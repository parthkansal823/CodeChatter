import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft, BookOpen, Bot, Bug, Check, ChevronDown, ChevronUp,
  Copy, Eye, FlaskConical, RefreshCw, RotateCcw, Send, Sparkles,
  Trash2, Wrench, Zap, ClipboardList,
} from "lucide-react";
import { motion as Motion, AnimatePresence } from "framer-motion";

import { API_ENDPOINTS } from "../config/security";
import { useAuth } from "../hooks/useAuth";
import { buildLocalAssistantReply, summarizeActiveFileContext } from "../utils/codeInsights";
import { secureFetch } from "../utils/security";

const QUICK_ACTIONS = [
  { id: "explain",  label: "Explain",   prompt: "Explain this file",                      icon: Sparkles,     col: "violet" },
  { id: "debug",    label: "Debug",     prompt: "Help me debug this file",                icon: Bug,          col: "rose"   },
  { id: "improve",  label: "Improve",   prompt: "How can I improve this file?",           icon: Wrench,       col: "amber"  },
  { id: "tests",    label: "Tests",     prompt: "Generate unit tests for this file",      icon: FlaskConical, col: "green"  },
  { id: "docs",     label: "Docs",      prompt: "Write documentation for this file",      icon: BookOpen,     col: "sky"    },
  { id: "optimize", label: "Optimize",  prompt: "Optimize this code for performance",     icon: Zap,          col: "yellow" },
  { id: "review",   label: "Review",    prompt: "Do a thorough code review of this file", icon: Eye,          col: "teal"   },
];

const LANG_COLOR = {
  python:     "bg-blue-500/15 text-blue-600 dark:text-blue-400",
  javascript: "bg-yellow-500/15 text-yellow-700 dark:text-yellow-400",
  typescript: "bg-blue-600/15 text-blue-700 dark:text-blue-300",
  cpp:        "bg-cyan-500/15 text-cyan-700 dark:text-cyan-400",
  java:       "bg-orange-500/15 text-orange-700 dark:text-orange-400",
  rust:       "bg-orange-600/15 text-orange-700 dark:text-orange-300",
  go:         "bg-sky-500/15 text-sky-700 dark:text-sky-400",
  html:       "bg-red-500/15 text-red-700 dark:text-red-400",
  css:        "bg-purple-500/15 text-purple-700 dark:text-purple-400",
  default:    "bg-indigo-500/15 text-indigo-700 dark:text-indigo-300",
};

function getTimeStamp() {
  return new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function buildFallbackMessage(localReply, errorMessage = "") {
  if (/gemini is not configured/i.test(errorMessage)) {
    return `⚠️ Gemini API key is not set in \`server/.env\`.\n\nLocal analysis:\n${localReply}`;
  }
  if (!errorMessage) return localReply;
  return `Gemini error: ${errorMessage}\n\nLocal analysis:\n${localReply}`;
}

function InlineCode({ children }) {
  return (
    <code className="rounded bg-zinc-100 px-1 py-0.5 font-mono text-[11px] text-violet-700 ring-1 ring-zinc-200 dark:bg-black/40 dark:text-emerald-300 dark:ring-white/10">
      {children}
    </code>
  );
}

function CodeBlock({ code, lang }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };
  return (
    <div className="group/code relative my-2">
      {lang && (
        <div className="rounded-t-lg border border-b-0 border-zinc-200 bg-zinc-100 px-3 py-1 text-[10px] font-mono text-zinc-500 dark:border-white/8 dark:bg-zinc-900/80 dark:text-zinc-500">
          {lang}
        </div>
      )}
      <pre className={`overflow-auto bg-zinc-50 p-3 pr-10 font-mono text-[11px] text-zinc-800 ring-1 ring-zinc-200 dark:bg-black/40 dark:text-emerald-300 dark:ring-white/10 ${lang ? "rounded-b-lg rounded-tr-lg" : "rounded-lg"}`}>
        {code}
      </pre>
      <button
        onClick={copy}
        className="absolute right-2 top-2 rounded border border-zinc-200 bg-white p-1 text-zinc-400 opacity-0 shadow transition-opacity group-hover/code:opacity-100 hover:text-zinc-700 dark:border-white/10 dark:bg-zinc-800/80 dark:hover:text-white"
        title="Copy code"
      >
        {copied ? <Check size={10} className="text-emerald-500" /> : <Copy size={10} />}
      </button>
    </div>
  );
}

