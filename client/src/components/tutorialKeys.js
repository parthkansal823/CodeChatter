export const HOME_TUTORIAL_KEY = "cc-home-tutorial-v2";
export const ROOM_TUTORIAL_KEY = "cc-room-tutorial-v1";

export function openHomeTutorial() {
  try { localStorage.removeItem(HOME_TUTORIAL_KEY); } catch { /* */ }
  window.dispatchEvent(new CustomEvent("cc-open-tutorial", { detail: "home" }));
}
