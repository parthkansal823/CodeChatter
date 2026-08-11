import {
  SiC,
  SiCplusplus,
  SiCss,
  SiDocker,
  SiEslint,
  SiGnubash,
  SiGo,
  SiGraphql,
  SiHtml5,
  SiJavascript,
  SiJson,
  SiKotlin,
  SiLua,
  SiMarkdown,
  SiMysql,
  SiNextdotjs,
  SiNodedotjs,
  SiPerl,
  SiPhp,
  SiPostcss,
  SiPrettier,
  SiPython,
  SiReact,
  SiRuby,
  SiRust,
  SiSass,
  SiSwift,
  SiTailwindcss,
  SiTypescript,
  SiVite,
  SiVuedotjs,
  SiYaml,
} from "react-icons/si";
import { FaJava } from "react-icons/fa";
import {
  Binary,
  Braces,
  Database,
  FileArchive,
  FileAudio,
  FileCode2,
  FileImage,
  FileText,
  FileVideo,
  Folder,
  FolderOpen,
  GitBranch,
  KeyRound,
  Package,
  Settings2,
  Terminal,
  Type,
} from "lucide-react";

/**
 * File-tree icons, the way an editor sidebar does them.
 *
 * Two lookup tables instead of a chain of `if`s: a filename is either a known
 * exact name (`Dockerfile`, `.gitignore`) or it falls through to its extension.
 * Adding a type is one line in one map, which is what keeps the coverage wide.
 *
 * Colours are the language's own — that is the point of these icons, and it is
 * how the eye finds a file in a long tree. Everything with no brand of its own
 * uses theme tokens so it still follows light/dark.
 */

// Exact filenames win over extensions: `package.json` is not a generic JSON file.
const BY_FILENAME = {
  "package.json": [SiNodedotjs, "text-success-500"],
  "package-lock.json": [Package, "text-success-700"],
  "yarn.lock": [Package, "text-info-500"],
  "pnpm-lock.yaml": [Package, "text-warning-600"],
  "bun.lockb": [Package, "text-warning-500"],

  dockerfile: [SiDocker, "text-info-500"],
  "docker-compose.yml": [SiDocker, "text-info-500"],
  "docker-compose.yaml": [SiDocker, "text-info-500"],
  ".dockerignore": [SiDocker, "text-info-400"],

  ".gitignore": [GitBranch, "text-danger-500"],
  ".gitattributes": [GitBranch, "text-danger-500"],
  ".gitmodules": [GitBranch, "text-danger-500"],

  ".env": [KeyRound, "text-warning-500"],
  ".npmrc": [SiNodedotjs, "text-fg-muted"],
  ".editorconfig": [Settings2, "text-fg-muted"],
  ".prettierrc": [SiPrettier, "text-info-400"],
  ".eslintrc": [SiEslint, "text-brand-500"],
  "eslint.config.js": [SiEslint, "text-brand-500"],

  "vite.config.js": [SiVite, "text-brand-500"],
  "vite.config.ts": [SiVite, "text-brand-500"],
  "tailwind.config.js": [SiTailwindcss, "text-info-500"],
  "tailwind.config.cjs": [SiTailwindcss, "text-info-500"],
  "tailwind.config.ts": [SiTailwindcss, "text-info-500"],
  "postcss.config.js": [SiPostcss, "text-danger-500"],
  "postcss.config.cjs": [SiPostcss, "text-danger-500"],
  "next.config.js": [SiNextdotjs, "text-fg"],
  "next.config.ts": [SiNextdotjs, "text-fg"],

  makefile: [Terminal, "text-fg-muted"],
  "cmakelists.txt": [Settings2, "text-fg-muted"],
  "requirements.txt": [SiPython, "text-success-600"],
  "pyproject.toml": [SiPython, "text-success-600"],
  "cargo.toml": [SiRust, "text-warning-600"],
  "go.mod": [SiGo, "text-info-400"],
  "go.sum": [SiGo, "text-info-400"],
  "gemfile": [SiRuby, "text-danger-500"],
  "composer.json": [SiPhp, "text-brand-500"],
  "readme.md": [SiMarkdown, "text-info-400"],
  "license": [FileText, "text-warning-500"],
};

