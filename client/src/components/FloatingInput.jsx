export default function FloatingInput({ id, label, type = "text", required = false, value, onChange }) {
  return (
    <div className="relative">
      <input
        id={id}
        type={type}
        placeholder=" "
        required={required}
        value={value}
        onChange={onChange}
        className="peer w-full px-4 pt-6 pb-2 bg-transparent border border-gray-600 rounded-lg focus:ring-2 focus:ring-purple-500 focus:outline-none transition"
      />
      <label
        htmlFor={id}
        className="absolute left-4 top-4 text-gray-400 text-sm transition-all
        peer-focus:top-2 peer-focus:text-xs peer-focus:text-purple-400
        peer-placeholder-shown:top-4 peer-placeholder-shown:text-sm
        peer-not-placeholder-shown:top-2 peer-not-placeholder-shown:text-xs
        pointer-events-none"
      >
        {label}
      </label>
    </div>
  );
}
