import express from "express";
import cors from "cors";
import mongoose from "mongoose";
import dotenv from "dotenv";
// import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import cookieParser from "cookie-parser";
import path from "path";
import { fileURLToPath } from "url";
import User from "./models/user.js";
import usersRoutes from "./routes/users.js";
import fileRoutes from "./routes/files.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config();

const app = express();
const port = 5000;

const connectDB = async () => {
  console.log("Attempting to connect to MongoDB...");

  try {
    const conn = await mongoose.connect(process.env.MONGODB_URI);
    console.log(`MongoDB Connected to: ${conn.connection.name}`);

    await conn.connection.db.admin().ping();
    console.log("🗄️ Database ping successful");

    return conn.connection.db;
  } catch (err) {
    console.error("MongoDB connection error:", err.message);
    process.exit(1);
  }
};

const questionSchema = new mongoose.Schema(
  {
    question: {
      type: String,
      required: [true, "Question text is required"],
      trim: true,
      minlength: [10, "Question must be at least 10 characters long"],
    },

    options: {
      type: [String],
      required: [true, "Options are required"],
      validate: {
        validator: function (options) {
          return options.length >= 2 && options.length <= 6;
        },
        message: "Must have between 2 and 6 options",
      },
    },

    correctAnswer: {
      type: String,
      required: [true, "Correct answer is required"],
      validate: {
        validator: function (answer) {
          return this.options.includes(answer);
        },
        message: "Correct answer must be one of the provided options",
      },
    },

    category: {
      type: String,
      required: [true, "Category is required"],
      enum: [
        "Fundamental Nursing",
        "Medical-Surgical",
        "Pediatric",
        "Obstetric",
        "Psychiatric",
        "Community Health",
        "Critical Care",
        "Emergency",
        "Other",
      ],
      default: "Other",
    },

    difficulty: {
      type: String,
      enum: ["Easy", "Medium", "Hard"],
      default: "Medium",
    },

    explanation: {
      type: String,
      trim: true,
    },

    tags: [
      {
        type: String,
        trim: true,
      },
    ],

    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: false, // Made optional for now
    },

    isActive: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
  }
);

// Add indexes for better query performance
questionSchema.index({ category: 1 });
questionSchema.index({ difficulty: 1 });
questionSchema.index({ createdBy: 1 });
questionSchema.index({ tags: 1 });

const Question = mongoose.model("Question", questionSchema);

// Authentication middleware
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1]; // Bearer TOKEN

  if (!token) {
    return res.status(401).json({
      success: false,
      message: "Access token required",
    });
  }

  jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({
        success: false,
        message: "Invalid or expired token",
      });
    }

    req.userId = user.userId;
    next();
  });
};

