import express from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import User from "../models/user.js";
import {
  requirePermission,
  requireRole,
  hasPermission,
} from "../middleware/roleAuth.js";
import auth from "../middleware/auth.js";

const router = express.Router();

router.get(
  "/",
  auth,
  requirePermission("view_credentials"),
  async (req, res) => {
    try {
      const { page = 1, limit = 10, search, department, status } = req.query;
      const userRole = req.user.role;

      let query = {};

      if (!["admin", "supervisor"].includes(userRole)) {
        query.userId = req.user.id;
      }

      if (search) {
        query.$or = [
          { nurseId: { $regex: search, $options: "i" } },
          { nurseName: { $regex: search, $options: "i" } },
          { licenseNumber: { $regex: search, $options: "i" } },
        ];
      }

      if (department) {
        query.department = department;
      }

      if (status) {
        query.status = status;
      }

      const credentials = await Credential.find(query)
        .populate("userId", "username email")
        .skip((page - 1) * limit)
        .limit(limit)
        .sort({ createdAt: -1 });

      const totalCredentials = await Credential.countDocuments(query);

      res.json({
        success: true,
        data: {
          credentials,
          totalPages: Math.ceil(totalCredentials / limit),
          currentPage: page,
          totalCredentials,
        },
      });
    } catch (error) {
      console.error("Get credentials error:", error);
      res.status(500).json({
        success: false,
        message: "Error fetching credentials",
      });
    }
  }
);

router.get(
  "/:id",
  auth,
  requirePermission("view_credentials"),
  async (req, res) => {
    try {
      const credential = await Credential.findbyId(req.params.id).populate(
        "userId",
        "username email role"
      );

      if (!credential) {
        return res.status(404).json({
          success: false,
          message: "Credential not found",
        });
      }

      const userRole = req.user.role;
      if (
        !["admin", "supervisor"].includes(userRole) &&
        credential.userId._id.toString() !== req.user.id
      ) {
        return res.status(403).json({
          success: false,
          message: "Access denied. You can only view your own credentials.",
        });
      }

      res.json({
        success: true,
        data: credential,
      });
    } catch (error) {
      console.error("Get credential error:", error);
      res.status(500).json({
        success: false,
        message: "Error fetching credential",
      });
    }
  }
);

router.get(
  "/stats/overview",
  auth,
  requireRole(["admin", "supervisor"]),
  async (req, res) => {
    try {
      const totalCredentials = await Credential.countDocuments();
      const activeCredentials = await Credential.countDocuments({
        status: "active",
      });
      const expiredCredentials = await Credential.countDocuments({
        status: "expired",
      });
      const pendingCredentials = await Credential.countDocuments({
        status: "pending",
      });

      // Get credentials by department
      const credentialsByDepartment = await Credential.aggregate([
        {
          $group: {
            _id: "$department",
            count: { $sum: 1 },
          },
        },
        { $sort: { count: -1 } },
      ]);

      // Get recent credentials
      const recentCredentials = await Credential.find()
        .populate("userId", "username")
        .sort({ createdAt: -1 })
        .limit(5);

      res.json({
        success: true,
        data: {
          overview: {
            total: totalCredentials,
            active: activeCredentials,
            expired: expiredCredentials,
            pending: pendingCredentials,
          },
          byDepartment: credentialsByDepartment,
          recent: recentCredentials,
        },
      });
    } catch (error) {
      console.error("Get credentials stats error:", error);
      res.status(500).json({
        success: false,
        message: "Error fetching credentials statistics",
      });
    }
  }
);

router.post(
  "/",
  auth,
  requirePermission("create_credentials"),
  async (req, res) => {
    try {
      const {
        nurseId,
        nurseName,
        licenseNumber,
        licenseType,
        issueDate,
        expiryDate,
        department,
        specializations,
        certifications,
        notes,
      } = req.body;

      // Validation
      if (!nurseId || !nurseName || !licenseNumber || !licenseType) {
        return res.status(400).json({
          success: false,
          message:
            "Required fields: nurseId, nurseName, licenseNumber, licenseType",
        });
      }

      // Check if license number already exists
      const existingCredential = await Credential.findOne({ licenseNumber });
      if (existingCredential) {
        return res.status(400).json({
          success: false,
          message: "License number already exists",
        });
      }

      // Calculate status based on expiry date
      let status = "active";
      if (expiryDate && new Date(expiryDate) < new Date()) {
        status = "expired";
      }

      // Create credential
      const credential = new Credential({
        nurseId,
        nurseName,
        licenseNumber,
        licenseType,
        issueDate,
        expiryDate,
        department,
        specializations: specializations || [],
        certifications: certifications || [],
        notes,
        status,
        userId: req.user.id,
        createdBy: req.user.id,
      });

      await credential.save();

      // Populate user data for response
      await credential.populate("userId", "username email");

      res.status(201).json({
        success: true,
        message: "Credential created successfully",
        data: credential,
      });
    } catch (error) {
      console.error("Create credential error:", error);
      res.status(500).json({
        success: false,
        message: "Error creating credential",
      });
    }
  }
);

