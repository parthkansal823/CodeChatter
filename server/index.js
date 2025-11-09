const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");
const axios = require("axios");
const mongoose = require("mongoose");
const cookieParser = require("cookie-parser");
const passport = require("passport");
require("dotenv").config();
require("./passport");

const ACTIONS = require("./Actions");
const authRoutes = require("./routes/auth");
const userRoutes = require("./routes/user");
const Chat = require("./models/Chat");

const app = express();
const server = http.createServer(app);

// === MIDDLEWARE ===
app.use(express.json());
app.use(cookieParser());
app.use(
  cors({
    origin: process.env.CLIENT_URL || "*",
    credentials: true,
  })
);
app.use(passport.initialize());

// === DATABASE ===
mongoose
  .connect(process.env.MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(() => console.log("✅ MongoDB connected"))
  .catch((err) => console.error("❌ MongoDB error:", err));

// === ROUTES ===
app.use("/api/auth", authRoutes);
app.use("/api/user", userRoutes);

// === SOCKET.IO CONFIG ===
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
});

const userSocketMap = {};

const getAllConnectedClients = (roomId) =>
  Array.from(io.sockets.adapter.rooms.get(roomId) || []).map((socketId) => ({
    socketId,
    username: userSocketMap[socketId],
  }));

io.on("connection", (socket) => {
  console.log("✅ Socket connected:", socket.id);

  // === Join Room ===
  socket.on(ACTIONS.JOIN, async ({ roomId, username }) => {
    if (!roomId) return;

    userSocketMap[socket.id] = username;
    socket.join(roomId);

    console.log(`👥 ${username} joined room ${roomId}`);

    const clients = getAllConnectedClients(roomId);
    clients.forEach(({ socketId }) =>
      io.to(socketId).emit(ACTIONS.JOINED, {
        clients,
        username,
        socketId: socket.id,
      })
    );

    // ✅ Send previous chat history
    const oldMessages = await Chat.find({ roomId }).sort({ createdAt: 1 });
    socket.emit("chat_history", oldMessages);
  });

  // === Real-Time Chat (with MongoDB persistence) ===
  socket.on("chat_message", async ({ roomId, username, message }) => {
    if (!roomId || !message.trim()) return;
    if (!io.sockets.adapter.rooms.get(roomId)?.has(socket.id)) socket.join(roomId);

    console.log(`💬 [${roomId}] ${username}: ${message}`);

    const chat = new Chat({ roomId, username, message });
    await chat.save();

    io.to(roomId).emit("chat_message", { username, message });
  });

  // === Code Synchronization ===
  socket.on(ACTIONS.CODE_CHANGE, ({ roomId, code }) => {
    if (roomId) socket.in(roomId).emit(ACTIONS.CODE_CHANGE, { code });
  });

  socket.on(ACTIONS.SYNC_CODE, ({ socketId, code }) => {
    if (socketId) io.to(socketId).emit(ACTIONS.CODE_CHANGE, { code });
  });

  // === Shared Output Synchronization ===
  socket.on("code_output", ({ roomId, output }) => {
    if (!roomId) return;
    socket.in(roomId).emit("code_output", { output });
  });

  // === Cursor and Selection Sync ===
  socket.on("cursor_change", ({ roomId, username, cursor, color }) => {
    if (!roomId) return;
    socket.in(roomId).emit("cursor_change", { username, cursor, color });
  });

  socket.on("selection_change", ({ roomId, username, selection, color }) => {
    if (!roomId) return;
    socket.in(roomId).emit("selection_change", { username, selection, color });
  });

  // === Handle Disconnects ===
  socket.on("disconnecting", async () => {
    const rooms = [...socket.rooms];

    for (const roomId of rooms) {
      if (roomId === socket.id) continue;

      // Notify others in the room
      socket.in(roomId).emit(ACTIONS.DISCONNECTED, {
        socketId: socket.id,
        username: userSocketMap[socket.id],
      });

      // ✅ Check if the room is now empty
      const remaining = getAllConnectedClients(roomId);
      if (remaining.length <= 1) {
        console.log(`🧹 All users left room ${roomId}. Deleting chat history...`);
        await Chat.deleteMany({ roomId });
        console.log(`✅ Chat history deleted for room ${roomId}`);
      }
    }

    delete userSocketMap[socket.id];
  });

  socket.on("disconnect", () => {
    console.log("❌ Socket disconnected:", socket.id);
  });
});

// === LANGUAGE MAP (Judge0 IDs) ===
const languageMap = {
  python3: 71,
  java: 62,
  cpp: 54,
  c: 50,
  nodejs: 63,
  php: 68,
  ruby: 72,
  go: 60,
  bash: 46,
  rust: 73,
  swift: 83,
  csharp: 51,
  r: 80,
  scala: 81,
  sql: 82,
};

// === CODE COMPILER API ===
app.post("/compile", async (req, res) => {
  const { code, language, input } = req.body;
  const langId = languageMap[language];
  if (!langId) return res.status(400).json({ error: "Unsupported language" });

  const apiUrl =
    "https://judge0-ce.p.rapidapi.com/submissions?base64_encoded=false&wait=true";

  try {
    const { data } = await axios.post(
      apiUrl,
      { source_code: code, language_id: langId, stdin: input || "" },
      {
        headers: {
          "X-RapidAPI-Key": process.env.RAPID_API_KEY,
          "X-RapidAPI-Host": "judge0-ce.p.rapidapi.com",
          "Content-Type": "application/json",
        },
      }
    );

    res.json({
      output: data.stdout || data.stderr || data.compile_output || "⚠️ No output received.",
      time: data.time,
      memory: data.memory,
    });
  } catch (err) {
    console.error("❌ Compilation error:", err.message);
    res.status(500).json({ error: "Code execution failed." });
  }
});

// === START SERVER ===
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => console.log(`🚀 Server running on http://localhost:${PORT}`));
