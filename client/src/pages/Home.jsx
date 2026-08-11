import { startTransition, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion as Motion, AnimatePresence } from "framer-motion";
import {
  ArrowRight,
  Bookmark,
  BookmarkCheck,
  Clock,
  FolderGit2,
  LayoutGrid,
  Link2,
  List,
  MoreVertical,
  Plus,
  Search,
  Settings2,
  Trash2,
  Users,
  X,
} from "lucide-react";
import toast from "react-hot-toast";

import { Button } from "../components/ui/Button";
import { Input } from "../components/ui/Input";
import ConfirmModal from "../components/ConfirmModal";
import RoomSettingsModal from "../components/RoomSettingsModal";
import { useAuth } from "../hooks/useAuth";
import { API_ENDPOINTS } from "../config/security";
import { sanitizeInput, secureFetch, validateRoomId } from "../utils/security";
import { buildRoomInviteLink, parseRoomInvite } from "../utils/room/invite";
import { getDefaultTerminalShell, getTerminalShellOptions } from "../utils/terminal";
import { getBookmarks, getRecentRooms, recordVisit, toggleBookmark } from "../utils/roomUtils";

const SkeletonCard = () => (
  <div className="rounded-lg border border-edge-subtle bg-panel p-5 animate-pulse">
    <div className="mb-3 flex items-center justify-between gap-3">
      <div className="h-5 w-1/2 rounded-md bg-hovered" />
      <div className="h-7 w-16 rounded-md bg-hovered" />
    </div>
    <div className="mb-4 h-4 w-1/3 rounded-md bg-hovered" />
    <div className="flex gap-2">
      <div className="h-6 w-16 rounded-full bg-hovered" />
      <div className="h-6 w-20 rounded-full bg-hovered" />
    </div>
  </div>
);

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.1 }
  }
};

const SPRING = { type: "spring", stiffness: 340, damping: 28 };

