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
import ConfirmModal from "../components/ConfirmModal";
import { Card, CardHeader, CardContent } from "../components/ui/Card";
import { Button } from "../components/ui/Button";



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
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const handleCopyUserId = () => {
    navigator.clipboard.writeText(user?.id || "");
    setCopiedId(true);
    setTimeout(() => setCopiedId(false), 2000);
    toast.success("User ID copied!");
  };

  const handleLogout = () => {
    setShowLogoutConfirm(true);
  };

  const confirmLogout = () => {
    setShowLogoutConfirm(false);
    logout();
    navigate("/");
    toast.success("Logged out successfully");
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
    setShowDeleteConfirm(true);
  };

  const confirmDeleteAccount = () => {
    setShowDeleteConfirm(false);
    toast.error("Account deletion not yet implemented");
  };

  return (
    <div className="min-h-full bg-white text-black dark:bg-zinc-950 dark:text-white">
      <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="mb-12 max-w-2xl">
          <p className="text-xs font-semibold uppercase tracking-wider text-brand-600 dark:text-brand-400">Settings</p>
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
            <Card>
              <CardHeader
                icon={UserRound}
                title="Profile"
                description="Your account information"
              />
              <CardContent>
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
              </CardContent>
            </Card>

            <Card>
              <CardHeader
                icon={Github}
                title="Connected Accounts"
                description="Link external services"
              />
              <CardContent>
                <div className="space-y-3">
                  <Button variant="outline" className="w-full">
                    <Github size={16} className="mr-2" />
                    Connect GitHub
                  </Button>
                  <Button variant="outline" className="w-full">
                    <Mail size={16} className="mr-2" />
                    Connect Social
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>

        {/* Editor Preferences Section */}
        <div className="mb-8">
          <h3 className="mb-4 text-sm font-bold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
            Editor
          </h3>
          <div className="grid gap-4 md:grid-cols-2">
            <Card>
              <CardHeader
                icon={Code2}
                title="Editor Settings"
                description="Customize your coding experience"
              />
              <CardContent>
                <div className="space-y-5">
                  <div>
                    <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2">
                      Font Size: <span className="text-brand-600 dark:text-brand-400">{preferences.fontSize}px</span>
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
                      className="w-full accent-brand-500"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2">
                      Line Height: <span className="text-brand-600 dark:text-brand-400">{preferences.lineHeight}</span>
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
                      className="w-full accent-brand-500"
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
                        className="rounded border-zinc-300 text-brand-600 focus:ring-brand-500 dark:border-zinc-600"
                      />
                      <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                        Auto-save files
                      </span>
                    </label>
                    <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                      Automatically save file changes every 2 seconds
                    </p>
                  </div>

                  <div className="pt-3">
                    <label className="flex items-center gap-3 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={preferences.wordWrap}
                        onChange={(e) => {
                          updatePreference("wordWrap", e.target.checked);
                          toast.success(e.target.checked ? "Word wrap enabled" : "Word wrap disabled");
                        }}
                        className="rounded border-zinc-300 text-brand-600 focus:ring-brand-500 dark:border-zinc-600"
                      />
                      <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                        Enable Word Wrap
                      </span>
                    </label>
                    <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                      Wrap lines that exceed the editor width
                    </p>
                  </div>

                  <div className="pt-3">
                    <label className="flex items-center gap-3 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={preferences.fontLigatures}
                        onChange={(e) => {
                          updatePreference("fontLigatures", e.target.checked);
                          toast.success(e.target.checked ? "Font ligatures enabled" : "Font ligatures disabled");
                        }}
                        className="rounded border-zinc-300 text-brand-600 focus:ring-brand-500 dark:border-zinc-600"
                      />
                      <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                        Enable Font Ligatures
                      </span>
                    </label>
                    <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                      Use specialized multi-character symbols like =&gt;
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader
                icon={Palette}
                title="Appearance"
                description="Visual theme preferences"
              />
              <CardContent>
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
                          className="text-brand-600 focus:ring-brand-500"
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
                          className="text-brand-600 focus:ring-brand-500"
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
                        className="rounded border-zinc-300 text-brand-600 focus:ring-brand-500 dark:border-zinc-600"
                      />
                      <span className="text-sm text-zinc-700 dark:text-zinc-300">Show code minimap</span>
                    </label>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>

        {/* Collaboration Section */}
        <div className="mb-8">
          <h3 className="mb-4 text-sm font-bold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
            Collaboration
          </h3>
          <div className="grid gap-4 md:grid-cols-2">
            <Card>
              <CardHeader
                icon={Users}
                title="Collaboration"
                description="Room and team settings"
              />
              <CardContent>
                <div className="space-y-4">
                  <SettingRow
                    label="Rooms Created"
                    value="5 rooms"
                  />
                  <SettingRow
                    label="Total Collaborators"
                    value="12 people across rooms"
                  />
                  <Button className="w-full mt-4">
                    Manage Rooms
                  </Button>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader
                icon={Zap}
                title="Keyboard Shortcuts"
                description="Quick actions and navigation"
              />
              <CardContent>
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
                  <Button variant="ghost" className="w-full mt-2 text-brand-600 dark:text-brand-400">
                    View all shortcuts →
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>

        {/* Preferences Section */}
        <div className="mb-8">
          <h3 className="mb-4 text-sm font-bold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
            Preferences
          </h3>
          <div className="grid gap-4 md:grid-cols-2">
            <Card>
              <CardHeader
                icon={Bell}
                title="Notifications"
                description="Email and in-app alerts"
              />
              <CardContent>
                <div className="space-y-4">
                  <label className="flex items-center gap-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={preferences.notifications.pushNotifications}
                      onChange={(e) => updateNotification("pushNotifications", e.target.checked)}
                      className="rounded border-zinc-300 text-brand-600 focus:ring-brand-500 dark:border-zinc-600"
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
                      className="rounded border-zinc-300 text-brand-600 focus:ring-brand-500 dark:border-zinc-600"
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
                      className="rounded border-zinc-300 text-brand-600 focus:ring-brand-500 dark:border-zinc-600"
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
                      className="rounded border-zinc-300 text-brand-600 focus:ring-brand-500 dark:border-zinc-600"
                    />
                    <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                      Email digest
                    </span>
                  </label>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader
                icon={Shield}
                title="Privacy & Security"
                description="Data and access control"
              />
              <CardContent>
                <div className="space-y-4">
                  <label className="flex items-center gap-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={preferences.privacy.profileVisibility}
                      onChange={(e) => updatePrivacy("profileVisibility", e.target.checked)}
                      className="rounded border-zinc-300 text-brand-600 focus:ring-brand-500 dark:border-zinc-600"
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
                      className="rounded border-zinc-300 text-brand-600 focus:ring-brand-500 dark:border-zinc-600"
                    />
                    <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                      Show activity status
                    </span>
                  </label>

                  <Button variant="outline" className="w-full mt-4">
                    Change Password
                  </Button>

                  <Button variant="outline" className="w-full">
                    Active Sessions
                  </Button>
                </div>
              </CardContent>
            </Card>
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
                <Button
                  onClick={handleLogout}
                  variant="danger"
                >
                  <LogOut size={16} className="mr-2" />
                  Logout
                </Button>

                <Button
                  onClick={handleDeleteAccount}
                  variant="outline"
                  className="!text-red-500 !border-red-500 hover:!bg-red-50 dark:hover:!bg-red-950/30"
                >
                  <Trash2 size={16} className="mr-2" />
                  Delete Account
                </Button>
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

      <ConfirmModal
        isOpen={showLogoutConfirm}
        title="Logout"
        description="Are you sure you want to logout?"
        confirmText="Logout"
        cancelText="Cancel"
        isDestructive={false}
        onConfirm={confirmLogout}
        onCancel={() => setShowLogoutConfirm(false)}
      />

      <ConfirmModal
        isOpen={showDeleteConfirm}
        title="Delete Account"
        description="Are you absolutely sure? This will permanently delete your account and all data. This cannot be undone."
        confirmText="Delete Account"
        cancelText="Cancel"
        isDestructive={true}
        onConfirm={confirmDeleteAccount}
        onCancel={() => setShowDeleteConfirm(false)}
      />
    </div>
  );
}