// Initialize connection before starting server
const initializeServer = async () => {
  try {
    const db = await connectDB();

    // Middleware setup
    app.use(
      cors({
        origin: "http://localhost:3000",
        credentials: true,
        methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
        allowedHeaders: ["Content-Type", "Authorization"],
      })
    );

    app.use(express.json());
    app.use(cookieParser());

    // Serve static files from uploads directory
    app.use("/uploads", express.static(path.join(__dirname, "uploads")));

    // Add route middlewares
    app.use("/api/users", usersRoutes);
    app.use("/api/files", fileRoutes); // Add this line

    // ============= LOGOUT ENDPOINT =============
    app.post("/api/auth/logout", (req, res) => {
      console.log("🚪 Logout attempt");

      try {
        // Since you're using JWT tokens (stateless), we don't need to do much server-side
        // The client will remove the token from localStorage/cookies

        res.status(200).json({
          success: true,
          message: "Logged out successfully",
        });

        console.log("✅ Logout successful");
      } catch (err) {
        console.error("❌ Logout error:", err);
        res.status(500).json({
          success: false,
          message: "Logout failed",
        });
      }
    });

    // ============= QUESTIONS ENDPOINTS =============

    // GET all questions
    app.get("/api/questions", async (req, res) => {
      console.log("📚 Fetching all questions");

      try {
        const questions = await Question.find({ isActive: true })
          .populate("createdBy", "username email")
          .sort({ createdAt: -1 });

        res.status(200).json({
          success: true,
          questions: questions,
          count: questions.length,
          message: "Questions fetched successfully",
        });

        console.log(`✅ Fetched ${questions.length} questions`);
      } catch (err) {
        console.error("❌ Error fetching questions:", err);
        res.status(500).json({
          success: false,
          message: "Failed to fetch questions",
        });
      }
    });

    // POST create new question
    app.post("/api/questions", async (req, res) => {
      console.log("📝 Creating new question");
      console.log("Request body:", req.body);

      try {
        const {
          question,
          options,
          correctAnswer,
          category,
          difficulty,
          explanation,
          tags,
        } = req.body;

        // Basic validation
        if (!question || !options || !correctAnswer) {
          return res.status(400).json({
            success: false,
            message: "Question, options, and correct answer are required",
          });
        }

        // Validate options array
        if (!Array.isArray(options) || options.length < 2) {
          return res.status(400).json({
            success: false,
            message: "At least 2 options are required",
          });
        }

        // Validate correct answer is in options
        if (!options.includes(correctAnswer)) {
          return res.status(400).json({
            success: false,
            message: "Correct answer must be one of the provided options",
          });
        }

        const newQuestion = new Question({
          question: question.trim(),
          options: options.map((opt) => opt.trim()),
          correctAnswer: correctAnswer.trim(),
          category: category || "Other",
          difficulty: difficulty || "Medium",
          explanation: explanation ? explanation.trim() : "",
          tags: tags || [],
          // createdBy: req.userId // Uncomment when using auth middleware
        });

        const savedQuestion = await newQuestion.save();

        console.log("✅ Question created successfully:", savedQuestion._id);

        res.status(201).json({
          success: true,
          message: "Question created successfully",
          question: savedQuestion,
        });
      } catch (err) {
        console.error("❌ Error creating question:", err);

        // Handle validation errors
        if (err.name === "ValidationError") {
          return res.status(400).json({
            success: false,
            message: "Validation failed",
            errors: Object.values(err.errors).map((e) => e.message),
          });
        }

        res.status(500).json({
          success: false,
          message: "Failed to create question",
          error:
            process.env.NODE_ENV === "development" ? err.message : undefined,
        });
      }
    });

    // GET single question by ID
    app.get("/api/questions/:id", async (req, res) => {
      console.log(`📖 Fetching question ${req.params.id}`);

      try {
        const question = await Question.findById(req.params.id).populate(
          "createdBy",
          "username email"
        );

        if (!question) {
          return res.status(404).json({
            success: false,
            message: "Question not found",
          });
        }

        res.status(200).json({
          success: true,
          question: question,
        });
      } catch (err) {
        console.error("❌ Error fetching question:", err);
        res.status(500).json({
          success: false,
          message: "Failed to fetch question",
        });
      }
    });

    // PUT update question
    app.put("/api/questions/:id", async (req, res) => {
      console.log(`📝 Updating question ${req.params.id}`);

      try {
        const { id } = req.params;
        const updateData = req.body;

        // Remove fields that shouldn't be updated directly
        delete updateData._id;
        delete updateData.createdAt;
        delete updateData.updatedAt;

        // Validate if correctAnswer is in options (if both are being updated)
        if (updateData.options && updateData.correctAnswer) {
          if (!updateData.options.includes(updateData.correctAnswer)) {
            return res.status(400).json({
              success: false,
              message: "Correct answer must be one of the provided options",
            });
          }
        }

        const updatedQuestion = await Question.findByIdAndUpdate(
          id,
          updateData,
          { new: true, runValidators: true }
        ).populate("createdBy", "username email");

        if (!updatedQuestion) {
          return res.status(404).json({
            success: false,
            message: "Question not found",
          });
        }

        console.log("✅ Question updated successfully:", updatedQuestion._id);

        res.status(200).json({
          success: true,
          message: "Question updated successfully",
          question: updatedQuestion,
        });
      } catch (err) {
        console.error("❌ Error updating question:", err);

        if (err.name === "ValidationError") {
          return res.status(400).json({
            success: false,
            message: "Validation failed",
            errors: Object.values(err.errors).map((e) => e.message),
          });
        }

        res.status(500).json({
          success: false,
          message: "Failed to update question",
        });
      }
    });

    // DELETE question (soft delete)
    app.delete("/api/questions/:id", async (req, res) => {
      console.log(`🗑️ Deleting question ${req.params.id}`);

      try {
        const { id } = req.params;

        // Soft delete by setting isActive to false
        const deletedQuestion = await Question.findByIdAndUpdate(
          id,
          { isActive: false },
          { new: true }
        );

        if (!deletedQuestion) {
          return res.status(404).json({
            success: false,
            message: "Question not found",
          });
        }

        console.log("✅ Question deleted successfully:", deletedQuestion._id);

        res.status(200).json({
          success: true,
          message: "Question deleted successfully",
        });
      } catch (err) {
        console.error("❌ Error deleting question:", err);
        res.status(500).json({
          success: false,
          message: "Failed to delete question",
        });
      }
    });

    // GET questions by category
    app.get("/api/questions/category/:category", async (req, res) => {
      console.log(`📚 Fetching questions for category: ${req.params.category}`);

      try {
        const questions = await Question.find({
          category: req.params.category,
          isActive: true,
        })
          .populate("createdBy", "username email")
          .sort({ createdAt: -1 });

        res.status(200).json({
          success: true,
          questions: questions,
          count: questions.length,
          category: req.params.category,
        });
      } catch (err) {
        console.error("❌ Error fetching questions by category:", err);
        res.status(500).json({
          success: false,
          message: "Failed to fetch questions by category",
        });
      }
    });

    // Debug route - Check environment variables
    app.get("/api/debug", (req, res) => {
      res.json({
        hasJWTSecret: !!process.env.JWT_SECRET,
        jwtSecretLength: process.env.JWT_SECRET
          ? process.env.JWT_SECRET.length
          : 0,
        hasMongoURI: !!process.env.MONGODB_URI,
        nodeEnv: process.env.NODE_ENV,
        timestamp: new Date().toISOString(),
      });
    });

    // Cleanup route for testing - Delete specific user
    app.delete("/api/cleanup/:identifier", async (req, res) => {
      try {
        const { identifier } = req.params;
        const result = await User.deleteOne({
          $or: [{ username: identifier }, { email: identifier }],
        });
        res.json({
          message: "User deleted",
          deletedCount: result.deletedCount,
        });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    });

    // Clear all users route for development (DELETE method)
    app.delete("/api/clear-all-users", async (req, res) => {
      try {
        // Only allow in development
        if (process.env.NODE_ENV === "production") {
          return res.status(403).json({ error: "Not allowed in production" });
        }

        const result = await User.deleteMany({});
        console.log(`🗑️ Cleared ${result.deletedCount} users from database`);
        res.json({
          message: "All users cleared",
          deletedCount: result.deletedCount,
        });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    });

    // Clear all users route for development (GET method - for easy browser access)
    app.get("/api/clear-all-users", async (req, res) => {
      try {
        // Only allow in development
        if (process.env.NODE_ENV === "production") {
          return res.status(403).json({ error: "Not allowed in production" });
        }

        const result = await User.deleteMany({});
        console.log(`🗑️ Cleared ${result.deletedCount} users from database`);
        res.json({
          message: "All users cleared via GET",
          deletedCount: result.deletedCount,
          note: "This GET method is for development convenience only",
        });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    });

    // Clear all questions route for development
    app.delete("/api/clear-all-questions", async (req, res) => {
      try {
        // Only allow in development
        if (process.env.NODE_ENV === "production") {
          return res.status(403).json({ error: "Not allowed in production" });
        }

        const result = await Question.deleteMany({});
        console.log(
          `🗑️ Cleared ${result.deletedCount} questions from database`
        );
        res.json({
          message: "All questions cleared",
          deletedCount: result.deletedCount,
        });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    });

    // Check database connection
    app.get("/api/check-db", async (req, res) => {
      try {
        const collections = await db.listCollections().toArray();
        res.json({
          status: "Database connection active",
          collections: collections.map((c) => c.name),
        });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    });

    // Register route with detailed logging
    app.post("/api/register", async (req, res) => {
      console.log("\n🚀 === REGISTRATION ATTEMPT ===");
      console.log("📝 Request body:", JSON.stringify(req.body, null, 2));
      console.log("🔧 Environment check:");
      console.log("  - JWT_SECRET exists:", !!process.env.JWT_SECRET);
      console.log(
        "  - JWT_SECRET length:",
        process.env.JWT_SECRET ? process.env.JWT_SECRET.length : 0
      );

      try {
        const {
          username,
          email,
          password,
          fullName,
          role = "perawat",
        } = req.body;

        // Validation
        if (!username || !email || !password) {
          console.log("❌ Missing required fields");
          return res.status(400).json({
            success: false,
            message: "All fields are required",
          });
        }

        if (username.trim().length < 3) {
          return res.status(400).json({
            success: false,
            message: "Username must be at least 3 characters long",
          });
        }

        console.log("🔍 Checking for existing user...");
        const existingUser = await User.findOne({
          $or: [{ username }, { email }],
        });

        if (existingUser) {
          console.log("❌ User already exists");
          return res.status(409).json({
            success: false,
            message:
              existingUser.username === username
                ? "Username already exists"
                : "Email already registered",
          });
        }

        console.log("👤 Creating new user...");

        const userData = {
          userName: username.trim(),
          email: email.trim().toLowerCase(),
          password,
          fullName: fullName || username,
          role: role || "perawat",
          isActive: true,
        };

        if (role === "perawat") {
          userData.unit = "General";
        } else if (role === "admin") {
          userData.unit = "General";
        }

        // Create new user
        const newUser = new User({
          username: username.trim(),
          email: email.trim().toLowerCase(),
          password,
          fullName: fullName || username,
          role: role || "perawat",
          isActive: true,
        });

        console.log("💾 Saving user to database...");
        const savedUser = await newUser.save();
        console.log("✅ User saved successfully:", {
          id: savedUser._id,
          username: savedUser.username,
          email: savedUser.email,
          role: savedUser.role,
        });

        console.log("🔐 Generating JWT token...");

        // Check if JWT_SECRET exists
        if (!process.env.JWT_SECRET) {
          console.error("❌ JWT_SECRET not found in environment variables");
          throw new Error("JWT_SECRET not configured");
        }

        const tokenPayload = {
          user: {
            id: savedUser._id,
            username: savedUser.username,
            email: savedUser.email,
            role: savedUser.role,
            fullName: savedUser.fullName,
            unit: savedUser.unit,
            permissions: savedUser.permissions || [],
          },
        };

        const token = jwt.sign(
          { userId: savedUser._id },
          process.env.JWT_SECRET,
          { expiresIn: "1d" }
        );
        console.log("✅ JWT token generated successfully");

        // Include role in response
        const userResponse = {
          _id: savedUser._id,
          username: savedUser.username,
          email: savedUser.email,
          role: savedUser.role,
          fullName: savedUser.fullName,
          unit: savedUser.unit,
          createdAt: savedUser.createdAt,
        };

        console.log("✅ Registration completed successfully for:", username);
        console.log("=== END REGISTRATION ===\n");

        res.status(201).json({
          success: true,
          message: "Registration successful",
          user: userResponse,
          token,
        });
      } catch (err) {
        console.error("\n💥 === REGISTRATION ERROR ===");
        console.error("Error name:", err.name);
        console.error("Error message:", err.message);
        console.error("Full error:", err);
        console.error("=== END ERROR ===\n");

        if (err.name === "ValidationError") {
          console.error("Validation errors:", Object.keys(err.errors));
          Object.keys(err.errors).forEach((field) => {
            console.error(`${field}: ${err.errors[field].message}`);
          });
        }

        console.error("=== END ERROR ===\n");

        // Handle specific errors
        if (err.code === 11000) {
          const field = Object.keys(err.keyPattern)[0];
          return res.status(409).json({
            success: false,
            message: `${field} already exists`,
          });
        }

        if (err.message.includes("JWT_SECRET")) {
          return res.status(500).json({
            success: false,
            message: "Server configuration error",
          });
        }

        // Validation errors
        if (err.name === "ValidationError") {
          const errorMessages = Object.values(err.errors).map((e) => e.message);
          return res.status(400).json({
            success: false,
            message: "Validation failed",
            errors: Object.values(err.errors).map((e) => e.message),
          });
        }

        // Generic error
        res.status(500).json({
          success: false,
          message: "Internal server error",
          ...(process.env.NODE_ENV === "development" && {
            error: err.message,
            stack: err.stack,
          }),
        });
      }
    });

    // Login route - Updated userResponse object
    app.post("/api/login", async (req, res) => {
      console.log("\n🔐 === LOGIN ATTEMPT ===");
      console.log(
        "📝 Request body:",
        JSON.stringify(
          {
            identifier: req.body.identifier,
            password: "[HIDDEN]",
          },
          null,
          2
        )
      );
      console.log("🔧 Environment check:");
      console.log("  - JWT_SECRET exists:", !!process.env.JWT_SECRET);

      try {
        const { identifier, password } = req.body;

        // Validation
        if (!identifier || !password) {
          console.log("❌ Missing required fields");
          return res.status(400).json({
            success: false,
            message: "Email/username and password are required",
          });
        }

        console.log("🔍 Searching for user...");

        // Find user by email or username
        const foundUser = await User.findOne({
          $or: [
            { email: identifier.toLowerCase().trim() },
            { username: identifier.trim() },
          ],
        });

        if (!foundUser) {
          console.log("❌ User not found for identifier:", identifier);
          return res.status(401).json({
            success: false,
            message: "Invalid credentials",
          });
        }

        console.log("✅ User found:", {
          id: foundUser._id,
          username: foundUser.username,
          email: foundUser.email,
          role: foundUser.role,
        });

        console.log("🔓 Verifying password...");

        // Verify password using the model method
        const isPasswordValid = await foundUser.comparePassword(password);

        if (!isPasswordValid) {
          console.log("❌ Invalid password for user:", foundUser.username);
          return res.status(401).json({
            success: false,
            message: "Invalid credentials",
          });
        }

        console.log("✅ Password verified successfully");
        console.log("🔐 Generating JWT token...");

        // Check if JWT_SECRET exists
        if (!process.env.JWT_SECRET) {
          console.error("❌ JWT_SECRET not found in environment variables");
          throw new Error("JWT_SECRET not configured");
        }

        const token = jwt.sign(
          { userId: foundUser._id },
          process.env.JWT_SECRET,
          { expiresIn: "1d" }
        );
        console.log("✅ JWT token generated successfully");

        // Update last login (optional)
        foundUser.lastLogin = new Date();
        await foundUser.save();
        console.log("📅 Last login updated");

        // Include role in response
        const userResponse = {
          _id: foundUser._id,
          username: foundUser.username,
          email: foundUser.email,
          role: foundUser.role,
          createdAt: foundUser.createdAt,
          lastLogin: foundUser.lastLogin,
        };

        console.log("✅ Login completed successfully for:", foundUser.username);
        console.log("=== END LOGIN ===\n");

        res.status(200).json({
          success: true,
          message: "Login successful",
          user: userResponse,
          token,
        });
      } catch (err) {
        console.error("\n💥 === LOGIN ERROR ===");
        console.error("Error name:", err.name);
        console.error("Error message:", err.message);
        console.error("Full error:", err);
        console.error("=== END ERROR ===\n");

        // Handle JWT errors
        if (err.message.includes("JWT_SECRET")) {
          return res.status(500).json({
            success: false,
            message: "Server configuration error",
          });
        }

        // Generic error
        res.status(500).json({
          success: false,
          message: "Internal server error",
          ...(process.env.NODE_ENV === "development" && {
            error: err.message,
            stack: err.stack,
          }),
        });
      }
    });

    app.post("/api/auth/verify", async (req, res) => {
      console.log("🔍 Token verification attempt");

      try {
        const authHeader = req.headers["authorization"];
        const token = authHeader && authHeader.split(" ")[1];

        if (!token) {
          console.log("❌ No token provided");
          return res.status(401).json({
            success: false,
            message: "Access token required",
            valid: false,
          });
        }

        jwt.verify(token, process.env.JWT_SECRET, async (err, encoded) => {
          if (err) {
            console.log("❌ Invalid or expired token", err.message);
            return res.status(403).json({
              success: false,
              message: "Invalid or expired token",
              valid: false,
            });
          }

          try {
            const user = await User.findById(encoded.userId).select(
              "-password"
            );

            if (!user) {
              console.log("❌ User not found for token");
              return res.status(404).json({
                success: false,
                message: "User not found",
                valid: false,
              });
            }

            console.log(
              "✅ Token verified successfully for user:",
              user.username
            );

            res.status(200).json({
              success: true,
              message: "Token is valid",
              valid: true,
              user: {
                _id: user._id,
                username: user.username,
                email: user.email,
                role: user.role,
                createdAt: user.createdAt,
                lastLogin: user.lastLogin,
              },
            });
          } catch (dbErr) {
            console.error(
              "❌ Database error during token verification:",
              dbErr
            );
            res.status(500).json({
              success: false,
              message: "Database error",
              valid: false,
            });
          }
        });
      } catch (jwtErr) {
        console.error("❌ JWT error during token verification:", jwtErr);
        res.status(500).json({
          success: false,
          message: "Internal server error",
          valid: false,
        });
      }
    });

    // Test route
    app.get("/api/test", (req, res) => {
      res.json({
        message: "Server is working!",
        timestamp: new Date().toISOString(),
      });
    });

    app.post("/api/save-evaluation", async (req, res) => {
      console.log("Saving evaluation data");
      console.log("Request body:", req.body);

      try {
        if (!req.body.namaPerawat || !req.body.prosedur) {
          return res.status(400).json({
            success: false,
            message: "Nama Perawat dan Prosedur wajib diisi",
          });
        }

        console.log("Evaluation data received successfully");
        res.status(201).json({
          success: true,
          message: "Evaluation saved successfully",
          data: req.body,
        });
      } catch {}
    });

    const evaluationSchema = new mongoose.Schema({
      namaPerawat: { type: String, required: true },
      NPK: { type: String, required: true },
      unit: { type: String, required: true },
      prosedur: { type: String, required: true },
      catatan: String,
    });

    app.listen(port, () => {
      console.log(`🚀 Server running on port ${port}`);
      console.log(`🔍 Debug endpoint: http://localhost:${port}/api/debug`);
      console.log(`🔍 Test endpoint: http://localhost:${port}/api/test`);
      console.log(
        `🚀 Register endpoint: http://localhost:${port}/api/register`
      );
      console.log(`🔐 Login endpoint: http://localhost:${port}/api/login`);
      console.log(
        `🚪 Logout endpoint: http://localhost:${port}/api/auth/logout`
      );
      console.log(`🗄️ Check DB: http://localhost:${port}/api/check-db`);
      console.log(
        `🗑️ Clear all users: http://localhost:${port}/api/clear-all-users (DELETE)`
      );
      console.log(
        `🗑️ Clear all questions: http://localhost:${port}/api/clear-all-questions (DELETE)`
      );
      console.log(`👥 User routes: http://localhost:${port}/api/users`);
      console.log(
        `📚 Questions routes: http://localhost:${port}/api/questions`
      );
      console.log(`📁 Files routes: http://localhost:${port}/api/files`);
      console.log(`🔗 Static files: http://localhost:${port}/uploads`);
    });
  } catch (err) {
    console.error("❌ Server initialization failed:", err);
    process.exit(1);
  }
};

initializeServer();

// import express from "express";
// import cors from "cors";
// import mongoose from "mongoose";
// import dotenv from "dotenv";
// import bcrypt from "bcryptjs";
// import jwt from "jsonwebtoken";
// import cookieParser from "cookie-parser";
// import path from "path";
// import { fileURLToPath } from 'url';
// import multer from 'multer';
// import User from "./models/user.js";
// import usersRoutes from "./routes/users.js";
// import fileRoutes from "./routes/files.js";
// import authRoutes from "./routes/auth.js";
// import adminRoutes from "./routes/admin.js";
// import examRoutes from "./routes/exams.js";
// import credentialRoutes from "./routes/credentials.js";

// const __filename = fileURLToPath(import.meta.url);
// const __dirname = path.dirname(__filename);

// dotenv.config();

// const app = express();
// const port = 5000;

// // File upload configuration
// const storage = multer.diskStorage({
//   destination: (req, file, cb) => {
//     cb(null, 'uploads/');
//   },
//   filename: (req, file, cb) => {
//     cb(null, Date.now() + '-' + file.originalname);
//   }
// });

// const upload = multer({
//   storage: storage,
//   fileFilter: (req, file, cb) => {
//     const allowedTypes = /jpeg|jpg|png|pdf|doc|docx/;
//     const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
//     const mimetype = allowedTypes.test(file.mimetype);

//     if (mimetype && extname) {
//       return cb(null, true);
//     } else {
//       cb(new Error('File type not supported'));
//     }
//   },
//   limits: { fileSize: 5 * 1024 * 1024 } // 5MB limit
// });

// const connectDB = async () => {
//   console.log("Attempting to connect to MongoDB...");

//   try {
//     const conn = await mongoose.connect(process.env.MONGODB_URI);
//     console.log(`MongoDB Connected to: ${conn.connection.name}`);

//     await conn.connection.db.admin().ping();
//     console.log("🗄️ Database ping successful");

//     return conn.connection.db;
//   } catch (err) {
//     console.error("MongoDB connection error:", err.message);
//     process.exit(1);
//   }
// };

// // Initialize connection before starting server
// const initializeServer = async () => {
//   try {
//     const db = await connectDB();

//     // Middleware setup
//     app.use(
//       cors({
//         origin: process.env.FRONTEND_URL || "http://localhost:3000",
//         credentials: true,
//         methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
//         allowedHeaders: ["Content-Type", "Authorization"],
//       })
//     );

//     app.use(express.json());
//     app.use(express.urlencoded({ extended: true }));
//     app.use(cookieParser());

//     // Serve static files from uploads directory
//     app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

//     // Add route middlewares
//     app.use("/api/users", usersRoutes);
//     app.use("/api/files", fileRoutes);
//     app.use("/api/auth", authRoutes);
//     app.use("/api/admin", authMiddleware(['admin', 'kepala_unit']), adminRoutes);
//     app.use("/api/exams", authMiddleware(['admin', 'kepala_unit', 'perawat']), examRoutes);
//     app.use("/api/credentials", authMiddleware(['admin', 'kepala_unit']), credentialRoutes);

//     // Health check endpoint
//     app.get('/api/health', (req, res) => {
//       res.json({
//         status: 'OK',
//         timestamp: new Date().toISOString(),
//         service: 'Keperawatan Backend API'
//       });
//     });

//     // Presentation evaluation endpoint
//     app.post('/api/evaluations/presentation', authMiddleware(['admin', 'kepala_unit']), async (req, res) => {
//       try {
//         const {
//           nurseId,
//           topic,
//           month,
//           documentationScores,
//           preparationScores,
//           executionScores,
//           contentScores,
//           discussionScores,
//           evaluatorId
//         } = req.body;

//         // Calculate scores
//         const documentationTotal = documentationScores.reduce((sum, score) => sum + parseInt(score), 0);
//         const preparationAvg = preparationScores.reduce((sum, score) => sum + parseInt(score), 0) / preparationScores.length;
//         const executionAvg = executionScores.reduce((sum, score) => sum + parseInt(score), 0) / executionScores.length;
//         const contentAvg = contentScores.reduce((sum, score) => sum + parseInt(score), 0) / contentScores.length;
//         const discussionAvg = discussionScores.reduce((sum, score) => sum + parseInt(score), 0) / discussionScores.length;

//         const scoreA = documentationTotal * 1; // Weight = 1
//         const scoreB = (preparationAvg * 0.5 + executionAvg * 1 + contentAvg * 1 + discussionAvg * 1.5) / 4;
//         const finalScore = (0.2 * scoreA) + (0.8 * scoreB);

//         const evaluation = {
//           nurseId,
//           topic,
//           month,
//           evaluatorId,
//           scores: {
//             documentation: documentationScores,
//             preparation: preparationScores,
//             execution: executionScores,
//             content: contentScores,
//             discussion: discussionScores
//           },
//           calculatedScores: {
//             scoreA,
//             scoreB,
//             finalScore
//           },
//           createdAt: new Date(),
//           updatedAt: new Date()
//         };

//         // Save to database (implement based on your DB choice)
//         // For now, we'll just return the calculated scores
//         res.json({
//           success: true,
//           message: 'Evaluation saved successfully',
//           data: evaluation
//         });

//       } catch (error) {
//         console.error('Error saving evaluation:', error);
//         res.status(500).json({
//           success: false,
//           message: 'Failed to save evaluation',
//           error: error.message
//         });
//       }
//     });

//     // Get all evaluations
//     app.get('/api/evaluations', authMiddleware(['admin', 'kepala_unit']), async (req, res) => {
//       try {
//         const { month, nurseId, page = 1, limit = 10 } = req.query;

//         // Build filter object
//         const filter = {};
//         if (month) filter.month = month;
//         if (nurseId) filter.nurseId = nurseId;

//         // Implement pagination and filtering based on your DB
//         const evaluations = []; // Fetch from database

//         res.json({
//           success: true,
//           data: evaluations,
//           pagination: {
//             page: parseInt(page),
//             limit: parseInt(limit),
//             total: evaluations.length
//           }
//         });

//       } catch (error) {
//         console.error('Error fetching evaluations:', error);
//         res.status(500).json({
//           success: false,
//           message: 'Failed to fetch evaluations',
//           error: error.message
//         });
//       }
//     });

//     // Get nurses list
//     app.get('/api/nurses', authMiddleware(['admin', 'kepala_unit']), async (req, res) => {
//       try {
//         const nurses = [
//           { id: 1, name: 'Nama Perawat 1', nip: '12345', unit: 'ICU' },
//           { id: 2, name: 'Nama Perawat 2', nip: '12346', unit: 'Emergency' },
//           { id: 3, name: 'Nama Perawat 3', nip: '12347', unit: 'Surgery' }
//         ];

//         res.json({
//           success: true,
//           data: nurses
//         });

//       } catch (error) {
//         console.error('Error fetching nurses:', error);
//         res.status(500).json({
//           success: false,
//           message: 'Failed to fetch nurses',
//           error: error.message
//         });
//       }
//     });

//     // Error handling middleware
//     app.use((error, req, res, next) => {
//       console.error('Error:', error);

//       if (error.name === 'ValidationError') {
//         return res.status(400).json({
//           success: false,
//           message: 'Validation Error',
//           errors: error.errors
//         });
//       }

//       if (error.name === 'JsonWebTokenError') {
//         return res.status(401).json({
//           success: false,
//           message: 'Invalid token'
//         });
//       }

//       if (error.name === 'TokenExpiredError') {
//         return res.status(401).json({
//           success: false,
//           message: 'Token expired'
//         });
//       }

//       res.status(500).json({
//         success: false,
//         message: 'Internal server error',
//         error: process.env.NODE_ENV === 'development' ? error.message : 'Something went wrong'
//       });
//     });

//     // 404 handler
//     app.use('*', (req, res) => {
//       res.status(404).json({
//         success: false,
//         message: 'Route not found'
//       });
//     });

//     // Start the server
//     app.listen(port, () => {
//       console.log(`🚀 Server running on port ${port}`);
//       console.log(`🏥 Keperawatan Backend API - Environment: ${process.env.NODE_ENV || 'development'}`);
//       console.log(`🔍 Health check: http://localhost:${port}/api/health`);
//       console.log(`🔐 Auth routes: http://localhost:${port}/api/auth`);
//       console.log(`👥 User routes: http://localhost:${port}/api/users`);
//       console.log(`📚 Exam routes: http://localhost:${port}/api/exams`);
//       console.log(`📁 File routes: http://localhost:${port}/api/files`);
//       console.log(`🔗 Static files: http://localhost:${port}/uploads`);
//     });
//   } catch (err) {
//     console.error("❌ Server initialization failed:", err);
//     process.exit(1);
//   }
// };

// initializeServer();
