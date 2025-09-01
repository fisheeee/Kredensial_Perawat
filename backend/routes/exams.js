import express from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import { v4 as uuidv4 } from "uuid";

const router = express.Router();

router.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header(
    "Access-Control-Allow-Headers",
    "Origin, X-Requested-With, Content-Type, Accept, Authorization"
  );
  next();
});

router.use((req, res, next) => {
  console.log(`Incoming ${req.method} request to ${req.path}`);
  console.log("Headers:", req.headers);
  if (req.body) {
    console.log("Body:", JSON.stringify(req.body, null, 2));
  }
  next();
});

// Configure multer for image uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = "uploads/questions";
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, "question-" + uniqueSuffix + path.extname(file.originalname));
  },
});

const upload = multer({
  storage: storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|gif|webp/;
    const extname = allowedTypes.test(
      path.extname(file.originalname).toLowerCase()
    );
    const mimetype = allowedTypes.test(file.mimetype);

    if (mimetype && extname) {
      return cb(null, true);
    } else {
      cb(new Error("Only image files are allowed!"));
    }
  },
});

// In-memory storage (replace with your database)
let questions = [];
let exams = [];

// Upload image for question
router.post("/upload-image", upload.single("image"), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No image file provided" });
    }

    const imageUrl = `/uploads/questions/${req.file.filename}`;
    res.json({
      success: true,
      imageUrl: `${req.protocol}://${req.get("host")}${imageUrl}`,
      filename: req.file.filename,
    });
  } catch (error) {
    res
      .status(500)
      .json({ error: "Failed to upload image", details: error.message });
  }
});

