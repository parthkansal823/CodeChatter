import { z } from "zod";

/**
 * Git in the room's sandbox (the Source Control view's "Git in the sandbox"): a real
 * repository at the room's top folder (/workspace), kept in the sandbox (`.git` never
 * syncs into the room). The panel asks for these operations only; nothing else reaches
 * git. Paths are the room's, relative to its top folder.
 */

/** A room path for git: relative, no `..`, no control characters. */
export const GitPath = z
  .string()
  .min(1)
  .max(1000)
  // eslint-disable-next-line no-control-regex
  .refine((path) => !path.startsWith("/") && !/[\u0000-\u001f]/.test(path) && path.split("/").every((part) => part !== "" && part !== "." && part !== ".."), {
    message: "That isn't a path in the room.",
  });

/** A branch name git accepts (a stricter subset of `git check-ref-format --branch`). */
export const GitBranchName = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .regex(/^(?!-)(?!.*\.\.)(?!.*\/\/)(?!.*@\{)[A-Za-z0-9._/-]+(?<![./])(?<!\.lock)$/, "Use letters, digits, '-', '_', '.' and '/' for a branch name.");

const Paths = z.array(GitPath).min(1).max(500);
/** The caller's Yjs state vector, so git sees every edit they had made (as Run does). */
const StateVector = z.string().max(20_000).optional();

export const GitRequest = z.discriminatedUnion("op", [
  z.object({ op: z.literal("status"), stateVector: StateVector }),
  z.object({ op: z.literal("init"), branch: GitBranchName.default("main") }),
  z.object({ op: z.literal("stage"), paths: Paths, stateVector: StateVector }),
  z.object({ op: z.literal("unstage"), paths: Paths }),
  /** Back to the last commit: changed files as they were, new ones removed. */
  z.object({ op: z.literal("discard"), paths: Paths }),
  /** Commit what's staged; with `all`, every change first (`git add -A`). */
  z.object({ op: z.literal("commit"), message: z.string().trim().min(1, "Write a commit message.").max(5000), all: z.boolean().default(false), stateVector: StateVector }),
  /** A file as it is in the last commit or in the staging area, for the diff view. */
  z.object({ op: z.literal("show"), path: GitPath, at: z.enum(["head", "index"]).default("head") }),
  z.object({ op: z.literal("log"), limit: z.number().int().min(1).max(200).default(30) }),
  z.object({ op: z.literal("branches") }),
  /** Switch to a branch, or make it from here (`create`). */
  z.object({ op: z.literal("checkout"), branch: GitBranchName, create: z.boolean().default(false) }),
]);
export type GitRequest = z.infer<typeof GitRequest>;
/** What the browser sends (defaults not filled in yet). */
export type GitRequestInput = z.input<typeof GitRequest>;
export type GitOp = GitRequest["op"];

/** Who a commit is by: added by the API from the signed-in person, never sent by the browser. */
export const GitAuthor = z.object({ name: z.string().min(1).max(200), email: z.string().min(3).max(320) });
export type GitAuthor = z.infer<typeof GitAuthor>;

/** What the runner takes: the panel's request, and the author for a commit. */
export const GitRunnerRequest = z.object({ request: GitRequest, author: GitAuthor.optional() });
export type GitRunnerRequest = z.infer<typeof GitRunnerRequest>;

/** One letter per side, as `git status` shows it: M modified, A added, D deleted, R renamed, C copied, T type changed, ? untracked. */
export type GitMark = "M" | "A" | "D" | "R" | "C" | "T" | "?";

export type GitChange = {
  path: string;
  /** Where a renamed or copied file came from. */
  from: string | null;
  /** In the staging area (what a commit takes), or null. */
  staged: GitMark | null;
  /** In the files, not staged yet, or null. */
  unstaged: GitMark | null;
  /** Both sides changed it in a merge that stopped. */
  conflict: boolean;
};

export type GitStatus =
  | { repo: false }
  | {
      repo: true;
      /** The branch, or null when HEAD is detached. */
      branch: string | null;
      /** The last commit's short id, or null before the first commit. */
      head: string | null;
      changes: GitChange[];
      /** Changes left out of `changes` (past the limit). */
      more: number;
    };

export type GitCommit = { id: string; short: string; author: string; email: string; at: string; subject: string };
export type GitBranch = { name: string; short: string; current: boolean };

export type GitResponse =
  | { op: "status"; status: GitStatus }
  | { op: "log"; commits: GitCommit[] }
  | { op: "branches"; branches: GitBranch[]; current: string | null }
  | { op: "show"; path: string; text: string | null; binary: boolean }
  | { op: "commit"; status: GitStatus; commit: string }
  | { op: "init" | "stage" | "unstage" | "discard" | "checkout"; status: GitStatus };
