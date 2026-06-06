export function parseRoomInvite(rawValue) {
  const trimmedValue = rawValue.trim();

  if (!trimmedValue) {
    return { roomId: "", inviteToken: null };
  }

  if (/^https?:\/\//i.test(trimmedValue)) {
    try {
      const url = new URL(trimmedValue);
      const segments = url.pathname.split("/").filter(Boolean);
      return {
        roomId: (segments.at(-1) || "").toUpperCase(),
        inviteToken: url.searchParams.get("invite")?.trim() || null,
      };
    } catch {
      return { roomId: trimmedValue.toUpperCase(), inviteToken: null };
    }
  }

  return { roomId: trimmedValue.toUpperCase(), inviteToken: null };
}

export function getInviteTokenFromSearch(search) {
  return new URLSearchParams(search).get("invite")?.trim() || null;
}

export function buildRoomInviteLink({
  origin = window.location.origin,
  roomId,
  inviteToken,
}) {
  const inviteQuery = inviteToken ? `?invite=${encodeURIComponent(inviteToken)}` : "";
  return `${origin}/room/${roomId}${inviteQuery}`;
}
