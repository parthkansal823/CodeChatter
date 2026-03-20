import { startTransition, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion as Motion } from "framer-motion";
import {
  ArrowRight,
  FolderGit2,
  Link2,
  Plus,
  Trash2,
  Users
} from "lucide-react";
import toast from "react-hot-toast";

import { useAuth } from "../hooks/useAuth";
import { API_ENDPOINTS } from "../config/security";
import { sanitizeInput, secureFetch, validateRoomId } from "../utils/security";

const SkeletonCard = () => (
  <div className="rounded-xl border border-zinc-200 bg-white p-6 animate-pulse dark:border-zinc-800 dark:bg-zinc-900">
    <div className="mb-4 h-6 w-3/4 rounded bg-zinc-200 dark:bg-zinc-700" />
    <div className="h-4 w-1/2 rounded bg-zinc-200 dark:bg-zinc-700" />
  </div>
);

function extractRoomId(rawValue) {
  const trimmedValue = rawValue.trim();

  if (!trimmedValue) {
    return "";
  }

  if (/^https?:\/\//i.test(trimmedValue)) {
    try {
      const url = new URL(trimmedValue);
      const segments = url.pathname.split("/").filter(Boolean);
      return (segments.at(-1) || "").toUpperCase();
    } catch {
      return trimmedValue.toUpperCase();
    }
  }

  return trimmedValue.toUpperCase();
}

