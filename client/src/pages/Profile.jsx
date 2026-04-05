import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion as Motion } from "framer-motion";
import {
  ArrowRight, Calendar, Clock3, Code2, FolderGit2, Github, Mail,
  PlayCircle, Settings, Shield, Sparkles, Users,
} from "lucide-react";

import { useAuth } from "../hooks/useAuth";
import { API_ENDPOINTS } from "../config/security";
import { secureFetch } from "../utils/security";
import UserAvatar from "../components/UserAvatar";

const SPRING = { type: "spring", stiffness: 320, damping: 28 };

const containerVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { staggerChildren: 0.06 } },
};

const itemVariants = {
  hidden: { opacity: 0, y: 16 },
  visible: { opacity: 1, y: 0, transition: SPRING },
};

function formatDateLabel(value) {
  if (!value) return "Recently";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "Recently";
  return parsed.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function RolePill({ role }) {
  const palette = {
    owner: "bg-yellow-50 text-yellow-700 border-yellow-200 dark:bg-yellow-500/10 dark:text-yellow-300 dark:border-yellow-500/20",
    editor: "bg-violet-50 text-violet-700 border-violet-200 dark:bg-violet-500/10 dark:text-violet-300 dark:border-violet-500/20",
    runner: "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-500/10 dark:text-amber-300 dark:border-amber-500/20",
    viewer: "bg-zinc-100 text-zinc-700 border-zinc-200 dark:bg-zinc-700/20 dark:text-zinc-300 dark:border-zinc-700/40",
  };

  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-semibold ${palette[role] || palette.viewer}`}>
      {role || "viewer"}
    </span>
  );
}

export default function Profile() {
  const { user, token } = useAuth();
  const navigate = useNavigate();
  const [rooms, setRooms] = useState([]);
  const [collaborators, setCollaborators] = useState([]);
  const [githubProfile, setGithubProfile] = useState(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let isMounted = true;

    async function loadProfileData() {
      if (!token) {
        if (isMounted) setIsLoading(false);
        return;
      }

      setIsLoading(true);

      const [roomsResult, collaboratorsResult, githubResult] = await Promise.allSettled([
        secureFetch(API_ENDPOINTS.GET_ROOMS, {}, token),
        secureFetch(API_ENDPOINTS.GET_COLLABORATORS, {}, token),
        secureFetch(API_ENDPOINTS.GITHUB_PROFILE, {}, token),
      ]);

      if (!isMounted) return;

      setRooms(roomsResult.status === "fulfilled" ? roomsResult.value || [] : []);
      setCollaborators(collaboratorsResult.status === "fulfilled" ? collaboratorsResult.value || [] : []);
      setGithubProfile(githubResult.status === "fulfilled" ? githubResult.value || null : null);
      setIsLoading(false);
    }

    loadProfileData();

    return () => {
      isMounted = false;
    };
  }, [token]);

  const ownedRooms = useMemo(() => rooms.filter((room) => room.ownerId === user?.id), [rooms, user?.id]);
  const joinedRooms = useMemo(() => rooms.filter((room) => room.ownerId !== user?.id), [rooms, user?.id]);
  const editableRooms = useMemo(() => rooms.filter((room) => room.canEdit).length, [rooms]);
  const runnableRooms = useMemo(() => rooms.filter((room) => room.canRun).length, [rooms]);
  const recentRooms = useMemo(
    () => [...rooms].sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0)).slice(0, 6),
    [rooms],
  );

  const roleSummary = useMemo(() => {
    return rooms.reduce((summary, room) => {
      const role = room.accessRole || "viewer";
      summary[role] = (summary[role] || 0) + 1;
      return summary;
    }, { owner: 0, editor: 0, runner: 0, viewer: 0 });
  }, [rooms]);

  const memberSince = user?.createdAt
    ? new Date(user.createdAt).toLocaleDateString("en-US", { year: "numeric", month: "long" })
    : "New member";

  const stats = [
    { label: "Owned workspaces", value: ownedRooms.length, icon: FolderGit2, accent: "bg-violet-100 text-violet-700 dark:bg-violet-500/10 dark:text-violet-300" },
    { label: "Joined workspaces", value: joinedRooms.length, icon: Users, accent: "bg-sky-100 text-sky-700 dark:bg-sky-500/10 dark:text-sky-300" },
    { label: "Can run code", value: runnableRooms, icon: PlayCircle, accent: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300" },
    { label: "Collaborators", value: collaborators.length, icon: Sparkles, accent: "bg-amber-100 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300" },
  ];

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(124,58,237,0.12),_transparent_32%),linear-gradient(to_bottom,_#fafafa,_#ffffff)] dark:bg-[radial-gradient(circle_at_top_left,_rgba(124,58,237,0.18),_transparent_28%),linear-gradient(to_bottom,_#09090b,_#111827)]">
      <Motion.div
        variants={containerVariants}
        initial="hidden"
        animate="visible"
        className="mx-auto max-w-6xl px-4 py-10 sm:px-6 lg:px-8"
      >
        <Motion.section variants={itemVariants} className="overflow-hidden rounded-[28px] border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
          <div className="h-28 bg-[linear-gradient(135deg,#18181b_0%,#4f46e5_45%,#14b8a6_100%)]" />
          <div className="px-6 pb-6">
            <div className="-mt-12 flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-end">
                <div className="rounded-full ring-4 ring-white dark:ring-zinc-900">
                  <UserAvatar username={user?.username} size="lg" />
                </div>
                <div>
                  <h1 className="text-3xl font-semibold text-zinc-900 dark:text-white">{user?.username}</h1>
                  <div className="mt-2 flex flex-wrap items-center gap-3 text-sm text-zinc-500 dark:text-zinc-400">
                    <span className="inline-flex items-center gap-1.5"><Mail size={14} />{user?.email}</span>
                    <span className="inline-flex items-center gap-1.5"><Calendar size={14} />Member since {memberSince}</span>
                    <span className="inline-flex items-center gap-1.5"><Shield size={14} />Verified account</span>
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap gap-3">
                <button
                  onClick={() => navigate("/home")}
                  className="inline-flex h-11 items-center gap-2 rounded-2xl bg-zinc-900 px-5 text-sm font-semibold text-white transition hover:bg-zinc-800 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200"
                >
                  Open Dashboard
                </button>
                <button
                  onClick={() => navigate("/settings")}
                  className="inline-flex h-11 items-center gap-2 rounded-2xl border border-zinc-200 px-5 text-sm font-semibold text-zinc-700 transition hover:border-violet-300 hover:bg-violet-50 hover:text-violet-700 dark:border-zinc-700 dark:text-zinc-200 dark:hover:border-violet-500 dark:hover:bg-violet-500/10 dark:hover:text-violet-300"
                >
                  <Settings size={16} />
                  Account Settings
                </button>
              </div>
            </div>

            <div className="mt-6 grid gap-4 lg:grid-cols-[1.5fr_1fr]">
              <div className="rounded-3xl border border-zinc-200 bg-zinc-50 p-5 dark:border-zinc-800 dark:bg-zinc-950/70">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-zinc-400">Workspace snapshot</p>
                <div className="mt-4 grid gap-3 sm:grid-cols-3">
                  <div>
                    <p className="text-2xl font-semibold text-zinc-900 dark:text-white">{isLoading ? "-" : rooms.length}</p>
                    <p className="text-sm text-zinc-500 dark:text-zinc-400">Total workspaces</p>
                  </div>
                  <div>
                    <p className="text-2xl font-semibold text-zinc-900 dark:text-white">{isLoading ? "-" : editableRooms}</p>
                    <p className="text-sm text-zinc-500 dark:text-zinc-400">Editable workspaces</p>
                  </div>
                  <div>
                    <p className="text-2xl font-semibold text-zinc-900 dark:text-white">{isLoading ? "-" : runnableRooms}</p>
                    <p className="text-sm text-zinc-500 dark:text-zinc-400">Runnable workspaces</p>
                  </div>
                </div>
              </div>

              <div className="rounded-3xl border border-zinc-200 bg-zinc-50 p-5 dark:border-zinc-800 dark:bg-zinc-950/70">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-zinc-400">Connected account</p>
                {githubProfile ? (
                  <div className="mt-4 flex items-center gap-3">
                    <img src={githubProfile.avatarUrl} alt={githubProfile.login} className="h-12 w-12 rounded-2xl object-cover" />
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-zinc-900 dark:text-white">{githubProfile.name || githubProfile.login}</p>
                      <p className="truncate text-sm text-zinc-500 dark:text-zinc-400">@{githubProfile.login}</p>
                    </div>
                  </div>
                ) : (
                  <div className="mt-4">
                    <p className="text-sm text-zinc-600 dark:text-zinc-300">GitHub is not connected yet.</p>
                    <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">Connect it from Settings to sync repos and import code faster.</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        </Motion.section>

        <Motion.section variants={itemVariants} className="mt-6 grid grid-cols-2 gap-4 xl:grid-cols-4">
          {stats.map(({ label, value, icon: Icon, accent }) => (
            <div key={label} className="rounded-3xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
              <span className={`inline-flex h-11 w-11 items-center justify-center rounded-2xl ${accent}`}>
                <Icon size={18} />
              </span>
              <p className="mt-4 text-3xl font-semibold text-zinc-900 dark:text-white">{isLoading ? "-" : value}</p>
              <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">{label}</p>
            </div>
          ))}
        </Motion.section>

        <div className="mt-6 grid gap-6 xl:grid-cols-[1.4fr_1fr]">
          <Motion.section variants={itemVariants} className="rounded-3xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-zinc-400">Recent workspaces</p>
                <h2 className="mt-1 text-xl font-semibold text-zinc-900 dark:text-white">Jump back into your latest rooms</h2>
              </div>
              <button onClick={() => navigate("/home")} className="text-sm font-semibold text-violet-600 hover:text-violet-700 dark:text-violet-400 dark:hover:text-violet-300">
                View all
              </button>
            </div>

            <div className="mt-5 space-y-3">
              {recentRooms.length === 0 ? (
                <div className="rounded-3xl border border-dashed border-zinc-300 bg-zinc-50 px-6 py-10 text-center dark:border-zinc-700 dark:bg-zinc-950/50">
                  <FolderGit2 size={24} className="mx-auto text-zinc-400" />
                  <p className="mt-3 text-sm font-medium text-zinc-700 dark:text-zinc-200">No workspaces yet</p>
                  <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">Create a room to start collaborating.</p>
                </div>
              ) : (
                recentRooms.map((room) => (
                  <button
                    key={room.id}
                    onClick={() => navigate(`/room/${room.id}`)}
                    className="flex w-full items-center justify-between rounded-2xl border border-zinc-200 bg-zinc-50 px-4 py-4 text-left transition hover:border-violet-300 hover:bg-violet-50 dark:border-zinc-800 dark:bg-zinc-950/60 dark:hover:border-violet-500 dark:hover:bg-violet-500/10"
                  >
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="truncate text-sm font-semibold text-zinc-900 dark:text-white">{room.name}</p>
                        <RolePill role={room.accessRole} />
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-zinc-500 dark:text-zinc-400">
                        <span>{room.templateName || "Blank workspace"}</span>
                        <span>{room.fileCount || 0} files</span>
                        <span>Updated {formatDateLabel(room.updatedAt)}</span>
                      </div>
                    </div>
                    <ArrowRight size={16} className="shrink-0 text-zinc-400" />
                  </button>
                ))
              )}
            </div>
          </Motion.section>

          <div className="space-y-6">
            <Motion.section variants={itemVariants} className="rounded-3xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-zinc-400">Role distribution</p>
              <div className="mt-4 space-y-3">
                {["owner", "editor", "runner", "viewer"].map((role) => (
                  <div key={role} className="flex items-center justify-between rounded-2xl bg-zinc-50 px-4 py-3 dark:bg-zinc-950/60">
                    <div className="flex items-center gap-2">
                      <RolePill role={role} />
                    </div>
                    <span className="text-sm font-semibold text-zinc-900 dark:text-white">{isLoading ? "-" : roleSummary[role]}</span>
                  </div>
                ))}
              </div>
            </Motion.section>

            <Motion.section variants={itemVariants} className="rounded-3xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-zinc-400">Collaborators</p>
                <button onClick={() => navigate("/home")} className="text-sm font-semibold text-violet-600 hover:text-violet-700 dark:text-violet-400 dark:hover:text-violet-300">
                  Open rooms
                </button>
              </div>
              <div className="mt-4 space-y-3">
                {collaborators.length === 0 ? (
                  <p className="text-sm text-zinc-500 dark:text-zinc-400">No collaborators yet.</p>
                ) : (
                  collaborators.slice(0, 6).map((collaborator, index) => (
                    <div key={collaborator.id || index} className="flex items-center gap-3 rounded-2xl bg-zinc-50 px-4 py-3 dark:bg-zinc-950/60">
                      <UserAvatar username={collaborator.username} size="sm" />
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-zinc-900 dark:text-white">{collaborator.username}</p>
                        <p className="truncate text-xs text-zinc-500 dark:text-zinc-400">{collaborator.email || "Workspace collaborator"}</p>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </Motion.section>

            <Motion.section variants={itemVariants} className="rounded-3xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-zinc-400">Quick actions</p>
              <div className="mt-4 grid gap-3">
                {[
                  { label: "Go to dashboard", icon: Code2, path: "/home" },
                  { label: "Open settings", icon: Settings, path: "/settings" },
                  { label: "Review recent work", icon: Clock3, path: "/home" },
                  { label: "Connect GitHub", icon: Github, path: "/settings" },
                ].map(({ label, icon: Icon, path }) => (
                  <button
                    key={label}
                    onClick={() => navigate(path)}
                    className="flex items-center gap-3 rounded-2xl border border-zinc-200 px-4 py-3 text-left transition hover:border-violet-300 hover:bg-violet-50 dark:border-zinc-800 dark:hover:border-violet-500 dark:hover:bg-violet-500/10"
                  >
                    <Icon size={16} className="text-zinc-500 dark:text-zinc-400" />
                    <span className="text-sm font-semibold text-zinc-700 dark:text-zinc-200">{label}</span>
                  </button>
                ))}
              </div>
            </Motion.section>
          </div>
        </div>
      </Motion.div>
    </div>
  );
}
