import React, { useEffect, useRef, useState, useCallback } from "react";
import Editor from "./Editor";
import Sidebar from "./Sidebar";
import Topbar from "./Topbar";
import CompilerPanel from "./CompilerPanel";
import ChatPanel from "./ChatPanel";
import { initSocket } from "../Socket";
import { ACTIONS } from "../Actions";
import { getLanguageTemplate } from "./LanguageTemplates";
import { useNavigate, useLocation, Navigate, useParams } from "react-router-dom";
import { toast } from "react-hot-toast";
import axios from "axios";
import "./EditorPage.css";

function EditorPage() {
  const [clients, setClients] = useState([]);
  const [output, setOutput] = useState("");
  const [isCompiling, setIsCompiling] = useState(false);
  const [selectedLanguage, setSelectedLanguage] = useState("python3");
  const [theme, setTheme] = useState(localStorage.getItem("theme") || "dark");

  const codeRef = useRef("");
  const editorRef = useRef(null);
  const socketRef = useRef(null);
  const location = useLocation();
  const navigate = useNavigate();
  const { roomId } = useParams();

  // Persist username across refresh
  const username = location.state?.username || sessionStorage.getItem("username");
  useEffect(() => {
    if (location.state?.username) {
      sessionStorage.setItem("username", location.state.username);
    }
  }, [location.state]);

  // Theme toggle
  const toggleTheme = () => {
    const newTheme = theme === "dark" ? "light" : "dark";
    setTheme(newTheme);
    document.body.className = newTheme === "light" ? "light-theme" : "";
    localStorage.setItem("theme", newTheme);
  };

  // === SOCKET CONNECTION ===
  useEffect(() => {
    const init = async () => {
      const socket = await initSocket();
      socketRef.current = socket;

      socket.on("connect_error", () => toast.error("Connection error"));
      socket.on("connect_failed", () => toast.error("Connection failed"));

      socket.emit(ACTIONS.JOIN, { roomId, username });

      socket.on(ACTIONS.JOINED, ({ clients, username: joinedUser, socketId }) => {
        if (joinedUser !== username) toast.success(`${joinedUser} joined the room.`);
        setClients(clients);
        socket.emit(ACTIONS.SYNC_CODE, { code: codeRef.current, socketId });
      });

      socket.on(ACTIONS.DISCONNECTED, ({ socketId, username: leftUser }) => {
        toast(`${leftUser} left the room`, { icon: "👋" });
        setClients((prev) => prev.filter((c) => c.socketId !== socketId));
      });

      socket.on("code_output", ({ output }) => setOutput(output));
    };

    init();

    // Cleanup on component unmount
    return () => {
      if (socketRef.current) {
        socketRef.current.disconnect();
        socketRef.current = null;
      }
    };
  }, [roomId, username]);

  // === Language Template Load ===
  useEffect(() => {
    if (editorRef.current) {
      const template = getLanguageTemplate(selectedLanguage);
      if (!codeRef.current?.trim()) {
        codeRef.current = template;
        editorRef.current.setValue(template);
      }
    }
  }, [selectedLanguage]);

  // === Copy Room ID ===
  const copyRoomId = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(roomId);
      toast.success("Room ID copied!");
    } catch {
      toast.error("Failed to copy Room ID");
    }
  }, [roomId]);

  // === Leave Room (clean and safe) ===
  const leaveRoom = () => {
    if (socketRef.current) {
      socketRef.current.disconnect();
      socketRef.current = null;
    }
    navigate("/");
  };

  // === Run Code ===
  const runCode = async () => {
    setIsCompiling(true);
    try {
      const { data } = await axios.post("http://localhost:5000/compile", {
        code: codeRef.current,
        language: selectedLanguage,
      });
      const outputText = data.output || "⚠️ No output.";
      setOutput(outputText);
      socketRef.current?.emit("code_output", { roomId, output: outputText });
    } catch (error) {
      const errMsg = error.response?.data?.error || "Compilation failed.";
      setOutput(errMsg);
      socketRef.current?.emit("code_output", { roomId, output: errMsg });
    } finally {
      setIsCompiling(false);
    }
  };

  if (!username) return <Navigate to="/" />;

  return (
    <div className="editor-page">
      <Sidebar clients={clients} copyRoomId={copyRoomId} leaveRoom={leaveRoom} />

      <main className="editor-layout">
        <div className="editor-main">
          <Topbar
            selectedLanguage={selectedLanguage}
            setSelectedLanguage={setSelectedLanguage}
            theme={theme}
            toggleTheme={toggleTheme}
          />

          <div className="code-container">
            <Editor
              ref={editorRef}
              socketRef={socketRef}
              roomId={roomId}
              language={selectedLanguage}
              onCodeChange={(code) => (codeRef.current = code)}
            />
          </div>

          <CompilerPanel
            output={output}
            runCode={runCode}
            isCompiling={isCompiling}
            selectedLanguage={selectedLanguage}
          />
        </div>
      </main>

      {/* Render Chat only if socket exists */}
      {socketRef.current && (
        <ChatPanel socketRef={socketRef} roomId={roomId} username={username} />
      )}
    </div>
  );
}

export default EditorPage;
