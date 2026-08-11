import { forwardRef } from "react";

/**
 * The single button primitive for the app.
 *
 * Variants map onto the semantic palette: `primary` and `subtle` are the only
 * ones that use the brand accent, `danger` is reserved for destructive actions,
 * and the rest are neutral. Sizes share a fixed height scale so buttons line up
 * with inputs and with each other in a toolbar row.
 *
 * Neutral variants are built from the theme tokens in styles/theme.css rather
 * than a zinc scale plus `dark:` pairs — the tokens already carry both themes,
 * so one class list stays correct when the theme flips at runtime.
 */
const VARIANTS = {
  primary: "bg-accent text-fg-accent hover:bg-accent-hover active:bg-accent-active",
  secondary: "bg-chrome text-fg hover:bg-hovered active:bg-selected",
  outline: "border border-edge bg-canvas text-fg hover:border-edge-strong hover:bg-hovered",
  ghost: "bg-transparent text-fg-muted hover:bg-hovered hover:text-fg",
  danger: "bg-danger-600 text-white hover:bg-danger-700 active:bg-danger-800",
  subtle: "bg-accent-subtle text-accent hover:bg-selected",
};

const SIZES = {
  xs: "h-7 gap-1.5 rounded-md px-2.5 text-xs",
  sm: "h-8 gap-1.5 rounded-md px-3 text-xs",
  md: "h-9 gap-2 rounded-md px-3.5 text-sm",
  lg: "h-11 gap-2 rounded-md px-5 text-base",
  icon: "h-9 w-9 rounded-md",
  "icon-sm": "h-8 w-8 rounded-md",
};

const Button = forwardRef(function Button(
  {
    className = "",
    variant = "primary",
    size = "md",
    isLoading = false,
    fullWidth = false,
    leadingIcon: LeadingIcon = null,
    trailingIcon: TrailingIcon = null,
    children,
    ...props
  },
  ref,
) {
  const base =
    "relative inline-flex select-none items-center justify-center whitespace-nowrap font-medium " +
    "transition-[background-color,border-color,color,transform] duration-150 " +
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1 " +
    "focus-visible:ring-offset-canvas " +
    "active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50";

  const iconSize = size === "lg" ? 18 : 15;

  return (
    <button
      ref={ref}
      className={[
        base,
        VARIANTS[variant] ?? VARIANTS.primary,
        SIZES[size] ?? SIZES.md,
        fullWidth ? "w-full" : "",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      disabled={isLoading || props.disabled}
      aria-busy={isLoading || undefined}
      {...props}
    >
      {isLoading ? (
        <span
          aria-hidden="true"
          className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent"
        />
      ) : (
        LeadingIcon && <LeadingIcon size={iconSize} aria-hidden="true" />
      )}
      {children}
      {TrailingIcon && !isLoading ? <TrailingIcon size={iconSize} aria-hidden="true" /> : null}
    </button>
  );
});

export { Button };
