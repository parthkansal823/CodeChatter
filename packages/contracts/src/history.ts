import { z } from "zod";

/**
 * Checkpoints: the room's files as they were at a moment, kept so you can look back,
 * compare and restore (the History view). Collab makes them from the live document:
 * automatically every ten minutes while the files change, when someone saves one, and
 * before a restore or an AI edit. A checkpoint holds the files document's Yjs state.
 */
export const CHECKPOINT_KINDS = ["manual", "auto", "pre_restore", "pre_ai", "pre_github", "interview", "import"] as const;
export type CheckpointKind = (typeof CHECKPOINT_KINDS)[number];

/** The kinds a person (their browser) asks collab for; the rest are made by the system. */
export const REQUESTED_CHECKPOINT_KINDS = ["manual", "pre_restore", "pre_ai"] as const;
export type RequestedCheckpointKind = (typeof REQUESTED_CHECKPOINT_KINDS)[number];

export type CheckpointSummary = {
  id: string;
  kind: CheckpointKind;
  label: string | null;
  /** ISO time it was made. */
  at: string;
  /** The files document's update log position it includes. */
  seq: number;
  by: { id: string; name: string } | null;
  /** Its stored size in bytes. */
  size: number;
};

export const CheckpointLabel = z.string().trim().max(100, "Keep the name to 100 characters.");

export const RenameCheckpointInput = z.object({ label: CheckpointLabel.nullable() });
export type RenameCheckpointInput = z.infer<typeof RenameCheckpointInput>;

/**
 * Stateless messages on the files document's connection (Hocuspocus): the browser asks
 * for a checkpoint and collab answers that connection; collab tells everyone in the
 * room when the list changes.
 */
export const CheckpointRequest = z.object({
  type: z.literal("checkpoint"),
  /** The asker's own id for the request, echoed in the answer. */
  request: z.string().min(1).max(64),
  kind: z.enum(REQUESTED_CHECKPOINT_KINDS),
  label: CheckpointLabel.nullable().default(null),
});
export type CheckpointRequest = z.input<typeof CheckpointRequest>;

export type CheckpointReply =
  | { type: "checkpoint"; request: string; ok: true; checkpoint: CheckpointSummary }
  | { type: "checkpoint"; request: string; ok: false; error: string };

export type CheckpointsChanged = { type: "checkpoints-changed" };
