import express from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import User from "../models/user.js";
import {
  menuAccess,
  rolePermissions,
  getRoleRedirectUrl,
} from "../config/roles.js";

const router = express.Router();

const tokenBlacklist = new Set();

const addTokenToBlacklist = (token) => {
  tokenBlacklist.add(token);
  const decoded = jwt.decode(token);
  if (decoded?.exp) {
    const expiresIn = decoded.exp * 1000 - Date.now();
    setTimeout(() => tokenBlacklist.delete(token), expiresIn);
  }
};

const isTokenBlacklisted = (token) => tokenBlacklist.has(token);

// Authentication Middleware
const verifyToken = (req, res, next) => {
  const authHeader = req.header("Authorization");
  const token = authHeader?.startsWith("Bearer ")
    ? authHeader.split(" ")[1]
    : req.cookies?.token;

  if (!token) {
    return res.status(401).json({
      success: false,
      message: "Authentication required",
    });
  }

  if (isTokenBlacklisted(token)) {
    return res.status(401).json({
      success: false,
      message: "Session expired. Please login again.",
    });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded.user;
    req.token = token;
    next();
  } catch (error) {
    console.error("Token verification error:", error.message);
    const message =
      error.name === "TokenExpiredError" ? "Session expired" : "Invalid token";
    res.status(401).json({ success: false, message });
  }
};

// User Registration
router.post("/register", async (req, res) => {
  try {
    const { username, email, password, role = "perawat" } = req.body;

    // Validation
    if (!username || !email || !password) {
      return res.status(400).json({
        success: false,
        message: "All fields are required",
        missingFields: {
          username: !username,
          email: !email,
          password: !password,
        },
      });
    }

    // Check existing user
    const existingUser = await User.findOne({ $or: [{ email }, { username }] });
    if (existingUser) {
      const field = existingUser.email === email ? "email" : "username";
      return res.status(409).json({
        success: false,
        message: `User with this ${field} already exists`,
        conflictField: field,
      });
    }

    // Create and save user
    const user = new User({
      username,
      email,
      password,
      role,
      permissions: rolePermissions[role] || [],
    });

    await user.save();

    // Generate token for immediate login
    const token = jwt.sign(
      {
        user: { id: user._id, role: user.role, permissions: user.permissions },
      },
      process.env.JWT_SECRET,
      { expiresIn: "24h" }
    );

    res.status(201).json({
      success: true,
      message: "Registration successful",
      token,
      user: {
        id: user._id,
        username: user.username,
        email: user.email,
        role: user.role,
        permissions: user.permissions,
      },
      redirectUrl: getRoleRedirectUrl(user.role),
    });
  } catch (error) {
    console.error("Registration error:", error);
    const status = error.name === "ValidationError" ? 400 : 500;
    res.status(status).json({
      success: false,
      message: error.message || "Registration failed",
    });
  }
});

// User Login - Updated with robust password handling
router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: "Email and password are required",
      });
    }

    // Find user with password explicitly selected
    const user = await User.findOne({ email })
      .select("+password +isActive +role +permissions")
      .lean();

    if (!user) {
      console.log("Login attempt for non-existent user:", email);
      return res.status(401).json({
        success: false,
        message: "Invalid credentials",
      });
    }

    // Debug: Verify password field exists
    console.log("User object in login:", {
      id: user._id,
      hasPassword: !!user.password,
      isActive: user.isActive,
    });

    if (!user.password) {
      console.error("Password missing for user:", user._id);
      return res.status(500).json({
        success: false,
        message: "Authentication system error",
      });
    }

    // Check account status
    if (!user.isActive) {
      return res.status(403).json({
        success: false,
        message: "Account deactivated. Contact administrator.",
      });
    }

    // Compare passwords directly using bcrypt
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      console.log("Invalid password attempt for user:", user._id);
      return res.status(401).json({
        success: false,
        message: "Invalid credentials",
      });
    }

    // Update last login (need to use the model instance)
    await User.findByIdAndUpdate(user._id, { lastLogin: new Date() });

    // Create token payload (remove sensitive data)
    const userPayload = {
      id: user._id,
      username: user.username,
      email: user.email,
      role: user.role,
      permissions: user.permissions,
    };

    // Generate token
    const token = jwt.sign({ user: userPayload }, process.env.JWT_SECRET, {
      expiresIn: "24h",
    });

    // Set HTTP-only cookie
    res.cookie("token", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      maxAge: 24 * 60 * 60 * 1000,
    });

    res.json({
      success: true,
      token,
      user: {
        ...userPayload,
        menuAccess: menuAccess[user.role] || [],
      },
      redirectUrl: getRoleRedirectUrl(user.role),
    });

    await User.updateOne(
      { _id: user._id },
      { $set: { lastLogin: new Date() } },
      { runValidators: false }
    );
  } catch (error) {
    console.error("Login error:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Login failed",
    });
  }
});