function MessageText({ text }) {
  const lines = text.split("\n");
  let inCode = false;
  let codeLines = [];
  let codeLang = "";
  const elements = [];

  const renderInline = (line, key) => {
    const parts = line.split(/(`[^`]+`|\*\*[^*]+\*\*)/g);
    return (
      <span key={key} className="block leading-relaxed">
        {parts.map((part, j) => {
          if (part.startsWith("`") && part.endsWith("`"))
            return <InlineCode key={j}>{part.slice(1, -1)}</InlineCode>;
          if (part.startsWith("**") && part.endsWith("**"))
            return <strong key={j}>{part.slice(2, -2)}</strong>;
          return part;
        })}
      </span>
    );
  };

  lines.forEach((line, i) => {
    if (line.startsWith("```")) {
      if (inCode) {
        elements.push(<CodeBlock key={`code-${i}`} code={codeLines.join("\n")} lang={codeLang} />);
        codeLines = []; codeLang = ""; inCode = false;
      } else {
        codeLang = line.slice(3).trim(); inCode = true;
      }
      return;
    }
    if (inCode) { codeLines.push(line); return; }

    if (line.startsWith("### ")) {
      elements.push(<p key={i} className="mb-1 mt-3 text-[12px] font-bold text-zinc-800 dark:text-zinc-100">{line.slice(4)}</p>);
      return;
    }
    if (line.startsWith("## ")) {
      elements.push(<p key={i} className="mb-1 mt-3 text-[13px] font-bold text-zinc-900 dark:text-white">{line.slice(3)}</p>);
      return;
    }
    if (line.startsWith("# ")) {
      elements.push(<p key={i} className="mb-1 mt-3 text-[14px] font-bold text-zinc-900 dark:text-white">{line.slice(2)}</p>);
      return;
    }
    if (/^[-*] /.test(line)) {
      elements.push(
        <div key={i} className="flex gap-2 leading-relaxed">
          <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-indigo-400" />
          {renderInline(line.slice(2), `li-${i}`)}
        </div>
      );
      return;
    }
    if (/^\d+\. /.test(line)) {
      const match = line.match(/^(\d+)\. (.*)/);
      if (match) {
        elements.push(
          <div key={i} className="flex gap-2 leading-relaxed">
            <span className="shrink-0 text-[11px] font-semibold text-indigo-400">{match[1]}.</span>
            {renderInline(match[2], `ol-${i}`)}
          </div>
        );
        return;
      }
    }
    if (/^---+$/.test(line.trim())) {
      elements.push(<div key={i} className="my-2 h-px w-full bg-zinc-200 dark:bg-white/8" />);
      return;
    }
    if (line.trim() === "") {
      elements.push(<div key={i} className="h-1.5" />);
      return;
    }
    elements.push(renderInline(line, i));
  });

  return <div className="text-sm">{elements}</div>;
}

