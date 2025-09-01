import express from "express";
import auth from "../middleware/auth.js";
import User from "../models/user.js";
import { requireRole, requirePermission } from "../middleware/roleAuth.js";

const router = express.Router();

router.get("/users", auth, requireRole(["admin"]), async (req, res) => {
  try {
    const users = await User.find({}, "-password");
    res.json({ success: true, users });
  } catch (error) {
    res.status(500).json({ success: false, message: "Server error" });
  }
});

router.put(
  "/users/:id/role",
  auth,
  requirePermission("manage_users"),
  async (req, res) => {
    try {
      const { role } = req.body;
      const { rolePermissions } = require("../config/roles");

      const user = await user.findbyIdAndUpdate(
        req.params.id,
        {
          role,
          permissions: rolePermissions[role] || [],
          updatedAt: Date.now(),
        },
        { new: true }
      ).select("-password");

      if (!user) {
        return res.status(404).json({
          success: false,
          message: "User not found",
        });
      }

      res.json({
        success: true,
        message: "User role updated successfully",
        user,
      });
    } catch (error) {
      res.status(500).json({ success: false, message: "Server error" });
    }
  }
);

module.exports = router;
