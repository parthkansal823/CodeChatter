import { signServiceToken } from "@codechatter/auth/service-token";
import type { AgentEvent } from "@codechatter/contracts";

import { log } from "./log.js";

/**
 * Room events the runner sees for automations: commits made in the sandbox's git, which the agent reads from its reflog (sandbox/agent/src/git-log.ts), sent
 * to the API (apps/api/src/automations/room-events.controller.ts) to be queued with the rest. Nothing waits for it: a commit isn't held up by automations.
 */
export function sendCommits(settings: { apiUrl: string; secret: string }, roomId: string, event: Extract<AgentEvent, { ev: "git" }>): void {
  const token = signServiceToken(settings.secret, { aud: "api", sub: roomId }, 120);
  void fetch(`${settings.apiUrl}/api/internal/automations/events`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ event: "git.commit", branch: event.branch, commits: event.commits.slice(-20) }),
    signal: AbortSignal.timeout(10_000),
  })
    .then((answer) => {
      if (!answer.ok) log.warn(`room ${roomId}: the API didn't take its commits (${answer.status})`);
    })
    .catch((error: unknown) => log.warn(`room ${roomId}: commits not sent to the API: ${String(error)}`));
}
