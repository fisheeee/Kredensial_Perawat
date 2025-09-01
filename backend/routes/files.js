import express from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import File from "../models/file.js";
import {
  authenticateToken as auth,
  requireRole,
} from "../middleware/roleAuth.js";

const router = express.Router();

// Constants for nurse schedules
const SCHEDULE_CATEGORY = "jadwal_perawat";
const ALLOWED_EXCEL_TYPES = [
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
];

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const uploadDir = "uploads/files";
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    const fileExtension = path.extname(file.originalname);
    cb(null, "file-" + uniqueSuffix + fileExtension);
  },
});

const fileFilter = (req, file, cb) => {
  const allowedTypes = [
    "application/pdf",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ...ALLOWED_EXCEL_TYPES,
    "application/vnd.ms-powerpoint",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "text/plain",
    "image/jpeg",
    "image/png",
    "image/gif",
    "application/zip",
    "application/x-zip-compressed",
  ];

  // Special validation for schedule files
  if (
    req.body.category === SCHEDULE_CATEGORY &&
    !ALLOWED_EXCEL_TYPES.includes(file.mimetype)
  ) {
    return cb(new Error("Only Excel files allowed for nurse schedules"), false);
  }

  if (allowedTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error("File type not allowed"), false);
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 50 * 1024 * 1024 },
});

const formatFileSize = (bytes) => {
  const sizes = ["Bytes", "KB", "MB", "GB"];
  if (bytes === 0) return "0 Bytes";
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return Math.round((bytes / Math.pow(1024, i)) * 100) / 100 + " " + sizes[i];
};

const getFileType = (mimetype) => {
  const typeMap = {
    "application/pdf": "pdf",
    "application/msword": "docx",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
      "docx",
    "application/vnd.ms-excel": "xlsx",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
    "application/vnd.ms-powerpoint": "ppt",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation":
      "ppt",
    "text/plain": "txt",
    "image/jpeg": "img",
    "image/png": "img",
    "image/gif": "img",
    "application/zip": "zip",
    "application/x-zip-compressed": "zip",
  };
  return typeMap[mimetype] || "default";
};

router.use((req, res, next) => {
  console.log(`📁 Files router - ${req.method} ${req.originalUrl}`);
  next();
});

router.get("/", auth, async (req, res) => {
  try {
    const { category, search, page = 1, limit = 10, month, unit } = req.query;

    let query = { isActive: true };

    if (category && category !== "all") {
      query.category = category;

      // Special handling for schedule queries
      if (category === SCHEDULE_CATEGORY) {
        if (month) query["metadata.month"] = month;
        if (unit) query["metadata.unit"] = unit;
      }
    }

    if (search) {
      query.$or = [
        { displayName: { $regex: search, $options: "i" } },
        { originalName: { $regex: search, $options: "i" } },
        ...(category === SCHEDULE_CATEGORY
          ? [
              { "metadata.month": { $regex: search, $options: "i" } },
              { "metadata.unit": { $regex: search, $options: "i" } },
            ]
          : []),
      ];
    }

    const files = await File.find(query)
      .populate("uploadedBy", "name email")
      .sort({ uploadedAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit)
      .exec();

    const total = await File.countDocuments(query);

    res.json({
      success: true,
      data: {
        files: files.map((file) => ({
          id: file._id,
          name: file.displayName,
          originalName: file.originalName,
          category: file.category,
          type: file.fileType,
          size: file.sizeFormatted,
          url: file.url,
          uploadedBy: file.uploadedBy,
          uploadedAt: file.uploadedAt,
          downloadCount: file.downloadCount,
          ...(file.category === SCHEDULE_CATEGORY && {
            month: file.metadata?.month,
            unit: file.metadata?.unit,
          }),
        })),
        pagination: {
          current: parseInt(page),
          pages: Math.ceil(total / limit),
          total: total,
        },
      },
    });
  } catch (error) {
    console.error("Error fetching files:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching files",
      error: error.message,
    });
  }
});

