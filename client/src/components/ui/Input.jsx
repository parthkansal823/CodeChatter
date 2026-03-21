import { forwardRef } from "react";

const Input = forwardRef(({ className = "", error, icon: Icon, ...props }, ref) => {
  return (
    <div className="relative">
      {Icon && (
        <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-zinc-400">
          <Icon size={16} />
        </div>
      )}
      <input
        ref={ref}
        className={`flex h-10 w-full rounded-lg border bg-white px-3 py-2 text-sm text-zinc-900 transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-zinc-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-100 dark:placeholder:text-zinc-500 ${
          Icon ? "pl-10" : ""
        } ${
          error ? "border-red-500 focus-visible:ring-red-500" : "border-zinc-200 dark:border-zinc-800 focus-visible:border-brand-500 dark:focus-visible:border-brand-500"
        } ${className}`}
        {...props}
      />
      {error && <p className="mt-1.5 text-xs text-red-500">{error}</p>}
    </div>
  );
});
Input.displayName = "Input";

export { Input };
