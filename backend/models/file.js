import mongoose from "mongoose";

const fileSchema = new mongoose.Schema(
  {
    fileName: {
      type: String,
      required: true,
      trim: true,
    },
    originalName: {
      type: String,
      required: true,
      trim: true,
    },
    displayName: {
      type: String,
      required: true,
      trim: true,
    },
    category: {
      type: String,
      required: true,
      enum: ["guidelines", "templates", "references", "nurse_schedules"], // Added nurse_schedules
      default: "guidelines",
    },
    fileType: {
      type: String,
      required: true,
    },
    size: {
      type: Number,
      required: true,
    },
    path: {
      type: String,
      required: true,
    },
    url: {
      type: String,
      required: true,
    },
    uploadedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "user",
      required: true,
    },
    // Added schedule-specific metadata
    metadata: {
      month: {
        type: String,
        enum: [
          "Januari",
          "Februari",
          "Maret",
          "April",
          "Mei",
          "Juni",
          "Juli",
          "Agustus",
          "September",
          "Oktober",
          "November",
          "Desember",
        ],
        required: function () {
          return this.category === "nurse_schedules";
        },
      },
      year: {
        type: Number,
        required: function () {
          return this.category === "nurse_schedules";
        },
      },
      unit: {
        type: String,
        required: function () {
          return this.category === "nurse_schedules";
        },
      },
    },
    uploadedAt: {
      type: Date,
      default: Date.now,
    },
    downloadCount: {
      type: Number,
      default: 0,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true }, // Ensure virtuals are included in JSON output
    toObject: { virtuals: true },
  }
);

// Indexes for better query performance
fileSchema.index({ category: 1, isActive: 1 });
fileSchema.index({ uploadedAt: -1 });
fileSchema.index({ displayName: "text" });
fileSchema.index({ "metadata.month": 1, "metadata.year": 1 }); // For schedule queries
fileSchema.index({ "metadata.unit": 1 }); // For filtering by unit

// Virtual for formatted size
fileSchema.virtual("sizeFormatted").get(function () {
  const bytes = this.size;
  const sizes = ["Bytes", "KB", "MB", "GB"];
  if (bytes === 0) return "0 Bytes";
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return Math.round((bytes / Math.pow(1024, i)) * 100) / 100 + " " + sizes[i];
});

// Virtual for schedule display name
fileSchema.virtual("scheduleDisplayName").get(function () {
  if (this.category === "nurse_schedules") {
    return `Jadwal Perawat ${this.metadata.unit} - ${this.metadata.month} ${this.metadata.year}`;
  }
  return this.displayName;
});

// Method to increment download count
fileSchema.methods.incrementDownload = function () {
  this.downloadCount += 1;
  return this.save();
};

// Pre-save hook to auto-generate display name for schedules
fileSchema.pre("save", function (next) {
  if (this.category === "nurse_schedules" && !this.displayName) {
    this.displayName = `Jadwal Perawat ${this.metadata.unit} - ${this.metadata.month} ${this.metadata.year}`;
  }
  next();
});

export default mongoose.model("File", fileSchema);