router.get("/verify", verifyToken, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select("-password -__v");

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    res.json({
      success: true,
      user: {
        ...user.toObject(),
        menuAccess: menuAccess[user.role] || [],
      },
      redirectUrl: getRoleRedirectUrl(user.role),
    });
  } catch (error) {
    console.error("Verification error:", error);
    res.status(500).json({
      success: false,
      message: "Session verification failed",
    });
  }
});

// User Logout
router.post("/logout", verifyToken, async (req, res) => {
  try {
    addTokenToBlacklist(req.token);

    // Clear cookies
    res.clearCookie("token");
    res.clearCookie("refreshToken");

    res.json({
      success: true,
      message: "Logged out successfully",
    });
  } catch (error) {
    console.error("Logout error:", error);
    res.status(500).json({
      success: false,
      message: "Logout failed",
    });
  }
});

// Password Update (Protected Route)
router.put("/update-password", verifyToken, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    const user = await User.findById(req.user.id).select("+password");

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    // Verify current password
    const isMatch = await bcrypt.compare(currentPassword, user.password);
    if (!isMatch) {
      return res.status(401).json({
        success: false,
        message: "Current password is incorrect",
      });
    }

    // Update password
    const salt = await bcrypt.genSalt(12);
    user.password = await bcrypt.hash(newPassword, salt);
    await user.save();

    // Invalidate all tokens by adding to blacklist
    addTokenToBlacklist(req.token);

    res.json({
      success: true,
      message: "Password updated successfully",
    });
  } catch (error) {
    console.error("Password update error:", error);
    res.status(500).json({
      success: false,
      message: "Password update failed",
    });
  }
});

router.post("/refresh", async (req, res) => {
  try {
    const refreshToken = req.cookies.refreshToken || req.body.refreshToken;

    if (!refreshToken) {
      return res.status(401).json({
        success: false,
        message: "Refresh token required",
      });
    }

    const decoded = jwt.verify(
      refreshToken,
      process.env.JWT_REFRESH_SECRET 
      // || process.env.JWT_SECRET
    );

    const user = await User.findById(decoded.userId);
    if (!user || !user.isActive) {
      return res.status(404).json({
        success: false,
        message: "User not found or inactive",
      });
    }

    const newToken = jwt.sign(
      {
        user: {
          id: user._id,
          username: user.username,
          email: user.email,
          role: user.role,
          permissions: user.permissions,
        },
      },
      process.env.JWT_SECRET,
      { expiresIn: "1h" }
    );

    res.json({
      success: true,
      token: newToken,
      user: {
        id: user._id,
        username: user.username,
        email: user.email,
        role: user.role,
        permissions: user.permissions,
        menuAccess: menuAccess[user.role] || [],
      },
    });
  } catch (error) {
    console.error("Refresh token error:", error);

    if (
      error.name === "TokenExpiredError" ||
      error.name === "JsonWebTokenError"
    ) {
      return res.status(403).json({
        success: false,
        message: "Invalid or expired refresh token",
      });
    }

    res.status(500).json({
      success: false,
      message: "Token refresh failed",
    });
  }
});

export default router;
export { verifyToken };
