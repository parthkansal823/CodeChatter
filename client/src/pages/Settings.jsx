import {
  LockKeyhole, Palette, UserRound, Code2, Bell, Users,
  Zap, Shield, LogOut, Trash2, Github, Mail, Copy, Check,
  ChevronRight, Moon, Sun,
} from "lucide-react";
import { useState } from "react";
import { motion as Motion, AnimatePresence } from "framer-motion";
import { useAuth } from "../hooks/useAuth";
import { usePreferences } from "../hooks/usePreferences";
import { useNavigate } from "react-router-dom";
import toast from "react-hot-toast";
import ConfirmModal from "../components/ConfirmModal";
import { Button } from "../components/ui/Button";
import UserAvatar from "../components/UserAvatar";

const NAV = [
  { id: "profile", label: "Profile", icon: UserRound },
  { id: "editor", label: "Editor", icon: Code2 },
  { id: "appearance", label: "Appearance", icon: Palette },
  { id: "collab", label: "Collaboration", icon: Users },
  { id: "notifs", label: "Notifications", icon: Bell },
  { id: "privacy", label: "Privacy", icon: Shield },
  { id: "shortcuts", label: "Shortcuts", icon: Zap },
  { id: "danger", label: "Account Actions", icon: LockKeyhole },
];

const SHORTCUTS = [
  ["Save file", "Ctrl+S"],
  ["Run code", "Ctrl+Enter"],
  ["Command palette", "Ctrl+K"],
  ["New file", "Ctrl+N"],
  ["Toggle terminal", "Ctrl+`"],
  ["Format file", "Shift+Alt+F"],
];