// Special endpoint for nurse schedules
router.get("/schedules", auth, async (req, res) => {
  try {
    const { month, unit, year } = req.query;

    const query = {
      isActive: true,
      category: SCHEDULE_CATEGORY,
      ...(month && { "metadata.month": month }),
      ...(unit && { "metadata.unit": unit }),
      ...(year && { "metadata.year": parseInt(year) }),
    };

    const schedules = await File.find(query)
      .sort({ "metadata.year": -1, "metadata.month": -1 })
      .populate("uploadedBy", "name")
      .lean();

    res.json({
      success: true,
      data: schedules.map((schedule) => ({
        ...schedule,
        displayName:
          schedule.displayName ||
          `Jadwal Perawat ${schedule.metadata?.unit || ""} - ${
            schedule.metadata?.month || ""
          } ${schedule.metadata?.year || ""}`.trim(),
      })),
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

router.post(
  "/",
  auth,
  requireRole(["admin", "kepala-unit"]), // Allow kepala-unit to upload
  upload.single("file"),
  async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({
          success: false,
          message: "No file provided",
        });
      }

      const { displayName, category, month, unit, year } = req.body;

      // Validate required fields for schedules
      if (category === SCHEDULE_CATEGORY) {
        if (!month || !unit) {
          fs.unlinkSync(req.file.path);
          return res.status(400).json({
            success: false,
            message: "Month and unit are required for nurse schedules",
          });
        }

        if (!ALLOWED_EXCEL_TYPES.includes(req.file.mimetype)) {
          fs.unlinkSync(req.file.path);
          return res.status(400).json({
            success: false,
            message: "Only Excel files allowed for nurse schedules",
          });
        }
      }

      const newFile = new File({
        fileName: req.file.filename,
        originalName: req.file.originalname,
        displayName:
          displayName ||
          (category === SCHEDULE_CATEGORY
            ? `Jadwal Perawat ${unit} - ${month} ${
                year || new Date().getFullYear()
              }`
            : req.file.originalname),
        category: category || "guidelines",
        fileType: getFileType(req.file.mimetype),
        size: req.file.size,
        sizeFormatted: formatFileSize(req.file.size),
        path: req.file.path,
        url: `/api/files/download/${req.file.filename}`,
        uploadedBy: req.user.id,
        ...(category === SCHEDULE_CATEGORY && {
          metadata: {
            month,
            unit,
            year: year || new Date().getFullYear(),
            scheduleType: "nurse",
          },
        }),
      });

      await newFile.save();

      res.status(201).json({
        success: true,
        message: "File uploaded successfully",
        data: {
          id: newFile._id,
          name: newFile.displayName,
          category: newFile.category,
          type: newFile.fileType,
          size: newFile.sizeFormatted,
          url: newFile.url,
          ...(newFile.category === SCHEDULE_CATEGORY && {
            month: newFile.metadata?.month,
            unit: newFile.metadata?.unit,
            year: newFile.metadata?.year,
          }),
        },
      });
    } catch (error) {
      if (req.file?.path && fs.existsSync(req.file.path)) {
        fs.unlinkSync(req.file.path);
      }
      console.error("Upload error:", error);
      res.status(500).json({
        success: false,
        message: error.message,
      });
    }
  }
);

// Keep existing download, delete, and stats routes unchanged
router.get("/download/:filename", auth, async (req, res) => {
  try {
    const { filename } = req.params;

    const file = await File.findOne({ fileName: filename, isActive: true });

    if (!file) {
      return res.status(404).json({
        success: false,
        message: "File not found",
      });
    }

    if (!fs.existsSync(file.path)) {
      return res.status(404).json({
        success: false,
        message: "File not found on server",
      });
    }

    await file.incrementDownload();

    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${file.originalName}"`
    );
    res.setHeader("Content-Type", "application/octet-stream");

    res.sendFile(path.resolve(file.path));
  } catch (error) {
    console.error("Error downloading file:", error);
    res.status(500).json({
      success: false,
      message: "Error downloading file",
      error: error.message,
    });
  }
});

router.delete("/:id", auth, requireRole(["admin"]), async (req, res) => {
  try {
    const { id } = req.params;

    const file = await File.findById(id);

    if (!file) {
      return res.status(404).json({
        success: false,
        message: "File not found",
      });
    }

    file.isActive = false;
    await file.save();

    res.json({
      success: true,
      message: "File deleted successfully",
    });
  } catch (error) {
    console.error("Error deleting file:", error);
    res.status(500).json({
      success: false,
      message: "Error deleting file",
      error: error.message,
    });
  }
});

router.get("/stats", auth, requireRole(["admin"]), async (req, res) => {
  try {
    const stats = await File.aggregate([
      { $match: { isActive: true } },
      {
        $group: {
          _id: "$category",
          count: { $sum: 1 },
          totalSize: { $sum: "$size" },
          totalDownloads: { $sum: "$downloadCount" },
        },
      },
    ]);

    const totalFiles = await File.countDocuments({ isActive: true });
    const totalSize = await File.aggregate([
      { $match: { isActive: true } },
      { $group: { _id: null, total: { $sum: "$size" } } },
    ]);

    res.json({
      success: true,
      data: {
        totalFiles,
        totalSize: totalSize[0]?.total || 0,
        totalSizeFormatted: formatFileSize(totalSize[0]?.total || 0),
        categoryStats: stats,
      },
    });
  } catch (error) {
    console.error("Error fetching stats:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching statistics",
      error: error.message,
    });
  }
});

router.use((error, req, res, next) => {
  if (error instanceof multer.MulterError) {
    if (error.code === "LIMIT_FILE_SIZE") {
      return res.status(400).json({
        success: false,
        message: "File too large. Maximum size is 50MB.",
      });
    }
  }

  if (error.message === "File type not allowed") {
    return res.status(400).json({
      success: false,
      message:
        "File type not allowed. Please upload PDF, DOC, XLS, PPT, TXT, images, or ZIP files.",
    });
  }

  next(error);
});

export default router;
