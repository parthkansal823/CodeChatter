import { z } from "zod";

/** GitHub's rules: owners are letters, digits and single hyphens (39 at most); names add dots and underscores. */
const OWNER = /^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$/;
const NAME = /^(?!\.\.?$)[A-Za-z0-9._-]{1,100}$/;
/** A branch, tag or commit: git's ref rules, short of the rarest ones. */
// eslint-disable-next-line no-control-regex
const REF = /^(?!\/)(?!.*\/\/)(?!.*\/$)(?!.*\.\.)(?!.*@\{)[^\s~^:?*[\\\u0000-\u001f\u007f]{1,200}$/;

export const RepoImport = z.object({
  owner: z.string().regex(OWNER, "That isn't a GitHub user or organisation name."),
  name: z.string().regex(NAME, "That isn't a GitHub repository name."),
  ref: z.string().regex(REF, "That isn't a branch, tag or commit.").optional(),
});
export type RepoImport = z.infer<typeof RepoImport>;

/**
 * A repository as people write it: `owner/name`, `owner/name@branch`, or a link
 * (`https://github.com/owner/name`, `…/name.git`, `…/tree/branch`). Null when it isn't one.
 */
export function parseRepo(text: string): RepoImport | null {
  let rest = text.trim().replace(/^(?:https?:\/\/)?(?:www\.)?github\.com\//i, "").replace(/[?#].*$/, "");
  let ref: string | undefined;
  const tree = /^([^/]+\/[^/]+)\/(?:tree|commit)\/(.+?)\/?$/.exec(rest);
  if (tree) [, rest, ref] = tree as unknown as [string, string, string];
  else {
    const at = /^([^/@]+\/[^/@]+)@(.+)$/.exec(rest);
    if (at) [, rest, ref] = at as unknown as [string, string, string];
  }
  const [owner = "", rawName = "", ...extra] = rest.replace(/\/$/, "").split("/");
  if (extra.length) return null;
  const parsed = RepoImport.safeParse({ owner, name: rawName.replace(/\.git$/i, ""), ...(ref && { ref }) });
  return parsed.success ? parsed.data : null;
}

/** What an import brought in, shown once the room is made. */
export type RepoImportSummary = {
  repo: string;
  branch: string;
  commit: string;
  /** Text files brought in. */
  files: number;
  /** Binary, too large or unnamable files left out. */
  skipped: number;
  /** True when the room's limits stopped the import before the end of the repository. */
  truncated: boolean;
};

/** A GitHub token for private repositories; GitHub's tokens are letters, digits and underscores. */
export const GithubTokenInput = z.object({
  token: z
    .string()
    .trim()
    .min(20, "That's too short for a GitHub token.")
    .max(255)
    .regex(/^[A-Za-z0-9_]+$/, "That isn't a GitHub token. Copy it again from GitHub."),
});
export type GithubTokenInput = z.infer<typeof GithubTokenInput>;

/** Whether you've given CodeChatter a GitHub token, and whose it is. */
export type GithubConnection = { login: string | null };

/** A full commit id. */
export const CommitSha = z.string().regex(/^[0-9a-f]{40}$/, "That isn't a commit id.");

/** A path in the room, as GitHub stores it: no leading slash, no `.` or `..` parts. */
// eslint-disable-next-line no-control-regex
const RepoPath = z.string().regex(/^(?!\/)(?!.*\/$)(?!(?:.*\/)?\.\.?(?:\/|$))[^\\\u0000-\u001f]{1,1024}$/, "That isn't a file path.");

/** The GitHub repository a room was made from, and where the room is on it. */
export type RoomRepo = {
  owner: string;
  name: string;
  branch: string;
  /** Where pull requests from the room's branch go. */
  defaultBranch: string;
  /** The commit the room's files were last synced with (imported, pulled or committed). */
  commit: string;
  syncedAt: string;
  /** Whose token commits from you would use; null when you haven't added one. */
  login: string | null;
  /** Whether the repository's pushes, pull requests and Actions results are posted to the room's chat. */
  webhook: boolean;
};

/**
 * Turning on GitHub activity in chat: "github" when the webhook was made on GitHub with
 * your token; "manual" when it has to be added by hand there, with this address and secret
 * (shown once).
 */
export type WebhookSetup = { made: "github" } | { made: "manual"; url: string; secret: string };

/** Commit the room's changes and push them: to the room's branch, or a new one. */
export const CommitInput = z.object({
  /** The commit the changes were made against: a commit from another stale view is refused. */
  since: CommitSha,
  message: z.string().trim().min(1, "Write a commit message.").max(5000),
  /** A new branch to push to instead of the room's branch; the room then follows it. */
  newBranch: z.string().regex(REF, "That isn't a branch name.").optional(),
  /** Each changed file's new text, or null when it was deleted. */
  changes: z.array(z.object({ path: RepoPath, content: z.string().max(1_000_000).nullable() })).min(1, "There's nothing to commit.").max(3000),
});
export type CommitInput = z.infer<typeof CommitInput>;

/** Bring in GitHub's newer commits on the room's branch, or switch to another branch. */
export const PullInput = z.object({
  since: CommitSha,
  branch: z.string().regex(REF, "That isn't a branch name.").optional(),
});
export type PullInput = z.infer<typeof PullInput>;

export type CommitResult = { branch: string; commit: string };
export type PullResult =
  | { upToDate: true; branch: string; commit: string }
  | { upToDate: false; branch: string; commit: string; files: Array<{ path: string; content: string }>; skipped: number; truncated: boolean };

/** An open pull request, as listed. */
export type PullSummary = {
  number: number;
  title: string;
  author: string;
  head: string;
  base: string;
  draft: boolean;
  url: string;
  updatedAt: string;
};

/** A file a pull request changes; `patch` is GitHub's unified diff, null for binary or very large files. */
export type PullFile = {
  path: string;
  previousPath: string | null;
  status: string;
  additions: number;
  deletions: number;
  patch: string | null;
};

/** A review comment on a line: RIGHT is the new file's line, LEFT the old one's; `line` is null once the line has changed (outdated). */
export type PullComment = {
  id: number;
  path: string;
  line: number | null;
  side: "LEFT" | "RIGHT";
  body: string;
  author: string;
  createdAt: string;
  inReplyTo: number | null;
  url: string;
};

export type PullDetail = PullSummary & {
  body: string;
  state: "open" | "closed";
  merged: boolean;
  headSha: string;
  files: PullFile[];
  comments: PullComment[];
};

/** Open a pull request from the room's branch into the repository's default branch. */
export const OpenPullInput = z.object({
  title: z.string().trim().min(1, "Give the pull request a title.").max(256),
  body: z.string().max(65_000).default(""),
});
export type OpenPullInput = z.infer<typeof OpenPullInput>;

/** A comment on a line of a pull request's diff, or a reply to one. */
export const PullCommentInput = z
  .object({
    body: z.string().trim().min(1, "Write a comment.").max(65_000),
    inReplyTo: z.number().int().positive().optional(),
    path: RepoPath.optional(),
    line: z.number().int().positive().optional(),
    side: z.enum(["LEFT", "RIGHT"]).optional(),
    commitId: CommitSha.optional(),
  })
  .refine((c) => c.inReplyTo !== undefined || (c.path && c.line && c.side && c.commitId), "A comment needs a line, or a comment to reply to.");
export type PullCommentInput = z.infer<typeof PullCommentInput>;

/** Publish the room as a new repository of yours; the room is then linked to it. */
export const PublishInput = z.object({
  name: z.string().regex(NAME, "Use letters, numbers, dots, dashes and underscores (100 at most)."),
  private: z.boolean().default(true),
  description: z.string().trim().max(350).default(""),
  files: z.array(z.object({ path: RepoPath, content: z.string().max(1_000_000) })).min(1, "The room has no files to publish.").max(3000),
});
export type PublishInput = z.infer<typeof PublishInput>;
export type PublishResult = { repo: string; url: string; branch: string; commit: string };

/** One file as a GitHub gist: secret (only people with the link) unless made public. */
export const GistInput = z.object({
  name: z.string().trim().min(1).max(255),
  content: z.string().min(1, "The file is empty.").max(1_000_000),
  description: z.string().trim().max(1000).default(""),
  public: z.boolean().default(false),
});
export type GistInput = z.infer<typeof GistInput>;