function Toggle({ checked, onChange }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full p-[2px] transition-colors focus:outline-none focus:ring-2 focus:ring-violet-500/40 ${checked ? "bg-violet-600" : "bg-zinc-300 dark:bg-zinc-700"
        }`}
    >
      <span
        className={`inline-block h-5 w-5 rounded-full bg-white shadow transition-transform ${checked ? "translate-x-5" : "translate-x-0"
          }`}
      />
    </button>
  );
}

function SectionTitle({ children }) {
  return (
    <h2 className="mb-5 text-lg font-semibold text-zinc-900 dark:text-white">{children}</h2>
  );
}

function Row({ label, hint, action }) {
  return (
    <div className="flex flex-col items-start gap-3 border-b border-zinc-100 py-3.5 dark:border-zinc-800/60 last:border-0 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-zinc-800 dark:text-zinc-200">{label}</p>
        {hint && <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-500">{hint}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

export default function Settings() {
  const { user, logout, deleteAccount } = useAuth();
  const navigate = useNavigate();
  const { preferences, updatePreference, updateNotification, updatePrivacy } = usePreferences();
  const [activeSection, setActiveSection] = useState("profile");
  const [copiedId, setCopiedId] = useState(false);
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const handleCopyUserId = () => {
    navigator.clipboard.writeText(user?.id || "");
    setCopiedId(true);
    setTimeout(() => setCopiedId(false), 2000);
    toast.success("User ID copied!");
  };

  const confirmLogout = () => {
    setShowLogoutConfirm(false);
    logout();
    navigate("/");
    toast.success("Logged out successfully");
  };

  const confirmDeleteAccount = async () => {
    setShowDeleteConfirm(false);
    const result = await deleteAccount();

    if (!result.success) {
      toast.error(result.error || "Could not delete account");
      return;
    }

    toast.success("Account deleted");
    navigate("/", { replace: true });
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

  const renderSection = () => {
    switch (activeSection) {
      case "profile":
        return (
          <div>
            <SectionTitle>Profile</SectionTitle>
            {/* Avatar hero */}
            <div className="mb-6 flex items-center gap-4 rounded-xl border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-900/60">
              <UserAvatar username={user?.username} size="lg" />
              <div>
                <p className="font-semibold text-zinc-900 dark:text-white">{user?.username}</p>
                <p className="text-sm text-zinc-500">{user?.email}</p>
              </div>
            </div>
            <Row label="Username" hint={user?.username || "—"} />
            <Row label="Email" hint={user?.email || "—"} />
            <Row
              label="User ID"
              hint={(user?.id || "").slice(0, 16) + "…"}
              action={
                <button
                  onClick={handleCopyUserId}
                  className="flex items-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-2.5 py-1.5 text-xs font-medium text-zinc-600 hover:border-violet-300 hover:text-violet-700 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-400 transition-colors"
                >
                  {copiedId ? <Check size={12} className="text-emerald-500" /> : <Copy size={12} />}
                  {copiedId ? "Copied!" : "Copy"}
                </button>
              }
            />
            <Row label="Connected accounts" hint="Link GitHub or Google for faster sign-in"
              action={
                <div className="flex gap-2">
                  <button className="flex items-center gap-1.5 rounded-lg border border-zinc-200 px-2.5 py-1.5 text-xs font-medium text-zinc-600 hover:border-zinc-300 dark:border-zinc-700 dark:text-zinc-400 transition-colors">
                    <Github size={12} /> GitHub
                  </button>
                  <button className="flex items-center gap-1.5 rounded-lg border border-zinc-200 px-2.5 py-1.5 text-xs font-medium text-zinc-600 hover:border-zinc-300 dark:border-zinc-700 dark:text-zinc-400 transition-colors">
                    <Mail size={12} /> Google
                  </button>
                </div>
              }
            />
          </div>
        );

      case "editor":
        return (
          <div>
            <SectionTitle>Editor</SectionTitle>
            <Row
              label="Font Size"
              hint={`${preferences.fontSize}px — drag to adjust`}
              action={
                <input type="range" min="12" max="20" value={preferences.fontSize}
                  onChange={(e) => { updatePreference("fontSize", parseInt(e.target.value)); }}
                  className="w-28 accent-violet-600"
                />
              }
            />
            <Row
              label="Line Height"
              hint={`${preferences.lineHeight} — spacing between lines`}
              action={
                <input type="range" min="1.2" max="2" step="0.1" value={preferences.lineHeight}
                  onChange={(e) => { updatePreference("lineHeight", parseFloat(e.target.value)); }}
                  className="w-28 accent-violet-600"
                />
              }
            />
            <Row
              label="Auto-save"
              hint="Save file changes automatically every 2s"
              action={<Toggle checked={preferences.autoSave} onChange={(v) => { updatePreference("autoSave", v); toast.success(v ? "Auto-save on" : "Auto-save off"); }} />}
            />
            <Row
              label="Word Wrap"
              hint="Wrap long lines to the editor width"
              action={<Toggle checked={preferences.wordWrap} onChange={(v) => { updatePreference("wordWrap", v); toast.success(v ? "Word wrap on" : "Word wrap off"); }} />}
            />
            <Row
              label="Font Ligatures"
              hint="Render multi-char symbols like => and !=="
              action={<Toggle checked={preferences.fontLigatures} onChange={(v) => { updatePreference("fontLigatures", v); toast.success(v ? "Ligatures on" : "Ligatures off"); }} />}
            />
            <Row
              label="Minimap"
              hint="Show a code overview on the right edge"
              action={<Toggle checked={preferences.minimap} onChange={(v) => { updatePreference("minimap", v); toast.success(v ? "Minimap on" : "Minimap off"); }} />}
            />
          </div>
        );

      case "appearance":
        return (
          <div>
            <SectionTitle>Appearance</SectionTitle>
            <p className="mb-4 text-sm text-zinc-500 dark:text-zinc-400">Choose the app and editor color scheme.</p>
            <div className="grid grid-cols-2 gap-3">
              {[
                { id: "vs-dark", label: "Dark", desc: "Easy on the eyes", icon: Moon },
                { id: "vs", label: "Light", desc: "High contrast", icon: Sun },
              ].map(({ id, label, desc, icon: Icon }) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => handleThemeChange(id)}
                  className={`flex flex-col items-start gap-2 rounded-xl border p-4 text-left transition-all ${preferences.theme === id
                      ? "border-violet-500 bg-violet-50 dark:border-violet-400 dark:bg-violet-900/10"
                      : "border-zinc-200 bg-white hover:border-zinc-300 dark:border-zinc-800 dark:bg-zinc-900/50"
                    }`}
                >
                  <div className={`rounded-lg p-2 ${preferences.theme === id ? "bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300" : "bg-zinc-100 text-zinc-500 dark:bg-zinc-800"}`}>
                    <Icon size={16} />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-zinc-900 dark:text-white">{label}</p>
                    <p className="text-xs text-zinc-500">{desc}</p>
                  </div>
                  {preferences.theme === id && (
                    <span className="mt-1 rounded-full bg-violet-600 px-2 py-0.5 text-[10px] font-semibold text-white">Active</span>
                  )}
                </button>
              ))}
            </div>
          </div>
        );

      case "collab":
        return (
          <div>
            <SectionTitle>Collaboration</SectionTitle>
            <Row label="Rooms Created" hint="Total rooms you own" />
            <Row label="Total Collaborators" hint="People with access to your rooms" />
            <div className="mt-4">
              <Button className="w-full" onClick={() => navigate("/home")}>
                <Users size={15} className="mr-2" /> Manage Rooms
              </Button>
            </div>
          </div>
        );

      case "notifs":
        return (
          <div>
            <SectionTitle>Notifications</SectionTitle>
            {[
              { key: "pushNotifications", label: "Push notifications", hint: "Browser alerts for room activity" },
              { key: "collaboratorJoined", label: "Collaborator joined", hint: "Alert when someone enters your room" },
              { key: "codeChanges", label: "Code changes", hint: "Alert when files are modified" },
              { key: "emailDigest", label: "Email digest", hint: "Weekly summary of room activity" },
            ].map(({ key, label, hint }) => (
              <Row
                key={key}
                label={label}
                hint={hint}
                action={<Toggle checked={preferences.notifications[key]} onChange={(v) => updateNotification(key, v)} />}
              />
            ))}
          </div>
        );

      case "privacy":
        return (
          <div>
            <SectionTitle>Privacy & Security</SectionTitle>
            <Row
              label="Profile visibility"
              hint="Allow others to see your profile"
              action={<Toggle checked={preferences.privacy.profileVisibility} onChange={(v) => updatePrivacy("profileVisibility", v)} />}
            />
            <Row
              label="Activity status"
              hint="Show when you're active in rooms"
              action={<Toggle checked={preferences.privacy.showActivityStatus} onChange={(v) => updatePrivacy("showActivityStatus", v)} />}
            />
            <div className="mt-4 flex flex-col gap-2">
              <Button variant="outline" className="w-full"><LockKeyhole size={14} className="mr-2" /> Change Password</Button>
              <Button variant="outline" className="w-full">Active Sessions</Button>
            </div>
          </div>
        );

      case "shortcuts":
        return (
          <div>
            <SectionTitle>Keyboard Shortcuts</SectionTitle>
            <div className="space-y-1">
              {SHORTCUTS.map(([action, keys]) => (
                <div key={action} className="flex items-center justify-between rounded-lg px-3 py-2.5 hover:bg-zinc-50 dark:hover:bg-zinc-900/60 transition-colors">
                  <span className="text-sm text-zinc-700 dark:text-zinc-300">{action}</span>
                  <kbd className="rounded-md border border-zinc-200 bg-zinc-100 px-2 py-1 font-mono text-[11px] text-zinc-600 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
                    {keys}
                  </kbd>
                </div>
              ))}
            </div>
          </div>
        );

      case "danger":
        return (
          <div>
            <SectionTitle>Account Actions</SectionTitle>
            <div className="rounded-xl border border-red-200 bg-red-50/50 p-5 dark:border-red-900/50 dark:bg-red-950/20">
              <p className="mb-1 text-sm font-semibold text-red-700 dark:text-red-300">Danger Zone</p>
              <p className="mb-4 text-xs text-red-600 dark:text-red-400">These actions are permanent and cannot be undone.</p>
              <div className="flex flex-col gap-2 sm:flex-row">
                <Button onClick={() => setShowLogoutConfirm(true)} variant="danger" className="flex-1">
                  <LogOut size={14} className="mr-2" /> Sign out
                </Button>
                <Button
                  onClick={() => setShowDeleteConfirm(true)}
                  variant="outline"
                  className="flex-1 !text-red-500 !border-red-300 hover:!bg-red-50 dark:!border-red-800 dark:hover:!bg-red-950/30"
                >
                  <Trash2 size={14} className="mr-2" /> Delete Account
                </Button>
              </div>
            </div>
          </div>
        );

      default:
        return null;
    }
  };

  return (
    <div className="min-h-full bg-zinc-50 dark:bg-zinc-950">
      <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
        {/* Page header */}
        <div className="mb-8">
          <p className="text-xs font-semibold uppercase tracking-widest text-violet-600 dark:text-violet-400">Settings</p>
          <h1 className="mt-1.5 text-3xl font-bold tracking-tight text-zinc-900 dark:text-white">Preferences</h1>
          <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">Manage your account, editor, and workspace settings.</p>
        </div>

        <div className="flex flex-col gap-6 lg:flex-row lg:gap-8">
          {/* Sidebar nav */}
          <aside className="shrink-0 lg:w-52">
            <nav className="flex flex-row flex-wrap gap-1 lg:flex-col">
              {NAV.map(({ id, label, icon: Icon }) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setActiveSection(id)}
                  className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-all ${activeSection === id
                      ? "bg-violet-600 text-white shadow-sm shadow-violet-500/30"
                      : "text-zinc-600 hover:bg-white hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-900 dark:hover:text-white"
                    }`}
                >
                  <Icon size={15} />
                  {label}
                  {activeSection === id && <ChevronRight size={12} className="ml-auto hidden lg:block" />}
                </button>
              ))}
            </nav>
          </aside>

          {/* Section panel */}
          <main className="flex-1 min-w-0">
            <AnimatePresence mode="wait">
              <Motion.div
                key={activeSection}
                initial={{ opacity: 0, x: 8 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -8 }}
                transition={{ duration: 0.15 }}
                className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900/60"
              >
                {renderSection()}
              </Motion.div>
            </AnimatePresence>
          </main>
        </div>
      </div>

      <ConfirmModal isOpen={showLogoutConfirm} title="Sign out" description="Are you sure you want to log out?"
        confirmText="Sign out" cancelText="Cancel" isDestructive={false}
        onConfirm={confirmLogout} onCancel={() => setShowLogoutConfirm(false)} />
      <ConfirmModal isOpen={showDeleteConfirm} title="Delete Account"
        description="This permanently deletes your account and all data. This cannot be undone."
        confirmText="Delete Account" cancelText="Cancel" isDestructive
        onConfirm={confirmDeleteAccount}
        onCancel={() => setShowDeleteConfirm(false)} />
    </div>
  );
}
