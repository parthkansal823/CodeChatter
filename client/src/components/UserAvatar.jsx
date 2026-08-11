import { avatarBackground, hueForName } from "../utils/avatar";

/**
 * UserAvatar — consistent avatar used everywhere in the app.
 *
 * Renders the first letter of the username on a colour derived from the name,
 * the way Drive, GitHub and Slack do. It used to fetch a DiceBear SVG per user,
 * which meant every avatar was a blocking request to a third-party host — slow
 * on a collaborator list, and blank whenever that host was unreachable.
 *
 * The colour defaults to a hash of the username, so a person keeps the same one
 * across sessions and devices with nothing stored. Picking a colour in Settings
 * saves a hue on the account, which then overrides the hash everywhere.
 *
 * Props:
 *   username  — string (used for the initial + aria-label)
 *   hue       — 0-359 from the account, or null/undefined to derive from the name
 *   size      — "xs" | "sm" | "base" | "md" | "lg"  (default "sm")
 *   className — extra wrapper classes
 */
const SIZE_CLASSES = {
  xs: "h-6 w-6 text-[10px]",
  sm: "h-7 w-7 text-[11px]",
  base: "h-8 w-8 text-xs",
  md: "h-9 w-9 text-sm",
  lg: "h-14 w-14 text-xl",
};

export default function UserAvatar({ username = "", hue = null, size = "sm", className = "" }) {
  const label = username || "User";
  const initial = label.trim().charAt(0).toUpperCase() || "?";
  const background = avatarBackground(Number.isInteger(hue) ? hue : hueForName(label));

  return (
    <div
      aria-label={label}
      title={label}
      style={{ backgroundColor: background }}
      className={`inline-flex shrink-0 select-none items-center justify-center rounded-full font-semibold uppercase leading-none text-white ${
        SIZE_CLASSES[size] ?? SIZE_CLASSES.sm
      } ${className}`}
    >
      {initial}
    </div>
  );
}
