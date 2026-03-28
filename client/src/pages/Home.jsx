import { startTransition, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion as Motion, AnimatePresence } from "framer-motion";
import {
  ArrowRight,
  FolderGit2,
  Link2,
  MoreVertical,
  Plus,
  Trash2,
  Users
} from "lucide-react";
import toast from "react-hot-toast";

import { Button } from "../components/ui/Button";
import { Input } from "../components/ui/Input";
import ConfirmModal from "../components/ConfirmModal";
import { useAuth } from "../hooks/useAuth";
import { API_ENDPOINTS } from "../config/security";
import { sanitizeInput, secureFetch, validateRoomId } from "../utils/security";
import { getDefaultTerminalShell, getTerminalShellOptions } from "../utils/terminal";

const SkeletonCard = () => (
  <div className="rounded-2xl border border-zinc-200 bg-white p-5 animate-pulse dark:border-zinc-800 dark:bg-zinc-900">
    <div className="mb-3 flex items-center justify-between gap-3">
      <div className="h-5 w-1/2 rounded-lg bg-zinc-200 dark:bg-zinc-800" />
      <div className="h-7 w-16 rounded-lg bg-zinc-100 dark:bg-zinc-800" />
    </div>
    <div className="mb-4 h-4 w-1/3 rounded-lg bg-zinc-100 dark:bg-zinc-800" />
    <div className="flex gap-2">
      <div className="h-6 w-16 rounded-full bg-zinc-100 dark:bg-zinc-800" />
      <div className="h-6 w-20 rounded-full bg-zinc-100 dark:bg-zinc-800" />
    </div>
  </div>
);

function parseRoomInvite(rawValue) {
  const trimmedValue = rawValue.trim();

  if (!trimmedValue) {
    return { roomId: "", inviteToken: null };
  }

  if (/^https?:\/\//i.test(trimmedValue)) {
    try {
      const url = new URL(trimmedValue);
      const segments = url.pathname.split("/").filter(Boolean);
      return {
        roomId: (segments.at(-1) || "").toUpperCase(),
        inviteToken: url.searchParams.get("invite")?.trim() || null,
      };
    } catch {
      return { roomId: trimmedValue.toUpperCase(), inviteToken: null };
    }
  }

  return { roomId: trimmedValue.toUpperCase(), inviteToken: null };
}

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.1 }
  }
};

const itemVariants = {
  hidden: { opacity: 0, y: 15 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.4, ease: "easeOut" } }
};

