import {
  LockKeyhole,
  Palette,
  UserRound,
  Code2,
  Bell,
  Users,
  Zap,
  Shield,
  LogOut,
  Trash2,
  Github,
  Mail,
  Copy,
  Check,
} from "lucide-react";
import { useState } from "react";
import { useAuth } from "../hooks/useAuth";
import { usePreferences } from "../context/PreferencesContext";
import { useNavigate } from "react-router-dom";
import toast from "react-hot-toast";

function SettingCard({ icon: Icon, title, description, children, className = "" }) {
  return (
    <section className={`rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900 ${className}`}>
      <div className="flex items-center gap-3">
        <div className="rounded-lg bg-blue-100 p-2.5 text-blue-700 dark:bg-blue-900 dark:text-blue-200">
          <Icon size={20} />
        </div>
        <div>
          <h2 className="text-lg font-semibold text-zinc-900 dark:text-white">{title}</h2>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">{description}</p>
        </div>
      </div>

      {children && <div className="mt-6">{children}</div>}
    </section>
  );
}

function SettingRow({ label, value, action }) {
  return (
    <div className="flex items-center justify-between border-b border-zinc-200 py-4 last:border-0 dark:border-zinc-800">
      <div className="flex-1">
        <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300">{label}</p>
        {value && <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">{value}</p>}
      </div>
      {action && <div className="ml-4">{action}</div>}
    </div>
  );
}

export default function Settings() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const { preferences, updatePreference, updateNotification, updatePrivacy } = usePreferences();
  const [copiedId, setCopiedId] = useState(false);

  const handleCopyUserId = () => {
    navigator.clipboard.writeText(user?.id || "");
    setCopiedId(true);
    setTimeout(() => setCopiedId(false), 2000);
    toast.success("User ID copied!");
  };

  const handleLogout = async () => {
    if (window.confirm("Are you sure you want to logout?")) {
      logout();
      navigate("/");
      toast.success("Logged out successfully");
    }
  };

  const handleThemeChange = (newTheme) => {
    updatePreference("theme", newTheme);
    if (newTheme === "vs-dark") {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }
    localStorage.setItem("theme", newTheme);
    toast.success("Theme updated");
  };

  const handleDeleteAccount = () => {
    if (window.confirm("Are you absolutely sure? This cannot be undone.")) {
      if (window.confirm("This will permanently delete your account and all data.")) {
        toast.error("Account deletion not yet implemented");
      }
    }
  };

  return (
    <div className="min-h-full bg-white text-black dark:bg-zinc-950 dark:text-white">
      <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="mb-12 max-w-2xl">
          <p className="text-xs font-semibold uppercase tracking-wider text-blue-600 dark:text-blue-400">Settings</p>
          <h1 className="mt-2 text-4xl font-bold tracking-tight text-zinc-900 dark:text-white">
            Workspace preferences
          </h1>
          <p className="mt-4 text-base text-zinc-600 dark:text-zinc-400">
            Manage your account, editor preferences, and collaboration settings.
          </p>
        </div>

        {/* Account Section */}
        <div className="mb-8">
          <h3 className="mb-4 text-sm font-bold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
            Account
          </h3>
          <div className="grid gap-4 md:grid-cols-2">
            <SettingCard
              icon={UserRound}
              title="Profile"
              description="Your account information"
            >
              <div className="space-y-4">
                <SettingRow
                  label="Username"
                  value={user?.username || "Unknown"}
                />
                <SettingRow
                  label="Email"
                  value={user?.email || "Unknown"}
                />
                <SettingRow
                  label="User ID"
                  value={user?.id?.slice(0, 12) + "..."}
                  action={
                    <button
                      onClick={handleCopyUserId}
                      className="flex items-center gap-2 rounded-md bg-zinc-100 p-2 text-xs hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700"
                      title="Copy full ID"
                    >
                      {copiedId ? <Check size={14} /> : <Copy size={14} />}
                    </button>
                  }
                />
                <SettingRow
                  label="Member Since"
                  value="March 18, 2026"
                />
              </div>
            </SettingCard>

            <SettingCard
              icon={Github}
              title="Connected Accounts"
              description="Link external services"
            >
              <div className="space-y-3">
                <button className="w-full rounded-lg border border-zinc-300 bg-white px-4 py-2.5 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700">
                  <div className="flex items-center justify-center gap-2">
                    <Github size={16} />
                    Connect GitHub
                  </div>
                </button>
                <button className="w-full rounded-lg border border-zinc-300 bg-white px-4 py-2.5 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700">
                  <div className="flex items-center justify-center gap-2">
                    <Mail size={16} />
                    Connect Social
                  </div>
                </button>
              </div>
            </SettingCard>
          </div>
        </div>

        {/* Editor Preferences Section */}
        <div className="mb-8">
          <h3 className="mb-4 text-sm font-bold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
            Editor
          </h3>
          <div className="grid gap-4 md:grid-cols-2">
            <SettingCard
              icon={Code2}
              title="Editor Settings"
              description="Customize your coding experience"
            >
              <div className="space-y-5">
                <div>
                  <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2">
                    Font Size: <span className="text-blue-600 dark:text-blue-400">{preferences.fontSize}px</span>
                  </label>
                  <input
                    type="range"
                    min="12"
                    max="20"
                    value={preferences.fontSize}
                    onChange={(e) => {
                      updatePreference("fontSize", parseInt(e.target.value));
                      toast.success(`Font size set to ${e.target.value}px`);
                    }}
                    className="w-full"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2">
                    Line Height: <span className="text-blue-600 dark:text-blue-400">{preferences.lineHeight}</span>
                  </label>
                  <input
                    type="range"
                    min="1.2"
                    max="2"
                    step="0.1"
                    value={preferences.lineHeight}
                    onChange={(e) => {
                      updatePreference("lineHeight", parseFloat(e.target.value));
                      toast.success(`Line height set to ${e.target.value}`);
                    }}
                    className="w-full"
                  />
                </div>

                <div className="pt-3">
                  <label className="flex items-center gap-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={preferences.autoSave}
                      onChange={(e) => {
                        updatePreference("autoSave", e.target.checked);
                        toast.success(e.target.checked ? "Auto-save enabled" : "Auto-save disabled");
                      }}
                      className="rounded border-zinc-300 dark:border-zinc-600"
                    />
                    <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                      Auto-save files
                    </span>
                  </label>
                  <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                    Automatically save file changes every 2 seconds
                  </p>
                </div>
              </div>
            </SettingCard>

            <SettingCard
              icon={Palette}
              title="Appearance"
              description="Visual theme preferences"
            >
              <div className="space-y-4">
                <div>
                  <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-3">Editor Theme</p>
                  <div className="space-y-2">
                    <label className="flex items-center gap-3 cursor-pointer">
                      <input
                        type="radio"
                        name="theme"
                        value="vs-dark"
                        checked={preferences.theme === "vs-dark"}
                        onChange={(e) => handleThemeChange(e.target.value)}
                        className="rounded-full"
                      />
                      <span className="text-sm text-zinc-700 dark:text-zinc-300">Dark Theme</span>
                    </label>
                    <label className="flex items-center gap-3 cursor-pointer">
                      <input
                        type="radio"
                        name="theme"
                        value="vs"
                        checked={preferences.theme === "vs"}
                        onChange={(e) => handleThemeChange(e.target.value)}
                        className="rounded-full"
                      />
                      <span className="text-sm text-zinc-700 dark:text-zinc-300">Light Theme</span>
                    </label>
                  </div>
                </div>

                <div className="pt-3">
                  <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-3">Minimap</p>
                  <label className="flex items-center gap-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={preferences.minimap}
                      onChange={(e) => {
                        updatePreference("minimap", e.target.checked);
                        toast.success(e.target.checked ? "Minimap enabled" : "Minimap disabled");
                      }}
                      className="rounded border-zinc-300 dark:border-zinc-600"
                    />
                    <span className="text-sm text-zinc-700 dark:text-zinc-300">Show code minimap</span>
                  </label>
                </div>
              </div>
            </SettingCard>
          </div>
        </div>

        {/* Collaboration Section */}
        <div className="mb-8">
          <h3 className="mb-4 text-sm font-bold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
            Collaboration
          </h3>
          <div className="grid gap-4 md:grid-cols-2">
            <SettingCard
              icon={Users}
              title="Collaboration"
              description="Room and team settings"
            >
              <div className="space-y-4">
                <SettingRow
                  label="Rooms Created"
                  value="5 rooms"
                />
                <SettingRow
                  label="Total Collaborators"
                  value="12 people across rooms"
                />
                <button className="w-full mt-4 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-blue-700 dark:bg-blue-700 dark:hover:bg-blue-800">
                  Manage Rooms
                </button>
              </div>
            </SettingCard>

            <SettingCard
              icon={Zap}
              title="Keyboard Shortcuts"
              description="Quick actions and navigation"
            >
              <div className="space-y-3 text-sm">
                <div className="flex items-center justify-between">
                  <span className="text-zinc-600 dark:text-zinc-400">Save file</span>
                  <kbd className="rounded bg-zinc-200 px-2 py-1 font-mono text-xs dark:bg-zinc-800">Ctrl+S</kbd>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-zinc-600 dark:text-zinc-400">Open file</span>
                  <kbd className="rounded bg-zinc-200 px-2 py-1 font-mono text-xs dark:bg-zinc-800">Ctrl+O</kbd>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-zinc-600 dark:text-zinc-400">New file</span>
                  <kbd className="rounded bg-zinc-200 px-2 py-1 font-mono text-xs dark:bg-zinc-800">Ctrl+N</kbd>
                </div>
                <button className="mt-2 w-full text-blue-600 text-xs font-medium hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300">
                  View all shortcuts →
                </button>
              </div>
            </SettingCard>
          </div>
        </div>

        {/* Preferences Section */}
        <div className="mb-8">
          <h3 className="mb-4 text-sm font-bold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
            Preferences
          </h3>
          <div className="grid gap-4 md:grid-cols-2">
            <SettingCard
              icon={Bell}
              title="Notifications"
              description="Email and in-app alerts"
            >
              <div className="space-y-4">
                <label className="flex items-center gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={preferences.notifications.pushNotifications}
                    onChange={(e) => updateNotification("pushNotifications", e.target.checked)}
                    className="rounded border-zinc-300 dark:border-zinc-600"
                  />
                  <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                    Push notifications
                  </span>
                </label>

                <label className="flex items-center gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={preferences.notifications.collaboratorJoined}
                    onChange={(e) => updateNotification("collaboratorJoined", e.target.checked)}
                    className="rounded border-zinc-300 dark:border-zinc-600"
                  />
                  <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                    Collaborator joined
                  </span>
                </label>

                <label className="flex items-center gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={preferences.notifications.codeChanges}
                    onChange={(e) => updateNotification("codeChanges", e.target.checked)}
                    className="rounded border-zinc-300 dark:border-zinc-600"
                  />
                  <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                    Code changes
                  </span>
                </label>

                <label className="flex items-center gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={preferences.notifications.emailDigest}
                    onChange={(e) => updateNotification("emailDigest", e.target.checked)}
                    className="rounded border-zinc-300 dark:border-zinc-600"
                  />
                  <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                    Email digest
                  </span>
                </label>
              </div>
            </SettingCard>

            <SettingCard
              icon={Shield}
              title="Privacy & Security"
              description="Data and access control"
            >
              <div className="space-y-4">
                <label className="flex items-center gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={preferences.privacy.profileVisibility}
                    onChange={(e) => updatePrivacy("profileVisibility", e.target.checked)}
                    className="rounded border-zinc-300 dark:border-zinc-600"
                  />
                  <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                    Profile visibility
                  </span>
                </label>

                <label className="flex items-center gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={preferences.privacy.showActivityStatus}
                    onChange={(e) => updatePrivacy("showActivityStatus", e.target.checked)}
                    className="rounded border-zinc-300 dark:border-zinc-600"
                  />
                  <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                    Show activity status
                  </span>
                </label>

                <button className="w-full mt-4 rounded-lg border border-zinc-300 bg-white px-4 py-2.5 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700">
                  Change Password
                </button>

                <button className="w-full rounded-lg border border-zinc-300 bg-white px-4 py-2.5 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700">
                  Active Sessions
                </button>
              </div>
            </SettingCard>
          </div>
        </div>

        {/* Danger Zone */}
        <div className="mb-8">
          <h3 className="mb-4 text-sm font-bold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
            Account Actions
          </h3>
          <div className="rounded-xl border border-red-200 bg-red-50 p-6 dark:border-red-900 dark:bg-red-950">
            <div className="space-y-4">
              <div>
                <h3 className="text-lg font-semibold text-red-900 dark:text-red-100">Danger Zone</h3>
                <p className="mt-1 text-sm text-red-800 dark:text-red-200">
                  Irreversible actions that affect your account
                </p>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <button
                  onClick={handleLogout}
                  className="flex items-center justify-center gap-2 rounded-lg bg-red-600 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-red-700"
                >
                  <LogOut size={16} />
                  Logout
                </button>

                <button
                  onClick={handleDeleteAccount}
                  className="flex items-center justify-center gap-2 rounded-lg border border-red-600 bg-transparent px-4 py-2.5 text-sm font-medium text-red-600 transition-colors hover:bg-red-50 dark:border-red-500 dark:text-red-400 dark:hover:bg-red-950"
                >
                  <Trash2 size={16} />
                  Delete Account
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Footer Info */}
        <div className="mt-12 border-t border-zinc-200 pt-8 dark:border-zinc-800">
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            Last updated: Today at 2:30 PM • Settings auto-save
          </p>
        </div>
      </div>
    </div>
  );
}
