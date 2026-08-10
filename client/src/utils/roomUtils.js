// ── Bookmarks ──────────────────────────────────────────────────────────────
const BOOKMARKS_KEY = "cc-bookmarks";

export function getBookmarks() {
  try { return JSON.parse(localStorage.getItem(BOOKMARKS_KEY) || "[]"); } catch { return []; }
}

export function isBookmarked(roomId) {
  return getBookmarks().includes(roomId);
}

export function toggleBookmark(roomId) {
  const current = getBookmarks();
  const next = current.includes(roomId)
    ? current.filter(id => id !== roomId)
    : [roomId, ...current];
  localStorage.setItem(BOOKMARKS_KEY, JSON.stringify(next));
  return next.includes(roomId);
}

// ── Recently Visited ───────────────────────────────────────────────────────
const RECENT_KEY = "cc-recent-rooms";
const MAX_RECENT = 5;

export function recordVisit(roomId, roomName) {
  if (!roomId) return;
  try {
    const list = JSON.parse(localStorage.getItem(RECENT_KEY) || "[]");
    const filtered = list.filter(r => r.id !== roomId);
    const updated = [{ id: roomId, name: roomName || roomId, ts: Date.now() }, ...filtered].slice(0, MAX_RECENT);
    localStorage.setItem(RECENT_KEY, JSON.stringify(updated));
  } catch { /* ignore */ }
}

export function getRecentRooms() {
  try { return JSON.parse(localStorage.getItem(RECENT_KEY) || "[]"); } catch { return []; }
}

// ── Room Tags ──────────────────────────────────────────────────────────────
const TAGS_KEY = "cc-room-tags";

export const TAG_COLORS = [
  { id: "violet", label: "Violet", cls: "bg-brand-100 text-brand-700 dark:bg-brand-900/30 dark:text-brand-300", dot: "bg-brand-500" },
  { id: "emerald", label: "Green",  cls: "bg-success-100 text-success-700 dark:bg-success-900/30 dark:text-success-300", dot: "bg-success-500" },
  { id: "sky",    label: "Blue",   cls: "bg-info-100 text-info-700 dark:bg-info-900/30 dark:text-info-300", dot: "bg-info-500" },
  { id: "amber",  label: "Amber",  cls: "bg-warning-100 text-warning-700 dark:bg-warning-900/30 dark:text-warning-300", dot: "bg-warning-500" },
  { id: "rose",   label: "Rose",   cls: "bg-danger-100 text-danger-700 dark:bg-danger-900/30 dark:text-danger-300", dot: "bg-danger-500" },
  { id: "zinc",   label: "None",   cls: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400", dot: "bg-zinc-400" },
];

export function getRoomTags() {
  try { return JSON.parse(localStorage.getItem(TAGS_KEY) || "{}"); } catch { return {}; }
}

export function setRoomTag(roomId, tagId) {
  const all = getRoomTags();
  if (tagId === "zinc" || !tagId) { delete all[roomId]; }
  else { all[roomId] = tagId; }
  localStorage.setItem(TAGS_KEY, JSON.stringify(all));
}

export function getRoomTag(roomId) {
  return getRoomTags()[roomId] || null;
}
