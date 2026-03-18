import {
  Braces,
  FileCode2,
  FileText,
  Folder,
  FolderOpen,
  FileJson,
  Zap,
  Package,
  Lock,
  Database,
  GitBranch,
  FileImage,
  FileArchive,
  FileAudio,
  FileVideo,
} from "lucide-react";

export function getFileVisual(name = "") {
  const extension = name.includes(".")
    ? name.split(".").pop().toLowerCase()
    : "";

  // JSON files
  if (extension === "json") {
    return {
      Icon: FileJson,
      className: "text-yellow-500",
    };
  }

  // Document files
  if (extension === "md" || extension === "markdown") {
    return {
      Icon: FileText,
      className: "text-blue-500",
    };
  }

  if (extension === "txt" || extension === "log") {
    return {
      Icon: FileText,
      className: "text-zinc-400",
    };
  }

  // Markup/Web files
  if (extension === "html" || extension === "htm") {
    return {
      Icon: FileCode2,
      className: "text-orange-500",
    };
  }

  if (extension === "css" || extension === "scss" || extension === "sass" || extension === "less") {
    return {
      Icon: FileCode2,
      className: "text-sky-500",
    };
  }

  // JavaScript/TypeScript
  if (extension === "js" || extension === "jsx" || extension === "mjs") {
    return {
      Icon: FileCode2,
      className: "text-yellow-400",
    };
  }

  if (extension === "ts" || extension === "tsx") {
    return {
      Icon: FileCode2,
      className: "text-blue-500",
    };
  }

  // Python
  if (extension === "py" || extension === "pyw") {
    return {
      Icon: FileCode2,
      className: "text-emerald-500",
    };
  }

  // Java
  if (extension === "java") {
    return {
      Icon: FileCode2,
      className: "text-orange-600",
    };
  }

  // Go
  if (extension === "go") {
    return {
      Icon: FileCode2,
      className: "text-cyan-400",
    };
  }

  // Rust
  if (extension === "rs") {
    return {
      Icon: FileCode2,
      className: "text-amber-600",
    };
  }

  // PHP
  if (extension === "php") {
    return {
      Icon: FileCode2,
      className: "text-purple-500",
    };
  }

  // Ruby
  if (extension === "rb") {
    return {
      Icon: FileCode2,
      className: "text-red-500",
    };
  }

  // C/C++
  if (extension === "c" || extension === "cpp" || extension === "cc" || extension === "cxx" || extension === "h" || extension === "hpp") {
    return {
      Icon: FileCode2,
      className: "text-blue-600",
    };
  }

  // Shell/Bash
  if (extension === "sh" || extension === "bash" || extension === "zsh") {
    return {
      Icon: FileCode2,
      className: "text-green-500",
    };
  }

  // Configuration files
  if (
    name === ".env" ||
    name === ".env.local" ||
    name === ".env.example" ||
    extension === "env"
  ) {
    return {
      Icon: Lock,
      className: "text-red-500",
    };
  }

  if (
    name === ".gitignore" ||
    name === ".gitattributes" ||
    extension === "git" ||
    extension === "github"
  ) {
    return {
      Icon: GitBranch,
      className: "text-red-600",
    };
  }

  if (
    name === "package.json" ||
    name === "package-lock.json" ||
    name === "yarn.lock" ||
    name === "pnpm-lock.yaml"
  ) {
    return {
      Icon: Package,
      className: "text-red-500",
    };
  }

  if (name === "dockerfile" || extension === "dockerfile" || name === ".dockerignore") {
    return {
      Icon: Zap,
      className: "text-blue-400",
    };
  }

  if (
    extension === "sql" ||
    extension === "db" ||
    extension === "sqlite" ||
    extension === "dbml"
  ) {
    return {
      Icon: Database,
      className: "text-blue-600",
    };
  }

  // YAML/TOML
  if (extension === "yaml" || extension === "yml" || extension === "toml") {
    return {
      Icon: FileText,
      className: "text-red-500",
    };
  }

  // Image files
  if (extension === "png" || extension === "jpg" || extension === "jpeg" || extension === "gif" || extension === "webp" || extension === "svg") {
    return {
      Icon: FileImage,
      className: "text-pink-500",
    };
  }

  // Archive files
  if (
    extension === "zip" ||
    extension === "tar" ||
    extension === "gz" ||
    extension === "rar" ||
    extension === "7z"
  ) {
    return {
      Icon: FileArchive,
      className: "text-yellow-600",
    };
  }

  // Audio files
  if (extension === "mp3" || extension === "wav" || extension === "flac" || extension === "aac") {
    return {
      Icon: FileAudio,
      className: "text-purple-500",
    };
  }

  // Video files
  if (extension === "mp4" || extension === "webm" || extension === "mkv" || extension === "avi") {
    return {
      Icon: FileVideo,
      className: "text-cyan-500",
    };
  }

  // Default
  return {
    Icon: FileCode2,
    className: "text-cyan-500",
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

  return {
    Icon: Folder,
    OpenIcon: FolderOpen,
    className: "text-amber-500",
  };
}
