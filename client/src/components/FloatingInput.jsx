export default function FloatingInput({
  id,
  label,
  type = "text",
  required = false,
  value,
  onChange,
  icon: Icon,
  placeholder,
}) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-[13px] font-medium text-fg">
        {label}
      </label>
      <div className="relative">
        {Icon && (
          <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-fg-subtle pointer-events-none">
            <Icon size={15} />
          </span>
        )}
        <input
          id={id}
          type={type}
          required={required}
          value={value}
          onChange={onChange}
          placeholder={placeholder || `Enter ${label.toLowerCase()}`}
          className={`w-full ${Icon ? "pl-10" : "pl-3.5"} pr-3.5 py-2.5 rounded-md bg-field border border-edge text-fg text-sm placeholder:text-fg-subtle outline-none transition-colors duration-200 hover:border-edge-strong focus:border-accent focus:ring-1 focus:ring-accent`}
        />
      </div>
    </div>
  );
}
