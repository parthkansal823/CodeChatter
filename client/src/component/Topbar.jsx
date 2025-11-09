import React from "react";
import LanguageDropdown from "./LanguageDropdown";

function Topbar({ selectedLanguage, setSelectedLanguage, theme, toggleTheme }) {
  return (
    <div className="editor-topbar">
      <LanguageDropdown
        selectedLanguage={selectedLanguage}
        setSelectedLanguage={setSelectedLanguage}
      />
      <button className="theme-toggle" onClick={toggleTheme}>
        {theme === "dark" ? "☀️ Light Mode" : "🌙 Dark Mode"}
      </button>
    </div>
  );
}

export default Topbar;
