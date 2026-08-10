import { forwardRef } from "react";

/**
 * The single button primitive for the app.
 *
 * Variants map onto the semantic palette: `primary` and `subtle` are the only
 * ones that use the brand accent, `danger` is reserved for destructive actions,
 * and the rest are neutral. Sizes share a fixed height scale so buttons line up
 * with inputs and with each other in a toolbar row.
 */
const VARIANTS = {
  primary:
    "bg-brand-600 text-white shadow-sm hover:bg-brand-700 active:bg-brand-800 " +
    "dark:bg-brand-500 dark:hover:bg-brand-400 dark:active:bg-brand-600",
  secondary:
    "bg-zinc-100 text-zinc-900 hover:bg-zinc-200 active:bg-zinc-300 " +
    "dark:bg-zinc-800 dark:text-zinc-100 dark:hover:bg-zinc-700 dark:active:bg-zinc-600",
  outline:
    "border border-zinc-200 bg-white text-zinc-700 hover:border-zinc-300 hover:bg-zinc-50 " +
    "dark:border-zinc-800 dark:bg-transparent dark:text-zinc-300 dark:hover:border-zinc-700 dark:hover:bg-zinc-800/60",
  ghost:
    "bg-transparent text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 " +
    "dark:text-zinc-400 dark:hover:bg-zinc-800/60 dark:hover:text-zinc-100",
  danger:
    "bg-danger-600 text-white shadow-sm hover:bg-danger-700 active:bg-danger-800 " +
    "dark:bg-danger-600 dark:hover:bg-danger-500",
  subtle:
    "bg-brand-50 text-brand-700 hover:bg-brand-100 " +
    "dark:bg-brand-500/10 dark:text-brand-300 dark:hover:bg-brand-500/20",
};

const SIZES = {
  xs: "h-7 gap-1.5 rounded-md px-2.5 text-xs",
  sm: "h-8 gap-1.5 rounded-lg px-3 text-xs",
  md: "h-9 gap-2 rounded-lg px-3.5 text-sm",
  lg: "h-11 gap-2 rounded-xl px-5 text-base",
  icon: "h-9 w-9 rounded-lg",
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
