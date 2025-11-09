# 💻 CodeChatter

> A real-time collaborative code editor built with **React**, **Node.js**, **Socket.IO**, and **MongoDB**, featuring live code editing, chat, syntax highlighting, and Judge0-powered code execution.

## 🚀 Features

✅ **Real-Time Collaboration** — Multiple users can code together in one room  
✅ **Live Chat** — Chat with other collaborators instantly  
✅ **Code Execution** — Run your code using the Judge0 API  
✅ **Syntax Highlighting** — Monaco Editor with multiple language support  
✅ **Dark & Light Themes** — Toggle modes like in VS Code  
✅ **Persistent Messages** — Chat history saved with MongoDB  


## 🧠 Tech Stack

### 🖥️ **Frontend**
- React.js ⚛️  
- Monaco Editor 🧩  
- Socket.IO Client  
- Tailwind CSS / Custom Styles  

### 🧩 **Backend**
- Node.js + Express  
- Socket.IO  
- MongoDB (Mongoose)  
- Judge0 API for code compilation  
- Passport.js for authentication  

---

## 🗂️ CodeChatter — Full Project Structure
```bash
CodeChatter/
│
├── README.md                            # 📘 Project overview file (you added)
├── package.json                         # Root config (can include concurrently)
├── .gitignore                           # Hides node_modules, .env, logs, etc.
│
├── client/                              # ⚛️ Frontend (React)
│   ├── package.json
│   ├── public/
│   │   ├── index.html
│   │   └── favicon.ico
│   │
│   └── src/
│       ├── index.js                     # React entry point
│       ├── App.js                       # Root component
│       ├── Actions.js                   # Shared socket action constants
│       │
│       ├── component/                   # 🧩 Reusable Components
│       │   ├── MonacoEditor.jsx         # Core collaborative editor
│       │   ├── Topbar.jsx               # Language + Theme bar
│       │   ├── LanguageDropdown.jsx     # Language selector (syncs with others)
│       │   ├── ChatBox.jsx              # Real-time chat UI
│       │   ├── OutputPanel.jsx          # Displays Judge0 code output
│       │   ├── CursorOverlay.jsx        # Cursor highlighting (for collab)
│       │   └── Loader.jsx               # Optional loading animation
│       │
│       ├── pages/                       # 📄 Route Pages
│       │   ├── Home.jsx                 # Landing screen
│       │   ├── EditorPage.jsx           # Main collaborative editor page
│       │   ├── Login.jsx                # Auth login screen
│       │   └── Register.jsx             # Auth register screen
│       │
│       ├── context/                     # 🌐 Global Contexts
│       │   └── UserContext.js
│       │
│       ├── hooks/                       # ⚙️ Custom React Hooks
│       │   └── useSocket.js             # Handles Socket.IO client connection
│       │
│       ├── utils/                       # 🧠 Utility Helpers
│       │   ├── languageMap.js           # Maps frontend language → Judge0 IDs
│       │   ├── themeUtils.js            # Handles VS Code-style themes
│       │   └── formatTime.js            # Chat timestamp formatter
│       │
│       ├── styles/                      # 🎨 Styling
│       │   ├── editor.css
│       │   ├── home.css
│       │   ├── topbar.css
│       │   └── chatbox.css
│       │
│       └── config.js                    # Frontend API base URL
│
├── server/                              # 🖥️ Backend (Express + Socket.IO)
│   ├── package.json
│   ├── server.js                        # Main backend server
│   ├── Actions.js                       # Shared socket event constants
│   ├── .env                             # Environment variables (private)
│   ├── .env.example                     # Public sample env (safe for GitHub)
│   │
│   ├── models/                          # 🧩 MongoDB Models
│   │   ├── User.js
│   │   └── Chat.js
│   │
│   ├── routes/                          # 🌍 API Routes
│   │   ├── auth.js                      # Handles OAuth + login
│   │   ├── user.js                      # User info endpoints
│   │   └── compile.js                   # Optional code execution route
│   │
│   ├── middleware/                      # 🔐 Middlewares
│   │   ├── authMiddleware.js            # JWT + session protection
│   │   └── errorHandler.js              # Error formatter
│   │
│   ├── passport/                        # 🧾 OAuth Config
│   │   └── index.js                     # Google OAuth setup
│   │
│   └── utils/                           # 🛠️ Helpers
│       ├── logger.js                    # Console + file logging
│       └── generateRoomId.js            # Unique ID generator for rooms
│
└── concurrently.config.json             # For running client + server together

```


## ⚙️ Setup Instructions

### 1. Clone this repository
```bash
git clone https://github.com/parthkansal823/CodeChatter.git
cd CodeChatter
```

### 2. Install dependencies (Client)
```bash
cd client
npm install
npm start
```

### 3. Configure environment
Create a .env file inside server/ with:
``` ini
# === SERVER CONFIG ===
PORT=5000

# === RAPID API (Judge0) ===
RAPID_API_KEY=...
USE_RAPID=false

# === DATABASE ===
MONGO_URI=mongodb://localhost:27017/codechatter

# === AUTH SECRETS ===
JWT_SECRET=...
REFRESH_TOKEN_SECRET=...

# === FRONTEND ORIGIN ===
CLIENT_URL=http://localhost:3000

# === GOOGLE OAUTH ===
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
GOOGLE_CALLBACK_URL=...

# === ENV MODE ===
NODE_ENV=development
```


### 4. Install dependencies (Server)
```bash
cd ../server
npm install
node index.js
```
