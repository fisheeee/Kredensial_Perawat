import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import { v4 as uuidv4 } from "uuid";

const userSchema = new mongoose.Schema(
  {
    id: {
      type: String,
      default: () => uuidv4(),
      unique: true,
    },
    username: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      minlength: 3,
      maxlength: 30,
    },
    fullName: {
      type: String,
      required: false,
      trim: true,
      maxlength: 100,
      default: "",
    },
    email: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      lowercase: true,
      validate: {
        validator: (email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email),
        message: "Please provide a valid email address",
      },
    },
    password: {
      type: String,
      required: true,
      minlength: 8,
      select: false,
    },
    npk: {
      type: String,
      required: function () {
        return this.role === "perawat";
      },
      unique: true,
      sparse: true,
      validate: {
        validator: function (v) {
          return /^NPK\d{4}$/.test(v);
        },
        message: (props) =>
          `${props.value} is not a valid NPK format! Must be NPK followed by 4 digits (e.g., 1234)`,
      },
    },
    role: {
      type: String,
      enum: ["admin", "mitra", "perawat", "kepala-unit"],
      default: "perawat",
      required: true,
    },
    permissions: [
      {
        type: String,
        enum: [
          "view_credentials",
          "create_credentials",
          "edit_credentials",
          "delete_credentials",
          "manage_users",
          "view_reports",
          "system_settings",
        ],
      },
    ],
    unit: {
      type: String,
      required: function () {
        return this.role === "perawat" || this.role === "kepala-unit";
      },
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    lastLogin: {
      type: Date,
    },
    createdAt: {
      type: Date,
      default: Date.now,
    },
    updatedAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
    toJSON: {
      virtuals: true,
      transform: function (doc, ret) {
        delete ret.password;
        delete ret.__v;
        return ret;
      },
    },
    toObject: {
      virtuals: true,
      transform: function (doc, ret) {
        delete ret.password;
        delete ret.__v;
        return ret;
      },
    },
  }
);

userSchema.pre("save", async function (next) {
  if (!this.isModified("password")) return next();

  try {
    const salt = await bcrypt.genSalt(12);
    this.password = await bcrypt.hash(this.password, salt);
    next();
  } catch (error) {
    next(error);
  }
});

userSchema.pre("save", async function (next) {
  if (this.role === "perawat" && !this.npk) {
    try {
      const lastNurse = await this.constructor.findOne(
        { role: "perawat", npk: { $regex: /^NPK\d{4}$/ } },
        { npk: 1 },
        { sort: { npk: -1 } }
      );

      let nextNumber = 1;
      if (lastNurse?.npk) {
        const lastNumber = parseInt(lastNurse.npk.replace("NPK", ""), 10);
        nextNumber = lastNumber + 1;
      }

      this.npk = `${nextNumber.toString().padStart(4, "0")}`;
    } catch (error) {
      return next(error);
    }
  }
  next();
});

