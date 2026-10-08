import type { AiMode } from "@codechatter/contracts";

import type { AiAttach } from "./ai-requests";

/** How far back a room summary looks, in minutes. */
export const SUMMARY_WINDOWS: Array<[number, string]> = [
  [15, "Last 15 minutes"],
  [60, "Last hour"],
  [240, "Last 4 hours"],
  [1440, "Last day"],
];

type ModeInfo = {
  label: string;
  description: string;
  placeholder: string;
  /** Sent when the message box is empty and you press Enter. */
  fallbackPrompt: string | null;
  starters: string[];
  attach: AiAttach;
};

export const MODES: Record<AiMode, ModeInfo> = {
  assistant: {
    label: "Assistant",
    description: "Ask about the code in this room, or ask it to write or change some.",
    placeholder: "Ask about the code",
    fallbackPrompt: null,
    starters: ["Explain what this file does", "Find bugs in this file", "Suggest a cleaner way to write this"],
    attach: { file: true, selection: true, run: false, paths: false },
  },
  "explain-error": {
    label: "Explain error",
    description: "Reads the last Run output and explains what went wrong and how to fix it.",
    placeholder: "Ask about the error, or press Enter",
    fallbackPrompt: "Explain the error in my last run and how to fix it.",
    starters: ["Why did my last run fail?", "How do I fix this error?"],
    attach: { file: true, selection: false, run: true, paths: false },
  },
  tutor: {
    label: "Tutor",
    description: "Hints and questions that help you solve it yourself. It won't hand over a full solution unless you ask twice.",
    placeholder: "What are you stuck on?",
    fallbackPrompt: null,
    starters: ["Give me a hint for this problem", "Is my approach on the right track?", "What concept should I learn for this?"],
    attach: { file: true, selection: true, run: false, paths: false },
  },
  interviewer: {
    label: "Mock interviewer",
    description: "Asks one coding question, waits for your solution in the open file, then scores it out of 10.",
    placeholder: "Answer, ask a question, or say you're done",
    fallbackPrompt: null,
    starters: ["Start the interview", "I'm done, review my code"],
    attach: { file: true, selection: false, run: false, paths: false },
  },
  complexity: {
    label: "Complexity",
    description: "Time and space Big-O of the open file or your selection, with ways to make it faster.",
    placeholder: "Ask about performance, or press Enter",
    fallbackPrompt: "Analyze the time and space complexity, and suggest how to make it faster.",
    starters: ["Analyze the complexity", "How can I make this faster?"],
    attach: { file: true, selection: true, run: false, paths: false },
  },
  screenshot: {
    label: "Screenshot to code",
    description: "Paste an error screenshot or a UI mockup. It explains the error, or writes HTML, CSS and JavaScript for the design.",
    placeholder: "Paste an image, then say what you want",
    fallbackPrompt: "Turn this into code, or explain it if it's an error.",
    starters: ["Turn this mockup into HTML and CSS", "What does this error mean?"],
    attach: { file: false, selection: false, run: false, paths: false },
  },
  edit: {
    label: "Edit",
    description: "Select code, describe the change, then review a side-by-side diff before anything changes in the file.",
    placeholder: "Describe the change",
    fallbackPrompt: null,
    starters: ["Add type hints", "Add error handling", "Make this faster", "Rename things to be clearer"],
    attach: { file: true, selection: true, run: false, paths: false },
  },
  agent: {
    label: "Agent",
    description: "Plans a task and proposes edits across files. It can ask to run a file or its tests. You approve every step.",
    placeholder: "What should the agent do?",
    fallbackPrompt: null,
    starters: ["Add tests for this file", "Find and fix the bug from my last run", "Split this into smaller functions"],
    attach: { file: true, selection: false, run: true, paths: true },
  },
  summary: {
    label: "Room summary",
    description: "Summarises the room's recent chat and what changed in the files.",
    placeholder: "Ask about the recent activity, or press Enter",
    fallbackPrompt: "Catch me up on what happened in this room.",
    starters: ["Catch me up on what happened", "What did people decide?", "What still needs doing?"],
    attach: { file: false, selection: false, run: false, paths: false },
  },
};
