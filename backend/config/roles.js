const rolePermissions = {
  admin: [
    "view_credentials",
    "create_credentials",
    "edit_credentials",
    "delete_credentials",
    "manage_users",
    "view_reports",
    "system_settings",
  ],
  mitra: [
    "view_credentials",
    "create_credentials",
    "edit_credentials",
    "view_reports",
  ],
  perawat: ["view_credentials", "create_credentials"], // Added perawat role
};

const menuAccess = {
  admin: [
    "dashboard",
    "credentials",
    "users",
    "reports",
    "settings",
    "profile",
  ],
  mitra: ["dashboard", "credentials", "reports", "profile"],
  perawat: ["dashboard", "credentials", "profile"], // Added perawat role
  nurse: ["dashboard", "credentials", "profile"], // Keep for backward compatibility
};

// Role hierarchy for access control (higher number = more permissions)
const roleHierarchy = {
  perawat: 1, 
  mitra: 2,
  admin: 3,
};

// Helper functions
export const getRolePermissions = (role) => {
  return rolePermissions[role] || [];
};

export const getMenuAccess = (role) => {
  return menuAccess[role] || [];
};

export const hasPermission = (userRole, requiredPermission) => {
  const permissions = getRolePermissions(userRole);
  return permissions.includes(requiredPermission);
};

export const canAccessMenu = (userRole, menuItem) => {
  const menus = getMenuAccess(userRole);
  return menus.includes(menuItem);
};

export const getRoleLevel = (role) => {
  return roleHierarchy[role] || 0;
};

export const canAccessRole = (userRole, requiredRole) => {
  return getRoleLevel(userRole) >= getRoleLevel(requiredRole);
};

// Redirect URLs for each role
export const roleRedirects = {
  admin: "/dashboard-kepala-unit",
  mitra: "/dashboard-mitra-bestari",
  perawat: "/dashboard-perawat",
};

export const getRoleRedirectUrl = (role) => {
  return roleRedirects[role] || "/";
};

// Export the main objects
export { rolePermissions, menuAccess, roleHierarchy };