/**
 * Card surfaces.
 *
 * Uses the theme-token utilities (bg-panel / border-edge-subtle / text-fg),
 * so these follow the active theme without any `dark:` variants and retune
 * from src/styles/theme.css.
 *
 * Flat by default: an inline card is separated by a 1px border, not by a
 * shadow or a translucent blur. Elevation is reserved for surfaces that
 * genuinely float — see `overlay`.
 */
export function Card({ children, className = "", overlay = false, ...props }) {
  return (
    <div
      className={[
        "rounded-md border border-edge-subtle bg-panel",
        overlay ? "shadow-md" : "",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      {...props}
    >
      {children}
    </div>
  );
}

export function CardHeader({ title, description, icon: Icon, action, className = "" }) {
  return (
    <div className={`flex items-start gap-3 px-4 py-3 ${className}`}>
      {Icon && (
        <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-sm bg-accent-subtle text-accent">
          <Icon size={14} aria-hidden="true" />
        </div>
      )}
      <div className="min-w-0 flex-1">
        {title && <h3 className="truncate text-base font-semibold leading-tight text-fg">{title}</h3>}
        {description && <p className="mt-0.5 text-sm text-fg-muted">{description}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

export function CardContent({ children, className = "" }) {
  return <div className={`px-4 pb-4 ${className}`}>{children}</div>;
}

export function CardFooter({ children, className = "" }) {
  return (
    <div
      className={`flex items-center justify-end gap-2 border-t border-edge-subtle px-4 py-3 ${className}`}
    >
      {children}
    </div>
  );
}
