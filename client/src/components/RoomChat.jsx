import { useState, useRef, useEffect } from "react";
import { ArrowLeft, Send, Hash, Paperclip, FileText, Download, Loader2, Lock } from "lucide-react";
import UserAvatar from "./UserAvatar";
import { useAuth } from "../hooks/useAuth";
import { secureFetch } from "../utils/security";
import toast from "react-hot-toast";

export default function RoomChat({ roomId, onBack, chatMessages = [], sendChatMessage = () => {} }) {
  const { user, token } = useAuth();
  const [input, setInput] = useState("");
  const [isUploading, setIsUploading] = useState(false);
  const scrollRef = useRef(null);
  const fileInputRef = useRef(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [chatMessages]);

  const handleSend = (e) => {
    e.preventDefault();
    if (!input.trim() && !isUploading) return;
    if (isUploading) return;

    sendChatMessage(input.trim());
    setInput("");
  };

  const handleFileUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate size (e.g., max 10MB)
    if (file.size > 10 * 1024 * 1024) {
      toast.error("File size must be under 10MB");
      return;
    }

    setIsUploading(true);
    const formData = new FormData();
    formData.append("file", file);

    try {
      const data = await secureFetch(`/api/rooms/${roomId}/messages/upload`, {
        method: "POST",
        body: formData,
        headers: { "Content-Type": null },
      }, token);

      // Send the file message payload to WebSocket
      sendChatMessage({
        type: "file",
        text: `Shared a file: ${data.filename}`,
        fileUrl: data.url,
        fileName: data.filename,
        fileSize: data.size,
      });

      e.target.value = null; // reset
    } catch (_error) {
      toast.error("Failed to upload file");
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-zinc-200/80 px-4 py-3 dark:border-zinc-800">
        <button
          type="button"
          onClick={onBack}
          className="rounded-lg p-2 text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-900 dark:hover:text-white"
          title="Back to tools"
        >
          <ArrowLeft size={16} />
        </button>
        <Hash size={16} className="text-emerald-500" />
        <span className="text-sm font-semibold text-zinc-900 dark:text-white">Room Chat</span>
        <div className="ml-auto flex items-center gap-1.5 px-2 py-1 rounded-full bg-zinc-100 dark:bg-zinc-800/50 cursor-default" title="End-to-End Encrypted">
          <Lock size={10} className="text-zinc-400 dark:text-zinc-500" />
          <span className="text-[10px] font-semibold tracking-wider text-zinc-400 dark:text-zinc-500 uppercase">E2EE</span>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-5" ref={scrollRef}>
        {chatMessages.map((msg, idx) => {
          const isSenderYou = msg.sender === "You" || msg.userId === user?.id;
          
          return (
            <div key={msg.id || `msg-${idx}`} className={`flex flex-col ${isSenderYou ? "items-end" : "items-start"}`}>
              {msg.isSystem ? (
                <div className="w-full text-center my-2">
                  <span className="px-3 py-1 bg-zinc-100 dark:bg-zinc-800/50 rounded-full text-[11px] font-medium text-zinc-500 dark:text-zinc-400">
                    {msg.text}
                  </span>
                </div>
              ) : (
                <div className={`flex max-w-[85%] gap-2 ${isSenderYou ? "flex-row-reverse" : "flex-row"}`}>
                  <div className="flex-shrink-0 mt-auto mb-1">
                     <UserAvatar username={isSenderYou ? user?.username : msg.sender} size="sm" />
                  </div>
                  <div className={`flex flex-col ${isSenderYou ? "items-end" : "items-start"}`}>
                    <div className="flex items-baseline gap-2 mb-1 px-1">
                      <span className="text-[11px] font-semibold text-zinc-700 dark:text-zinc-300">
                        {isSenderYou ? "You" : msg.sender}
                      </span>
                      <span className="text-[9px] text-zinc-400 dark:text-zinc-500">{msg.time}</span>
                    </div>

                    {msg.msgType === "file" && msg.fileUrl ? (
                      <div className={`p-3 text-sm leading-relaxed shadow-sm break-words flex items-center gap-3 ${
                        isSenderYou
                          ? "bg-violet-600 border border-violet-500 text-white rounded-2xl rounded-br-sm shadow-violet-600/10"
                          : "bg-white dark:bg-zinc-900 border border-zinc-200/50 dark:border-white/5 text-zinc-800 dark:text-zinc-200 rounded-2xl rounded-bl-sm"
                      }`}>
                        <div className={`p-2 rounded-lg ${isSenderYou ? "bg-white/20 text-white" : "bg-zinc-100 dark:bg-zinc-800 text-violet-500"}`}>
                          <FileText size={18} />
                        </div>
                        <div className="flex flex-col flex-1 min-w-0">
                          <span className="font-semibold truncate max-w-[150px]">{msg.fileName}</span>
                          <span className={`${isSenderYou ? "text-white/70" : "text-zinc-500"} text-xs mt-0.5`}>
                            {msg.fileSize ? (msg.fileSize / 1024 / 1024).toFixed(2) + ' MB' : 'Unknown size'}
                          </span>
                        </div>
                        <a 
                          href={msg.fileUrl} 
                          download={msg.fileName}
                          target="_blank"
                          rel="noreferrer"
                          className={`ml-2 p-1.5 rounded-full hover:bg-black/10 transition-colors ${isSenderYou ? "text-white" : "text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white"}`}
                          title="Download File"
                        >
                          <Download size={16} />
                        </a>
                      </div>
                    ) : (
                      <div
                        className={`px-3.5 py-2.5 text-sm leading-relaxed shadow-sm break-words whitespace-pre-wrap ${
                          isSenderYou
                            ? "bg-violet-600 text-white rounded-2xl rounded-br-sm shadow-violet-600/10"
                            : "bg-white dark:bg-zinc-900 border border-zinc-200/50 dark:border-white/5 text-zinc-800 dark:text-zinc-200 rounded-2xl rounded-bl-sm"
                        }`}
                      >
                        {msg.text}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="p-3 border-t border-zinc-200/50 dark:border-zinc-800/50 bg-zinc-50 dark:bg-[#09090b]">
        <form onSubmit={handleSend} className="relative flex items-center gap-2">
          <input 
            type="file" 
            ref={fileInputRef} 
            onChange={handleFileUpload}
            className="hidden" 
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={isUploading}
            className="flex-shrink-0 p-2.5 rounded-full text-zinc-400 hover:text-violet-500 hover:bg-violet-50 dark:hover:bg-violet-500/10 transition-colors disabled:opacity-50"
            title="Attach file"
          >
            {isUploading ? <Loader2 size={18} className="animate-spin" /> : <Paperclip size={18} />}
          </button>
          <div className="relative flex-1">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Type a message..."
              disabled={isUploading}
              className="w-full bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-white/10 rounded-full pl-4 pr-10 py-2.5 text-sm text-zinc-900 dark:text-white placeholder-zinc-400 focus:outline-none focus:border-violet-500/50 focus:ring-1 focus:ring-violet-500/50 transition-all shadow-sm disabled:opacity-50"
            />
            <button
              type="submit"
              disabled={!input.trim() || isUploading}
              className="absolute right-1.5 top-1.5 w-[30px] h-[30px] flex items-center justify-center rounded-full bg-violet-600 text-white disabled:opacity-50 disabled:bg-zinc-200 dark:disabled:bg-zinc-800 dark:disabled:text-zinc-500 transition-colors shadow-sm"
            >
              <Send size={14} className="ml-0.5" />
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