export default function AIHelper({
  onBack,
  roomId,
  roomName,
  activeFilePath,
  activeCode,
  runResult,
}) {
  const { token } = useAuth();
  const storageKey = `ai-chat-${roomId || "default"}`;

  const initialMsg = {
    id: 1,
    text: "Hi! I'm your Workspace AI — powered by Gemini when configured. Ask me anything about your code, or use the quick actions below.",
    sender: "AI",
    time: getTimeStamp(),
  };

  const [messages, setMessages]       = useState(() => {
    try {
      const saved = sessionStorage.getItem(storageKey);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch { /* ignore */ }
    return [initialMsg];
  });
  const [input, setInput]             = useState("");
  const [isTyping, setIsTyping]       = useState(false);
  const [copied, setCopied]           = useState(null);
  const [actionsOpen, setActionsOpen] = useState(true);
  const scrollRef   = useRef(null);
  const mountedRef  = useRef(true);
  const textareaRef = useRef(null);

  const context = useMemo(
    () => summarizeActiveFileContext({ roomName, activeFilePath, activeCode, runResult }),
    [activeCode, activeFilePath, roomName, runResult]
  );

  const langKey   = (context.languageLabel || "").toLowerCase();
  const langClass = LANG_COLOR[langKey] || LANG_COLOR.default;

  // Persist chat to sessionStorage
  useEffect(() => {
    if (messages.length > 1) {
      try { sessionStorage.setItem(storageKey, JSON.stringify(messages)); } catch { /* ignore */ }
    }
  }, [messages, storageKey]);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, isTyping]);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const submitPrompt = async (nextPrompt) => {
    const userMsg = nextPrompt.trim();
    if (!userMsg) return;

    const localReply = buildLocalAssistantReply({ prompt: userMsg, roomName, activeFilePath, activeCode, runResult });
    setMessages((prev) => [...prev, { id: Date.now(), text: userMsg, sender: "You", time: getTimeStamp() }]);
    setInput("");
    if (textareaRef.current) textareaRef.current.style.height = "auto";
    setIsTyping(true);

    let replyText = localReply;
    try {
      const response = await secureFetch(
        API_ENDPOINTS.AI_ASSIST,
        { method: "POST", body: JSON.stringify({ prompt: userMsg, roomId, roomName, activeFilePath, activeCode, runResult }), timeout: 30000 },
        token
      );
      if (typeof response?.answer === "string" && response.answer.trim()) {
        replyText = response.answer.trim();
      }
    } catch (error) {
      replyText = buildFallbackMessage(localReply, error.message || "");
    }

    if (!mountedRef.current) return;
    setIsTyping(false);
    setMessages((prev) => [...prev, { id: Date.now() + 1, text: replyText, sender: "AI", time: getTimeStamp() }]);
  };

  const handleSend = (e) => { e.preventDefault(); void submitPrompt(input); };

  const handleCopy = (text, id) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(id);
      setTimeout(() => setCopied(null), 1500);
    });
  };

  const handleCopyConversation = () => {
    const text = messages
      .map((m) => `[${m.sender} ${m.time}]\n${m.text}`)
      .join("\n\n---\n\n");
    navigator.clipboard.writeText(text).then(() => {
      setCopied("conversation");
      setTimeout(() => setCopied(null), 1500);
    });
  };

  const handleRegenerate = () => {
    const reversed = [...messages].reverse();
    const lastUser = reversed.find((m) => m.sender === "You");
    if (!lastUser || isTyping) return;
    setMessages((prev) => prev.filter((m) => m.id !== reversed[0]?.id));
    void submitPrompt(lastUser.text);
  };

  const handleClear = () => {
    const fresh = [{ ...initialMsg, id: Date.now(), time: getTimeStamp() }];
    setMessages(fresh);
    try { sessionStorage.removeItem(storageKey); } catch { /* ignore */ }
  };

  const handleTextareaChange = (e) => {
    setInput(e.target.value);
    e.target.style.height = "auto";
    e.target.style.height = `${Math.min(e.target.scrollHeight, 120)}px`;
  };

  const lastAiMsg = [...messages].reverse().find((m) => m.sender === "AI");
  const charCount = input.length;

  return (
    <div className="flex h-full flex-col overflow-hidden bg-white dark:bg-zinc-950">

      {/* ── Header ── */}
      <div className="relative shrink-0 overflow-hidden border-b border-zinc-200 dark:border-white/5">
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-indigo-500/10 via-violet-500/5 to-transparent dark:from-indigo-600/20 dark:via-violet-600/10" />
        <div className="relative px-3 pb-3 pt-3">

          {/* Title row */}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onBack}
              className="rounded-lg p-1.5 text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-700 dark:text-zinc-400 dark:hover:bg-white/10 dark:hover:text-white"
              title="Back"
            >
              <ArrowLeft size={15} />
            </button>
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-500 to-violet-600 shadow-lg shadow-indigo-500/30">
              <Bot size={14} className="text-white" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold leading-none text-zinc-900 dark:text-white">Workspace AI</p>
              <p className="mt-0.5 flex items-center gap-1 text-[10px] leading-none text-zinc-500 dark:text-zinc-400">
                <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
                Gemini 2.5 Flash
              </p>
            </div>

            {/* Copy conversation */}
            <button
              type="button"
              onClick={handleCopyConversation}
              disabled={messages.length <= 1}
              className="rounded-lg p-1.5 text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-600 disabled:opacity-30 dark:hover:bg-white/10 dark:hover:text-zinc-200"
              title="Copy conversation"
            >
              {copied === "conversation"
                ? <Check size={13} className="text-emerald-500" />
                : <ClipboardList size={13} />
              }
            </button>

            {/* Clear chat */}
            <button
              type="button"
              onClick={handleClear}
              disabled={messages.length <= 1}
              className="rounded-lg p-1.5 text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-red-500 disabled:opacity-30 dark:hover:bg-white/10 dark:hover:text-red-400"
              title="Clear chat"
            >
              <Trash2 size={13} />
            </button>
          </div>

          {/* Context pill */}
          {context.filePath ? (
            <div className="mt-3 flex items-center gap-2 rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 dark:border-white/8 dark:bg-white/5">
              <span className={`shrink-0 rounded-md px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${langClass}`}>
                {context.languageLabel}
              </span>
              <span className="min-w-0 truncate text-[11px] font-medium text-zinc-700 dark:text-zinc-300">{context.fileName}</span>
              <span className="ml-auto shrink-0 text-[10px] text-zinc-400 dark:text-zinc-500">{context.signals.nonEmptyLineCount}L</span>
            </div>
          ) : (
            <div className="mt-3 flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-700 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-300">
              <Zap size={11} />
              Open a file to give Gemini richer context
            </div>
          )}

          {/* Quick actions with toggle */}
          <div className="mt-3">
            <button
              type="button"
              onClick={() => setActionsOpen((v) => !v)}
              className="mb-2 flex w-full items-center justify-between text-[10px] font-semibold uppercase tracking-widest text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
            >
              <span>Quick Actions</span>
              {actionsOpen ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
            </button>

            <AnimatePresence initial={false}>
              {actionsOpen && (
                <Motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.15 }}
                  className="overflow-hidden"
                >
                  <div className="grid grid-cols-2 gap-1.5">
                    {QUICK_ACTIONS.map((action) => {
                      const Icon = action.icon;
                      return (
                        <button
                          key={action.id}
                          type="button"
                          onClick={() => void submitPrompt(action.prompt)}
                          disabled={isTyping}
                          className="flex items-center gap-2 rounded-lg border border-zinc-200 bg-zinc-50 px-2.5 py-2 text-[11px] font-medium text-zinc-600 transition-all hover:border-indigo-300 hover:bg-indigo-50 hover:text-indigo-700 disabled:opacity-40 dark:border-white/8 dark:bg-white/5 dark:text-zinc-300 dark:hover:border-indigo-400/30 dark:hover:bg-indigo-500/10 dark:hover:text-indigo-200"
                        >
                          <Icon size={11} className="shrink-0" />
                          {action.label}
                        </button>
                      );
                    })}
                  </div>
                </Motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </div>

      {/* ── Messages ── */}
      <div
        ref={scrollRef}
        className="flex flex-1 flex-col gap-4 overflow-y-auto px-3 py-4 scrollbar-thin scrollbar-thumb-zinc-200 dark:scrollbar-thumb-zinc-800"
      >
        <AnimatePresence initial={false}>
          {messages.map((msg) => {
            const isUser   = msg.sender === "You";
            const isLastAI = !isUser && msg.id === lastAiMsg?.id;
            return (
              <Motion.div
                key={msg.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.18 }}
                className={`group flex flex-col ${isUser ? "items-end" : "items-start"}`}
              >
                {!isUser && (
                  <div className="mb-1.5 flex items-center gap-1.5">
                    <div className="flex h-5 w-5 items-center justify-center rounded-full bg-gradient-to-br from-indigo-500 to-violet-600">
                      <Bot size={10} className="text-white" />
                    </div>
                    <span className="text-[10px] font-medium text-zinc-500 dark:text-zinc-400">Gemini AI</span>
                  </div>
                )}

                <div
                  className={`relative max-w-[92%] rounded-2xl px-3.5 py-2.5 ${
                    isUser
                      ? "rounded-tr-sm bg-indigo-600 text-white shadow-lg shadow-indigo-500/20"
                      : "rounded-tl-sm border border-zinc-200 bg-zinc-50 text-zinc-800 shadow-sm dark:border-white/8 dark:bg-zinc-900 dark:text-zinc-200"
                  }`}
                >
                  {isUser ? (
                    <p className="text-sm leading-relaxed">{msg.text}</p>
                  ) : (
                    <MessageText text={msg.text} />
                  )}

                  {!isUser && (
                    <button
                      onClick={() => handleCopy(msg.text, msg.id)}
                      className="absolute -right-1 -top-1 hidden rounded-md border border-zinc-200 bg-white p-1 text-zinc-400 opacity-0 shadow transition-opacity group-hover:flex group-hover:opacity-100 hover:text-zinc-700 dark:border-white/10 dark:bg-zinc-800 dark:hover:text-white"
                      title="Copy message"
                    >
                      {copied === msg.id ? (
                        <Check size={10} className="text-emerald-500" />
                      ) : (
                        <Copy size={10} />
                      )}
                    </button>
                  )}
                </div>

                <div className="mt-1 flex items-center gap-2 px-1">
                  <span className="text-[10px] text-zinc-400 dark:text-zinc-600">{msg.time}</span>
                  {isLastAI && !isTyping && (
                    <button
                      onClick={handleRegenerate}
                      className="flex items-center gap-1 text-[10px] text-zinc-400 opacity-0 transition-opacity group-hover:opacity-100 hover:text-zinc-600 dark:text-zinc-600 dark:hover:text-zinc-400"
                      title="Regenerate response"
                    >
                      <RotateCcw size={9} />
                      Regenerate
                    </button>
                  )}
                </div>
              </Motion.div>
            );
          })}
        </AnimatePresence>

        {isTyping && (
          <Motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex items-center gap-2">
            <div className="flex h-5 w-5 items-center justify-center rounded-full bg-gradient-to-br from-indigo-500 to-violet-600">
              <Bot size={10} className="text-white" />
            </div>
            <div className="flex items-center gap-1 rounded-2xl rounded-tl-sm border border-zinc-200 bg-zinc-50 px-4 py-3 shadow-sm dark:border-white/8 dark:bg-zinc-900">
              {[0, 150, 300].map((d, i) => (
                <span
                  key={i}
                  className="h-1.5 w-1.5 animate-bounce rounded-full bg-indigo-400"
                  style={{ animationDelay: `${d}ms` }}
                />
              ))}
            </div>
          </Motion.div>
        )}
      </div>

      {/* ── Input ── */}
      <div className="shrink-0 border-t border-zinc-200 bg-zinc-50 p-3 dark:border-white/5 dark:bg-zinc-950">
        <form
          onSubmit={handleSend}
          className="relative flex items-end gap-2 rounded-xl border border-zinc-200 bg-white px-3 py-2 shadow-sm transition-all focus-within:border-indigo-400 focus-within:ring-1 focus-within:ring-indigo-400/30 dark:border-white/10 dark:bg-zinc-900 dark:focus-within:border-indigo-500/40 dark:focus-within:ring-indigo-500/30"
        >
          <textarea
            ref={textareaRef}
            value={input}
            onChange={handleTextareaChange}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void submitPrompt(input); }
            }}
            placeholder="Ask Gemini anything about your code…"
            rows={1}
            className="flex-1 resize-none bg-transparent py-1 text-sm text-zinc-800 placeholder-zinc-400 focus:outline-none dark:text-zinc-200 dark:placeholder-zinc-500"
            style={{ minHeight: "24px", maxHeight: "120px" }}
          />
          <button
            type="submit"
            disabled={!input.trim() || isTyping}
            className="mb-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-indigo-600 text-white shadow-md shadow-indigo-500/30 transition-all hover:bg-indigo-500 disabled:bg-zinc-200 disabled:text-zinc-400 disabled:shadow-none dark:disabled:bg-zinc-800 dark:disabled:text-zinc-600"
          >
            {isTyping ? <RefreshCw size={13} className="animate-spin" /> : <Send size={13} className="ml-0.5" />}
          </button>
        </form>

        <div className="mt-1.5 flex items-center justify-between px-1">
          <p className="text-[10px] text-zinc-400 dark:text-zinc-600">Enter to send · Shift+Enter for newline</p>
          {charCount > 500 && (
            <span className={`text-[10px] font-medium ${charCount > 1500 ? "text-red-500" : "text-zinc-400 dark:text-zinc-500"}`}>
              {charCount}/2000
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