router.post("/bulk-import", auth, requireRole(["admin"]), async (req, res) => {
  try {
    const { credentials } = req.body;

    if (!Array.isArray(credentials) || credentials.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Invalid credentials data",
      });
    }

    const results = {
      successful: 0,
      failed: 0,
      errors: [],
    };

    for (let i = 0; i < credentials.length; i++) {
      try {
        const credData = credentials[i];

        // Check if license number already exists
        const existingCredential = await Credential.findOne({
          licenseNumber: credData.licenseNumber,
        });

        if (existingCredential) {
          results.failed++;
          results.errors.push({
            row: i + 1,
            error: `License number ${credData.licenseNumber} already exists`,
          });
          continue;
        }

        // Calculate status
        let status = "active";
        if (credData.expiryDate && new Date(credData.expiryDate) < new Date()) {
          status = "expired";
        }

        const credential = new Credential({
          ...credData,
          status,
          userId: req.user.id,
          createdBy: req.user.id,
        });

        await credential.save();
        results.successful++;
      } catch (error) {
        results.failed++;
        results.errors.push({
          row: i + 1,
          error: error.message,
        });
      }
    }

    res.json({
      success: true,
      message: "Bulk import completed",
      data: results,
    });
  } catch (error) {
    console.error("Bulk import error:", error);
    res.status(500).json({
      success: false,
      message: "Error during bulk import",
    });
  }
});

router.put(
  "/:id",
  auth,
  requirePermission("edit_credentials"),
  async (req, res) => {
    try {
      const credential = await Credential.findById(req.params.id);

      if (!credential) {
        return res.status(404).json({
          success: false,
          message: "Credential not found",
        });
      }

      // Check if user can edit this credential
      const userRole = req.user.role;
      if (
        !["admin", "supervisor"].includes(userRole) &&
        credential.userId.toString() !== req.user.id
      ) {
        return res.status(403).json({
          success: false,
          message: "Access denied. You can only edit your own credentials.",
        });
      }

      const {
        nurseId,
        nurseName,
        licenseNumber,
        licenseType,
        issueDate,
        expiryDate,
        department,
        specializations,
        certifications,
        notes,
        status,
      } = req.body;

      // Check if license number is being changed and if it already exists
      if (licenseNumber && licenseNumber !== credential.licenseNumber) {
        const existingCredential = await Credential.findOne({
          licenseNumber,
          _id: { $ne: req.params.id },
        });

        if (existingCredential) {
          return res.status(400).json({
            success: false,
            message: "License number already exists",
          });
        }
      }

      // Calculate status if expiry date is provided
      let newStatus = status;
      if (expiryDate && !status) {
        newStatus = new Date(expiryDate) < new Date() ? "expired" : "active";
      }

      // Update credential
      const updatedCredential = await Credential.findByIdAndUpdate(
        req.params.id,
        {
          nurseId: nurseId || credential.nurseId,
          nurseName: nurseName || credential.nurseName,
          licenseNumber: licenseNumber || credential.licenseNumber,
          licenseType: licenseType || credential.licenseType,
          issueDate: issueDate || credential.issueDate,
          expiryDate: expiryDate || credential.expiryDate,
          department: department || credential.department,
          specializations: specializations || credential.specializations,
          certifications: certifications || credential.certifications,
          notes: notes !== undefined ? notes : credential.notes,
          status: newStatus || credential.status,
          updatedAt: Date.now(),
          updatedBy: req.user.id,
        },
        { new: true }
      ).populate("userId", "username email");

      res.json({
        success: true,
        message: "Credential updated successfully",
        data: updatedCredential,
      });
    } catch (error) {
      console.error("Update credential error:", error);
      res.status(500).json({
        success: false,
        message: "Error updating credential",
      });
    }
  }
);

router.put(
  "/:id/status",
  auth,
  requireRole(["admin", "supervisor"]),
  async (req, res) => {
    try {
      const { status } = req.body;

      if (!["active", "expired", "suspended", "pending"].includes(status)) {
        return res.status(400).json({
          success: false,
          message:
            "Invalid status. Must be: active, expired, suspended, or pending",
        });
      }

      const credential = await Credential.findByIdAndUpdate(
        req.params.id,
        {
          status,
          updatedAt: Date.now(),
          updatedBy: req.user.id,
        },
        { new: true }
      ).populate("userId", "username email");

      if (!credential) {
        return res.status(404).json({
          success: false,
          message: "Credential not found",
        });
      }

      res.json({
        success: true,
        message: "Credential status updated successfully",
        data: credential,
      });
    } catch (error) {
      console.error("Update credential status error:", error);
      res.status(500).json({
        success: false,
        message: "Error updating credential status",
      });
    }
  }
);

