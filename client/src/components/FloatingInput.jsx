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
      <label htmlFor={id} className="block text-[13px] font-medium text-gray-300">
        {label}
      </label>
      <div className="relative">
        {Icon && (
          <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-500 pointer-events-none">
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
          className={`w-full ${Icon ? "pl-10" : "pl-3.5"} pr-3.5 py-2.5 rounded-lg bg-white/[0.04] border border-white/10 text-white text-sm placeholder-gray-600 outline-none focus:border-purple-500/60 focus:ring-1 focus:ring-purple-500/25 hover:border-white/20 transition-all duration-200`}
        />
      </div>
    </div>
  );
}
