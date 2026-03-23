export default function BrandLogo({ size = "md", className = "" }) {
  const sizes = { sm: 28, md: 36, lg: 44, xl: 56 };
  const px = sizes[size] || 36;

  return (
    <div className={`flex items-center gap-3 ${className}`}>
      <svg
        width={px}
        height={px}
        viewBox="0 0 48 48"
        xmlns="http://www.w3.org/2000/svg"
      >
        <defs>
          <linearGradient id="gradPurple1" x1="0" y1="0" x2="48" y2="48">
            <stop offset="0%" stopColor="#8B5CF6" />
            <stop offset="100%" stopColor="#6366F1" />
          </linearGradient>

          <linearGradient id="gradBlue1" x1="0" y1="0" x2="48" y2="48">
            <stop offset="0%" stopColor="#60A5FA" />
            <stop offset="100%" stopColor="#2563EB" />
          </linearGradient>
        </defs>

        {/* BLUE BACK SQUARE */}
        <rect
          x="18"
          y="18"
          width="22"
          height="20"
          rx="7"
          fill="url(#gradBlue1)"
        />

        {/* PURPLE MAIN BUBBLE */}
        <rect
          x="6"
          y="6"
          width="24"
          height="20"
          rx="7"
          fill="url(#gradPurple1)"
        />

        {/* TAIL */}
        <path
          d="M12 26 L9 32 L17 26Z"
          fill="url(#gradPurple1)"
        />

        {/* CODE ICON */}
        <g
          stroke="white"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          {/* < */}
          <path d="M13 13 L10.5 15.5 L13 18" />
          {/* > */}
          <path d="M19 13 L21.5 15.5 L19 18" />
          {/* / */}
          <path d="M17 12.5 L15.5 18.5" />
        </g>
      </svg>

      {/* TEXT */}
      <span className="text-xl font-semibold tracking-tight">
        <span className="text-zinc-800 dark:text-white">Code</span>
        <span className="bg-gradient-to-r from-violet-500 to-blue-500 bg-clip-text text-transparent">
          Chatter
        </span>
      </span>
    </div>
  );
}