const express = require("express");
const router = express.Router();
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const passport = require("passport");
const User = require("../models/User");
const { createAccessToken, createRefreshToken } = require("../utils/tokens");

const CLIENT_URL = process.env.CLIENT_URL || "http://localhost:3000";

const COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
  secure: process.env.NODE_ENV === "production",
  path: "/api/auth/refresh",
};

// === REGISTER ===
router.post("/register", async (req, res) => {
  try {
    const { name, email, password } = req.body;
    if (!email || !password)
      return res.status(400).json({ message: "Email and password required" });

    const existing = await User.findOne({ email });
    if (existing) return res.status(400).json({ message: "Email already exists" });

    const passwordHash = await bcrypt.hash(password, 10);
    const user = await User.create({ name, email, passwordHash });

    const accessToken = createAccessToken(user);
    const refreshToken = createRefreshToken(user);
    user.refreshTokens.push(refreshToken);
    await user.save();

    res.cookie("jid", refreshToken, COOKIE_OPTIONS);
    res.json({ accessToken, user: { id: user._id, email: user.email, name: user.name } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});

// === LOGIN ===
router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email });
    if (!user || !user.passwordHash)
      return res.status(400).json({ message: "Invalid credentials" });

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) return res.status(400).json({ message: "Invalid credentials" });

    const accessToken = createAccessToken(user);
    const refreshToken = createRefreshToken(user);
    user.refreshTokens.push(refreshToken);
    await user.save();

    res.cookie("jid", refreshToken, COOKIE_OPTIONS);
    res.json({ accessToken, user: { id: user._id, email: user.email, name: user.name } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});

// === GOOGLE OAUTH START ===
router.get("/google", passport.authenticate("google", { scope: ["profile", "email"] }));

// === GOOGLE CALLBACK ===
router.get(
  "/google/callback",
  passport.authenticate("google", {
    session: false,
    failureRedirect: `${CLIENT_URL}/login`,
  }),
  async (req, res) => {
    const user = req.user;
    const accessToken = createAccessToken(user);
    const refreshToken = createRefreshToken(user);
    user.refreshTokens.push(refreshToken);
    await user.save();

    res.cookie("jid", refreshToken, COOKIE_OPTIONS);
    res.redirect(`${CLIENT_URL}/oauth-success#accessToken=${accessToken}`);
  }
);

// === REFRESH TOKEN ===
router.post("/refresh", async (req, res) => {
  const token = req.cookies.jid;
  if (!token) return res.status(401).json({ message: "No token" });

  try {
    const payload = jwt.verify(token, process.env.REFRESH_TOKEN_SECRET);
    const user = await User.findById(payload.id);
    if (!user) return res.status(401).json({ message: "User not found" });
    if (!user.refreshTokens.includes(token))
      return res.status(401).json({ message: "Token revoked" });

    // Rotate refresh token
    const newRefreshToken = createRefreshToken(user);
    user.refreshTokens = user.refreshTokens.filter((t) => t !== token);
    user.refreshTokens.push(newRefreshToken);
    await user.save();

    const accessToken = createAccessToken(user);
    res.cookie("jid", newRefreshToken, COOKIE_OPTIONS);
    res.json({ accessToken, user: { id: user._id, email: user.email, name: user.name } });
  } catch (err) {
    console.error(err);
    res.status(401).json({ message: "Invalid refresh token" });
  }
});

// === LOGOUT ===
router.post("/logout", async (req, res) => {
  const token = req.cookies.jid;
  if (token) {
    try {
      const payload = jwt.verify(token, process.env.REFRESH_TOKEN_SECRET);
      const user = await User.findById(payload.id);
      if (user) {
        user.refreshTokens = user.refreshTokens.filter((t) => t !== token);
        await user.save();
      }
    } catch (_) {}
  }
  res.clearCookie("jid", { path: "/api/auth/refresh" });
  res.json({ ok: true });
});

module.exports = router;
