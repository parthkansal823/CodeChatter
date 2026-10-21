import { randomBytes } from "node:crypto";
import { gunzipSync, gzipSync } from "node:zlib";

import type {
  CommitInput,
  CommitResult,
  OpenPullInput,
  PublishInput,
  PublishResult,
  PullCommentInput,
  PullInput,
  PullResult,
  RoomRepo,
  WebhookSetup,
} from "@codechatter/contracts";
import { schema, type DbHandle } from "@codechatter/db";
import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { and, eq } from "drizzle-orm";

import type { Env } from "../config/env.js";
import { DB, ENV } from "../infra/tokens.js";
import { GithubService } from "./github.service.js";
import { openToken, sealToken } from "./token-box.js";
import type { ImportedFile } from "./import-files.js";

const stale = () => new ConflictException("Someone in the room synced with GitHub a moment ago. Look over the changes again, then retry.");

/**
 * Source Control for a room made from a GitHub repository. The room's base (room_repos:
 * the files at the commit it last synced with) is what the browser compares the live files
 * with. A commit pushes changed files on top of the base and makes them the new base; a
 * pull (or a branch switch) stores the branch's files as the base and hands them to the
 * browser, which merges them into the live files for everyone. Every sync names the base it
 * was made against, so one from a stale view is refused, and a room syncs one at a time.
 */
@Injectable()
export class SourceControlService {
  private readonly syncing = new Set<string>();

  constructor(
    @Inject(DB) private readonly handle: DbHandle,
    @Inject(ENV) private readonly env: Env,
    private readonly github: GithubService,
  ) {}

  private async row(roomId: string) {
    const [row] = await this.handle.db.select().from(schema.roomRepos).where(eq(schema.roomRepos.roomId, roomId));
    if (!row) throw new NotFoundException("This room isn't linked to a GitHub repository.");
    return row;
  }

  async info(roomId: string, userId: string): Promise<RoomRepo> {
    const row = await this.row(roomId);
    const { login } = await this.github.connection(userId);
    return {
      owner: row.owner,
      name: row.name,
      branch: row.branch,
      defaultBranch: await this.defaultBranchOf(row, userId),
      commit: row.commitSha,
      syncedAt: row.importedAt.toISOString(),
      login,
      webhook: row.webhookSecret !== null,
    };
  }

  /** Kept from the import; asked of GitHub (once) for rooms imported before it was kept. */
  private async defaultBranchOf(row: { roomId: string; owner: string; name: string; defaultBranch: string | null }, userId: string): Promise<string> {
    if (row.defaultBranch) return row.defaultBranch;
    const branch = await this.github.defaultBranch(userId, row.owner, row.name);
    await this.handle.db.update(schema.roomRepos).set({ defaultBranch: branch }).where(eq(schema.roomRepos.roomId, row.roomId));
    return branch;
  }

  async pullRequests(roomId: string, userId: string) {
    const row = await this.row(roomId);
    return this.github.pulls(userId, row.owner, row.name);
  }

  async pullRequest(roomId: string, userId: string, number: number) {
    const row = await this.row(roomId);
    return this.github.pull(userId, row.owner, row.name, number);
  }

  /** A pull request from the room's branch into the default one. */
  async openPull(roomId: string, userId: string, input: OpenPullInput) {
    const row = await this.row(roomId);
    const base = await this.defaultBranchOf(row, userId);
    if (row.branch === base) {
      throw new BadRequestException(`The room is on ${base}, the default branch. Commit to a new branch first: a pull request asks to merge one branch into another.`);
    }
    return this.github.openPull(userId, row, { title: input.title, body: input.body, head: row.branch, base });
  }

  /**
   * Post the repository's activity to the room's chat: a new secret, then the webhook made
   * on GitHub with your token, or handed back to be added by hand. Turning it on again
   * replaces the secret, so an old webhook stops being answered.
   */
  async connectWebhook(roomId: string, userId: string): Promise<WebhookSetup> {
    const row = await this.row(roomId);
    if (row.webhookId) await this.github.deleteHook(userId, row, row.webhookId);
    const secret = randomBytes(24).toString("base64url");
    const url = `${this.env.APP_URL}/api/github/webhooks/${roomId}`;
    const id = await this.github.createHook(userId, row, { url, secret });
    await this.handle.db
      .update(schema.roomRepos)
      .set({ webhookSecret: sealToken(this.env.BETTER_AUTH_SECRET, secret), webhookId: id })
      .where(eq(schema.roomRepos.roomId, roomId));
    return id ? { made: "github" } : { made: "manual", url, secret };
  }

  async disconnectWebhook(roomId: string, userId: string): Promise<void> {
    const row = await this.row(roomId);
    if (row.webhookId) await this.github.deleteHook(userId, row, row.webhookId);
    await this.handle.db.update(schema.roomRepos).set({ webhookSecret: null, webhookId: null }).where(eq(schema.roomRepos.roomId, roomId));
  }