// Create a new question - FIXED to handle both Indonesian and English field names
router.post("/questions", async (req, res) => {
  try {
    console.log("Incoming request body:", req.body);

    if (!req.body) {
      return res.status(400).json({
        success: false,
        message: "Request body is required",
      });
    }

    const {
      question,
      pertanyaan,
      type,
      options,
      pilihan,
      correctAnswer,
      jawabanBenar,
      category,
      kategori,
      difficulty,
      tingkatKesulitan,
      image,
    } = req.body;

    const questionText = pertanyaan || question;
    if (!questionText || !questionText.trim()) {
      return res.status(400).json({
        success: false,
        message: "Question text is required",
      });
    }

    if (!type) {
      return res.status(400).json({
        success: false,
        message: "Question type is required",
      });
    }

    const questionOptions = pilihan || options || [];
    const correctAns = jawabanBenar || correctAnswer;

    if (type === "multiple-choice" || type === "checkbox") {
      const validOptions = questionOptions.filter(
        (opt) => opt && opt.trim() !== ""
      );

      if (validOptions.length < 2) {
        return res.status(400).json({
          success: false,
          message: "At least 2 options are required for this question type",
        });
      }

      if (!correctAns) {
        return res.status(400).json({
          success: false,
          message: "Correct answer is required for this question type",
        });
      }

      if (!validOptions.includes(correctAns)) {
        return res.status(400).json({
          success: false,
          message: "Correct answer must be one of the options",
        });
      }
    }

    // Process the question
    const newQuestion = {
      id: uuidv4(),
      pertanyaan: questionText.trim(),
      question: questionText.trim(), // Include both for compatibility
      type,
      pilihan: (type === "multiple-choice" || type === "checkbox") 
        ? questionOptions.filter(opt => opt && opt.trim() !== "")
        : undefined,
      options: (type === "multiple-choice" || type === "checkbox") 
        ? questionOptions.filter(opt => opt && opt.trim() !== "")
        : undefined,
      jawabanBenar: correctAns,
      correctAnswer: correctAns,
      kategori: kategori || category || "Other",
      category: kategori || category || "Other",
      tingkatKesulitan: tingkatKesulitan || difficulty || "Medium",
      difficulty: tingkatKesulitan || difficulty || "Medium",
      image: image || null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    
    // Add to database or array
    questions.push(newQuestion);

    return res.status(201).json({
      success: true,
      question: newQuestion,
    });
  } catch (error) {
    console.error("Server error:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
});

// Get question by ID
router.get("/questions/:id", (req, res) => {
  try {
    const question = questions.find((q) => q.id === req.params.id);

    if (!question) {
      return res.status(404).json({ error: "Question not found" });
    }

    res.json({
      success: true,
      question,
    });
  } catch (error) {
    res
      .status(500)
      .json({ error: "Failed to fetch question", details: error.message });
  }
});

router.put("/questions/:id", (req, res) => {
  try {
    const questionIndex = questions.findIndex((q) => q.id === req.params.id);

    if (questionIndex === -1) {
      return res.status(404).json({ error: "Question not found" });
    }

    const {
      question,
      pertanyaan,
      type,
      options,
      pilihan,
      correctAnswer,
      jawabanBenar,
      category,
      kategori,
      difficulty,
      tingkatKesulitan,
      explanation,
      penjelasan,
      tags,
      image,
    } = req.body;

    // Use Indonesian names as primary, fallback to English
    const questionText = pertanyaan || question;
    const questionOptions = pilihan || options;
    const correctAns = jawabanBenar || correctAnswer;
    const questionCategory = kategori || category;
    const questionDifficulty = tingkatKesulitan || difficulty;
    const questionExplanation = penjelasan || explanation;

    if (questionText && !questionText.trim()) {
      return res.status(400).json({ error: "Question text cannot be empty" });
    }

    const updatedQuestion = {
      ...questions[questionIndex],
      ...(questionText && {
        pertanyaan: questionText.trim(),
        question: questionText.trim(),
      }),
      ...(type && { type }),
      ...(questionOptions !== undefined && {
        pilihan: Array.isArray(questionOptions)
          ? questionOptions.filter((p) => p && p.trim() !== "")
          : [],
        options: Array.isArray(questionOptions)
          ? questionOptions.filter((p) => p && p.trim() !== "")
          : [],
      }),
      ...(correctAns !== undefined && {
        jawabanBenar: correctAns,
        correctAnswer: correctAns,
      }),
      ...(questionCategory !== undefined && {
        kategori: questionCategory,
        category: questionCategory,
      }),
      ...(questionDifficulty !== undefined && {
        tingkatKesulitan: questionDifficulty,
        difficulty: questionDifficulty,
      }),
      ...(questionExplanation !== undefined && {
        penjelasan: questionExplanation,
        explanation: questionExplanation,
      }),
      ...(tags !== undefined && { tags }),
      ...(image !== undefined && { image }),
      updatedAt: new Date().toISOString(),
      updatedBy: req.user?.id || "system",
    };

    questions[questionIndex] = updatedQuestion;

    res.json({
      success: true,
      question: updatedQuestion,
      message: "Question updated successfully",
    });
  } catch (error) {
    res
      .status(500)
      .json({ error: "Failed to update question", details: error.message });
  }
});

// Delete question
router.delete("/questions/:id", (req, res) => {
  try {
    const questionIndex = questions.findIndex((q) => q.id === req.params.id);

    if (questionIndex === -1) {
      return res.status(404).json({ error: "Question not found" });
    }

    const deletedQuestion = questions[questionIndex];
    questions.splice(questionIndex, 1);

    // Delete associated image file if exists
    if (deletedQuestion.image && deletedQuestion.image.includes("/uploads/")) {
      const filename = deletedQuestion.image.split("/").pop();
      const filepath = path.join("uploads/questions", filename);

      fs.unlink(filepath, (err) => {
        if (err) console.warn("Failed to delete image file:", err.message);
      });
    }

    res.json({
      success: true,
      message: "Question deleted successfully",
    });
  } catch (error) {
    res
      .status(500)
      .json({ error: "Failed to delete question", details: error.message });
  }
});

// Rest of the routes remain the same...
router.put("/questions-reorder", (req, res) => {
  try {
    const { questionIds } = req.body;

    if (!Array.isArray(questionIds)) {
      return res.status(400).json({ error: "Question IDs must be an array" });
    }

    const reorderedQuestions = questionIds
      .map((id) => questions.find((q) => q.id === id))
      .filter(Boolean);

    const remainingQuestions = questions.filter(
      (q) => !questionIds.includes(q.id)
    );
    questions = [...reorderedQuestions, ...remainingQuestions];

    res.json({
      success: true,
      message: "Questions reordered successfully",
    });
  } catch (error) {
    res
      .status(500)
      .json({ error: "Failed to reorder questions", details: error.message });
  }
});

router.post("/exams", (req, res) => {
  try {
    const { title, description, questionIds, settings } = req.body;

    if (!title || !title.trim()) {
      return res.status(400).json({ error: "Exam title is required" });
    }

    if (
      !questionIds ||
      !Array.isArray(questionIds) ||
      questionIds.length === 0
    ) {
      return res
        .status(400)
        .json({ error: "At least one question is required" });
    }

    const examQuestions = questionIds
      .map((id) => questions.find((q) => q.id === id))
      .filter(Boolean);

    if (examQuestions.length !== questionIds.length) {
      return res.status(400).json({ error: "Some question IDs are invalid" });
    }

    const newExam = {
      id: uuidv4(),
      title: title.trim(),
      description: description?.trim() || "",
      questions: examQuestions,
      questionCount: examQuestions.length,
      settings: {
        timeLimit: settings?.timeLimit || null,
        shuffleQuestions: settings?.shuffleQuestions || false,
        showResults: settings?.showResults !== false,
        allowReview: settings?.allowReview !== false,
        passingScore: settings?.passingScore || 70,
        maxAttempts: settings?.maxAttempts || 1,
        ...settings,
      },
      status: "draft",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      createdBy: req.user?.id || "system",
    };

    exams.push(newExam);

    res.status(201).json({
      success: true,
      exam: newExam,
      message: "Exam created successfully",
    });
  } catch (error) {
    res
      .status(500)
      .json({ error: "Failed to create exam", details: error.message });
  }
});

router.get("/exams", (req, res) => {
  try {
    const { status, search, page = 1, limit = 20 } = req.query;
    let filteredExams = [...exams];

    if (status && status !== "all") {
      filteredExams = filteredExams.filter((exam) => exam.status === status);
    }

    if (search) {
      const searchLower = search.toLowerCase();
      filteredExams = filteredExams.filter(
        (exam) =>
          exam.title.toLowerCase().includes(searchLower) ||
          (exam.description &&
            exam.description.toLowerCase().includes(searchLower))
      );
    }

    const startIndex = (page - 1) * limit;
    const endIndex = startIndex + parseInt(limit);
    const paginatedExams = filteredExams.slice(startIndex, endIndex);

    res.json({
      success: true,
      exams: paginatedExams.sort(
        (a, b) => new Date(b.createdAt) - new Date(a.createdAt)
      ),
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(filteredExams.length / limit),
        totalExams: filteredExams.length,
        hasNext: endIndex < filteredExams.length,
        hasPrev: startIndex > 0,
      },
    });
  } catch (error) {
    res
      .status(500)
      .json({ error: "Failed to fetch exams", details: error.message });
  }
});

router.get("/exams/:id", (req, res) => {
  try {
    const exam = exams.find((e) => e.id === req.params.id);

    if (!exam) {
      return res.status(404).json({ error: "Exam not found" });
    }

    res.json({
      success: true,
      exam,
    });
  } catch (error) {
    res
      .status(500)
      .json({ error: "Failed to fetch exam", details: error.message });
  }
});

router.put("/exams/:id", (req, res) => {
  try {
    const examIndex = exams.findIndex((e) => e.id === req.params.id);

    if (examIndex === -1) {
      return res.status(404).json({ error: "Exam not found" });
    }

    const { title, description, questionIds, settings, status } = req.body;

    let examQuestions = exams[examIndex].questions;
    if (questionIds) {
      examQuestions = questionIds
        .map((id) => questions.find((q) => q.id === id))
        .filter(Boolean);
    }

    const updatedExam = {
      ...exams[examIndex],
      ...(title && { title: title.trim() }),
      ...(description !== undefined && {
        description: description?.trim() || "",
      }),
      ...(questionIds && {
        questions: examQuestions,
        questionCount: examQuestions.length,
      }),
      ...(settings && {
        settings: { ...exams[examIndex].settings, ...settings },
      }),
      ...(status && { status }),
      updatedAt: new Date().toISOString(),
      updatedBy: req.user?.id || "system",
    };

    exams[examIndex] = updatedExam;

    res.json({
      success: true,
      exam: updatedExam,
      message: "Exam updated successfully",
    });
  } catch (error) {
    res
      .status(500)
      .json({ error: "Failed to update exam", details: error.message });
  }
});

router.delete("/exams/:id", (req, res) => {
  try {
    const examIndex = exams.findIndex((e) => e.id === req.params.id);

    if (examIndex === -1) {
      return res.status(404).json({ error: "Exam not found" });
    }

    exams.splice(examIndex, 1);

    res.json({
      success: true,
      message: "Exam deleted successfully",
    });
  } catch (error) {
    res
      .status(500)
      .json({ error: "Failed to delete exam", details: error.message });
  }
});

router.put("/exams/:id/publish", (req, res) => {
  try {
    const examIndex = exams.findIndex((e) => e.id === req.params.id);

    if (examIndex === -1) {
      return res.status(404).json({ error: "Exam not found" });
    }

    if (exams[examIndex].questions.length === 0) {
      return res
        .status(400)
        .json({ error: "Cannot publish exam without questions" });
    }

    exams[examIndex].status = "published";
    exams[examIndex].publishedAt = new Date().toISOString();
    exams[examIndex].updatedAt = new Date().toISOString();

    res.json({
      success: true,
      exam: exams[examIndex],
      message: "Exam published successfully",
    });
  } catch (error) {
    res
      .status(500)
      .json({ error: "Failed to publish exam", details: error.message });
  }
});

router.get("/stats/overview", (req, res) => {
  try {
    const stats = {
      totalQuestions: questions.length,
      totalExams: exams.length,
      publishedExams: exams.filter((e) => e.status === "published").length,
      draftExams: exams.filter((e) => e.status === "draft").length,
      questionTypes: {
        "short-answer": questions.filter((q) => q.type === "short-answer")
          .length,
        "multiple-choice": questions.filter((q) => q.type === "multiple-choice")
          .length,
        checkbox: questions.filter((q) => q.type === "checkbox").length,
        "case-study": questions.filter((q) => q.type === "case-study").length,
      },
      recentActivity: {
        questionsThisWeek: questions.filter(
          (q) =>
            new Date(q.createdAt) >
            new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
        ).length,
        examsThisWeek: exams.filter(
          (e) =>
            new Date(e.createdAt) >
            new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
        ).length,
      },
    };

    res.json({
      success: true,
      stats,
    });
  } catch (error) {
    res
      .status(500)
      .json({ error: "Failed to fetch statistics", details: error.message });
  }
});

export default router;
