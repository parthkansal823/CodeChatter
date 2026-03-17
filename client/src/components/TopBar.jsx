import { useState, useRef, useEffect } from "react";
import { Github, Share2, ChevronDown, Copy, Home } from "lucide-react";
import { useNavigate } from "react-router-dom";
import toast from "react-hot-toast";

import {
  SiCplusplus,
  SiJavascript,
  SiTypescript,
  SiPython,
  SiRust,
  SiPhp,
  SiRuby,
  SiHtml5
} from "react-icons/si";

import { DiJava, DiCss3 } from "react-icons/di";
import { VscJson, VscMarkdown } from "react-icons/vsc";

const LANGUAGES = [
  { label: "C++", value: "cpp", icon: SiCplusplus },
  { label: "JavaScript", value: "javascript", icon: SiJavascript },
  { label: "TypeScript", value: "typescript", icon: SiTypescript },
  { label: "Python", value: "python", icon: SiPython },
  { label: "Java", value: "java", icon: DiJava },
  { label: "Rust", value: "rust", icon: SiRust },
  { label: "PHP", value: "php", icon: SiPhp },
  { label: "Ruby", value: "ruby", icon: SiRuby },
  { label: "HTML", value: "html", icon: SiHtml5 },
  { label: "CSS", value: "css", icon: DiCss3 },
  { label: "JSON", value: "json", icon: VscJson },
  { label: "Markdown", value: "markdown", icon: VscMarkdown }
];

export default function TopBar({
  onLanguageChange,
  roomId,
  code
}) {
  const navigate = useNavigate();

  const [language, setLanguage] = useState(LANGUAGES[0]);
  const [dropdownOpen, setDropdownOpen] = useState(false);

  const dropdownRef = useRef();

  const users = [
    { id: 1, name: "Parth", active: false },
    { id: 2, name: "Niyati", active: true },
    { id: 3, name: "Aman", active: false },
    { id: 4, name: "Riya", active: true }
  ];

  const sortedUsers = [...users].sort(
    (a, b) => Number(b.active) - Number(a.active)
  );

  const connectionStatus = "connected";

  const avatarColors = [
    "bg-red-500",
    "bg-blue-500",
    "bg-green-500",
    "bg-purple-500",
    "bg-pink-500",
    "bg-yellow-500"
  ];

  useEffect(() => {
    const handler = (e) => {
      if (!dropdownRef.current?.contains(e.target)) {
        setDropdownOpen(false);
      }
    };

    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const handleLanguageSelect = (lang) => {
    setLanguage(lang);
    onLanguageChange?.(lang.value);
    setDropdownOpen(false);
  };

  const copyRoomLink = async () => {
    const link = `${window.location.origin}/room/${roomId}`;

    try {
      await navigator.clipboard.writeText(link);
      toast.success("Room link copied!");
    } catch {
      toast.error("Failed to copy link");
    }
  };

  const shareCode = async () => {
    try {
      await navigator.clipboard.writeText(code || "");
      toast.success("Code copied!");
    } catch {
      toast.error("Failed to copy code");
    }
  };

  const handleBackToHome = () => {
    navigate("/home");
  };

  const CurrentIcon = language.icon;

  return (
    <div className="h-14 border-b flex items-center justify-between px-6
      bg-white dark:bg-zinc-950
      border-zinc-300 dark:border-zinc-800">

      {/* LEFT */}
      <div className="flex items-center gap-5">

        <span className="font-semibold text-zinc-800 dark:text-white">
          Room: {roomId}
        </span>

        <button
          onClick={copyRoomLink}
          className="flex items-center gap-1 text-sm
          text-zinc-600 dark:text-zinc-400
          hover:text-black dark:hover:text-white transition"
        >
          <Copy size={14} />
          Copy Link
        </button>

        <span className={`text-xs px-2 py-1 rounded font-medium ${
          connectionStatus === "connected"
            ? "bg-green-600 text-white"
            : "bg-red-600 text-white"
        }`}>
          {connectionStatus}
        </span>

      </div>

      {/* CENTER */}
      <div className="flex items-center gap-4">

        {/* LANGUAGE DROPDOWN */}
        <div className="relative" ref={dropdownRef}>

          <button
            onClick={() => setDropdownOpen(!dropdownOpen)}
            className="flex items-center gap-2
            bg-zinc-200 dark:bg-zinc-800
            border border-zinc-300 dark:border-zinc-700
            px-3 py-1.5 rounded text-sm
            text-zinc-800 dark:text-white
            hover:bg-zinc-300 dark:hover:bg-zinc-700 transition"
          >
            <CurrentIcon size={16} />
            {language.label}
            <ChevronDown size={16} />
          </button>

          {dropdownOpen && (
            <div className="absolute top-10 left-0 w-56 rounded shadow-lg z-50
              bg-white dark:bg-zinc-900
              border border-zinc-300 dark:border-zinc-800">

              {LANGUAGES.map((lang) => {

                const Icon = lang.icon;

                return (
                  <button
                    key={lang.value}
                    onClick={() => handleLanguageSelect(lang)}
                    className={`w-full flex items-center gap-3 px-3 py-2 text-sm
                    text-zinc-800 dark:text-white
                    hover:bg-zinc-200 dark:hover:bg-zinc-800 transition
                    ${
                      language.value === lang.value
                        ? "bg-zinc-200 dark:bg-zinc-800"
                        : ""
                    }`}
                  >
                    <Icon size={16} />
                    {lang.label}
                  </button>
                );
              })}

            </div>
          )}

        </div>

      </div>

      {/* RIGHT */}
      <div className="flex items-center gap-4">

        {/* ACTIVE USERS */}
        <div className="flex items-center gap-2">

          {sortedUsers.map((user, index) => {

            const color = avatarColors[index % avatarColors.length];

            return (
              <div
                key={user.id}
                title={`${user.name} ${user.active ? "(online)" : "(offline)"}`}
                className={`relative w-8 h-8 rounded-full flex items-center justify-center
                text-white text-xs font-semibold cursor-pointer
                ${color}
                ${user.active ? "ring-2 ring-green-400" : "opacity-40"}
                border border-white dark:border-zinc-900
                hover:scale-110 transition`}
              >

                {user.name.charAt(0)}

                {user.active && (
                  <span className="absolute bottom-0 right-0 w-2.5 h-2.5
                    bg-green-400 border-2 border-white dark:border-zinc-950
                    rounded-full"
                  />
                )}

              </div>
            );

          })}

        </div>

        {/* GITHUB */}
        <button
          onClick={() => window.open("https://github.com", "_blank")}
          className="p-2 rounded-md hover:bg-zinc-200 dark:hover:bg-zinc-800 transition"
        >
          <Github size={18} />
        </button>

        {/* SHARE */}
        <button
          onClick={shareCode}
          title="Share Code"
          className="p-2 rounded-md hover:bg-zinc-200 dark:hover:bg-zinc-800 transition"
        >
          <Share2 size={18} />
        </button>

        {/* BACK TO HOME */}
        <button
          onClick={handleBackToHome}
          className="p-2 rounded-md hover:bg-zinc-200 dark:hover:bg-zinc-800 transition
          text-zinc-600 dark:text-zinc-400 hover:text-zinc-800 dark:hover:text-white"
          title="Back to Dashboard"
        >
          <Home size={18} />
        </button>

      </div>

    </div>
  );
}