userSchema.statics = {
  generateMissingNPKs: async function () {
    try {
      const nurses = await this.find({
        role: "perawat",
        $or: [
          { npk: { $exists: false } },
          { npk: null },
          { npk: { $not: /^NPK\d{4}$/ } },
        ],
      }).sort({ createdAt: 1 });

      let nextNumber = 1;
      const lastNurse = await this.findOne(
        { role: "perawat", npk: { $regex: /^NPK\d{4}$/ } },
        { npk: 1 },
        { sort: { npk: -1 } }
      );

      if (lastNurse?.npk) {
        nextNumber = parseInt(lastNurse.npk.replace("NPK", ""), 10) + 1;
      }

      const updates = nurses.map((nurse, index) => {
        nurse.npk = `NPK${(nextNumber + index).toString().padStart(4, "0")}`;
        return nurse.save();
      });

      await Promise.all(updates);
      return { updatedCount: nurses.length };
    } catch (error) {
      throw new Error(`Failed to generate NPKs: ${error.message}`);
    }
  },

  createUser: async function (userData) {
    try {
      const newUser = new this(userData);
      await newUser.save();
      return newUser.toObject();
    } catch (error) {
      if (error.code === 11000) {
        const field = Object.keys(error.keyPattern)[0];
        throw new Error(`${field} already exists`);
      }
      throw new Error(`Failed to create user: ${error.message}`);
    }
  },

  findByUsername: async function (username) {
    try {
      return await this.findOne({ username, isActive: true }).select(
        "-password"
      );
    } catch (error) {
      throw new Error(`Failed to find user: ${error.message}`);
    }
  },

  findByEmail: async function (email) {
    try {
      return await this.findOne({ email, isActive: true }).select("-password");
    } catch (error) {
      throw new Error(`Failed to find user: ${error.message}`);
    }
  },

  findActiveById: async function (id) {
    try {
      return await this.findOne({
        $or: [{ _id: id }, { id: id }],
        isActive: true,
      }).select("-password");
    } catch (error) {
      throw new Error(`Failed to find user: ${error.message}`);
    }
  },

  findAllWithFilters: async function (filters = {}) {
    try {
      let query = { isActive: true };

      if (filters.role) query.role = filters.role;
      if (filters.unit) query.unit = filters.unit;

      if (filters.search) {
        const searchRegex = new RegExp(filters.search, "i");
        query.$or = [
          { username: searchRegex },
          { fullName: searchRegex },
          { email: searchRegex },
          { npk: searchRegex },
        ];
      }

      const page = parseInt(filters.page) || 1;
      const limit = parseInt(filters.limit) || 20;
      const skip = (page - 1) * limit;

      const [users, total] = await Promise.all([
        this.find(query)
          .select("-password")
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(limit),
        this.countDocuments(query),
      ]);

      return {
        users,
        pagination: {
          currentPage: page,
          totalPages: Math.ceil(total / limit),
          totalUsers: total,
          hasNext: skip + limit < total,
          hasPrev: page > 1,
        },
      };
    } catch (error) {
      throw new Error(`Failed to fetch users: ${error.message}`);
    }
  },

  getStats: async function () {
    try {
      const [totalUsers, roleDistribution, newUsersThisWeek] =
        await Promise.all([
          this.countDocuments({ isActive: true }),
          this.aggregate([
            { $match: { isActive: true } },
            { $group: { _id: "$role", count: { $sum: 1 } } },
            { $project: { role: "$_id", count: 1, _id: 0 } },
          ]),
          this.countDocuments({
            isActive: true,
            createdAt: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
          }),
        ]);

      return {
        totalUsers,
        roleDistribution,
        newUsersThisWeek,
      };
    } catch (error) {
      throw new Error(`Failed to get user statistics: ${error.message}`);
    }
  },

  updateUser: async function (userId, updateData) {
    try {
      const allowedUpdates = [
        "username",
        "email",
        "fullName",
        "role",
        "unit",
        "npk",
        "permissions",
        "isActive",
      ];

      const updates = Object.keys(updateData).reduce((acc, key) => {
        if (allowedUpdates.includes(key)) acc[key] = updateData[key];
        return acc;
      }, {});

      if (Object.keys(updates).length === 0) {
        throw new Error("No valid fields to update");
      }

      const user = await this.findOneAndUpdate(
        { $or: [{ _id: userId }, { id: userId }] },
        updates,
        { new: true, runValidators: true }
      ).select("-password");

      if (!user) throw new Error("User not found");
      return user;
    } catch (error) {
      if (error.code === 11000) {
        const field = Object.keys(error.keyPattern)[0];
        throw new Error(`${field} already exists`);
      }
      throw new Error(`Failed to update user: ${error.message}`);
    }
  },
};

userSchema.methods.comparePassword = async function (candidatePassword) {
  try {
    // If password isn't loaded, fetch it from database
    if (!this.password) {
      const userWithPassword = await this.constructor
        .findById(this._id)
        .select("+password");
      if (!userWithPassword?.password) {
        throw new Error("Could not retrieve user password");
      }
      return bcrypt.compare(candidatePassword, userWithPassword.password);
    }

    return bcrypt.compare(candidatePassword, this.password);
  } catch (error) {
    console.error("Password comparison error:", error);
    throw new Error("Failed to compare passwords");
  }
};

userSchema.statics.findByEmail = async function (
  email,
  includePassword = false
) {
  try {
    const query = this.findOne({ email, isActive: true });
    if (includePassword) {
      query.select("+password");
    } else {
      query.select("-password");
    }
    return await query.exec();
  } catch (error) {
    throw new Error(`Failed to find user: ${error.message}`);
  }
};