  /** The secret a delivery to this room must be signed with, and the repository it must be about. */
  async webhookTarget(roomId: string): Promise<{ secret: string; repo: string } | null> {
    const [row] = await this.handle.db
      .select({ sealed: schema.roomRepos.webhookSecret, owner: schema.roomRepos.owner, name: schema.roomRepos.name })
      .from(schema.roomRepos)
      .where(eq(schema.roomRepos.roomId, roomId));
    const secret = row?.sealed ? openToken(this.env.BETTER_AUTH_SECRET, row.sealed) : null;
    return row && secret ? { secret, repo: `${row.owner}/${row.name}` } : null;
  }

  /** Publish a room that isn't on GitHub yet as a new repository, and link the room to it. */
  async publish(roomId: string, userId: string, input: PublishInput): Promise<PublishResult> {
    return this.exclusive(roomId, async () => {
      const [linked] = await this.handle.db.select({ owner: schema.roomRepos.owner, name: schema.roomRepos.name }).from(schema.roomRepos).where(eq(schema.roomRepos.roomId, roomId));
      if (linked) throw new ConflictException(`This room is already linked to ${linked.owner}/${linked.name}. Commit and push from Source control instead.`);
      const made = await this.github.publish(userId, input);
      await this.handle.db.insert(schema.roomRepos).values({
        roomId,
        owner: made.owner,
        name: made.name,
        branch: made.branch,
        defaultBranch: made.branch,
        commitSha: made.commit,
        files: gzipSync(JSON.stringify(input.files)),
        importedBy: userId,
      });
      return { repo: `${made.owner}/${made.name}`, url: made.url, branch: made.branch, commit: made.commit };
    });
  }

  async commentOnPull(roomId: string, userId: string, number: number, input: PullCommentInput) {
    const row = await this.row(roomId);
    return this.github.commentOnPull(userId, row, number, input);
  }

  /** The base's files as stored: gzipped JSON, sent as it is. */
  async files(roomId: string): Promise<{ commit: string; gzipped: Uint8Array }> {
    const row = await this.row(roomId);
    return { commit: row.commitSha, gzipped: row.files };
  }

  async branches(roomId: string, userId: string): Promise<string[]> {
    const row = await this.row(roomId);
    return this.github.branches(userId, row.owner, row.name);
  }

  async commit(roomId: string, userId: string, input: CommitInput): Promise<CommitResult> {
    return this.exclusive(roomId, async () => {
      const row = await this.row(roomId);
      if (row.commitSha !== input.since) throw stale();
      const branch = input.newBranch ?? row.branch;
      const commit = await this.github.pushCommit(userId, row, {
        parent: row.commitSha,
        branch,
        newBranch: Boolean(input.newBranch),
        message: input.message,
        changes: input.changes,
      });
      const files = new Map(readFiles(row.files).map((file) => [file.path, file.content]));
      for (const change of input.changes) {
        if (change.content === null) files.delete(change.path);
        else files.set(change.path, change.content);
      }
      await this.save(roomId, input.since, branch, commit, [...files].map(([path, content]) => ({ path, content })));
      return { branch, commit };
    });
  }

  async pull(roomId: string, userId: string, input: PullInput): Promise<PullResult> {
    return this.exclusive(roomId, async () => {
      const row = await this.row(roomId);
      if (row.commitSha !== input.since) throw stale();
      const branch = input.branch ?? row.branch;
      const head = await this.github.head(userId, row.owner, row.name, branch);
      if (head === row.commitSha && branch === row.branch) return { upToDate: true, branch, commit: head };
      const repo = await this.github.download(userId, { owner: row.owner, name: row.name, ref: branch });
      await this.save(roomId, input.since, branch, repo.commitSha, repo.files);
      return { upToDate: false, branch, commit: repo.commitSha, files: repo.files, skipped: repo.skipped, truncated: repo.truncated };
    });
  }

  /** The new base, only over the one it was made against. */
  private async save(roomId: string, since: string, branch: string, commitSha: string, files: ImportedFile[]): Promise<void> {
    const saved = await this.handle.db
      .update(schema.roomRepos)
      .set({ branch, commitSha, files: gzipSync(JSON.stringify(files)), importedAt: new Date() })
      .where(and(eq(schema.roomRepos.roomId, roomId), eq(schema.roomRepos.commitSha, since)))
      .returning({ roomId: schema.roomRepos.roomId });
    if (!saved.length) throw stale();
  }

  private async exclusive<T>(roomId: string, work: () => Promise<T>): Promise<T> {
    if (this.syncing.has(roomId)) throw new ConflictException("This room is already syncing with GitHub. Wait for it to finish.");
    this.syncing.add(roomId);
    try {
      return await work();
    } finally {
      this.syncing.delete(roomId);
    }
  }
}

const readFiles = (gzipped: Uint8Array): ImportedFile[] => JSON.parse(gunzipSync(gzipped).toString("utf8")) as ImportedFile[];
