/**
 * Avatar colour maths, shared by the avatar itself and by the colour picker in
 * Settings. It lives outside the component file so that file keeps exporting
 * only a component, which is what React Fast Refresh needs to patch it.
 */

/** Stable hue for a name, so a person keeps one colour with nothing stored. */
export function hueForName(name) {
  let hash = 0;

  for (let i = 0; i < name.length; i += 1) {
    hash = (hash * 31 + name.charCodeAt(i)) % 360;
  }

  return hash;
}

/**
 * Fixed saturation and lightness keep white text readable on every hue, and
 * keep the set looking like one family rather than a bag of random colours.
 */
export function avatarBackground(hue) {
  return `hsl(${hue}, 52%, 42%)`;
}