export default function Home() {
  const navigate = useNavigate();
  const { user, token } = useAuth();
  const terminalShellOptions = useMemo(() => getTerminalShellOptions(), []);
  const defaultTerminalShell = useMemo(() => getDefaultTerminalShell(), []);
  const [joinRoomValue, setJoinRoomValue] = useState("");
  const [joiningRoom, setJoiningRoom] = useState(false);
  const [creatingRoom, setCreatingRoom] = useState(false);
  const [rooms, setRooms] = useState([]);
  const [collaborators, setCollaborators] = useState([]);
  const [roomTemplates, setRoomTemplates] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [roomName, setRoomName] = useState("");
  const [roomDescription, setRoomDescription] = useState("");
  const [selectedTemplateId, setSelectedTemplateId] = useState("blank");
  const [selectedShell, setSelectedShell] = useState(defaultTerminalShell);
  const [dsaLanguage, setDsaLanguage] = useState("python");
  const [roomToDelete, setRoomToDelete] = useState(null);
  const [openMenuId, setOpenMenuId] = useState(null);

  const selectedTemplate = useMemo(
    () => roomTemplates.find((t) => t.id === selectedTemplateId) || null,
    [roomTemplates, selectedTemplateId]
  );
  const selectedTemplateLanguages = useMemo(
    () => selectedTemplate?.supportedLanguages || [],
    [selectedTemplate]
  );

  useEffect(() => {
    if (selectedTemplateId !== "dsa-practice") {
      return;
    }

    const supportedLanguageIds = new Set(selectedTemplateLanguages.map((language) => language.id));
    const preferredLanguage = selectedTemplate?.defaultLanguage || selectedTemplateLanguages[0]?.id || "python";

    if (!supportedLanguageIds.has(dsaLanguage)) {
      setDsaLanguage(preferredLanguage);
    }
  }, [dsaLanguage, selectedTemplate, selectedTemplateId, selectedTemplateLanguages]);

  useEffect(() => {
    if (!token) {
      setIsLoading(false);
      return;
    }

    let isMounted = true;

    const fetchDashboard = async () => {
      setIsLoading(true);

      try {
        const [roomsResult, collaboratorsResult, templateResult] = await Promise.allSettled([
          secureFetch(API_ENDPOINTS.GET_ROOMS, {}, token),
          secureFetch(API_ENDPOINTS.GET_COLLABORATORS, {}, token),
          secureFetch(API_ENDPOINTS.GET_ROOM_TEMPLATES, {}, token),
        ]);

        if (!isMounted) {
          return;
        }

        startTransition(() => {
          setRooms(roomsResult.status === "fulfilled" ? roomsResult.value || [] : []);
          setCollaborators(
            collaboratorsResult.status === "fulfilled" ? collaboratorsResult.value || [] : []
          );
          setRoomTemplates(templateResult.status === "fulfilled" ? templateResult.value || [] : []);
        });
      } catch (error) {
        console.error("Error fetching dashboard data:", error);

        if (isMounted) {
          toast.error("Could not load dashboard data");
        }
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    };

    fetchDashboard();

    return () => {
      isMounted = false;
    };
  }, [token]);

  // Close room action menus when clicking outside
  useEffect(() => {
    const handler = () => setOpenMenuId(null);
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const handleJoinById = async (roomId, inviteToken = null) => {
    if (!roomId) {
      toast.error("Enter a room ID or invite link");
      return;
    }

    if (!validateRoomId(roomId)) {
      toast.error("Invalid room ID format");
      return;
    }

    setJoiningRoom(true);

    try {
      await secureFetch(
        API_ENDPOINTS.JOIN_ROOM,
        {
          method: "POST",
          body: JSON.stringify({ roomId, inviteToken }),
        },
        token
      );

      navigate(`/room/${roomId}`);
    } catch (error) {
      toast.error(error.message || "Could not join room");
    } finally {
      setJoiningRoom(false);
    }
  };

  const handleCreateRoom = async (event) => {
    event.preventDefault();
    setCreatingRoom(true);

    try {
      const room = await secureFetch(
        API_ENDPOINTS.CREATE_ROOM,
        {
          method: "POST",
          body: JSON.stringify({
            name: sanitizeInput(roomName) || null,
            description: sanitizeInput(roomDescription) || null,
            templateId: selectedTemplateId,
            terminalShell: selectedShell,
            dsaLanguage: selectedTemplateId === "dsa-practice" ? dsaLanguage : undefined,
          }),
        },
        token
      );

      setCreateModalOpen(false);
      setRoomName("");
      setRoomDescription("");
      setSelectedTemplateId("blank");
      setSelectedShell(defaultTerminalShell);
      setDsaLanguage("python");
      toast.success("Room created");
      navigate(`/room/${room.id}`);
    } catch (error) {
      toast.error(error.message || "Could not create room");
    } finally {
      setCreatingRoom(false);
    }
  };

  const openCreateModal = () => {
    setRoomName("");
    setRoomDescription("");
    setSelectedTemplateId("blank");
    setSelectedShell(defaultTerminalShell);
    setDsaLanguage("python");
    setCreateModalOpen(true);
  };

  const handleDeleteRoom = (room) => {
    setRoomToDelete(room);
  };

  const confirmDeleteRoom = async () => {
    if (!roomToDelete) return;

    try {
      await secureFetch(
        API_ENDPOINTS.DELETE_ROOM(roomToDelete.id),
        { method: "DELETE" },
        token
      );

      setRooms((currentRooms) => currentRooms.filter((currentRoom) => currentRoom.id !== roomToDelete.id));
      toast.success("Room deleted");
    } catch (error) {
      toast.error(error.message || "Could not delete room");
    } finally {
      setRoomToDelete(null);
    }
  };

  const handleUpdateShell = async (room, shell) => {
    try {
      await secureFetch(
        API_ENDPOINTS.UPDATE_ROOM_SETTINGS(room.id),
        { method: "PUT", body: JSON.stringify({ terminalShell: shell }) },
        token
      );
      setRooms((currentRooms) => currentRooms.map((r) => r.id === room.id ? { ...r, terminalShell: shell } : r));
      toast.success("Terminal shell updated");
    } catch (error) {
      toast.error(error.message || "Could not update terminal shell");
    }
  };

  return (
    <div className="relative min-h-screen bg-gradient-to-b from-zinc-50 to-white text-black dark:from-zinc-950 dark:to-zinc-950/90 dark:text-white">
      <Motion.div
        variants={containerVariants}
        initial="hidden"
        animate="visible"
        className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8"
      >
        <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <Motion.div variants={itemVariants}>
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              Welcome back, {user?.username || "developer"}.
            </p>
            <h1 className="mt-1 text-3xl font-semibold tracking-tight sm:text-4xl">
              Build room-based workspaces
            </h1>
            <p className="mt-3 max-w-3xl text-sm text-zinc-600 dark:text-zinc-400 sm:text-base">
              Start with a blank room or choose a starter template, invite collaborators by link,
              and keep each room&apos;s files and members separate.
            </p>
          </Motion.div>

          <Motion.div variants={itemVariants} className="grid grid-cols-2 gap-3">
            <SummaryCard label="Your Rooms" value={rooms.length} icon={FolderGit2} />
            <SummaryCard label="Collaborators" value={collaborators.length} icon={Users} />
          </Motion.div>
        </div>

        <div className="mt-10 grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
          <Motion.button
            variants={itemVariants}
            whileHover={{ scale: 1.01, y: -2 }}
            whileTap={{ scale: 0.99 }}
            onClick={openCreateModal}
            className="group rounded-2xl border border-zinc-200 bg-white/70 p-6 text-left transition-all hover:border-brand-500 hover:shadow-lg dark:border-zinc-800 dark:bg-zinc-900/50 dark:hover:border-brand-500 backdrop-blur-md"
          >
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-sm text-zinc-500 dark:text-zinc-400">Create room</p>
                <h2 className="mt-1 text-2xl font-semibold">Blank workspace or starter template</h2>
                <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
                  Name the room, pick a template, and jump straight into the editor.
                </p>
              </div>
              <div className="rounded-xl bg-brand-100 p-3 text-brand-700 transition-transform group-hover:scale-110 dark:bg-brand-900/40 dark:text-brand-300">
                <Plus size={22} />
              </div>
            </div>
          </Motion.button>

          <Motion.form
            variants={itemVariants}
            onSubmit={(event) => {
              event.preventDefault();
              const { roomId, inviteToken } = parseRoomInvite(joinRoomValue);
              handleJoinById(roomId, inviteToken);
            }}
            className="rounded-2xl border border-zinc-200 bg-white/70 p-6 transition-all hover:border-brand-500 hover:shadow-lg dark:border-zinc-800 dark:bg-zinc-900/50 dark:hover:border-brand-500 backdrop-blur-md"
          >
            <p className="text-sm text-zinc-500 dark:text-zinc-400">Join room</p>
            <h2 className="mt-1 text-2xl font-semibold">Paste a room ID or invite link</h2>
            <div className="mt-4 flex flex-col gap-3">
              <Input
                placeholder="ABC123 or https://.../room/ABC123"
                value={joinRoomValue}
                onChange={(event) => setJoinRoomValue(event.target.value)}
                icon={Link2}
                className="h-12"
              />
              <Button
                type="submit"
                isLoading={joiningRoom}
                size="lg"
              >
                {!joiningRoom && <Link2 size={18} className="mr-2" />}
                Join room
              </Button>
            </div>
          </Motion.form>
        </div>

        <section className="mt-10">
          <Motion.div variants={itemVariants} className="mb-4 flex items-center justify-between gap-3">
            <h2 className="text-xl font-bold tracking-tight text-zinc-900 dark:text-white">Your rooms</h2>
            <span className="text-sm text-zinc-500 dark:text-zinc-400">{rooms.length} total</span>
          </Motion.div>

          {isLoading ? (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {[1, 2, 3].map((item) => (
                <SkeletonCard key={item} />
              ))}
            </div>
          ) : rooms.length > 0 ? (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              <AnimatePresence mode="popLayout">
                {rooms.map((room) => (
                  <Motion.div
                    key={room.id}
                    layout // helps smoothly reflow grid after deletion
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.95, transition: { duration: 0.2 } }}
                    whileHover={{ y: -4 }}
                    className="group/card relative overflow-hidden rounded-2xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900 transition-all hover:border-violet-200 dark:hover:border-violet-900/50 hover:shadow-lg hover:shadow-violet-500/5"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <button
                        onClick={() => navigate(`/room/${room.id}`)}
                        className="min-w-0 flex-1 text-left"
                      >
                        <h3 className="truncate text-base font-semibold text-zinc-900 dark:text-white transition-colors">{room.name}</h3>
                        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
                          {room.templateName || "Blank Workspace"}
                        </p>
                      </button>

                      {room.ownerId === user?.id && (
                        <div className="relative">
                          {/* Trigger — stopPropagation on BOTH mousedown AND click */}
                          <button
                            onMouseDown={(e) => e.stopPropagation()}
                            onClick={(e) => {
                              e.stopPropagation();
                              setOpenMenuId(openMenuId === room.id ? null : room.id);
                            }}
                            className={`rounded-lg p-1.5 transition-colors ${openMenuId === room.id
                              ? "bg-violet-100 text-violet-600 dark:bg-violet-900/30 dark:text-violet-400"
                              : "text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
                              }`}
                            title="Workspace settings"
                          >
                            <MoreVertical size={16} />
                          </button>

                          {openMenuId === room.id && (
                            <div
                              onMouseDown={(e) => e.stopPropagation()}
                              className="absolute right-0 top-9 z-30 w-56 overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-2xl shadow-black/10 dark:border-zinc-700/80 dark:bg-zinc-900"
                            >
                              {/* Room info header */}
                              <div className="border-b border-zinc-100 px-4 py-3 dark:border-zinc-800">
                                <p className="truncate text-xs font-semibold text-zinc-800 dark:text-white">{room.name}</p>
                                <p className="mt-0.5 font-mono text-[10px] text-zinc-400">{room.id}</p>
                              </div>

                              {/* Actions */}
                              <div className="py-1">
                                <button
                                  onClick={() => { navigate(`/room/${room.id}`); setOpenMenuId(null); }}
                                  className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm text-zinc-700 transition-colors hover:bg-zinc-50 dark:text-zinc-200 dark:hover:bg-zinc-800/60"
                                >
                                  <ArrowRight size={14} className="text-zinc-400" />
                                  Open workspace
                                </button>

                                <button
                                  onClick={() => {
                                    const inviteQuery = room.inviteToken
                                      ? `?invite=${encodeURIComponent(room.inviteToken)}`
                                      : "";
                                    const url = `${window.location.origin}/room/${room.id}${inviteQuery}`;
                                    navigator.clipboard.writeText(url);
                                    toast.success("Invite link copied!");
                                    setOpenMenuId(null);
                                  }}
                                  className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm text-zinc-700 transition-colors hover:bg-zinc-50 dark:text-zinc-200 dark:hover:bg-zinc-800/60"
                                >
                                  <Link2 size={14} className="text-zinc-400" />
                                  Copy invite link
                                </button>
                              </div>

                              {/* Terminal shell */}
                              <div className="border-t border-zinc-100 px-3 py-2.5 dark:border-zinc-800">
                                <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
                                  Terminal shell
                                </p>
                                <div className="grid grid-cols-3 gap-1">
                                  {terminalShellOptions.map((shell) => {
                                    const isActive = (room.terminalShell || "bash") === shell.id;
                                    return (
                                      <button
                                        key={shell.id}
                                        onClick={() => { handleUpdateShell(room, shell.id); setOpenMenuId(null); }}
                                        className={`rounded-lg py-1.5 text-[11px] font-bold tracking-wide transition-all ${isActive
                                          ? "bg-violet-600 text-white shadow-sm shadow-violet-500/30"
                                          : "bg-zinc-100 text-zinc-500 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-700"
                                          }`}
                                        title={shell.label}
                                      >
                                        {shell.shortLabel}
                                      </button>
                                    );
                                  })}
                                </div>
                              </div>

                              {/* Collaborators info */}
                              <div className="flex items-center gap-2 border-t border-zinc-100 px-4 py-2.5 dark:border-zinc-800">
                                <Users size={13} className="text-zinc-400" />
                                <span className="text-xs text-zinc-500 dark:text-zinc-400">
                                  {room.participantCount || 0} collaborator{room.participantCount !== 1 ? "s" : ""}
                                </span>
                                <span className="ml-auto text-xs text-zinc-400 dark:text-zinc-500">
                                  {room.fileCount || 0} files
                                </span>
                              </div>

                              {/* Delete */}
                              <div className="border-t border-zinc-100 py-1 dark:border-zinc-800">
                                <button
                                  onClick={() => { handleDeleteRoom(room); setOpenMenuId(null); }}
                                  className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm text-red-600 transition-colors hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-900/20"
                                >
                                  <Trash2 size={14} />
                                  Delete workspace
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>

                    <button
                      onClick={() => navigate(`/room/${room.id}`)}
                      className="mt-4 block w-full text-left group"
                    >
                      <div className="flex flex-wrap gap-2 text-xs text-zinc-500 dark:text-zinc-400">
                        <span className="rounded-full bg-zinc-100 px-2.5 py-1 dark:bg-zinc-800">
                          {room.fileCount || 0} files
                        </span>
                        <span className="rounded-full bg-zinc-100 px-2.5 py-1 dark:bg-zinc-800">
                          {room.participantCount || 0} collaborators
                        </span>
                        <span className="truncate max-w-[120px] rounded-full bg-zinc-100 px-2.5 py-1 dark:bg-zinc-800">
                          {room.id}
                        </span>
                      </div>
                      <div className="mt-5 flex items-center justify-between border-t border-zinc-100 pt-3 text-sm font-medium text-zinc-400 dark:border-zinc-800 dark:text-zinc-500 group-hover/card:text-violet-600 dark:group-hover/card:text-violet-400 transition-colors">
                        <span>Open room</span>
                        <ArrowRight size={14} className="transform group-hover/card:translate-x-1 transition-transform" />
                      </div>
                    </button>
                  </Motion.div>
                ))}
              </AnimatePresence>
            </div>
          ) : (
            <Motion.div variants={itemVariants} className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-zinc-300 p-12 text-center dark:border-zinc-700">
              <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-violet-100 text-violet-600 dark:bg-violet-900/20 dark:text-violet-400">
                <FolderGit2 size={24} />
              </div>
              <p className="text-base font-semibold text-zinc-700 dark:text-zinc-300">No rooms yet</p>
              <p className="mt-1.5 max-w-xs text-sm text-zinc-500 dark:text-zinc-400">
                Create your first workspace and start coding instantly with a template.
              </p>
              <button
                onClick={openCreateModal}
                className="mt-5 inline-flex items-center gap-2 rounded-xl bg-violet-600 px-4 py-2 text-sm font-semibold text-white shadow-sm shadow-violet-500/20 hover:bg-violet-500 transition-colors"
              >
                <Plus size={15} /> Create a room
              </button>
            </Motion.div>
          )}
        </section>
      </Motion.div>

      <AnimatePresence>
        {createModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/50 p-4 backdrop-blur-sm">
            <Motion.form
              initial={{ opacity: 0, y: 12, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 12, scale: 0.95, transition: { duration: 0.15 } }}
              transition={{ duration: 0.2, ease: "easeOut" }}
              onSubmit={handleCreateRoom}
              className="max-h-[90vh] w-full max-w-4xl overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-2xl dark:border-zinc-800 dark:bg-zinc-900"
            >
              <div className="border-b border-zinc-200 px-6 py-4 dark:border-zinc-800">
                <p className="text-sm font-medium text-zinc-500 dark:text-zinc-400">Create a room</p>
                <h2 className="mt-1 text-2xl font-semibold">Choose how the workspace should start</h2>
              </div>

              <div className="grid gap-6 p-6 lg:grid-cols-[1fr_1.4fr]">
                <div className="space-y-4">
                  <div>
                    <label className="mb-2 block text-sm font-medium">Room name</label>
                    <Input
                      required
                      value={roomName}
                      onChange={(event) => setRoomName(event.target.value)}
                      placeholder="Example: DSA Pairing Session"
                    />
                  </div>

                  <div>
                    <label className="mb-2 block text-sm font-medium">Description</label>
                    <textarea
                      value={roomDescription}
                      onChange={(event) => setRoomDescription(event.target.value)}
                      placeholder="Optional room description"
                      rows={4}
                      className="w-full rounded-lg border border-zinc-200 bg-white px-4 py-3 text-sm outline-none transition focus:border-zinc-400 dark:border-zinc-700 dark:bg-zinc-950 resize-none"
                    />
                  </div>

                  <div>
                    <label className="mb-2 block text-sm font-medium">Terminal Shell</label>
                    <p className="mb-3 text-xs text-zinc-500 dark:text-zinc-400">
                      {terminalShellOptions.find((shell) => shell.id === selectedShell)?.description}
                    </p>
                    <div className="grid grid-cols-3 gap-2">
                      {terminalShellOptions.map((shell) => (
                        <button
                          key={shell.id}
                          type="button"
                          onClick={() => setSelectedShell(shell.id)}
                          className={`rounded-lg border px-3 py-2 text-center text-sm font-medium transition-colors ${selectedShell === shell.id
                            ? "border-zinc-900 bg-zinc-900 text-white dark:border-white dark:bg-white dark:text-zinc-950 shadow-sm"
                            : "border-zinc-200 bg-white text-zinc-600 hover:border-zinc-300 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-400 dark:hover:border-zinc-700"
                            }`}
                        >
                          {shell.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-950">
                    <p className="text-sm font-medium">{selectedTemplate?.name || "Blank Workspace"}</p>
                    <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
                      {selectedTemplate?.description || "Start from an empty workspace."}
                    </p>
                  </div>
                </div>

                <div>
                  <p className="mb-3 text-sm font-medium">Starter templates</p>
                  <div className="grid max-h-[38vh] gap-2.5 overflow-auto pr-1 md:grid-cols-2">
                    {roomTemplates.map((template) => (
                      <Motion.button
                        whileHover={{ scale: 1.02 }}
                        whileTap={{ scale: 0.98 }}
                        key={template.id}
                        type="button"
                        onClick={() => setSelectedTemplateId(template.id)}
                        className={`rounded-xl border p-4 text-left transition-colors ${selectedTemplateId === template.id
                          ? "border-violet-600 bg-violet-50 dark:border-violet-400 dark:bg-violet-900/10"
                          : "border-zinc-200 bg-white hover:border-zinc-300 dark:border-zinc-800 dark:bg-zinc-950 dark:hover:border-zinc-700"
                          }`}
                      >
                        <div className="flex items-center justify-between gap-3">
                          <p className={`font-medium text-sm ${selectedTemplateId === template.id ? "text-violet-700 dark:text-violet-300" : ""}`}>{template.name}</p>
                          <span className={`flex-shrink-0 rounded-full px-2 py-0.5 text-[9px] font-semibold tracking-wider uppercase ${selectedTemplateId === template.id
                            ? "bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300"
                            : "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400"
                            }`}>
                            {template.category}
                          </span>
                        </div>
                        <p className="mt-1.5 text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">
                          {template.description}
                        </p>
                      </Motion.button>
                    ))}
                  </div>

                  {/* DSA Language Picker */}
                  {selectedTemplateId === "dsa-practice" && (
                    <div className="mt-3 rounded-xl border border-violet-200 bg-violet-50 p-4 dark:border-violet-900/40 dark:bg-violet-900/10">
                      <p className="mb-2.5 text-xs font-semibold uppercase tracking-wider text-violet-700 dark:text-violet-300">
                        Starter Language
                      </p>
                      <div className="flex flex-wrap gap-2">
                        {selectedTemplateLanguages.map((lang) => (
                          <button
                            key={lang.id}
                            type="button"
                            onClick={() => setDsaLanguage(lang.id)}
                            className={`rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors ${dsaLanguage === lang.id
                              ? "border-violet-600 bg-violet-600 text-white dark:border-violet-400 dark:bg-violet-400 dark:text-zinc-900"
                              : "border-zinc-200 bg-white text-zinc-600 hover:border-violet-300 hover:text-violet-700 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-400"
                              }`}
                          >
                            {lang.label}
                          </button>
                        ))}
                      </div>
                      <p className="mt-2 text-[11px] text-zinc-500 dark:text-zinc-400">
                        A <strong>{selectedTemplateLanguages.find((language) => language.id === dsaLanguage)?.label || "Python"}</strong> starter solution will be added to your workspace.
                      </p>
                    </div>
                  )}
                </div>
              </div>

              <div className="flex items-center justify-end gap-3 border-t border-zinc-200 px-6 py-4 dark:border-zinc-800">
                <Button
                  type="button"
                  onClick={() => {
                    setCreateModalOpen(false);
                    setSelectedShell(defaultTerminalShell);
                  }}
                  variant="ghost"
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={!roomName.trim()}
                  isLoading={creatingRoom}
                >
                  Create room
                </Button>
              </div>
            </Motion.form>
          </div>
        )}
      </AnimatePresence>

      <ConfirmModal
        isOpen={!!roomToDelete}
        title={`Delete "${roomToDelete?.name}"?`}
        description="This will permanently remove the room, its files, and collaborator access."
        confirmText="Delete"
        cancelText="Cancel"
        isDestructive={true}
        onConfirm={confirmDeleteRoom}
        onCancel={() => setRoomToDelete(null)}
      />
    </div>
  );
}

function SummaryCard({ label, value, icon }) {
  const IconComponent = icon;

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex items-center gap-3">
        <div className="rounded-lg bg-zinc-100 p-2 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200">
          <IconComponent size={16} />
        </div>
        <div>
          <p className="text-xs font-medium uppercase tracking-wider text-zinc-500 dark:text-zinc-400">{label}</p>
          <p className="text-xl font-semibold">{value}</p>
        </div>
      </div>
    </div>
  );
}
