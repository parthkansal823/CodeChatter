const PRESENCE_COLORS = [
  "#2563eb",
  "#dc2626",
  "#059669",
  "#7c3aed",
  "#ea580c",
  "#0891b2",
  "#db2777",
  "#4f46e5",
];

export function generateRequestId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }

  return `req-${Math.random().toString(36).slice(2, 12)}`;
}

export function getPresenceColor(seed = "") {
  let hash = 0;

  for (let index = 0; index < seed.length; index += 1) {
    hash = (hash * 31 + seed.charCodeAt(index)) >>> 0;
  }

  return PRESENCE_COLORS[hash % PRESENCE_COLORS.length];
}

export function dedupePresenceByUser(sessions = [], currentUserId = null) {
  const sessionsByUser = new Map();

  sessions.forEach((session) => {
    if (!session?.userId) {
      return;
    }

    const existing = sessionsByUser.get(session.userId);
    const sessionTimestamp = session?.cursor?.updatedAt || "";
    const existingTimestamp = existing?.cursor?.updatedAt || "";

    if (!existing || sessionTimestamp > existingTimestamp) {
      sessionsByUser.set(session.userId, session);
    }
  });

  return Array.from(sessionsByUser.values()).sort((left, right) => {
    if (left.userId === currentUserId) {
      return -1;
    }

    if (right.userId === currentUserId) {
      return 1;
    }

    return left.username.localeCompare(right.username, undefined, {
      sensitivity: "base",
    });
  });
}
