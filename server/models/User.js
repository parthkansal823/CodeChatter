const mongoose = require("mongoose");

const UserSchema = new mongoose.Schema(
  {
    name: { type: String },
    email: { type: String, required: true, unique: true },
    passwordHash: { type: String },
    googleId: { type: String },
    avatar: { type: String },
    refreshTokens: [String],
  },
  { timestamps: true }
);

module.exports = mongoose.model("User", UserSchema);
