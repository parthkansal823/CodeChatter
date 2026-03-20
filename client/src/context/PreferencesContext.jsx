import { createContext, useContext, useState, useEffect } from "react";

const PreferencesContext = createContext();

const DEFAULT_PREFERENCES = {
  // Editor preferences
  fontSize: 15,
  lineHeight: 1.6,
  autoSave: true,
  minimap: false,
  
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

export function PreferencesProvider({ children }) {
  const [preferences, setPreferences] = useState(DEFAULT_PREFERENCES);
  const [isLoading, setIsLoading] = useState(true);

  // Load preferences from localStorage on mount
  useEffect(() => {
    try {
      const savedPreferences = localStorage.getItem("app_preferences");
      if (savedPreferences) {
        const parsed = JSON.parse(savedPreferences);
        setPreferences((prev) => ({ ...prev, ...parsed }));
      }
    } catch (error) {
      console.error("Failed to load preferences:", error);
    } finally {
      setIsLoading(false);
    }
  }, []);

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

export function usePreferences() {
  const context = useContext(PreferencesContext);
  if (!context) {
    throw new Error("usePreferences must be used within a PreferencesProvider");
  }
  return context;
}
