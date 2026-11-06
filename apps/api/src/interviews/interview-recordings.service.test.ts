import { describe, expect, it, vi } from "vitest";

import { InterviewRecordingsService, looksLikeVideo } from "./interview-recordings.service.js";

const webm = Uint8Array.from([0x1a, 0x45, 0xdf, 0xa3, 1, 2, 3]);
const mp4 = Uint8Array.from([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 1, 2]);

describe("looksLikeVideo", () => {
  it("knows a webm and an mp4 by their first bytes", () => {
    expect(looksLikeVideo("video/webm", webm)).toBe(true);
    expect(looksLikeVideo("video/mp4", mp4)).toBe(true);
  });

  it("isn't fooled by what a file claims to be", () => {
    expect(looksLikeVideo("video/webm", Buffer.from("<script>alert(1)</script>"))).toBe(false);
    expect(looksLikeVideo("video/mp4", webm)).toBe(false);
    expect(looksLikeVideo("video/webm", new Uint8Array())).toBe(false);
    expect(looksLikeVideo("text/html", webm)).toBe(false);
  });
});

describe("cleanup", () => {
  /** A service over a table of clips, as a stand-in database that answers the two queries cleanup makes. */
  function setup(clips: Array<{ id: string; key: string }>, { failing = new Set<string>(), hasStore = true } = {}) {
    const table = [...clips];
    const deletedFromStore: string[] = [];
    const store = {
      delete: vi.fn(async (key: string) => {
        if (failing.has(key)) throw new Error("the store is away");
        deletedFromStore.push(key);
      }),
    };
    const lastBefore: Date[] = [];
    const db = {
      select: () => ({
        from: () => ({
          where: (condition: { queryChunks?: unknown[] }) => ({
            limit: async (limit: number) => {
              lastBefore.push(new Date());
              void condition;
              return table.slice(0, limit);
            },
          }),
        }),
      }),
      delete: () => ({
        where: async () => {
          // Only what the store let go of is deleted: see removeClips.
          for (const key of deletedFromStore) {
            const at = table.findIndex((clip) => clip.key === key);
            if (at !== -1) table.splice(at, 1);
          }
        },
      }),
    };
    const service = new InterviewRecordingsService({ db } as never, { INTERVIEW_RECORDING_RETENTION_DAYS: 30 } as never, (hasStore ? store : null) as never, {} as never);
    return { service, table, store, deletedFromStore };
  }
  const clips = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `c${i}`, key: `k${i}` }));

  it("deletes what's past its time, bytes and row", async () => {
    const { service, table, deletedFromStore } = setup(clips(3));
    expect(await service.cleanup()).toBe(3);
    expect(deletedFromStore).toEqual(["k0", "k1", "k2"]);
    expect(table).toEqual([]);
  });

  it("works through more than one batch", async () => {
    const { service, table } = setup(clips(1200));
    expect(await service.cleanup()).toBe(1200);
    expect(table).toEqual([]);
  });

  it("keeps the row of a clip the store wouldn't delete, to try again", async () => {
    const { service, table } = setup(clips(2), { failing: new Set(["k1"]) });
    expect(await service.cleanup()).toBe(1);
    expect(table).toEqual([{ id: "c1", key: "k1" }]);
  });

  it("stops rather than spin when nothing can be deleted", async () => {
    const { service, store } = setup(clips(500), { failing: new Set(clips(500).map((clip) => clip.key)) });
    expect(await service.cleanup()).toBe(0);
    expect(store.delete).toHaveBeenCalledTimes(500);
  });

  it("does nothing with no store", async () => {
    const { service, table } = setup(clips(2), { hasStore: false });
    expect(await service.cleanup()).toBe(0);
    expect(table).toHaveLength(2);
  });
});
