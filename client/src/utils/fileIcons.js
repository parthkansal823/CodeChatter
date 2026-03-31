import {
  SiJavascript,
  SiTypescript,
  SiPython,
  SiHtml5,
  SiCss,
  SiReact,
  SiGo,
  SiRust,
  SiRuby,
  SiPhp,
  SiGnubash,
  SiSwift,
  SiKotlin,
  SiDocker,
  SiCplusplus,
  SiC,
  SiVite,
  SiNextdotjs,
  SiNodedotjs,
  SiTailwindcss,
} from "react-icons/si";
import { VscJson, VscMarkdown } from "react-icons/vsc";
import { FaJava } from "react-icons/fa";
import {
  FileText,
  Folder,
  FolderOpen,
  Lock,
  GitBranch,
  Package,
  Database,
  FileImage,
  FileArchive,
  FileAudio,
  FileVideo,
  FileCode2,
} from "lucide-react";

export function getFileVisual(name = "") {
  const extension = name.includes(".")
    ? name.split(".").pop().toLowerCase()
    : "";

  // Exact file name matches
  if (name === "package.json") return { Icon: SiNodedotjs, className: "text-green-500" };
  if (name === "vite.config.js" || name === "vite.config.ts") return { Icon: SiVite, className: "text-purple-500" };
  if (name === "tailwind.config.js" || name === "tailwind.config.ts") return { Icon: SiTailwindcss, className: "text-cyan-500" };
  if (name === "next.config.js" || name === "next.config.ts") return { Icon: SiNextdotjs, className: "text-zinc-900 dark:text-white" };
  
  // Notebook files
  if (extension === "nb") return { Icon: FileCode2, className: "text-violet-500" };

  // JSON files
  if (extension === "json") return { Icon: VscJson, className: "text-yellow-500" };

  // Document files
  if (extension === "md" || extension === "markdown") return { Icon: VscMarkdown, className: "text-blue-500" };
  if (extension === "txt" || extension === "log") return { Icon: FileText, className: "text-zinc-400" };

  // Markup/Web files
  if (extension === "html" || extension === "htm") return { Icon: SiHtml5, className: "text-orange-500" };
  if (extension === "css" || extension === "scss" || extension === "sass" || extension === "less") return { Icon: SiCss, className: "text-blue-500" };

  // JavaScript/TypeScript + React
  if (extension === "jsx" || extension === "tsx") return { Icon: SiReact, className: "text-cyan-400" };
  if (extension === "js" || extension === "mjs" || extension === "cjs") return { Icon: SiJavascript, className: "text-yellow-400" };
  if (extension === "ts") return { Icon: SiTypescript, className: "text-blue-500" };

  // Python
  if (extension === "py" || extension === "pyw") return { Icon: SiPython, className: "text-emerald-500" };

  // Java
  if (extension === "java" || extension === "jar") return { Icon: FaJava, className: "text-amber-600" };

  // Go
  if (extension === "go") return { Icon: SiGo, className: "text-cyan-400" };

  // Rust
  if (extension === "rs") return { Icon: SiRust, className: "text-amber-600" };

  // PHP
  if (extension === "php") return { Icon: SiPhp, className: "text-purple-500" };

  // Ruby
  if (extension === "rb") return { Icon: SiRuby, className: "text-red-500" };

  // C/C++
  if (extension === "cpp" || extension === "cc" || extension === "cxx") return { Icon: SiCplusplus, className: "text-blue-600" };
  if (extension === "c" || extension === "h" || extension === "hpp") return { Icon: SiC, className: "text-indigo-500" };

  // Shell/Bash
  if (extension === "sh" || extension === "bash" || extension === "zsh") return { Icon: SiGnubash, className: "text-zinc-700 dark:text-zinc-300" };

  // Swift
  if (extension === "swift") return { Icon: SiSwift, className: "text-orange-500" };

  // Kotlin
  if (extension === "kt" || extension === "kts") return { Icon: SiKotlin, className: "text-purple-600" };

  // Docker
  if (name === "dockerfile" || extension === "dockerfile" || name === ".dockerignore") return { Icon: SiDocker, className: "text-blue-500" };

  // Configuration & System files
  if (name === ".env" || name.startsWith(".env.") || extension === "env") return { Icon: Lock, className: "text-zinc-500" };
  if (name === ".gitignore" || extension === "git") return { Icon: GitBranch, className: "text-red-500" };
  if (name === "package-lock.json" || name === "yarn.lock" || name === "pnpm-lock.yaml") return { Icon: Package, className: "text-amber-700" };
  
  if (["sql", "db", "sqlite", "dbml"].includes(extension)) return { Icon: Database, className: "text-blue-600" };
  if (["yaml", "yml", "toml"].includes(extension)) return { Icon: FileText, className: "text-red-500" };
  
  // Media files
  if (["png", "jpg", "jpeg", "gif", "webp", "svg", "ico"].includes(extension)) return { Icon: FileImage, className: "text-pink-500" };
  if (["zip", "tar", "gz", "rar", "7z"].includes(extension)) return { Icon: FileArchive, className: "text-yellow-600" };
  if (["mp3", "wav", "flac", "aac"].includes(extension)) return { Icon: FileAudio, className: "text-purple-500" };
  if (["mp4", "webm", "mkv", "avi"].includes(extension)) return { Icon: FileVideo, className: "text-cyan-500" };

  // Default
  return {
    Icon: FileCode2,
    className: "text-zinc-500",
  };
}

export function getFolderVisual(name = "") {
  // Special folder colors
  if (name === "node_modules" || name === "venv" || name === ".git" || name === "__pycache__") {
    return {
      Icon: Folder,
      OpenIcon: FolderOpen,
      className: "text-zinc-500",
    };
  }
  
  if (name === "src" || name === "public" || name === "components" || name === "pages" || name === "api") {
    return {
      Icon: Folder,
      OpenIcon: FolderOpen,
      className: "text-blue-500",
    };
  }

  return {
    Icon: Folder,
    OpenIcon: FolderOpen,
    className: "text-amber-500",
  };
}
