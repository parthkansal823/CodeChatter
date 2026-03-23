/**
 * UserAvatar — consistent avatar used everywhere in the app.
 *
 * Displays the user's initials on a gradient background.
 * All sizes and variants derive from one place, ensuring
 * the avatar looks identical in the Navbar, Settings,
 * room cards, and anywhere else it appears.
 *
 * Props:
 *   username  — string (used for initials + aria-label)
 *   size      — "xs" | "sm" | "md" | "lg"  (default "sm")
 *   className — extra wrapper classes
 */
export default function UserAvatar({ username = "", size = "sm", className = "" }) {
  const initials = username
    .split(/[\s_-]+/)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .slice(0, 2)
    .join("") || "?";

  const sizeClasses = {
    xs: "h-6 w-6 text-[10px]",
    sm: "h-7 w-7 text-xs",
    md: "h-9 w-9 text-sm",
    lg: "h-14 w-14 text-xl",
  };

  return (
    <span
      aria-label={username || "User"}
      className={`inline-flex shrink-0 select-none items-center justify-center rounded-full bg-gradient-to-br from-violet-500 to-indigo-600 font-semibold text-white shadow-sm shadow-violet-500/20 ${sizeClasses[size] ?? sizeClasses.sm} ${className}`}
    >
      {initials}
    </span>
  );
}
