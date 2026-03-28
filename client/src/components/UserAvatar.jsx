/**
 * UserAvatar — consistent avatar used everywhere in the app.
 *
 * Displays a DiceBear "thumbs" avatar based on the username.
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
  const avatarUrl = `https://api.dicebear.com/9.x/thumbs/svg?seed=${encodeURIComponent(username || "default")}`;

  const sizeClasses = {
    xs: "h-6 w-6",
    sm: "h-7 w-7",
    base: "h-8 w-8",
    md: "h-9 w-9",
    lg: "h-14 w-14",
  };

  return (
    <div
      aria-label={username || "User"}
      className={`inline-flex shrink-0 select-none overflow-hidden items-center justify-center rounded-full bg-slate-800/50 ring-1 ring-white/10 shadow-sm ${sizeClasses[size] ?? sizeClasses.sm} ${className}`}
    >
      <img
        src={avatarUrl}
        alt={username || "User Avatar"}
        className="h-full w-full object-cover"
      />
    </div>
  );
}