export default function Home() {
  const navigate = useNavigate();
  const { user, token } = useAuth();
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

  const selectedTemplate = useMemo(
    () => roomTemplates.find((t) => t.id === selectedTemplateId) || null,
    [roomTemplates, selectedTemplateId]
  );

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

  const handleJoinById = async (roomId) => {
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
          body: JSON.stringify({ roomId }),
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
          }),
        },
        token
      );

      setCreateModalOpen(false);
      toast.success("Room created");
      navigate(`/room/${room.id}`);
    } catch (error) {
      toast.error(error.message || "Could not create room");
    } finally {
      setCreatingRoom(false);
    }
  };

  const handleDeleteRoom = async (room) => {
    const confirmed = window.confirm(
      `Delete "${room.name}"?\n\nThis will permanently remove the room, its files, and collaborator access.`
    );

    if (!confirmed) {
      return;
    }

    try {
      await secureFetch(
        API_ENDPOINTS.DELETE_ROOM(room.id),
        { method: "DELETE" },
        token
      );

      setRooms((currentRooms) => currentRooms.filter((currentRoom) => currentRoom.id !== room.id));
      toast.success("Room deleted");
    } catch (error) {
      toast.error(error.message || "Could not delete room");
    }
  };

  return (
    <div className="min-h-screen bg-zinc-50 text-black dark:bg-zinc-950 dark:text-white">
      <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
        <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
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
          </div>

          <div className="grid grid-cols-2 gap-3">
            <SummaryCard label="Your Rooms" value={rooms.length} icon={FolderGit2} />
            <SummaryCard label="Collaborators" value={collaborators.length} icon={Users} />
          </div>
        </div>

        <div className="mt-10 grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
          <button
            onClick={() => setCreateModalOpen(true)}
            className="rounded-2xl border border-zinc-200 bg-white p-6 text-left transition-colors hover:border-zinc-300 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-zinc-700"
          >
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-sm text-zinc-500 dark:text-zinc-400">Create room</p>
                <h2 className="mt-1 text-2xl font-semibold">Blank workspace or starter template</h2>
                <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
                  Name the room, pick a template, and jump straight into the editor.
                </p>
              </div>
              <div className="rounded-xl bg-zinc-900 p-3 text-white dark:bg-white dark:text-zinc-950">
                <Plus size={22} />
              </div>
            </div>
          </button>

          <form
            onSubmit={(event) => {
              event.preventDefault();
              handleJoinById(extractRoomId(joinRoomValue));
            }}
            className="rounded-2xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900"
          >
            <p className="text-sm text-zinc-500 dark:text-zinc-400">Join room</p>
            <h2 className="mt-1 text-2xl font-semibold">Paste a room ID or invite link</h2>
            <div className="mt-4 flex flex-col gap-3">
              <input
                type="text"
                placeholder="ABC123 or https://.../room/ABC123"
                value={joinRoomValue}
                onChange={(event) => setJoinRoomValue(event.target.value)}
                className="w-full rounded-lg border border-zinc-200 bg-white px-4 py-3 text-sm outline-none transition focus:border-zinc-400 dark:border-zinc-700 dark:bg-zinc-950"
              />
              <button
                type="submit"
                disabled={joiningRoom}
                className="inline-flex items-center justify-center gap-2 rounded-lg bg-zinc-900 px-4 py-3 text-sm font-medium text-white transition-colors hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-70 dark:bg-white dark:text-zinc-950 dark:hover:bg-zinc-200"
              >
                <Link2 size={16} />
                {joiningRoom ? "Joining..." : "Join room"}
              </button>
            </div>
          </form>
        </div>

        <section className="mt-10">
          <div className="mb-4 flex items-center justify-between gap-3">
            <h2 className="text-xl font-semibold">Recent rooms</h2>
            <span className="text-sm text-zinc-500 dark:text-zinc-400">{rooms.length} total</span>
          </div>

          {isLoading ? (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {[1, 2, 3].map((item) => (
                <SkeletonCard key={item} />
              ))}
            </div>
          ) : rooms.length > 0 ? (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {rooms.map((room) => (
                <div
                  key={room.id}
                  className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900"
                >
                  <div className="flex items-start justify-between gap-3">
                    <button
                      onClick={() => navigate(`/room/${room.id}`)}
                      className="min-w-0 flex-1 text-left"
                    >
                      <h3 className="truncate text-base font-semibold">{room.name}</h3>
                      <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
                        {room.templateName || "Blank Workspace"}
                      </p>
                    </button>

                    {room.ownerId === user?.id && (
                      <button
                        onClick={() => handleDeleteRoom(room)}
                        className="rounded-lg p-2 text-zinc-400 transition-colors hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/20 dark:hover:text-red-400"
                        title={`Delete ${room.name}`}
                      >
                        <Trash2 size={16} />
                      </button>
                    )}
                  </div>

                  <button
                    onClick={() => navigate(`/room/${room.id}`)}
                    className="mt-4 block w-full text-left"
                  >
                    <div className="flex flex-wrap gap-2 text-xs text-zinc-500 dark:text-zinc-400">
                      <span className="rounded-full bg-zinc-100 px-2.5 py-1 dark:bg-zinc-800">
                        {room.fileCount || 0} files
                      </span>
                      <span className="rounded-full bg-zinc-100 px-2.5 py-1 dark:bg-zinc-800">
                        {room.participantCount || 0} collaborators
                      </span>
                      <span className="rounded-full bg-zinc-100 px-2.5 py-1 dark:bg-zinc-800">
                        {room.id}
                      </span>
                    </div>
                    <div className="mt-4 flex items-center gap-2 text-sm text-zinc-500 dark:text-zinc-400">
                      Open room
                      <ArrowRight size={15} />
                    </div>
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <div className="rounded-xl border border-dashed border-zinc-300 p-8 text-center text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
              You have no rooms yet. Create one to start with a blank workspace or a starter template.
            </div>
          )}
        </section>
      </div>

      {createModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/50 p-4 backdrop-blur-sm">
          <Motion.form
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            onSubmit={handleCreateRoom}
            className="max-h-[90vh] w-full max-w-4xl overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-2xl dark:border-zinc-800 dark:bg-zinc-900"
          >
            <div className="border-b border-zinc-200 px-6 py-4 dark:border-zinc-800">
              <p className="text-sm text-zinc-500 dark:text-zinc-400">Create a room</p>
              <h2 className="mt-1 text-2xl font-semibold">Choose how the workspace should start</h2>
            </div>

            <div className="grid gap-6 p-6 lg:grid-cols-[1fr_1.4fr]">
              <div className="space-y-4">
                <div>
                  <label className="mb-2 block text-sm font-medium">Room name</label>
                  <input
                    value={roomName}
                    onChange={(event) => setRoomName(event.target.value)}
                    placeholder="Example: DSA Pairing Session"
                    className="w-full rounded-lg border border-zinc-200 bg-white px-4 py-3 text-sm outline-none transition focus:border-zinc-400 dark:border-zinc-700 dark:bg-zinc-950"
                  />
                </div>

                <div>
                  <label className="mb-2 block text-sm font-medium">Description</label>
                  <textarea
                    value={roomDescription}
                    onChange={(event) => setRoomDescription(event.target.value)}
                    placeholder="Optional room description"
                    rows={4}
                    className="w-full rounded-lg border border-zinc-200 bg-white px-4 py-3 text-sm outline-none transition focus:border-zinc-400 dark:border-zinc-700 dark:bg-zinc-950"
                  />
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
                <div className="grid max-h-[52vh] gap-3 overflow-auto pr-1 md:grid-cols-2">
                  {roomTemplates.map((template) => (
                    <button
                      key={template.id}
                      type="button"
                      onClick={() => setSelectedTemplateId(template.id)}
                      className={`rounded-xl border p-4 text-left transition-colors ${
                        selectedTemplateId === template.id
                          ? "border-zinc-900 bg-zinc-900 text-white dark:border-white dark:bg-white dark:text-zinc-950"
                          : "border-zinc-200 bg-white hover:border-zinc-300 dark:border-zinc-800 dark:bg-zinc-950 dark:hover:border-zinc-700"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <p className="font-medium">{template.name}</p>
                        <span className={`rounded-full px-2.5 py-1 text-xs ${
                          selectedTemplateId === template.id
                            ? "bg-white/15 text-white dark:bg-zinc-200 dark:text-zinc-900"
                            : "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400"
                        }`}>
                          {template.category}
                        </span>
                      </div>
                      <p className={`mt-2 text-sm ${
                        selectedTemplateId === template.id
                          ? "text-white/80 dark:text-zinc-600"
                          : "text-zinc-500 dark:text-zinc-400"
                      }`}>
                        {template.description}
                      </p>
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 border-t border-zinc-200 px-6 py-4 dark:border-zinc-800">
              <button
                type="button"
                onClick={() => setCreateModalOpen(false)}
                className="rounded-lg border border-zinc-200 px-4 py-2 text-sm font-medium text-zinc-600 transition-colors hover:border-zinc-300 hover:text-zinc-900 dark:border-zinc-800 dark:text-zinc-300 dark:hover:border-zinc-700 dark:hover:text-white"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={creatingRoom}
                className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-70 dark:bg-white dark:text-zinc-950 dark:hover:bg-zinc-200"
              >
                {creatingRoom ? "Creating..." : "Create room"}
              </button>
            </div>
          </Motion.form>
        </div>
      )}
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
          <p className="text-xs text-zinc-500 dark:text-zinc-400">{label}</p>
          <p className="text-lg font-semibold">{value}</p>
        </div>
      </div>
    </div>
  );
}