userSchema.methods = {
  comparePassword: async function (candidatePassword) {
    try {
      // If password isn't loaded, fetch it from database
      if (!this.password) {
        const userWithPassword = await this.constructor
          .findById(this._id)
          .select("+password");
        if (!userWithPassword?.password) {
          throw new Error("Could not retrieve user password");
        }
        return bcrypt.compare(candidatePassword, userWithPassword.password);
      }

      return bcrypt.compare(candidatePassword, this.password);
    } catch (error) {
      console.error("Password comparison error:", error);
      throw new Error("Failed to compare passwords");
    }
  },

  updatePassword: async function (newPassword) {
    try {
      const salt = await bcrypt.genSalt(12);
      this.password = await bcrypt.hash(newPassword, salt);
      return this.save();
    } catch (error) {
      console.error("Password update error:", error);
      throw new Error("Failed to update password");
    }
  },

  updateLastLogin: async function () {
    try {
      this.lastLogin = new Date();
      return this.save();
    } catch (error) {
      console.error("Last login update error:", error);
      throw new Error("Failed to update last login");
    }
  },

  softDelete: async function () {
    try {
      this.isActive = false;
      return this.save();
    } catch (error) {
      console.error("Soft delete error:", error);
      throw new Error("Failed to deactivate account");
    }
  },
};

// userSchema.methods = {
//   comparePassword: async function (candidatePassword) {
//     if (!candidatePassword || !this.password) {
//       throw new Error("Missing password for comparison");
//     }
//     return bcrypt.compare(candidatePassword, this.password);
//   },

//   updatePassword: async function (newPassword) {
//     this.password = newPassword;
//     return this.save();
//   },

//   updateLastLogin: async function () {
//     this.lastLogin = new Date();
//     return this.save();
//   },

//   softDelete: async function () {
//     this.isActive = false;
//     return this.save();
//   },
// };

// Indexes
userSchema.index({ role: 1 });
userSchema.index({ unit: 1 });
userSchema.index({ isActive: 1 });

export default mongoose.model("User", userSchema);

// import mongoose from "mongoose";
// import bcrypt from "bcryptjs";
// import { v4 as uuidv4 } from "uuid";
// import crypto from "crypto";

// const userSchema = new mongoose.Schema({
//   id: {
//     type: String,
//     default: () => uuidv4(),
//     unique: true,
//   },
//   name: {
//     type: String,
//     required: [true, 'Name is required'],
//     trim: true,
//     maxlength: [100, 'Name cannot exceed 100 characters']
//   },
//   username: {
//     type: String,
//     required: true,
//     unique: true,
//     trim: true,
//   },
//   email: {
//     type: String,
//     required: [true, 'Email is required'],
//     unique: true,
//     trim: true,
//     lowercase: true,
//     match: [/^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/, 'Please enter a valid email']
//   },
//   password: {
//     type: String,
//     required: [true, 'Password is required'],
//     minlength: [6, 'Password must be at least 6 characters'],
//     select: false
//   },
//   npk: {
//     type: String,
//     required: [true, 'NPK is required'],
//     unique: true,
//     trim: true,
//     maxlength: [20, 'NPK cannot exceed 20 characters']
//   },
//   role: {
//     type: String,
//     enum: ["admin", "mitra", "perawat", "kepala_unit"],
//     default: "perawat",
//     required: true
//   },
//   department: {
//     type: String,
//     required: [true, 'Department is required'],
//     trim: true,
//     maxlength: [50, 'Department cannot exceed 50 characters']
//   },
//   position: {
//     type: String,
//     trim: true,
//     maxlength: [100, 'Position cannot exceed 100 characters']
//   },
//   phoneNumber: {
//     type: String,
//     trim: true,
//     match: [/^[\+]?[1-9][\d]{0,15}$/, 'Please enter a valid phone number']
//   },
//   address: {
//     type: String,
//     trim: true,
//     maxlength: [200, 'Address cannot exceed 200 characters']
//   },
//   profilePicture: {
//     type: String,
//     default: null
//   },
//   permissions: [
//     {
//       type: String,
//       enum: [
//         "view_credentials",
//         "create_credentials",
//         "edit_credentials",
//         "delete_credentials",
//         "manage_users",
//         "view_reports",
//         "system_settings",
//       ],
//     },
//   ],
//   isActive: {
//     type: Boolean,
//     default: true
//   },
//   lastLogin: {
//     type: Date,
//     default: null
//   },
//   resetPasswordToken: {
//     type: String,
//     default: null
//   },
//   resetPasswordExpire: {
//     type: Date,
//     default: null
//   },
//   createdBy: {
//     type: mongoose.Schema.Types.ObjectId,
//     ref: 'User',
//     default: null
//   },
//   updatedBy: {
//     type: mongoose.Schema.Types.ObjectId,
//     ref: 'User',
//     default: null
//   }
// }, {
//   timestamps: true,
//   toJSON: {
//     virtuals: true,
//     transform: function(doc, ret) {
//       delete ret.password;
//       delete ret.resetPasswordToken;
//       delete ret.resetPasswordExpire;
//       return ret;
//     }
//   },
//   toObject: { virtuals: true }
// });

