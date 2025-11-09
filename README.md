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
