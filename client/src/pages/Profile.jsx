import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion as Motion } from "framer-motion";
import {
  ArrowRight, Calendar, FolderGit2, Github, Mail, PlayCircle, Settings, Users,
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
  hidden: { opacity: 0, y: 8 },
  visible: { opacity: 1, y: 0, transition: SPRING },
};

function formatDateLabel(value) {
  if (!value) return "recently";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "recently";
  return parsed.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function RolePill({ role }) {
  const isOwner = role === "owner";

  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${
        isOwner ? "bg-warning-500/15 text-warning-600" : "bg-hovered text-fg-muted"
      }`}
    >
      {role || "viewer"}
    </span>
  );
}

function StatTile({ label, value, icon: Icon, isLoading }) {
  return (
    <div className="rounded-lg border border-edge-subtle bg-panel p-4">
      <div className="flex items-center gap-2 text-fg-subtle">
        <Icon size={14} />
        <p className="truncate text-[11px] font-semibold uppercase tracking-wider">{label}</p>
      </div>
      <p className="mt-2 text-2xl font-semibold leading-none text-fg">
        {isLoading ? "—" : value}
      </p>
    </div>
  );
}

function Panel({ title, action, children }) {
  return (
    <section className="rounded-lg border border-edge-subtle bg-panel">
      <div className="flex items-center justify-between gap-3 border-b border-edge-subtle px-4 py-3">
        <h2 className="text-[11px] font-semibold uppercase tracking-wider text-fg-subtle">
          {title}
        </h2>
        {action}
      </div>
      <div className="p-4">{children}</div>
    </section>
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

  const ownedCount = useMemo(
    () => rooms.filter((room) => room.ownerId === user?.id).length,
    [rooms, user?.id],
  );
  const runnableCount = useMemo(() => rooms.filter((room) => room.canRun).length, [rooms]);
  const recentRooms = useMemo(
    () => [...rooms].sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0)).slice(0, 6),
    [rooms],
  );

  const memberSince = user?.createdAt
    ? new Date(user.createdAt).toLocaleDateString("en-US", { year: "numeric", month: "long" })
    : null;

  return (
    <div className="min-h-screen bg-canvas text-fg">
      <Motion.div
        variants={containerVariants}
        initial="hidden"
        animate="visible"
        className="mx-auto max-w-6xl px-4 py-10 sm:px-6 lg:px-8"
      >
        {/* Identity */}
        <Motion.header
          variants={itemVariants}
          className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between"
        >
          <div className="flex min-w-0 items-center gap-4">
            <UserAvatar username={user?.username} hue={user?.avatarHue} size="lg" />
            <div className="min-w-0">
              <h1 className="truncate text-2xl font-semibold tracking-tight text-fg">
                {user?.username}
              </h1>
              <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-fg-muted">
                <span className="inline-flex items-center gap-1.5">
                  <Mail size={13} />
                  {user?.email}
                </span>
                {memberSince ? (
                  <span className="inline-flex items-center gap-1.5">
                    <Calendar size={13} />
                    Joined {memberSince}
                  </span>
                ) : null}
              </div>
            </div>
          </div>

          <div className="flex shrink-0 flex-wrap gap-2">
            <button
              onClick={() => navigate("/home")}
              className="inline-flex h-9 items-center gap-2 rounded-md bg-accent px-4 text-sm font-semibold text-fg-accent transition-colors hover:bg-accent-hover"
            >
              Open dashboard
            </button>
            <button
              onClick={() => navigate("/settings")}
              className="inline-flex h-9 items-center gap-2 rounded-md border border-edge px-4 text-sm font-semibold text-fg transition-colors hover:border-edge-strong hover:bg-hovered"
            >
              <Settings size={15} />
              Settings
            </button>
          </div>
        </Motion.header>

        {/* One row of numbers, each measuring something different. */}
        <Motion.div variants={itemVariants} className="mt-8 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatTile label="Workspaces" value={rooms.length} icon={FolderGit2} isLoading={isLoading} />
          <StatTile label="You own" value={ownedCount} icon={FolderGit2} isLoading={isLoading} />
          <StatTile label="Can run code" value={runnableCount} icon={PlayCircle} isLoading={isLoading} />
          <StatTile label="Collaborators" value={collaborators.length} icon={Users} isLoading={isLoading} />
        </Motion.div>

        <div className="mt-6 grid items-start gap-6 lg:grid-cols-[1.5fr_1fr]">
          <Motion.div variants={itemVariants}>
            <Panel
              title="Recent workspaces"
              action={
                <button
                  onClick={() => navigate("/home")}
                  className="text-xs font-semibold text-accent transition-colors hover:underline"
                >
                  View all
                </button>
              }
            >
              {recentRooms.length === 0 ? (
                <div className="rounded-md border border-dashed border-edge px-6 py-10 text-center">
                  <FolderGit2 size={22} className="mx-auto text-fg-subtle" />
                  <p className="mt-3 text-sm font-medium text-fg">No workspaces yet</p>
                  <p className="mt-1 text-xs text-fg-muted">Create a room to start collaborating.</p>
                </div>
              ) : (
                <div className="space-y-1">
                  {recentRooms.map((room) => (
                    <button
                      key={room.id}
                      onClick={() => navigate(`/room/${room.id}`)}
                      className="group/row flex w-full items-center gap-3 rounded-md px-2 py-2.5 text-left transition-colors hover:bg-hovered"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-2">
                          <span className="truncate text-sm font-medium text-fg">{room.name}</span>
                          <RolePill role={room.accessRole} />
                        </span>
                        <span className="mt-0.5 block truncate text-xs text-fg-muted">
                          {room.templateName || "Blank workspace"}
                          {" · "}{room.fileCount || 0} files
                          {" · "}updated {formatDateLabel(room.updatedAt)}
                        </span>
                      </span>
                      <ArrowRight
                        size={14}
                        className="shrink-0 text-fg-subtle opacity-0 transition-all group-hover/row:translate-x-0.5 group-hover/row:text-accent group-hover/row:opacity-100"
                      />
                    </button>
                  ))}
                </div>
              )}
            </Panel>
          </Motion.div>

          <div className="space-y-6">
            <Motion.div variants={itemVariants}>
              <Panel title="GitHub">
                {githubProfile ? (
                  <div className="flex items-center gap-3">
                    <img
                      src={githubProfile.avatarUrl}
                      alt=""
                      className="h-10 w-10 rounded-md object-cover"
                    />
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-fg">
                        {githubProfile.name || githubProfile.login}
                      </p>
                      <p className="truncate text-xs text-fg-muted">@{githubProfile.login}</p>
                    </div>
                  </div>
                ) : (
                  <div>
                    <p className="text-sm text-fg-muted">Not connected.</p>
                    <button
                      onClick={() => navigate("/settings")}
                      className="mt-3 inline-flex items-center gap-2 rounded-md border border-edge px-3 py-1.5 text-xs font-semibold text-fg transition-colors hover:border-edge-strong hover:bg-hovered"
                    >
                      <Github size={14} />
                      Connect GitHub
                    </button>
                  </div>
                )}
              </Panel>
            </Motion.div>

            <Motion.div variants={itemVariants}>
              <Panel title="Collaborators">
                {collaborators.length === 0 ? (
                  <p className="text-sm text-fg-muted">
                    No collaborators yet. Share a workspace to add people.
                  </p>
                ) : (
                  <div className="space-y-1">
                    {collaborators.slice(0, 6).map((collaborator, index) => (
                      <div
                        key={collaborator.id || index}
                        className="flex items-center gap-3 rounded-md px-1 py-1.5"
                      >
                        <UserAvatar
                          username={collaborator.username}
                          hue={collaborator.avatarHue}
                          size="base"
                        />
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-fg">
                            {collaborator.username}
                          </p>
                          <p className="truncate text-xs text-fg-muted">
                            {collaborator.email || "Workspace collaborator"}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </Panel>
            </Motion.div>
          </div>
        </div>
      </Motion.div>
    </div>
  );
}
