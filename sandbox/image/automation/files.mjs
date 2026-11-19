// Files in automations, for host.mjs and builtins.mjs: what a step makes (File Helper's Create File, a CSV file, a zip) is kept with its run and read back from
// the worker at an address of its own, and outputs the engine keeps apart (over 32 KB) are put back into a run's details. Also the room's files, for the Read
// files and Write a file steps: paths inside the workspace only, and patterns such as reports/**/*.csv.
import { readdirSync } from "node:fs";
import { join, posix } from "node:path";

export const RUN_ID = /^[\w-]{1,64}$/;
export const FILE_ID = /^[\w-]{1,64}$/;
/** How much of the outputs kept apart goes back into a run's details: past it, the rest stay apart (the engine still reads them). */
export const MOST_WHOLE_BYTES = 8 * 1024 * 1024;
/** The most a file step reads or writes, as Activepieces' own limit on a step's file (AP_MAX_FILE_SIZE_MB). */
export const MOST_FILE_BYTES = 10 * 1024 * 1024;

/** A file's name as given with it, safe as one: no folders, no control characters. */
export function fileNameOf(given) {
  const name = String(given ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .split(/[\\/]/)
    .at(-1)
    .trim()
    .slice(0, 200);
  return name && name !== "." && name !== ".." ? name : "file";
}

/** Content-Disposition's filename*, which the engine reads back with [\w%\-.]+, so every other character is encoded. */
export function dispositionOf(name) {
  return `attachment; filename*=UTF-8''${encodeURIComponent(name).replace(/[!'()*~]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`)}`;
}

const TYPES = {
  csv: "text/csv",
  json: "application/json",
  txt: "text/plain",
  md: "text/markdown",
  html: "text/html",
  xml: "application/xml",
  yaml: "application/yaml",
  yml: "application/yaml",
  pdf: "application/pdf",
  zip: "application/zip",
  gz: "application/gzip",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};
/** A file's type by its name, for whoever reads it next. */
export const typeOf = (name) => TYPES[String(name).split(".").at(-1)?.toLowerCase() ?? ""] ?? "application/octet-stream";

/** Where a step's file is read from, while the worker on `port` runs. Its name is the last part, as the engine takes a file's name from an address. */
export const stepFileUrl = (port, runId, fileId, name) => `http://127.0.0.1:${port}/v1/step-files/${runId}/${fileId}/${encodeURIComponent(name)}`;

const FILE_URL = /http:\/\/127\.0\.0\.1:\d+\/v1\/step-files\//g;
/**
 * A value with its steps' files read from the worker on `port`: each worker has a port of its own, so a run carried on, tried again, given pinned data or an
 * earlier run's output reads the same files from this one.
 */
export function filesHere(value, port) {
  if (value === undefined) return value;
  const text = JSON.stringify(value);
  return text.includes("/v1/step-files/") ? JSON.parse(text.replace(FILE_URL, `http://127.0.0.1:${port}/v1/step-files/`)) : value;
}

/**
 * Steps with the outputs the engine kept apart put back, so the run's details show them and a run carried on has them: up to MOST_WHOLE_BYTES in all, and in
 * each time round a loop. `read` gives an output's bytes by its id, or null.
 */
export function wholeSteps(steps, read, budget = { left: MOST_WHOLE_BYTES }) {
  for (const step of Object.values(steps ?? {})) {
    if (!step || typeof step !== "object") continue;
    if (step.outputType === "slice" && typeof step.output?.fileId === "string") {
      const size = Number(step.output.size) || 0;
      const data = size <= budget.left ? read(step.output.fileId) : null;
      if (data) {
        try {
          step.output = JSON.parse(data.toString("utf8"));
          delete step.outputType;
          budget.left -= size;
        } catch {
          // Left as the engine gave it.
        }
      }
    }
    for (const iteration of Array.isArray(step.output?.iterations) ? step.output.iterations : []) wholeSteps(iteration, read, budget);
  }
  return steps;
}

/** A path in the room, as people write it (src/app.ts, ./notes.md): inside the workspace, or refused saying so. */
export function roomPathOf(given) {
  const text = String(given ?? "")
    .trim()
    .replace(/\\/g, "/")
    .replace(/^(\.\/)+/, "");
  if (!text) throw new Error("Say which file, such as reports/summary.csv.");
  if (text.startsWith("/") || /^[A-Za-z]:/.test(text) || text.split("/").includes("..")) throw new Error(`"${text}" should be a path in the room, such as reports/summary.csv.`);
  return posix.normalize(text).replace(/\/+$/, "");
}

/** A pattern as a test: * is any name's part, ** any folders, ? one character, {a,b} either. */
export function patternOf(pattern) {
  let source = "";
  for (let at = 0; at < pattern.length; at += 1) {
    const character = pattern[at];
    if (character === "*" && pattern[at + 1] === "*") {
      // "**/" is any folders, none too.
      if (pattern[at + 2] === "/") {
        source += "(?:[^/]+/)*";
        at += 2;
      } else {
        source += ".*";
        at += 1;
      }
    } else if (character === "*") source += "[^/]*";
    else if (character === "?") source += "[^/]";
    else if (character === "{") {
      const end = pattern.indexOf("}", at);
      if (end === -1) source += "\\{";
      else {
        source += `(?:${pattern
          .slice(at + 1, end)
          .split(",")
          .map((each) => each.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[^/]*").replace(/\?/g, "[^/]"))
          .join("|")})`;
        at = end;
      }
    } else source += character.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${source}$`);
}

const SKIPPED = new Set([".git", "node_modules"]);
/**
 * The room's files a pattern (or a plain path) names, as paths in the room, sorted: never .git or node_modules unless the pattern names them. At most `most`;
 * `more` says whether there were others.
 */
export function filesMatching(root, given, most = 100) {
  const pattern = roomPathOf(given);
  const wild = /[*?{]/.test(pattern);
  if (!wild) return { paths: [pattern], more: false };
  const test = patternOf(pattern);
  // Only the folders the pattern can be in: those before its first wildcard.
  const parts = pattern.split("/");
  const firstWild = parts.findIndex((part) => /[*?{]/.test(part));
  const base = parts.slice(0, firstWild).join("/");
  const named = new Set(parts.filter((part) => SKIPPED.has(part)));
  const found = [];
  let more = false;
  const walk = (folder) => {
    let entries = [];
    try {
      entries = readdirSync(join(root, folder), { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const path = folder ? `${folder}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (!SKIPPED.has(entry.name) || named.has(entry.name)) walk(path);
      } else if (entry.isFile() && test.test(path)) {
        if (found.length >= most) {
          more = true;
          return;
        }
        found.push(path);
      }
      if (more) return;
    }
  };
  walk(base);
  return { paths: found, more };
}
