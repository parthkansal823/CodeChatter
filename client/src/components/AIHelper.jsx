import { useState, useRef, useEffect } from "react";
import { Send, Bot, Sparkles } from "lucide-react";

export default function AIHelper({ onBack }) {
  const [messages, setMessages] = useState([
    { id: 1, text: "Hi! I'm your workspace AI. I can explain the current file, help you debug errors, or suggest improvements. What do you need?", sender: "AI", time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) }
  ]);
  const [input, setInput] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const scrollRef = useRef(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, isTyping]);

  const handleSend = (e) => {
    e.preventDefault();
    if (!input.trim()) return;

    const userMsg = input.trim();
    setMessages((prev) => [
      ...prev,
      { id: Date.now(), text: userMsg, sender: "You", time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) }
    ]);
    setInput("");
    setIsTyping(true);

    // Mock AI Response
    setTimeout(() => {
      setIsTyping(false);
      setMessages((prev) => [
        ...prev,
        {
          id: Date.now() + 1,
          text: `I understand you're asking about "${userMsg}". Since I'm currently running in local demo mode, I can't analyze the live server code yet, but I'm fully integrated into the UI for the V2 release!`,
          sender: "AI",
          time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        }
      ]);
    }, 1500);
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-col px-4 py-4 border-b border-zinc-200/80 dark:border-zinc-800 bg-gradient-to-b from-indigo-50/50 to-transparent dark:from-indigo-950/20">
        <div className="flex items-center gap-2 mb-1">
          <div className="p-1.5 rounded-lg bg-indigo-600 text-white shadow-sm shadow-indigo-600/20">
            <Bot size={16} />
          </div>
          <span className="text-sm font-bold text-zinc-900 dark:text-white">Workspace AI</span>
        </div>
        <p className="text-xs text-zinc-500 dark:text-zinc-400">Powered by CodeChatter Assistant</p>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-5" ref={scrollRef}>
        {messages.map((msg) => (
          <div key={msg.id} className={`flex flex-col max-w-[88%] ${msg.sender === "You" ? "self-end items-end ml-auto" : "items-start"}`}>
            <div className={`px-3.5 py-2.5 rounded-2xl text-sm leading-relaxed shadow-sm ${
              msg.sender === "You"
                ? "bg-zinc-900 text-white dark:bg-white dark:text-zinc-950 rounded-br-sm"
                : "bg-white dark:bg-zinc-900 border border-zinc-200/60 dark:border-white/5 text-zinc-800 dark:text-zinc-200 rounded-bl-sm"
            }`}>
              {msg.text}
            </div>
            <span className="text-[10px] text-zinc-400 dark:text-zinc-500 mt-1.5 px-1">{msg.time}</span>
          </div>
        ))}
        {isTyping && (
          <div className="flex flex-col max-w-[85%] items-start">
            <div className="px-4 py-3 bg-white dark:bg-zinc-900 border border-zinc-200/60 dark:border-white/5 rounded-2xl rounded-bl-sm shadow-sm flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 animate-bounce" style={{ animationDelay: '0ms' }} />
              <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 animate-bounce" style={{ animationDelay: '150ms' }} />
              <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 animate-bounce" style={{ animationDelay: '300ms' }} />
            </div>
          </div>
        )}
      </div>

      <div className="p-3 border-t border-zinc-200/50 dark:border-zinc-800/50">
        <form onSubmit={handleSend} className="relative flex items-end bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-white/10 rounded-xl shadow-sm focus-within:border-indigo-500/50 focus-within:ring-1 focus-within:ring-indigo-500/50 transition-all p-1">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSend(e);
              }
            }}
            placeholder="Ask AI anything..."
            className="w-full bg-transparent resize-none max-h-32 min-h-[36px] px-3 py-2 text-sm text-zinc-900 dark:text-white placeholder-zinc-400 focus:outline-none"
            rows={1}
          />
          <button
            type="submit"
            disabled={!input.trim()}
            className="mb-1 mr-1 flex-shrink-0 w-8 h-8 flex items-center justify-center rounded-lg bg-indigo-600 text-white disabled:opacity-50 disabled:bg-zinc-100 dark:disabled:bg-zinc-800 dark:disabled:text-zinc-500 transition-colors"
          >
            <Sparkles size={14} className="ml-0.5" />
          </button>
        </form>
        <div className="mt-2 text-center">
          <span className="text-[10px] text-zinc-400 dark:text-zinc-500">AI can make mistakes. Check important info.</span>
        </div>
      </div>
    </div>
  );
}