// // Virtual for full name display
// userSchema.virtual('displayName').get(function() {
//   return `${this.name} (${this.npk})`;
// });

// // Hash password before saving
// userSchema.pre('save', async function(next) {
//   if (!this.isModified('password')) return next();

//   try {
//     const salt = await bcrypt.genSalt(12);
//     this.password = await bcrypt.hash(this.password, salt);
//     next();
//   } catch (error) {
//     next(error);
//   }
// });

// // Compare password method
// userSchema.methods.comparePassword = async function(candidatePassword) {
//   return await bcrypt.compare(candidatePassword, this.password);
// };

// // Verify password (alias for comparePassword)
// userSchema.methods.verifyPassword = async function(password) {
//   return await this.comparePassword(password);
// };

// // Update password method
// userSchema.methods.updatePassword = async function(newPassword) {
//   try {
//     this.password = newPassword;
//     await this.save();
//     return true;
//   } catch (error) {
//     throw new Error(`Failed to update password: ${error.message}`);
//   }
// };

// // Update last login
// userSchema.methods.updateLastLogin = async function() {
//   try {
//     this.lastLogin = new Date();
//     await this.save({ validateBeforeSave: false });
//     return this;
//   } catch (error) {
//     throw new Error(`Failed to update last login: ${error.message}`);
//   }
// };

// // Generate reset password token
// userSchema.methods.generateResetToken = function() {
//   const resetToken = crypto.randomBytes(32).toString('hex');

//   this.resetPasswordToken = crypto
//     .createHash('sha256')
//     .update(resetToken)
//     .digest('hex');

//   this.resetPasswordExpire = Date.now() + 30 * 60 * 1000; // 30 minutes

//   return resetToken;
// };

// // Soft delete method
// userSchema.methods.softDelete = async function() {
//   try {
//     this.isActive = false;
//     await this.save();
//     return true;
//   } catch (error) {
//     throw new Error(`Failed to delete user: ${error.message}`);
//   }
// };

// // Static method to create user with enhanced error handling
// userSchema.statics.createUser = async function(userData) {
//   try {
//     const newUser = new this(userData);
//     await newUser.save();

//     // Return user without password
//     const userObject = newUser.toObject();
//     delete userObject.password;
//     delete userObject.resetPasswordToken;
//     delete userObject.resetPasswordExpire;
//     return userObject;
//   } catch (error) {
//     if (error.code === 11000) {
//       const field = Object.keys(error.keyPattern)[0];
//       throw new Error(`${field} already exists`);
//     }
//     throw new Error(`Failed to create user: ${error.message}`);
//   }
// };

// // Static method to find user by username
// userSchema.statics.findByUsername = async function(username) {
//   try {
//     const user = await this.findOne({
//       username: username,
//       isActive: true,
//     });
//     return user;
//   } catch (error) {
//     throw new Error(`Failed to find user: ${error.message}`);
//   }
// };

// // Static method to find user by email
// userSchema.statics.findByEmail = async function(email) {
//   try {
//     const user = await this.findOne({
//       email: email,
//       isActive: true,
//     });
//     return user;
//   } catch (error) {
//     throw new Error(`Failed to find user: ${error.message}`);
//   }
// };

// // Static method to find active user by ID
// userSchema.statics.findActiveById = async function(id) {
//   try {
//     const user = await this.findOne({
//       $or: [{ _id: id }, { id: id }],
//       isActive: true,
//     });
//     return user;
//   } catch (error) {
//     throw new Error(`Failed to find user: ${error.message}`);
//   }
// };