const BY_EXTENSION = {
  // Web
  html: [SiHtml5, "text-warning-500"],
  htm: [SiHtml5, "text-warning-500"],
  css: [SiCss, "text-info-500"],
  scss: [SiSass, "text-danger-400"],
  sass: [SiSass, "text-danger-400"],
  less: [SiCss, "text-info-600"],
  vue: [SiVuedotjs, "text-success-500"],
  svelte: [FileCode2, "text-danger-500"],

  // JavaScript / TypeScript
  js: [SiJavascript, "text-warning-400"],
  mjs: [SiJavascript, "text-warning-400"],
  cjs: [SiJavascript, "text-warning-400"],
  jsx: [SiReact, "text-info-400"],
  ts: [SiTypescript, "text-info-500"],
  mts: [SiTypescript, "text-info-500"],
  cts: [SiTypescript, "text-info-500"],
  tsx: [SiReact, "text-info-400"],

  // Languages
  py: [SiPython, "text-success-500"],
  pyw: [SiPython, "text-success-500"],
  pyi: [SiPython, "text-success-600"],
  ipynb: [SiPython, "text-warning-500"],
  java: [FaJava, "text-warning-600"],
  jar: [FaJava, "text-warning-700"],
  class: [Binary, "text-fg-subtle"],
  kt: [SiKotlin, "text-brand-600"],
  kts: [SiKotlin, "text-brand-600"],
  go: [SiGo, "text-info-400"],
  rs: [SiRust, "text-warning-600"],
  rb: [SiRuby, "text-danger-500"],
  php: [SiPhp, "text-brand-500"],
  swift: [SiSwift, "text-warning-500"],
  lua: [SiLua, "text-brand-600"],
  pl: [SiPerl, "text-info-500"],
  pm: [SiPerl, "text-info-500"],
  c: [SiC, "text-brand-500"],
  h: [SiC, "text-brand-400"],
  cpp: [SiCplusplus, "text-info-600"],
  cc: [SiCplusplus, "text-info-600"],
  cxx: [SiCplusplus, "text-info-600"],
  hpp: [SiCplusplus, "text-info-500"],
  cs: [FileCode2, "text-brand-600"],
  dart: [FileCode2, "text-info-500"],
  scala: [FileCode2, "text-danger-500"],
  r: [FileCode2, "text-info-500"],
  ex: [FileCode2, "text-brand-600"],
  exs: [FileCode2, "text-brand-600"],
  hs: [FileCode2, "text-brand-500"],
  clj: [FileCode2, "text-success-500"],
  zig: [FileCode2, "text-warning-500"],

  // Shell
  sh: [SiGnubash, "text-success-600"],
  bash: [SiGnubash, "text-success-600"],
  zsh: [SiGnubash, "text-success-600"],
  fish: [SiGnubash, "text-success-600"],
  ps1: [Terminal, "text-info-500"],
  bat: [Terminal, "text-fg-muted"],
  cmd: [Terminal, "text-fg-muted"],

  // Data / config
  json: [SiJson, "text-warning-500"],
  jsonc: [SiJson, "text-warning-500"],
  json5: [SiJson, "text-warning-500"],
  yaml: [SiYaml, "text-danger-500"],
  yml: [SiYaml, "text-danger-500"],
  toml: [Settings2, "text-warning-600"],
  ini: [Settings2, "text-fg-muted"],
  cfg: [Settings2, "text-fg-muted"],
  conf: [Settings2, "text-fg-muted"],
  xml: [Braces, "text-warning-600"],
  csv: [Database, "text-success-600"],
  tsv: [Database, "text-success-600"],
  sql: [SiMysql, "text-info-600"],
  db: [Database, "text-info-600"],
  sqlite: [Database, "text-info-600"],
  graphql: [SiGraphql, "text-danger-400"],
  gql: [SiGraphql, "text-danger-400"],
  env: [KeyRound, "text-warning-500"],
  lock: [Package, "text-fg-subtle"],

  // Documents
  md: [SiMarkdown, "text-info-400"],
  markdown: [SiMarkdown, "text-info-400"],
  mdx: [SiMarkdown, "text-info-500"],
  txt: [FileText, "text-fg-muted"],
  log: [FileText, "text-fg-subtle"],
  pdf: [FileText, "text-danger-500"],
  rtf: [FileText, "text-fg-muted"],

  // Media
  png: [FileImage, "text-danger-400"],
  jpg: [FileImage, "text-danger-400"],
  jpeg: [FileImage, "text-danger-400"],
  gif: [FileImage, "text-danger-400"],
  webp: [FileImage, "text-danger-400"],
  bmp: [FileImage, "text-danger-400"],
  svg: [FileImage, "text-warning-500"],
  ico: [FileImage, "text-info-500"],
  ttf: [Type, "text-fg-muted"],
  otf: [Type, "text-fg-muted"],
  woff: [Type, "text-fg-muted"],
  woff2: [Type, "text-fg-muted"],
  mp3: [FileAudio, "text-brand-500"],
  wav: [FileAudio, "text-brand-500"],
  flac: [FileAudio, "text-brand-500"],
  aac: [FileAudio, "text-brand-500"],
  ogg: [FileAudio, "text-brand-500"],
  mp4: [FileVideo, "text-info-500"],
  webm: [FileVideo, "text-info-500"],
  mkv: [FileVideo, "text-info-500"],
  avi: [FileVideo, "text-info-500"],
  mov: [FileVideo, "text-info-500"],

  // Archives / binaries
  zip: [FileArchive, "text-warning-600"],
  tar: [FileArchive, "text-warning-600"],
  gz: [FileArchive, "text-warning-600"],
  tgz: [FileArchive, "text-warning-600"],
  rar: [FileArchive, "text-warning-600"],
  "7z": [FileArchive, "text-warning-600"],
  exe: [Binary, "text-fg-subtle"],
  dll: [Binary, "text-fg-subtle"],
  so: [Binary, "text-fg-subtle"],
  bin: [Binary, "text-fg-subtle"],
  wasm: [Binary, "text-brand-500"],

  // App-specific
  nb: [FileCode2, "text-brand-500"],
};