const itemVariants = {
  hidden:  { opacity: 0, y: 8, scale: 0.97 },
  visible: { opacity: 1, y: 0,  scale: 1,    transition: { ...SPRING, opacity: { duration: 0.22 } } },
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
  const [roomSearch, setRoomSearch] = useState("");
  const [bookmarks, setBookmarks] = useState(getBookmarks);
  const [recentRooms, setRecentRooms] = useState(getRecentRooms);
  const [roomToDelete, setRoomToDelete] = useState(null);
  const [openMenuId, setOpenMenuId] = useState(null);
  const [settingsRoomId, setSettingsRoomId] = useState(null);
  const [settingsRoom, setSettingsRoom] = useState(null);
  const [isRoomSettingsLoading, setIsRoomSettingsLoading] = useState(false);
  const pendingRequestCountsRef = useRef({});
  const [roomViewMode, setRoomViewMode] = useState(() => {
    if (typeof window === "undefined") {
      return "grid";
    }

    return window.localStorage.getItem("codechatter-home-room-view") === "list" ? "list" : "grid";
  });

  const isRoomSettingsOpen = Boolean(settingsRoomId);
  const isListView = roomViewMode === "list";
  const normalizedRoomSearch = roomSearch.trim().toLowerCase();
  const filteredRooms = useMemo(
    () => rooms.filter((room) => {
      if (roomSearch === "__bookmarked__") {
        return bookmarks.includes(room.id);
      }
      if (!normalizedRoomSearch) {
        return true;
      }
      return (
        room.name?.toLowerCase().includes(normalizedRoomSearch)
        || room.id?.toLowerCase().includes(normalizedRoomSearch)
      );
    }),
    [bookmarks, normalizedRoomSearch, roomSearch, rooms],
  );

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
          const nextRooms = roomsResult.status === "fulfilled" ? roomsResult.value || [] : [];
          pendingRequestCountsRef.current = Object.fromEntries(
            nextRooms.map((room) => [room.id, room.pendingJoinRequestCount || 0]),
          );
          setRooms(nextRooms);
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

  useEffect(() => {
    if (!token) {
      pendingRequestCountsRef.current = {};
      return undefined;
    }

    let isCancelled = false;

    const refreshRoomSummaries = async () => {
      try {
        const nextRooms = await secureFetch(API_ENDPOINTS.GET_ROOMS, {}, token);

        if (isCancelled) {
          return;
        }

        const nextCounts = Object.fromEntries(
          (nextRooms || []).map((room) => [room.id, room.pendingJoinRequestCount || 0]),
        );

        const previousCounts = pendingRequestCountsRef.current;
        const increasedRooms = (nextRooms || []).filter((room) => {
          const previousCount = previousCounts[room.id] || 0;
          return (room.pendingJoinRequestCount || 0) > previousCount;
        });

        if (Object.keys(previousCounts).length > 0 && increasedRooms.length > 0) {
          toast.success(
            increasedRooms.length === 1
              ? `New join request in ${increasedRooms[0].name}.`
              : `${increasedRooms.length} workspaces have new join requests.`,
          );
        }

        pendingRequestCountsRef.current = nextCounts;
        setRooms(nextRooms || []);

        if (settingsRoomId) {
          const matchingRoom = (nextRooms || []).find((room) => room.id === settingsRoomId);
          if (matchingRoom) {
            setSettingsRoom((currentRoom) => ({ ...(currentRoom || {}), ...matchingRoom }));
          }
        }
      } catch {
        // Ignore background refresh errors on the dashboard.
      }
    };

    const intervalId = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        refreshRoomSummaries();
      }
    }, 10000);

    return () => {
      isCancelled = true;
      window.clearInterval(intervalId);
    };
  }, [settingsRoomId, token]);

  // Close room action menus when clicking outside
  useEffect(() => {
    const handler = () => setOpenMenuId(null);
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    window.localStorage.setItem("codechatter-home-room-view", roomViewMode);
  }, [roomViewMode]);

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
      const joinResult = await secureFetch(
        API_ENDPOINTS.JOIN_ROOM,
        {
          method: "POST",
          body: JSON.stringify({ roomId, inviteToken }),
        },
        token
      );

      if (joinResult?.status === "pending_approval") {
        toast.success(joinResult.message || "Join request sent");
        setJoinRoomValue("");
        navigate(
          `/room/${roomId}${inviteToken ? `?invite=${encodeURIComponent(inviteToken)}` : ""}`,
        );
        return;
      }

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
      recordVisit(room.id, room.name);
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

  const closeRoomSettings = () => {
    setSettingsRoomId(null);
    setSettingsRoom(null);
    setIsRoomSettingsLoading(false);
  };

  const handleOpenRoomSettings = async (room) => {
    setOpenMenuId(null);
    setSettingsRoomId(room.id);
    setSettingsRoom(room);
    setIsRoomSettingsLoading(true);

    try {
      const fullRoom = await secureFetch(API_ENDPOINTS.GET_ROOM(room.id), {}, token);
      setSettingsRoom(fullRoom);
    } catch (error) {
      toast.error(error.message || "Could not load workspace settings");
    } finally {
      setIsRoomSettingsLoading(false);
    }
  };

  const handleRoomSettingsUpdate = (updatedRoom) => {
    setSettingsRoom(updatedRoom);
    setRooms((currentRooms) =>
      currentRooms.map((currentRoom) =>
        currentRoom.id === updatedRoom.id ? { ...currentRoom, ...updatedRoom } : currentRoom
      )
    );
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

  return (
    <div className="relative min-h-screen bg-canvas text-fg">
      <Motion.div
        variants={containerVariants}
        initial="hidden"
        animate="visible"
        className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8"
      >
        <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <Motion.div variants={itemVariants}>
            <p className="text-sm text-fg-muted">
              Welcome back, {user?.username || "developer"}.
            </p>
            <h1 className="mt-1 text-3xl font-semibold tracking-tight sm:text-4xl">
              Build room-based workspaces
            </h1>
            <p className="mt-3 max-w-3xl text-sm text-fg-muted sm:text-base">
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
            
            whileTap={{ scale: 0.99 }}
            onClick={openCreateModal}
            className="group rounded-lg border border-edge-subtle bg-panel p-6 text-left transition-colors hover:border-accent"
          >
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-sm text-fg-muted">Create room</p>
                <h2 className="mt-1 text-2xl font-semibold">Blank workspace or starter template</h2>
                <p className="mt-2 text-sm text-fg-muted">
                  Name the room, pick a template, and jump straight into the editor.
                </p>
              </div>
              <div className="rounded-md bg-accent-subtle p-3 text-accent transition-transform group-hover:scale-110">
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
            className="rounded-lg border border-edge-subtle bg-panel p-6 transition-colors hover:border-accent"
          >
            <p className="text-sm text-fg-muted">Join room</p>
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

        {/* Recently Visited */}
        {recentRooms.length > 0 && (
          <Motion.div variants={itemVariants} className="mt-8">
            <div className="mb-3 flex items-center gap-2">
              <Clock size={13} className="text-fg-subtle" />
              <h2 className="text-xs font-semibold uppercase tracking-widest text-fg-subtle">
                Recently visited
              </h2>
            </div>
            <div className="flex gap-2 overflow-x-auto pb-1">
              {recentRooms.map(r => (
                <button
                  key={r.id}
                  onClick={() => { recordVisit(r.id, r.name); setRecentRooms(getRecentRooms()); navigate(`/room/${r.id}`); }}
                  className="flex shrink-0 items-center gap-2 rounded-md border border-edge-subtle bg-panel px-3 py-2 text-left text-sm transition-colors hover:border-accent hover:bg-hovered"
                >
                  <FolderGit2 size={13} className="text-fg-subtle" />
                  <span className="font-medium text-fg">{r.name}</span>
                  <ArrowRight size={12} className="text-fg-subtle" />
                </button>
              ))}
            </div>
          </Motion.div>
        )}

        <section className="mt-10">
          <Motion.div variants={itemVariants} className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <h2 className="text-xl font-bold tracking-tight text-fg">Your rooms</h2>
            <div className="flex flex-wrap items-center gap-2 sm:gap-3">
              {/* Search */}
              <div className="relative">
                <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-subtle" />
                <input
                  value={roomSearch === "__bookmarked__" ? "" : roomSearch}
                  onChange={e => setRoomSearch(e.target.value)}
                  placeholder="Search rooms…"
                  aria-label="Search rooms"
                  className="h-8 w-40 rounded-md border border-edge bg-field pl-8 pr-7 text-xs text-fg placeholder:text-fg-subtle outline-none transition-colors focus:border-accent focus:ring-1 focus:ring-accent sm:w-52"
                />
                {roomSearch && (
                  <button onClick={() => setRoomSearch("")} aria-label="Clear search" className="absolute right-2 top-1/2 -translate-y-1/2 text-fg-subtle hover:text-fg">
                    <X size={12} />
                  </button>
                )}
              </div>
              {bookmarks.length > 0 && (
                <button
                  onClick={() => setRoomSearch(prev => prev === "__bookmarked__" ? "" : "__bookmarked__")}
                  aria-pressed={roomSearch === "__bookmarked__"}
                  className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors ${
                    roomSearch === "__bookmarked__"
                      ? "bg-accent-subtle text-accent"
                      : "text-fg-muted hover:bg-hovered hover:text-fg"
                  }`}
                >
                  <BookmarkCheck size={12} />
                  Bookmarked ({bookmarks.length})
                </button>
              )}
              <span className="text-xs text-fg-muted sm:text-sm">{rooms.length} total</span>
              <div className="inline-flex items-center rounded-md bg-chrome p-1">
                <button
                  type="button"
                  onClick={() => setRoomViewMode("grid")}
                  aria-pressed={!isListView}
                  className={`inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${
                    !isListView
                      ? "bg-canvas text-fg"
                      : "text-fg-muted hover:text-fg"
                  }`}
                  title="Block view"
                >
                  <LayoutGrid size={14} />
                  Blocks
                </button>
                <button
                  type="button"
                  onClick={() => setRoomViewMode("list")}
                  aria-pressed={isListView}
                  className={`inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${
                    isListView
                      ? "bg-canvas text-fg"
                      : "text-fg-muted hover:text-fg"
                  }`}
                  title="List view"
                >
                  <List size={14} />
                  List
                </button>
              </div>
            </div>
          </Motion.div>

          {isLoading ? (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {[1, 2, 3].map((item) => (
                <SkeletonCard key={item} />
              ))}
            </div>
          ) : filteredRooms.length > 0 ? (
            <div className={isListView ? "space-y-3" : "grid gap-4 md:grid-cols-2 xl:grid-cols-3"}>
              <AnimatePresence mode="popLayout">
                {filteredRooms.map((room) => (
                  <Motion.div
                    key={room.id}
                    layout // helps smoothly reflow grid after deletion
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.95, transition: { duration: 0.2 } }}
                    whileHover={{ y: -5, scale: 1.01, transition: SPRING }}
                    whileTap={{ scale: 0.99 }}
                    className={`group/card relative rounded-lg border border-edge-subtle bg-panel transition-colors hover:border-accent ${
                      isListView ? "p-4" : "p-5"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <button
                        onClick={() => { recordVisit(room.id, room.name); setRecentRooms(getRecentRooms()); navigate(`/room/${room.id}`); }}
                        className="min-w-0 flex-1 text-left"
                      >
                        <h3 className="truncate text-base font-semibold text-fg transition-colors">{room.name}</h3>
                        <p className="mt-1 text-sm text-fg-muted">
                          {room.templateName || "Blank Workspace"}
                        </p>
                        {room.ownerId === user?.id && (room.pendingJoinRequestCount || 0) > 0 && (
                          <span className="mt-2 inline-flex rounded-full bg-warning-500/15 px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-warning-600">
                            {room.pendingJoinRequestCount} request{room.pendingJoinRequestCount === 1 ? "" : "s"} waiting
                          </span>
                        )}
                      </button>

                      {/* Bookmark toggle */}
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleBookmark(room.id);
                          setBookmarks(getBookmarks());
                        }}
                        title={bookmarks.includes(room.id) ? "Remove bookmark" : "Bookmark room"}
                        className={`shrink-0 rounded-md p-1.5 transition-colors ${
                          bookmarks.includes(room.id)
                            ? "text-accent"
                            : "text-fg-subtle hover:text-fg"
                        }`}
                      >
                        {bookmarks.includes(room.id)
                          ? <BookmarkCheck size={15} />
                          : <Bookmark size={15} />
                        }
                      </button>

                      {room.ownerId === user?.id && (
                        <div className="relative">
                          {/* Trigger - stopPropagation on both mousedown and click */}
                          <button
                            onMouseDown={(e) => e.stopPropagation()}
                            onClick={(e) => {
                              e.stopPropagation();
                              setOpenMenuId(openMenuId === room.id ? null : room.id);
                            }}
                            className={`rounded-md p-1.5 transition-colors ${openMenuId === room.id
                              ? "bg-accent-subtle text-accent"
                              : "text-fg-subtle hover:bg-hovered hover:text-fg"
                              }`}
                            title="Workspace settings"
                            aria-haspopup="menu"
                            aria-expanded={openMenuId === room.id}
                          >
                            <MoreVertical size={16} />
                          </button>

                          {openMenuId === room.id && (
                            <div
                              onMouseDown={(e) => e.stopPropagation()}
                              role="menu"
                              className="absolute right-0 top-10 z-30 w-56 overflow-hidden rounded-md border border-edge bg-overlay shadow-xl"
                            >

                              {/* Actions */}
                              <div className="py-1">
                                <button
                                  onClick={() => { navigate(`/room/${room.id}`); setOpenMenuId(null); }}
                                  role="menuitem"
                                  className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm text-fg transition-colors hover:bg-hovered"
                                >
                                  <ArrowRight size={14} className="text-fg-subtle" />
                                  Open workspace
                                </button>

                                <button
                                  onClick={() => handleOpenRoomSettings(room)}
                                  role="menuitem"
                                  className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm text-fg transition-colors hover:bg-hovered"
                                >
                                  <Settings2 size={14} className="text-fg-subtle" />
                                  Workspace settings
                                </button>

                                <button
                                  onClick={async () => {
                                    const url = buildRoomInviteLink({
                                      roomId: room.id,
                                      inviteToken: room.inviteToken,
                                    });
                                    try {
                                      await navigator.clipboard.writeText(url);
                                      toast.success("Invite link copied!");
                                    } catch {
                                      toast.error("Could not copy invite link");
                                    }
                                    setOpenMenuId(null);
                                  }}
                                  role="menuitem"
                                  className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm text-fg transition-colors hover:bg-hovered"
                                >
                                  <Link2 size={14} className="text-fg-subtle" />
                                  Copy invite link
                                </button>
                              </div>

                              {/* Delete */}
                              <div className="border-t border-edge-subtle py-1">
                                <button
                                  onClick={() => { handleDeleteRoom(room); setOpenMenuId(null); }}
                                  role="menuitem"
                                  className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm text-danger-500 transition-colors hover:bg-danger-500/10"
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
                      <div className="flex flex-wrap gap-2 text-xs text-fg-muted">
                        <span className="rounded-full bg-hovered px-2.5 py-1">
                          {room.fileCount || 0} files
                        </span>
                        <span className="rounded-full bg-hovered px-2.5 py-1">
                          {room.participantCount || 0} collaborators
                        </span>
                        <span className="truncate max-w-[120px] rounded-full bg-hovered px-2.5 py-1">
                          {room.id}
                        </span>
                      </div>
                      <div className="mt-5 flex items-center justify-between border-t border-edge-subtle pt-3 text-sm font-medium text-fg-muted transition-colors group-hover/card:text-accent">
                        <span>Open room</span>
                        <ArrowRight size={14} className="transform group-hover/card:translate-x-1 transition-transform" />
                      </div>
                    </button>
                  </Motion.div>
                ))}
              </AnimatePresence>
            </div>
          ) : rooms.length > 0 ? (
            <Motion.div variants={itemVariants} className="flex flex-col items-center justify-center rounded-lg border border-dashed border-edge p-10 text-center">
              <Search size={22} className="text-fg-subtle" />
              <p className="mt-3 text-base font-semibold text-fg">No matching rooms</p>
              <p className="mt-1 max-w-sm text-sm text-fg-muted">
                Try a different name or room ID, or clear the filter to view all rooms.
              </p>
              <button
                onClick={() => setRoomSearch("")}
                className="mt-4 inline-flex items-center gap-2 rounded-md border border-edge bg-panel px-4 py-2 text-sm font-semibold text-fg transition-colors hover:bg-hovered hover:border-edge-strong"
              >
                Clear filter
              </button>
            </Motion.div>
          ) : (
            <Motion.div variants={itemVariants} className="flex flex-col items-center justify-center rounded-lg border border-dashed border-edge p-12 text-center">
              <Motion.div
                animate={{ y: [0, -5, 0] }}
                transition={{ duration: 2.8, repeat: Infinity, ease: "easeInOut" }}
                className="mb-4 flex h-14 w-14 items-center justify-center rounded-md bg-accent-subtle text-accent"
              >
                <FolderGit2 size={24} />
              </Motion.div>
              <p className="text-base font-semibold text-fg">No rooms yet</p>
              <p className="mt-1.5 max-w-xs text-sm text-fg-muted">
                Create your first workspace and start coding instantly with a template.
              </p>
              <button
                onClick={openCreateModal}
                className="mt-5 inline-flex items-center gap-2 rounded-md bg-accent px-4 py-2 text-sm font-semibold text-fg-accent transition-colors hover:bg-accent-hover"
              >
                <Plus size={15} /> Create a room
              </button>
            </Motion.div>
          )}
        </section>
      </Motion.div>

      <AnimatePresence>
        {createModalOpen && (
          <Motion.div
            key="create-room-modal"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, transition: { duration: 0.16 } }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
          >
            <Motion.form
              initial={{ opacity: 0, y: 8, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 8, scale: 0.97, transition: { duration: 0.16, ease: "easeIn" } }}
              transition={{ type: "spring", stiffness: 360, damping: 28, filter: { duration: 0.22 }, opacity: { duration: 0.2 } }}
              onSubmit={handleCreateRoom}
              className="max-h-[92vh] w-full max-w-4xl overflow-hidden rounded-lg border border-edge bg-overlay text-fg shadow-xl"
            >
              <div className="border-b border-edge-subtle px-4 py-4 sm:px-6">
                <p className="text-sm font-medium text-fg-muted">Create a room</p>
                <h2 className="mt-1 text-2xl font-semibold">Choose how the workspace should start</h2>
              </div>

              <div className="grid max-h-[68vh] gap-6 overflow-y-auto p-4 sm:p-6 lg:grid-cols-[1fr_1.4fr]">
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
                      className="w-full resize-none rounded-md border border-edge bg-field px-4 py-3 text-sm text-fg placeholder:text-fg-subtle outline-none transition-colors focus:border-accent focus:ring-1 focus:ring-accent"
                    />
                  </div>

                  <div>
                    <label className="mb-2 block text-sm font-medium">Terminal Shell</label>
                    <p className="mb-3 text-xs text-fg-muted">
                      {terminalShellOptions.find((shell) => shell.id === selectedShell)?.description}
                    </p>
                    <div className="grid grid-cols-3 gap-2">
                      {terminalShellOptions.map((shell) => (
                        <button
                          key={shell.id}
                          type="button"
                          onClick={() => setSelectedShell(shell.id)}
                          aria-pressed={selectedShell === shell.id}
                          className={`rounded-md border px-3 py-2 text-center text-sm font-medium transition-colors ${selectedShell === shell.id
                            ? "border-accent bg-accent text-fg-accent"
                            : "border-edge bg-field text-fg-muted hover:border-edge-strong hover:text-fg"
                            }`}
                        >
                          {shell.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="rounded-md border border-edge-subtle bg-panel p-4">
                    <p className="text-sm font-medium">{selectedTemplate?.name || "Blank Workspace"}</p>
                    <p className="mt-1 text-sm text-fg-muted">
                      {selectedTemplate?.description || "Start from an empty workspace."}
                    </p>
                  </div>
                </div>

                <div>
                  <p className="mb-3 text-sm font-medium">Starter templates</p>
                  <div className="grid max-h-[38vh] gap-2.5 overflow-auto pr-1 md:grid-cols-2">
                    {roomTemplates.map((template) => (
                      <Motion.button
                        
                        whileTap={{ scale: 0.98 }}
                        key={template.id}
                        type="button"
                        onClick={() => setSelectedTemplateId(template.id)}
                        aria-pressed={selectedTemplateId === template.id}
                        className={`rounded-md border p-4 text-left transition-colors ${selectedTemplateId === template.id
                          ? "border-accent bg-accent-subtle"
                          : "border-edge-subtle bg-field hover:border-edge-strong"
                          }`}
                      >
                        <div className="flex items-center justify-between gap-3">
                          <p className={`font-medium text-sm ${selectedTemplateId === template.id ? "text-accent" : "text-fg"}`}>{template.name}</p>
                          <span className={`flex-shrink-0 rounded-full px-2 py-0.5 text-[9px] font-semibold tracking-wider uppercase ${selectedTemplateId === template.id
                            ? "bg-accent text-fg-accent"
                            : "bg-hovered text-fg-muted"
                            }`}>
                            {template.category}
                          </span>
                        </div>
                        <p className="mt-1.5 text-xs leading-relaxed text-fg-muted">
                          {template.description}
                        </p>
                      </Motion.button>
                    ))}
                  </div>

                  {/* DSA Language Picker */}
                  {selectedTemplateId === "dsa-practice" && (
                    <div className="mt-3 rounded-md border border-edge-subtle bg-accent-subtle p-4">
                      <p className="mb-2.5 text-xs font-semibold uppercase tracking-wider text-accent">
                        Starter Language
                      </p>
                      <div className="flex flex-wrap gap-2">
                        {selectedTemplateLanguages.map((lang) => (
                          <button
                            key={lang.id}
                            type="button"
                            onClick={() => setDsaLanguage(lang.id)}
                            aria-pressed={dsaLanguage === lang.id}
                            className={`rounded-md border px-3 py-1.5 text-xs font-semibold transition-colors ${dsaLanguage === lang.id
                              ? "border-accent bg-accent text-fg-accent"
                              : "border-edge bg-field text-fg-muted hover:border-accent hover:text-fg"
                              }`}
                          >
                            {lang.label}
                          </button>
                        ))}
                      </div>
                      <p className="mt-2 text-[11px] text-fg-muted">
                        A <strong>{selectedTemplateLanguages.find((language) => language.id === dsaLanguage)?.label || "Python"}</strong> starter solution will be added to your workspace.
                      </p>
                    </div>
                  )}
                </div>
              </div>

              <div className="flex items-center justify-end gap-3 border-t border-edge-subtle px-6 py-4">
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
          </Motion.div>
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

      <RoomSettingsModal
        room={settingsRoom}
        isOpen={isRoomSettingsOpen}
        isLoading={isRoomSettingsLoading}
        onClose={closeRoomSettings}
        onUpdate={handleRoomSettingsUpdate}
      />
    </div>
  );
}

function SummaryCard({ label, value, icon }) {
  const IconComponent = icon;

  return (
    <Motion.div
      whileHover={{ y: -3, scale: 1.02, transition: { type: "spring", stiffness: 400, damping: 24 } }}
      className="rounded-lg border border-edge-subtle bg-panel p-4">
      <div className="flex items-center gap-3">
        <div className="rounded-md bg-hovered p-2 text-fg">
          <IconComponent size={16} />
        </div>
        <div>
          <p className="text-xs font-medium uppercase tracking-wider text-fg-muted">{label}</p>
          <p className="text-xl font-semibold">{value}</p>
        </div>
      </div>
    </Motion.div>
  );
}