// // Static method to get all users with filters and pagination
// userSchema.statics.findAllWithFilters = async function(filters = {}) {
//   try {
//     let query = { isActive: true };

//     // Apply filters
//     if (filters.role) {
//       query.role = filters.role;
//     }

//     if (filters.department) {
//       query.department = filters.department;
//     }

//     if (filters.search) {
//       const searchRegex = new RegExp(filters.search, "i");
//       query.$or = [
//         { username: searchRegex },
//         { name: searchRegex },
//         { email: searchRegex },
//         { npk: searchRegex }
//       ];
//     }

//     // Pagination
//     const page = parseInt(filters.page) || 1;
//     const limit = parseInt(filters.limit) || 20;
//     const skip = (page - 1) * limit;

//     // Execute query with pagination
//     const users = await this.find(query)
//       .select("-password -resetPasswordToken -resetPasswordExpire")
//       .sort({ createdAt: -1 })
//       .skip(skip)
//       .limit(limit);

//     // Get total count
//     const total = await this.countDocuments(query);

//     return {
//       users,
//       pagination: {
//         currentPage: page,
//         totalPages: Math.ceil(total / limit),
//         totalUsers: total,
//         hasNext: skip + limit < total,
//         hasPrev: page > 1,
//       },
//     };
//   } catch (error) {
//     throw new Error(`Failed to fetch users: ${error.message}`);
//   }
// };

// // Static method to get user statistics
// userSchema.statics.getStats = async function() {
//   try {
//     // Get total active users
//     const totalUsers = await this.countDocuments({ isActive: true });

//     // Get role distribution
//     const roleDistribution = await this.aggregate([
//       { $match: { isActive: true } },
//       { $group: { _id: "$role", count: { $sum: 1 } } },
//       {
//         $group: {
//           _id: null,
//           roles: {
//             $push: {
//               k: "$_id",
//               v: "$count",
//             },
//           },
//         },
//       },
//       {
//         $replaceRoot: {
//           newRoot: { $arrayToObject: "$roles" },
//         },
//       },
//     ]);

//     // Get new users this week
//     const oneWeekAgo = new Date();
//     oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);

//     const newUsersThisWeek = await this.countDocuments({
//       isActive: true,
//       createdAt: { $gte: oneWeekAgo },
//     });

//     return {
//       totalUsers,
//       roleDistribution: roleDistribution[0] || {},
//       newUsersThisWeek,
//     };
//   } catch (error) {
//     throw new Error(`Failed to get user statistics: ${error.message}`);
//   }
// };

// // Static method to update user with allowed fields only
// userSchema.statics.updateUser = async function(userId, updateData) {
//   try {
//     const allowedFields = [
//       "name",
//       "username",
//       "email",
//       "npk",
//       "role",
//       "department",
//       "position",
//       "phoneNumber",
//       "address",
//       "profilePicture",
//       "permissions",
//       "isActive"
//     ];

//     const updates = {};

//     allowedFields.forEach((field) => {
//       if (updateData[field] !== undefined) {
//         updates[field] = updateData[field];
//       }
//     });

//     if (Object.keys(updates).length === 0) {
//       throw new Error("No valid fields to update");
//     }

//     updates.updatedAt = new Date();

//     const user = await this.findOneAndUpdate(
//       { $or: [{ _id: userId }, { id: userId }], isActive: true },
//       updates,
//       { new: true, runValidators: true }
//     ).select("-password -resetPasswordToken -resetPasswordExpire");

//     if (!user) {
//       throw new Error("User not found");
//     }

//     return user;
//   } catch (error) {
//     if (error.code === 11000) {
//       const field = Object.keys(error.keyPattern)[0];
//       throw new Error(`${field} already exists`);
//     }
//     throw new Error(`Failed to update user: ${error.message}`);
//   }
// };

// // Static method to get users by role
// userSchema.statics.getUsersByRole = function(role) {
//   return this.find({ role, isActive: true }).select('-password -resetPasswordToken -resetPasswordExpire');
// };

// // Static method to get nurses for dropdown
// userSchema.statics.getNursesForDropdown = function() {
//   return this.find({
//     role: 'perawat',
//     isActive: true
//   }).select('name npk department').sort({ name: 1 });
// };

// export default mongoose.model("User", userSchema);
