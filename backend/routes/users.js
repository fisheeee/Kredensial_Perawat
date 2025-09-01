import express from "express";
import User from "../models/user.js";

const router = express.Router();

// Role validation middleware
const validateRoleUpdate = (req, res, next) => {
  if (req.body.role) {
    // Normalize role to lowercase
    req.body.role = req.body.role.toLowerCase();

    const allowedRoles = ['admin', 'mitra', 'perawat'];
    if (!allowedRoles.includes(req.body.role)) {
      return res.status(400).json({
        error: `Invalid role. Allowed roles: ${allowedRoles.join(', ')}`
      });
    }
  }
  next();
};

// GET /api/users - Fetch all users
router.get("/", async (req, res) => {
  try {
    const users = await User.find({}).select("-password");
    res.json(users);
  } catch (error) {
    console.error("Error fetching users:", error);
    res.status(500).json({ error: "Failed to fetch users" });
  }
});

// GET /api/users/:id - Get specific user
router.get("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const foundUser = await User.findById(id).select("-password");

    if (!foundUser) {
      return res.status(404).json({ error: "User not found" });
    }

    res.json(foundUser);
  } catch (error) {
    console.error("Error fetching user:", error);
    res.status(500).json({ error: "Failed to fetch user" });
  }
});

// PUT /api/users/:id - Update user (with role validation)
router.put("/:id", validateRoleUpdate, async (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body;

    console.log('Updating user:', id, 'with data:', updates);

    const allowedUpdates = ["name", "email", "npk", "role"];
    const filteredUpdates = {};

    Object.keys(updates).forEach((key) => {
      if (allowedUpdates.includes(key)) {
        filteredUpdates[key] = updates[key];
      }
    });

    const updatedUser = await User
      .findByIdAndUpdate(id, filteredUpdates, {
        new: true,
        runValidators: true,
      })
      .select("-password");

    if (!updatedUser) {
      return res.status(404).json({ error: "User not found" });
    }

    res.json(updatedUser);
  } catch (error) {
    console.error("Error updating user:", error);
    res.status(500).json({ error: "Failed to update user" });
  }
});

// PATCH /api/users/:id/role - Update user role specifically
router.patch("/:id/role", validateRoleUpdate, async (req, res) => {
  try {
    const { id } = req.params;
    const { role } = req.body;
    
    // Log the role change for audit purposes
    console.log(`Role change request: User ${id} -> ${role}`);
    
    const updatedUser = await User
      .findByIdAndUpdate(id, { role }, {
        new: true,
        runValidators: true,
      })
      .select("-password");

    if (!updatedUser) {
      return res.status(404).json({ error: "User not found" });
    }
    
    // Log successful change
    console.log(`Role changed successfully: User ${id} is now ${role}`);
    
    res.json({
      message: 'Role updated successfully',
      user: updatedUser
    });
  } catch (error) {
    console.error('Error updating user role:', error);
    res.status(500).json({ error: "Failed to update user role" });
  }
});

// DELETE /api/users/:id - Delete user
router.delete("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const deletedUser = await User.findByIdAndDelete(id);

    if (!deletedUser) {
      return res.status(404).json({ error: "User not found" });
    }

    res.json({ message: "User deleted successfully" });
  } catch (error) {
    console.error("Error deleting user:", error);
    res.status(500).json({ error: "Failed to delete user" });
  }
});

export default router;