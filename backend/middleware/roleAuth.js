import jwt from "jsonwebtoken";
import { rolePermissions, getRoleRedirectUrl } from "../config/roles.js";
import User from "../models/user.js";

const hasPermission = (userRole, userPermissions, requiredPermission) => {
  const rolePerms = rolePermissions[userRole] || [];
  if (rolePerms.includes(requiredPermission)) return true;
  if (userPermissions && userPermissions.includes(requiredPermission))
    return true;
  return false;
};

export const authenticateToken = (req, res, next) => {
  try {
    const authHeader = req.headers["authorization"];
    const token = authHeader && authHeader.split(" ")[1];

    if (!token) {
      return res.status(401).json({
        success: false,
        message: "Access token required",
      });
    }

    jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
      if (err) {
        return res.status(403).json({
          success: false,
          message: "Invalid or expired token",
        });
      }

      let userData;

      if (decoded.user) {
        userData = decoded.user;
      } else if (decoded.role) {
        userData = {
          id: decoded.id,
          email: decoded.email,
          role: decoded.role,
          username: decoded.username,
          unit: decoded.unit,
          fullName: decoded.fullName,
          permissions: decoded.permissions || [],
        };
      } else {
        return res.status(403).json({
          success: false,
          message: "Invalid or expired token",
        });
      }

      if (!userData.role) {
        return res.status(403).json({
          success: false,
          message: "Invalid or expired token",
        });
      }

      req.user = userData;
      next();
    });
  } catch (error) {
    console.error("Authenticate error:", error);
    res.status(500).json({
      success: false,
      message: "Error authenticating token",
    });
  }
};

export const requiredPermission = (permission) => {
  return (req, res, next) => {
    try {
      if (!req.user) {
        return res.status(401).json({
          success: false,
          message: "User not authenticated",
        });
      }

      const { role, permissions } = req.user;

      if (!hasPermission(role, permissions, permission)) {
        const redirectUrl = getRoleRedirectUrl(role);

        return res.status(403).json({
          success: false,
          message: `Access denied. Permission "${permission}" required.`,
          redirectUrl,
          userRole: role,
        });
      }

      next();
    } catch (error) {
      console.error("Permission check error:", error);
      res.status(500).json({
        success: false,
        message: "Error checking permissions",
      });
    }
  };
};

export const requireRole = (allowedRoles) => {
  return async (req, res, next) => {
    try {
      if (!req.user) {
        return res.status(401).json({
          success: false,
          message: "User not authenticated",
        });
      }

      if (!req.user.role) {
        return res.status(403).json({
          success: false,
          message: "User role not defined",
        });
      }

      if (!allowedRoles.includes(req.user.role)) {
        return res.status(403).json({
          success: false,
          message: `Insufficient permissions. Required roles: ${allowedRoles.join(
            ", "
          )}`,
          userRole: req.user.role,
        });
      }

      next();
    } catch (error) {
      console.error("Role check error:", error);
      return res.status(500).json({
        success: false,
        message: "Internal server error during role check",
      });
    }
  };
};

export const requireMinimumRole = (minimumRole) => {
  const roleHierarchy = {
    perawat: 1,
    mitra: 2,
    admin: 3,
  };

  return (req, res, next) => {
    try {
      if (!req.user) {
        return res.status(401).json({
          success: false,
          message: "User not authenticated",
        });
      }

      const userRole = req.user.role;
      const userLevel = roleHierarchy[userRole] || 0;
      const requiredLevel = roleHierarchy[minimumRole] || 0;

      if (userLevel < requiredLevel) {
        const redirectUrl = getRoleRedirectUrl(userRole);

        return res.status(403).json({
          success: false,
          message: `Access denied. Minimum role "${minimumRole}" required.`,
          redirectUrl,
          userRole,
          minimumRole,
        });
      }

      next();
    } catch (error) {
      console.error("Minimum role check error:", error);
      res.status(500).json({
        success: false,
        message: "Error checking minimum roles",
      });
    }
  };
};

export const requireActiveUser = async (req, res, next) => {
  try {
    if (!req.user?.id) {
      return res.status(401).json({
        success: false,
        message: "User not authenticated",
      });
    }

    const foundUser = await User.findById(req.user.id);

    if (!foundUser) {
      return res.status(403).json({
        success: false,
        message: "Account is deactivated or not found",
        redirectUrl: "/login",
      });
    }

    await foundUser.updateLastLogin();
    req.userDetails = foundUser;
    next();
  } catch (error) {
    console.error("Active user check error:", error);
    res.status(500).json({
      success: false,
      message: "Error checking user status",
    });
  }
};

export const refreshUserData = async (req, res, next) => {
  try {
    if (!req.user?.id) {
      return res.status(401).json({
        success: false,
        message: "User not authenticated",
      });
    }

    const foundUser = await User.findActiveById(req.user.id);

    if (!foundUser) {
      return res.status(403).json({
        success: false,
        message: "User not found or inactive",
        redirectUrl: "/login",
      });
    }

    req.user = {
      id: foundUser.id || foundUser._id,
      username: foundUser.username,
      email: foundUser.email,
      fullName: foundUser.fullName,
      role: foundUser.role,
      permissions: foundUser.permissions,
      department: foundUser.department,
      npk: foundUser.npk,
      isActive: foundUser.isActive,
      lastLogin: foundUser.lastLogin,
    };

    req.userDetails = foundUser;
    next();
  } catch (error) {
    console.error("Refresh user data error:", error);
    res.status(500).json({
      success: false,
      message: "Error refreshing user data",
    });
  }
};

export const authorize = (options = {}) => {
  const middleware = [authenticateToken];

  if (options.refreshUserData) {
    middleware.push(refreshUserData);
  }

  if (options.activeuser !== false) {
    middleware.push(requireActiveUser);
  }

  if (options.roles) {
    middleware.push(requireRole(options.roles));
  }

  if (options.minimumRole) {
    middleware.push(requireMinimumRole(options.minimumRole));
  }

  if (options.permissions) {
    middleware.push(...options.permissions.map((p) => requiredPermission(p)));
  }

  return middleware;
};

export const checkMinimumRole = (userRole, minimumRole) => {
  const roleHierarchy = {
    perawat: 1,
    mitra: 2,
    admin: 3,
  };

  const userLevel = roleHierarchy[userRole] || 0;
  const requiredLevel = roleHierarchy[minimumRole] || 0;

  return userLevel >= requiredLevel;
};

export const logUserActivity = (action) => {
  return (req, res, next) => {
    try {
      const user = req.user;
      const timestamp = new Date().toISOString();

      console.log(
        `[${timestamp}] User Activity - ID: ${user?.id}, Username: ${user?.username}, Action: ${action}, IP: ${req.ip}`
      );

      next();
    } catch (error) {
      console.error("Log user activity error:", error);
      next();
    }
  };
};

export { hasPermission };
