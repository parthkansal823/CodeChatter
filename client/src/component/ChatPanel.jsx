import React, { useState, useEffect, useRef } from "react";
import "./ChatPanel.css";

function ChatPanel({ socketRef, roomId, username }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const chatEndRef = useRef(null);

  useEffect(() => {
    if (!socketRef?.current) return;
    const socket = socketRef.current;

    const handleChatMessage = ({ username: sender, message }) => {
      if (sender === username) return;
      setMessages((prev) => [...prev, { username: sender, message }]);
    };

    const handleChatHistory = (oldMessages) => {
      setMessages(
        oldMessages.map((msg) => ({
          username: msg.username,
          message: msg.message,
        }))
      );
    };

    socket.on("chat_message", handleChatMessage);
    socket.on("chat_history", handleChatHistory);

    return () => {
      if (socket && socket.connected) {
        socket.off("chat_message", handleChatMessage);
        socket.off("chat_history", handleChatHistory);
      }
    };
  }, [socketRef, username]);

  const sendMessage = () => {
    if (!input.trim() || !socketRef?.current) return;
    const payload = { roomId, username, message: input };
    setMessages((prev) => [...prev, { username: "You", message: input }]);
    socketRef.current.emit("chat_message", payload);
    setInput("");
  };

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  return (
    <div className="chat-panel">
      <h5 className="chat-header">💬 Chat</h5>
      <div className="chat-messages">
        {messages.length === 0 ? (
          <p className="chat-empty">No messages yet. Start chatting 👋</p>
        ) : (
          messages.map((msg, index) => (
            <div
              key={index}
              className={`chat-msg ${msg.username === "You" ? "self" : ""}`}
            >
              <strong>{msg.username}: </strong>
              <span>{msg.message}</span>
            </div>
          ))
        )}
        <div ref={chatEndRef} />
      </div>

      <div className="chat-input">
        <input
          type="text"
          placeholder="Type your message..."
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && sendMessage()}
        />
        <button onClick={sendMessage}>Send</button>
      </div>
    </div>
  );
}

export default ChatPanel;
