import mongoose from "mongoose";

const questionSchema = new mongoose.Schema(
  {
    pertanyaan: {
      type: String,
      required: [true, "Pertanyaan text is required"],
      trim: true,
      minLength: [10, "Pertanyaan must be at least 10 characters long"],
      maxLength: [1000, "Pertanyaan cannot exceed 1000 characters"],
    },

    type: {
      type: String,
      required: [true, "Question type is required"],
      enum: {
        values: ["short-answer", "multiple-choice", "checkbox", "case-study"],
        message: "Invalid question type",
      },
    },

    pilihan: {
      type: [String],
      required: function () {
        return this.type === "multiple-choice" || this.type === "checkbox";
      },
      validate: {
        validator: function (pilihan) {
          if (this.type === "multiple-choice" || this.type === "checkbox") {
            // Check for empty options
            const hasEmptyOptions = pilihan.some((opt) => opt.trim() === "");
            if (hasEmptyOptions) return false;

            return pilihan.length >= 2 && pilihan.length <= 6;
          }
          return true;
        },
        message: "Pilihan ganda questions must have 2-6 non-empty options",
      },
    },

    jawabanBenar: {
      type: mongoose.Schema.Types.Mixed, // Can be String for MC or [String] for checkbox
      required: function () {
        return this.type === "multiple-choice" || this.type === "checkbox";
      },
      validate: {
        validator: function (jawaban) {
          if (this.type === "multiple-choice") {
            return this.pilihan.includes(jawaban);
          } else if (this.type === "checkbox") {
            return (
              Array.isArray(jawaban) &&
              jawaban.length > 0 &&
              jawaban.every((ans) => this.pilihan.includes(ans))
            );
          }
          return true;
        },
        message: "Jawaban benar must be one of the provided pilihan",
      },
    },

    kategori: {
      type: String,
      required: [true, "Kategori is required"],
      enum: {
        values: [
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
        message: "Invalid kategori value",
      },
      default: "Other",
    },

    tingkatKesulitan: {
      type: String,
      enum: ["Easy", "Medium", "Hard"],
      default: "Medium",
    },

    penjelasan: {
      type: String,
      trim: true,
      maxLength: [2000, "Penjelasan cannot exceed 2000 characters"],
    },

    image: {
      type: String,
      validate: {
        validator: function (v) {
          return (
            v === null ||
            v === undefined ||
            /^(https?|ftp):\/\/[^\s/$.?#].[^\s]*$/.test(v)
          );
        },
        message: "Invalid image URL format",
      },
    },

    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: [true, "Creator ID is required"],
    },

    isActive: {
      type: Boolean,
      default: true,
    },

    tags: {
      type: [String],
      validate: {
        validator: function (tags) {
          return tags.length <= 5; // Maximum 5 tags
        },
        message: "Cannot have more than 5 tags",
      },
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// Indexes for better query performance
questionSchema.index({ pertanyaan: "text" });
questionSchema.index({ kategori: 1 });
questionSchema.index({ tingkatKesulitan: 1 });
questionSchema.index({ createdBy: 1 });
questionSchema.index({ isActive: 1 });
questionSchema.index({ type: 1 });

// Pre-save hook to clean data
questionSchema.pre("save", function (next) {
  // Trim all string fields
  this.pertanyaan = this.pertanyaan.trim();

  if (this.penjelasan) {
    this.penjelasan = this.penjelasan.trim();
  }

  // Clean pilihan array
  if (this.pilihan && Array.isArray(this.pilihan)) {
    this.pilihan = this.pilihan
      .map((opt) => opt.trim())
      .filter((opt) => opt !== "");
  }

  // Clean tags array
  if (this.tags && Array.isArray(this.tags)) {
    this.tags = this.tags
      .map((tag) => tag.trim().toLowerCase())
      .filter((tag, i, arr) => tag !== "" && arr.indexOf(tag) === i);
  }

  next();
});

// Static methods
questionSchema.statics.findByCategory = function (kategori) {
  return this.find({ kategori, isActive: true });
};

questionSchema.statics.findByDifficulty = function (tingkatKesulitan) {
  return this.find({ tingkatKesulitan, isActive: true });
};

// Instance methods
questionSchema.methods.getSimplified = function () {
  return {
    id: this._id,
    pertanyaan: this.pertanyaan,
    type: this.type,
    kategori: this.kategori,
    tingkatKesulitan: this.tingkatKesulitan,
  };
};

const Question = mongoose.model("Question", questionSchema);

export default Question;