router.delete(
  "/:id",
  auth,
  requirePermission("delete_credentials"),
  async (req, res) => {
    try {
      const credential = await Credential.findById(req.params.id);

      if (!credential) {
        return res.status(404).json({
          success: false,
          message: "Credential not found",
        });
      }

      // Check if user can delete this credential
      const userRole = req.user.role;
      if (!["admin"].includes(userRole)) {
        // Only admin can delete credentials
        return res.status(403).json({
          success: false,
          message: "Access denied. Only administrators can delete credentials.",
        });
      }

      await Credential.findByIdAndDelete(req.params.id);

      res.json({
        success: true,
        message: "Credential deleted successfully",
      });
    } catch (error) {
      console.error("Delete credential error:", error);
      res.status(500).json({
        success: false,
        message: "Error deleting credential",
      });
    }
  }
);

router.delete(
  "/bulk-delete",
  auth,
  requireRole(["admin"]),
  async (req, res) => {
    try {
      const { credentialIds } = req.body;

      if (!Array.isArray(credentialIds) || credentialIds.length === 0) {
        return res.status(400).json({
          success: false,
          message: "Invalid credential IDs",
        });
      }

      const result = await Credential.deleteMany({
        _id: { $in: credentialIds },
      });

      res.json({
        success: true,
        message: `${result.deletedCount} credentials deleted successfully`,
        data: {
          deletedCount: result.deletedCount,
        },
      });
    } catch (error) {
      console.error("Bulk delete credentials error:", error);
      res.status(500).json({
        success: false,
        message: "Error deleting credentials",
      });
    }
  }
);

router.post(
  "/search",
  auth,
  requirePermission("view_credentials"),
  async (req, res) => {
    try {
      const {
        searchTerm,
        filters = {},
        sortBy = "createdAt",
        sortOrder = "desc",
        page = 1,
        limit = 10,
      } = req.body;

      let query = {};
      const userRole = req.user.role;

      // Role-based filtering
      if (!["admin", "supervisor"].includes(userRole)) {
        query.userId = req.user.id;
      }

      // Search term
      if (searchTerm) {
        query.$or = [
          { nurseId: { $regex: searchTerm, $options: "i" } },
          { nurseName: { $regex: searchTerm, $options: "i" } },
          { licenseNumber: { $regex: searchTerm, $options: "i" } },
          { department: { $regex: searchTerm, $options: "i" } },
        ];
      }

      // Apply filters
      Object.keys(filters).forEach((key) => {
        if (
          filters[key] !== null &&
          filters[key] !== undefined &&
          filters[key] !== ""
        ) {
          query[key] = filters[key];
        }
      });

      // Execute search
      const credentials = await Credential.find(query)
        .populate("userId", "username email")
        .sort({ [sortBy]: sortOrder === "desc" ? -1 : 1 })
        .limit(limit * 1)
        .skip((page - 1) * limit);

      const totalResults = await Credential.countDocuments(query);

      res.json({
        success: true,
        data: {
          credentials,
          totalPages: Math.ceil(totalResults / limit),
          currentPage: page,
          totalResults,
        },
      });
    } catch (error) {
      console.error("Search credentials error:", error);
      res.status(500).json({
        success: false,
        message: "Error searching credentials",
      });
    }
  }
);

router.get(
  "/export/data",
  auth,
  requireRole(["admin", "supervisor"]),
  async (req, res) => {
    try {
      const { format = "json", filters = {} } = req.query;

      let query = {};

      // Apply filters
      Object.keys(filters).forEach((key) => {
        if (filters[key]) {
          query[key] = filters[key];
        }
      });

      const credentials = await Credential.find(query)
        .populate("userId", "username email")
        .sort({ createdAt: -1 });

      if (format === "csv") {
        // Convert to CSV format
        const csvData = credentials.map((cred) => ({
          "Nurse ID": cred.nurseId,
          "Nurse Name": cred.nurseName,
          "License Number": cred.licenseNumber,
          "License Type": cred.licenseType,
          Department: cred.department,
          Status: cred.status,
          "Issue Date": cred.issueDate
            ? cred.issueDate.toISOString().split("T")[0]
            : "",
          "Expiry Date": cred.expiryDate
            ? cred.expiryDate.toISOString().split("T")[0]
            : "",
          "Created By": cred.userId ? cred.userId.username : "",
          "Created Date": cred.createdAt.toISOString().split("T")[0],
        }));

        res.setHeader("Content-Type", "text/csv");
        res.setHeader(
          "Content-Disposition",
          "attachment; filename=credentials.csv"
        );

        // Simple CSV conversion (you might want to use a proper CSV library)
        const csvHeaders = Object.keys(csvData[0] || {}).join(",");
        const csvRows = csvData.map((row) => Object.values(row).join(","));
        const csvContent = [csvHeaders, ...csvRows].join("\n");

        res.send(csvContent);
      } else {
        res.json({
          success: true,
          data: credentials,
        });
      }
    } catch (error) {
      console.error("Export credentials error:", error);
      res.status(500).json({
        success: false,
        message: "Error exporting credentials",
      });
    }
  }
);

module.exports = router;
