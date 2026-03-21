import { useState, useRef, useEffect } from "react";
import { Send, Hash } from "lucide-react";

export default function RoomChat({ onBack }) {
  const [messages, setMessages] = useState([
    { id: 1, text: "Welcome to the room chat! Messages here are visible to all current collaborators.", sender: "System", isSystem: true, time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) }
  ]);
  const [input, setInput] = useState("");
  const scrollRef = useRef(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const handleSend = (e) => {
    e.preventDefault();
    if (!input.trim()) return;

    setMessages((prev) => [
      ...prev,
      {
        id: Date.now(),
        text: input.trim(),
        sender: "You",
        isSystem: false,
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      }
    ]);
    setInput("");
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-zinc-200/80 px-4 py-3 dark:border-zinc-800">
        <Hash size={16} className="text-emerald-500" />
        <span className="text-sm font-semibold text-zinc-900 dark:text-white">Room Chat</span>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4" ref={scrollRef}>
        {messages.map((msg) => (
          <div key={msg.id} className={`flex flex-col ${msg.sender === "You" ? "items-end" : "items-start"}`}>
            {msg.isSystem ? (
              <div className="w-full text-center my-2">
                <span className="px-3 py-1 bg-zinc-100 dark:bg-zinc-800/50 rounded-full text-[11px] font-medium text-zinc-500 dark:text-zinc-400">
                  {msg.text}
                </span>
              </div>
            ) : (
              <div className={`flex flex-col max-w-[85%] ${msg.sender === "You" ? "items-end" : "items-start"}`}>
                <div className="flex items-baseline gap-2 mb-1">
                  <span className="text-[11px] font-semibold text-zinc-700 dark:text-zinc-300">
                    {msg.sender}
                  </span>
                  <span className="text-[9px] text-zinc-400 dark:text-zinc-500">{msg.time}</span>
                </div>
                <div
                  className={`px-3 py-2 rounded-2xl text-sm leading-relaxed ${
                    msg.sender === "You"
                      ? "bg-purple-600 text-white rounded-br-sm shadow-md shadow-purple-600/10"
                      : "bg-white dark:bg-zinc-900 border border-zinc-200/50 dark:border-white/5 text-zinc-800 dark:text-zinc-200 rounded-bl-sm"
                  }`}
                >
                  {msg.text}
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="p-3 border-t border-zinc-200/50 dark:border-zinc-800/50">
        <form onSubmit={handleSend} className="relative flex items-center">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Type a message..."
            className="w-full bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-white/10 rounded-full pl-4 pr-10 py-2 text-sm text-zinc-900 dark:text-white placeholder-zinc-400 focus:outline-none focus:border-purple-500/50 focus:ring-1 focus:ring-purple-500/50 transition-all shadow-sm"
          />
          <button
            type="submit"
            disabled={!input.trim()}
            className="absolute right-1 w-8 h-8 flex items-center justify-center rounded-full bg-purple-600 text-white disabled:opacity-50 disabled:bg-zinc-200 dark:disabled:bg-zinc-800 dark:disabled:text-zinc-500 transition-colors"
          >
            <Send size={14} className="ml-0.5" />
          </button>
        </form>
      </div>
    </div>
  );
}
