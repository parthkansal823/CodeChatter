export function Card({ children, className = "" }) {
  return (
    <div className={`rounded-xl border border-zinc-200 bg-white/70 backdrop-blur-md shadow-sm dark:border-zinc-800/80 dark:bg-zinc-900/50 ${className}`}>
      {children}
    </div>
  );
}

export function CardHeader({ title, description, icon: Icon, action, className = "" }) {
  return (
    <div className={`flex flex-col space-y-1.5 p-6 ${className}`}>
      <div className="flex items-center gap-3">
        {Icon && (
          <div className="rounded-lg bg-brand-100 p-2 text-brand-700 dark:bg-brand-900/30 dark:text-brand-300">
            <Icon size={20} />
          </div>
        )}
        <div className="flex-1">
          {title && <h3 className="font-semibold leading-none tracking-tight text-zinc-900 dark:text-zinc-100">{title}</h3>}
          {description && <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">{description}</p>}
        </div>
        {action && <div>{action}</div>}
      </div>
    </div>
  );
}

export function CardContent({ children, className = "" }) {
  return <div className={`p-6 pt-0 ${className}`}>{children}</div>;
}
