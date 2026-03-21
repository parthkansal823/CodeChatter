import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";

export default function PasswordInput({ id, label, required = false, value, onChange, icon: Icon }) {
  const [showPassword, setShowPassword] = useState(false);

  return (
    <div className="relative group">
      {Icon && (
        <div className="absolute left-4 top-[1.15rem] text-gray-400 group-focus-within:text-purple-400 transition-colors z-10">
          <Icon size={20} />
        </div>
      )}
      <input
        id={id}
        type={showPassword ? "text" : "password"}
        placeholder=" "
        required={required}
        value={value}
        onChange={onChange}
        className={`peer w-full ${Icon ? "pl-11" : "px-4"} pr-11 pt-6 pb-2 bg-white/5 border border-white/10 rounded-xl focus:ring-2 focus:ring-purple-500/50 focus:border-purple-500 focus:bg-white/10 outline-none transition-all duration-300 text-white placeholder-transparent`}
      />
      <label
        htmlFor={id}
        className={`absolute ${Icon ? "left-11" : "left-4"} top-4 text-gray-400 text-sm transition-all duration-300
        peer-focus:top-2 peer-focus:text-[11px] peer-focus:text-purple-400 peer-focus:font-medium
        peer-placeholder-shown:top-4 peer-placeholder-shown:text-sm
        peer-not-placeholder-shown:top-2 peer-not-placeholder-shown:text-[11px]
        pointer-events-none`}
      >
        {label}
      </label>

      <div
        onClick={() => setShowPassword(!showPassword)}
        className="absolute right-4 top-[1.15rem] cursor-pointer text-gray-400 hover:text-white transition-colors z-10"
      >
        {showPassword ? <Eye size={20} /> : <EyeOff size={20} />}
      </div>
    </div>
  );
}