const DEFAULT_FILE = [FileCode2, "text-fg-subtle"];

export function getFileVisual(name = "") {
  const lower = name.toLowerCase();

  const exact = BY_FILENAME[lower];
  if (exact) return { Icon: exact[0], className: exact[1] };

  // `.env.local`, `.env.production` and friends all read as env files.
  if (lower.startsWith(".env")) return { Icon: KeyRound, className: "text-warning-500" };

  // Config files often carry a compound extension: `foo.config.js` should still
  // resolve on `js`, which the plain extension lookup below already handles.
  const extension = lower.includes(".") ? lower.split(".").pop() : "";
  const match = BY_EXTENSION[extension] || DEFAULT_FILE;

  return { Icon: match[0], className: match[1] };
}

// Folders that are machine-generated read as inert; the rest share one colour so
// the tree does not turn into a colour chart.
const MUTED_FOLDERS = new Set([
  "node_modules",
  "venv",
  ".venv",
  ".git",
  "__pycache__",
  "dist",
  "build",
  ".next",
  ".cache",
  "coverage",
  "target",
  ".ruff_cache",
  ".trunk",
]);

export function getFolderVisual(name = "") {
  const isMuted = MUTED_FOLDERS.has(name.toLowerCase());

  return {
    Icon: Folder,
    OpenIcon: FolderOpen,
    className: isMuted ? "text-fg-subtle" : "text-info-400",
  };
}
