import { detectLanguageFromName } from "./workspace";

const LANGUAGE_LABELS = {
  c: "C",
  cpp: "C++",
  css: "CSS",
  go: "Go",
  html: "HTML",
  java: "Java",
  javascript: "JavaScript",
  json: "JSON",
  kotlin: "Kotlin",
  lua: "Lua",
  markdown: "Markdown",
  perl: "Perl",
  php: "PHP",
  plaintext: "Plain text",
  python: "Python",
  ruby: "Ruby",
  rust: "Rust",
  shell: "Shell",
  swift: "Swift",
  typescript: "TypeScript",
};

function countMatches(pattern, value) {
  const matches = value.match(pattern);
  return matches ? matches.length : 0;
}

function detectPurpose(code, language, filePath) {
  if (!code.trim()) {
    return "This file is empty right now, so the next best step is to scaffold the basic structure you want.";
  }

  if (language === "python" && /FastAPI\s*\(/.test(code)) {
    return "This looks like a FastAPI entry point that defines HTTP routes and boots an API app.";
  }

  if (language === "javascript" && /express\s*\(/.test(code)) {
    return "This looks like an Express server file that wires middleware and request handlers.";
  }

  if ((language === "javascript" || language === "typescript") && /useState|useEffect|return\s*\(/.test(code)) {
    return "This appears to be a React UI file that renders interactive stateful components.";
  }

  if (language === "html") {
    return "This file defines the page structure and likely works together with linked styles or scripts.";
  }

  if (language === "css") {
    return "This stylesheet controls layout, spacing, colors, and visual states for the UI.";
  }

  if (language === "markdown") {
    return "This looks like documentation or notes meant to guide collaborators through the workspace.";
  }

  if (/__main__|main\s*\(/.test(code) || /export default|module\.exports/.test(code)) {
    return "This file looks like a main entry point that drives the behavior of the feature or app.";
  }

  return `This file is mainly focused on ${filePath || "the current workspace file"} and its core implementation details.`;
}

function collectSignals(code = "", language = "plaintext") {
  return {
    lineCount: code ? code.split(/\r?\n/).length : 0,
    nonEmptyLineCount: code
      ? code.split(/\r?\n/).filter((line) => line.trim().length > 0).length
      : 0,
    importCount: countMatches(
      /^\s*(import\s.+from\s.+|import\s.+|from\s.+\simport\s.+|require\(.+\))/gm,
      code
    ),
    functionCount: countMatches(
      /\bfunction\b|\bdef\b|\bclass\b|=>\s*{|const\s+\w+\s*=\s*\(|public\s+\w+\s+\w+\s*\(/gm,
      code
    ),
    conditionalCount: countMatches(/\bif\b|\bswitch\b|\bcase\b|\bmatch\b/gm, code),
    hasTodo: /TODO|FIXME/i.test(code),
    hasConsoleOutput: /console\.log|print\(|System\.out\.println|fmt\.Print/.test(code),
    hasErrorHandling: /try\s*{|catch\s*\(|except\s+|finally\s*:|throw\s+new|raise\s+/.test(code),
    hasTests: /\bdescribe\s*\(|\bit\s*\(|\btest\s*\(|pytest|unittest|assert\s/.test(code),
    hasTypes: language === "typescript" || /:\s*[A-Z][A-Za-z0-9_<>,[\]\s|?]*/.test(code),
    hasComments: /\/\/|#|\/\*/.test(code),
  };
}

function getErrorSummary(runResult) {
  if (!runResult) {
    return "No recent run result is available yet.";
  }

  if (runResult.exitCode === 0 && !runResult.stderr?.trim()) {
    return "The latest run completed successfully, so there is no active runtime failure to inspect.";
  }

  const stderr = (runResult.stderr || "").trim();
  const excerpt = stderr
    ? stderr.split(/\r?\n/).slice(0, 3).join(" ").slice(0, 220)
    : "The process exited with a non-zero status.";

  return `Latest run signal: ${excerpt}`;
}

function getDebugSuggestions(runResult, language) {
  const stderr = `${runResult?.stderr || ""} ${runResult?.stdout || ""}`.toLowerCase();
  const suggestions = [];

  if (!runResult) {
    suggestions.push("Run the active file once so we can compare the code against a real error signal.");
    return suggestions;
  }

  if (runResult.exitCode === 0 && !runResult.stderr?.trim()) {
    suggestions.push("The last run succeeded, so I would switch from debugging to cleanup or test coverage.");
    return suggestions;
  }

  if (/syntaxerror|unexpected token|indentationerror/.test(stderr)) {
    suggestions.push("Check the exact line named in the parser error first, because syntax issues usually cascade into misleading follow-up messages.");
  }

  if (/modulenotfounderror|cannot find module|no module named/.test(stderr)) {
    suggestions.push("A dependency or import path is missing. Verify the filename, export name, and whether the package is installed in this workspace.");
  }

  if (/referenceerror|nameerror|is not defined/.test(stderr)) {
    suggestions.push("Something is being used before it exists. Compare the failing name against local variable scope, import spelling, and capitalization.");
  }

  if (/typeerror|attributeerror|nullpointer|cannot read/.test(stderr)) {
    suggestions.push("A value is likely undefined, null, or shaped differently than expected. Add a quick guard near the failing access and log the incoming value.");
  }

  if (language === "python" && !suggestions.length) {
    suggestions.push("For Python files, start by checking indentation, import paths, and whether the script expects input that was not provided.");
  }

  if ((language === "javascript" || language === "typescript") && !suggestions.length) {
    suggestions.push("For JS and TS files, inspect imports, async code paths, and any object access that assumes data is already loaded.");
  }

  if (!suggestions.length) {
    suggestions.push("Trace the failure from the first error line rather than the last one. The earliest stack frame is usually the real root cause.");
  }

  return suggestions;
}

function getImprovementSuggestions(signals, language) {
  const suggestions = [];

  if (signals.nonEmptyLineCount > 160) {
    suggestions.push("Split this file into smaller units. At its current size, future edits and review cycles will get harder to reason about.");
  }

  if (signals.functionCount <= 1 && signals.nonEmptyLineCount > 35) {
    suggestions.push("Extract named helper functions so the main flow reads more clearly and repeated logic has a single home.");
  }

  if (!signals.hasErrorHandling && ["javascript", "typescript", "python", "java", "go"].includes(language)) {
    suggestions.push("Add explicit error handling around risky paths like network work, parsing, file access, or command execution.");
  }

  if (!signals.hasTests && ["javascript", "typescript", "python", "java", "go", "rust"].includes(language)) {
    suggestions.push("This is a good candidate for a small test file that locks in the happy path plus one or two edge cases.");
  }

  if (signals.hasConsoleOutput) {
    suggestions.push("Review debug output before shipping. Keep only logs that are genuinely useful for operators or collaborators.");
  }

  if (signals.hasTodo) {
    suggestions.push("There are TODO markers here, so this file already signals unfinished work. Converting the most important one into a concrete follow-up would help.");
  }

  if (!signals.hasComments && signals.nonEmptyLineCount > 80) {
    suggestions.push("A short comment above the trickiest block would improve readability more than broad commenting everywhere.");
  }

  return suggestions.slice(0, 4);
}

function getTestIdeas(filePath, language) {
  if (language === "python") {
    return [
      "Cover the main function or exported helper with one normal input and one edge case.",
      "Add a failure-path test for invalid input or missing dependencies.",
      "If this script prints output, assert on the returned value or captured stdout instead of manual inspection.",
    ];
  }

  if (language === "javascript" || language === "typescript") {
    return [
      "Test the default flow first, then add one case for empty input or missing data.",
      "If this is a React component, verify the main render state and one interaction path.",
      "Mock external fetches, timers, or browser APIs so failures are easy to reproduce.",
    ];
  }

  return [
    `Start with one test that proves ${filePath || "this file"} works on a normal path.`,
    "Add an edge case for invalid input, empty state, or unexpected shape.",
    "Include one regression case tied to the last bug or most fragile branch.",
  ];
}

export function summarizeActiveFileContext({ roomName, activeFilePath, activeCode, runResult }) {
  const language = detectLanguageFromName(activeFilePath || "");
  const signals = collectSignals(activeCode, language);

  return {
    roomName: roomName || "Current room",
    filePath: activeFilePath || "",
    fileName: activeFilePath ? activeFilePath.split("/").pop() : "",
    language,
    languageLabel: LANGUAGE_LABELS[language] || language,
    signals,
    purpose: detectPurpose(activeCode || "", language, activeFilePath || ""),
    errorSummary: getErrorSummary(runResult),
  };
}

export function buildLocalAssistantReply({
  prompt,
  roomName,
  activeFilePath,
  activeCode,
  runResult,
}) {
  const trimmedPrompt = prompt.trim();

  if (!trimmedPrompt) {
    return "Ask about the current file and I will use the local workspace context to help.";
  }

  if (!activeFilePath) {
    return [
      "Open a file first so I can give grounded advice instead of generic guesses.",
      "Once a file is active, I can explain what it does, suggest improvements, or help debug the latest run.",
    ].join("\n\n");
  }

  const context = summarizeActiveFileContext({
    roomName,
    activeFilePath,
    activeCode,
    runResult,
  });
  const promptLower = trimmedPrompt.toLowerCase();
  const wantsDebug = /debug|error|fix|why|issue|crash|fail/.test(promptLower);
  const wantsTests = /test|coverage|cases|edge case/.test(promptLower);
  const wantsImprove = /improve|refactor|clean|optimi[sz]e|better/.test(promptLower);
  const wantsExplain = /explain|what does|understand|overview|summar/.test(promptLower);

  if (wantsDebug) {
    const suggestions = getDebugSuggestions(runResult, context.language);
    return [
      `Debug view for ${context.filePath}`,
      `- ${context.errorSummary}`,
      ...suggestions.map((item) => `- ${item}`),
    ].join("\n");
  }

  if (wantsTests) {
    return [
      `Test ideas for ${context.filePath}`,
      ...getTestIdeas(context.filePath, context.language).map((item) => `- ${item}`),
    ].join("\n");
  }

  if (wantsImprove) {
    const suggestions = getImprovementSuggestions(context.signals, context.language);
    return [
      `Improvement pass for ${context.filePath}`,
      `- ${context.purpose}`,
      ...(suggestions.length
        ? suggestions.map((item) => `- ${item}`)
        : ["- The file already looks fairly lean. My next step would be adding tests or documenting the hardest branch."]),
    ].join("\n");
  }

  if (wantsExplain || trimmedPrompt.length < 18) {
    return [
      `Quick explanation for ${context.filePath}`,
      `- Workspace: ${context.roomName}`,
      `- Language: ${context.languageLabel}`,
      `- Size: ${context.signals.nonEmptyLineCount} non-empty lines, ${context.signals.functionCount} notable blocks`,
      `- ${context.purpose}`,
      `- Imports detected: ${context.signals.importCount || 0}`,
    ].join("\n");
  }

  return [
    `Context-aware answer for ${context.filePath}`,
    `- ${context.purpose}`,
    `- Latest run: ${context.errorSummary}`,
    `- Based on your question, I would inspect ${context.signals.hasErrorHandling ? "the data flow and edge cases" : "missing guards and error handling"} first.`,
    `- Strong next move: ${getImprovementSuggestions(context.signals, context.language)[0] || "run the file, then ask me to debug the result."}`,
  ].join("\n");
}
