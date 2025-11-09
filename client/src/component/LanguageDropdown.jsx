import React, { useState, useRef, useEffect } from "react";
import {
  FaPython, FaJava, FaNodeJs, FaPhp, FaSwift,
} from "react-icons/fa";
import {
  SiCplusplus, SiC, SiGo, SiScala, SiRubyonrails,
  SiRust, SiMysql, SiR, SiDotnet,
} from "react-icons/si";
import { BsTerminal } from "react-icons/bs";

const LANGUAGE_OPTIONS = [
  { value: "python3", label: "Python", icon: <FaPython color="#3776AB" /> },
  { value: "java", label: "Java", icon: <FaJava color="#ED8B00" /> },
  { value: "cpp", label: "C++", icon: <SiCplusplus color="#00599C" /> },
  { value: "c", label: "C", icon: <SiC color="#283593" /> },
  { value: "nodejs", label: "Node.js", icon: <FaNodeJs color="#68A063" /> },
  { value: "php", label: "PHP", icon: <FaPhp color="#777BB4" /> },
  { value: "swift", label: "Swift", icon: <FaSwift color="#FA7343" /> },
  { value: "ruby", label: "Ruby", icon: <SiRubyonrails color="#CC342D" /> },
  { value: "go", label: "Go", icon: <SiGo color="#00ADD8" /> },
  { value: "scala", label: "Scala", icon: <SiScala color="#DC322F" /> },
  { value: "bash", label: "Bash", icon: <BsTerminal color="#4EAA25" /> },
  { value: "sql", label: "SQL", icon: <SiMysql color="#00618A" /> },
  { value: "csharp", label: "C#", icon: <SiDotnet color="#68217A" /> },
  { value: "rust", label: "Rust", icon: <SiRust color="#DEA584" /> },
  { value: "r", label: "R", icon: <SiR color="#276DC3" /> },
];

function LanguageDropdown({ selectedLanguage, setSelectedLanguage }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const currentLang = LANGUAGE_OPTIONS.find((lang) => lang.value === selectedLanguage);

  return (
    <div className="custom-dropdown" ref={ref}>
      <button type="button" className="dropdown-toggle" onClick={() => setOpen(!open)}>
        {currentLang?.icon}
        <span>{currentLang?.label}</span>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor">
          <path d="M6 9l6 6 6-6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && (
        <div className="dropdown-menu-portal">
          {LANGUAGE_OPTIONS.map((lang) => (
            <div
              key={lang.value}
              className={`dropdown-item ${selectedLanguage === lang.value ? "active" : ""}`}
              onClick={() => {
                setSelectedLanguage(lang.value);
                setOpen(false);
              }}
            >
              {lang.icon}
              <span>{lang.label}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default LanguageDropdown;
