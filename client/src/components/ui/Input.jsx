import { forwardRef } from "react";

const Input = forwardRef(({ className = "", error, icon: Icon, ...props }, ref) => {
  return (
    <div className="relative">
      {Icon && (
        <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-fg-subtle">
          <Icon size={16} />
        </div>
      )}
      <input
        ref={ref}
        aria-invalid={error ? true : undefined}
        className={`flex h-10 w-full rounded-md border bg-field px-3 py-2 text-sm text-fg transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-fg-subtle focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-50 ${
          Icon ? "pl-10" : ""
        } ${
          error
            ? "border-danger-500 focus-visible:ring-danger-500"
            : "border-edge hover:border-edge-strong focus-visible:border-accent"
        } ${className}`}
        {...props}
      />
      {error && <p className="mt-1.5 text-xs text-danger-500">{error}</p>}
    </div>
  );
});
Input.displayName = "Input";

export { Input };
