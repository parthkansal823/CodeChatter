import { useState, useEffect } from "react";
import { PreferencesContext } from "./preferences-context";

const DEFAULT_PREFERENCES = {
  // Editor preferences
  fontSize: 15,
  lineHeight: 1.6,
  autoSave: true,
  minimap: true,
  wordWrap: true,
  fontLigatures: true,

  // Theme
  theme: "vs-dark",

  // Notifications
  notifications: {
    pushNotifications: true,
    collaboratorJoined: true,
    codeChanges: true,
    emailDigest: false,
  },

  // Privacy
  privacy: {
    profileVisibility: true,
    showActivityStatus: true,
  },
};

function loadInitialPreferences() {
  try {
    const saved = localStorage.getItem("app_preferences");
    if (saved) return { ...DEFAULT_PREFERENCES, ...JSON.parse(saved) };
  } catch {
    // ignore
  }
  return DEFAULT_PREFERENCES;
}

export function PreferencesProvider({ children }) {
  const [preferences, setPreferences] = useState(loadInitialPreferences);
  const [isLoading] = useState(false);

  // Apply dark class whenever theme preference changes
  useEffect(() => {
    if (preferences.theme === "vs-dark") {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }
  }, [preferences.theme]);

  // Save preferences to localStorage whenever they change
  useEffect(() => {
    if (!isLoading) {
      try {
        localStorage.setItem("app_preferences", JSON.stringify(preferences));
      } catch (error) {
        console.error("Failed to save preferences:", error);
      }
    }
  }, [preferences, isLoading]);

  const updatePreference = (key, value) => {
    setPreferences((prev) => ({
      ...prev,
      [key]: value,
    }));
  };

  const updateNotification = (key, value) => {
    setPreferences((prev) => ({
      ...prev,
      notifications: {
        ...prev.notifications,
        [key]: value,
      },
    }));
  };

  const updatePrivacy = (key, value) => {
    setPreferences((prev) => ({
      ...prev,
      privacy: {
        ...prev.privacy,
        [key]: value,
      },
    }));
  };

  const resetPreferences = () => {
    setPreferences(DEFAULT_PREFERENCES);
  };

  return (
    <PreferencesContext.Provider
      value={{
        preferences,
        updatePreference,
        updateNotification,
        updatePrivacy,
        resetPreferences,
        isLoading,
      }}
    >
      {children}
    </PreferencesContext.Provider>
  );
}

