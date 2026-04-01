import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { motion as Motion } from "framer-motion";
import {
  Mail, Calendar, FolderGit2, Users, Settings,
  Edit3, Shield, ArrowRight, Clock, Code2, Star,
} from "lucide-react";

import { useAuth } from "../hooks/useAuth";
import { API_ENDPOINTS } from "../config/security";
import { secureFetch } from "../utils/security";
import UserAvatar from "../components/UserAvatar";

const SPRING = { type: "spring", stiffness: 340, damping: 28 };

const containerVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { staggerChildren: 0.08 } },
};
const itemVariants = {
  hidden: { opacity: 0, y: 16, scale: 0.97 },
  visible: { opacity: 1, y: 0, scale: 1, transition: SPRING },
};

export default function Profile() {
  const { user, token } = useAuth();
  const navigate = useNavigate();
  const [rooms, setRooms] = useState([]);
  const [collaborators, setCollaborators] = useState([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!token) { setIsLoading(false); return; }
    Promise.allSettled([
      secureFetch(API_ENDPOINTS.GET_ROOMS, {}, token),
      secureFetch(API_ENDPOINTS.GET_COLLABORATORS, {}, token),
    ]).then(([roomsRes, collabRes]) => {
      setRooms(roomsRes.status === "fulfilled" ? roomsRes.value || [] : []);
      setCollaborators(collabRes.status === "fulfilled" ? collabRes.value || [] : []);
    }).finally(() => setIsLoading(false));
  }, [token]);

  const ownedRooms = rooms.filter(r => r.ownerId === user?.id);
  const joinedRooms = rooms.filter(r => r.ownerId !== user?.id);
  const memberSince = user?.createdAt
    ? new Date(user.createdAt).toLocaleDateString("en-US", { year: "numeric", month: "long" })
    : "Member";

  const stats = [
    { label: "Rooms Created", value: ownedRooms.length, icon: FolderGit2, color: "text-violet-500", bg: "bg-violet-50 dark:bg-violet-900/20" },
    { label: "Rooms Joined",  value: joinedRooms.length, icon: Users, color: "text-emerald-600 dark:text-emerald-400", bg: "bg-emerald-50 dark:bg-emerald-900/20" },
    { label: "Collaborators", value: collaborators.length, icon: Star, color: "text-amber-600 dark:text-amber-400", bg: "bg-amber-50 dark:bg-amber-900/20" },
    { label: "Total Rooms",   value: rooms.length, icon: Code2, color: "text-sky-600 dark:text-sky-400", bg: "bg-sky-50 dark:bg-sky-900/20" },
  ];

  return (
    <div className="min-h-screen bg-gradient-to-b from-zinc-50 to-white dark:from-zinc-950 dark:to-zinc-950/90">
      <Motion.div
        variants={containerVariants}
        initial="hidden"
        animate="visible"
        className="mx-auto max-w-4xl px-4 py-10 sm:px-6 lg:px-8"
      >
        {/* ── Profile Header ───────────────────────────────────────────── */}
        <Motion.div variants={itemVariants} className="mb-8 overflow-hidden rounded-2xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
          <div className="h-24 bg-gradient-to-r from-violet-500 via-purple-500 to-indigo-500" />
          <div className="px-6 pb-6">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
              <div className="-mt-10 flex items-end gap-4">
                <div className="rounded-full ring-4 ring-white dark:ring-zinc-900">
                  <UserAvatar username={user?.username} size="lg" />
                </div>
                <div className="mb-1">
                  <h1 className="text-2xl font-bold text-zinc-900 dark:text-white">{user?.username}</h1>
                  <div className="flex items-center gap-1.5 text-sm text-zinc-500 dark:text-zinc-400">
                    <Mail size={13} />
                    {user?.email}
                  </div>
                </div>
              </div>
              <button
                onClick={() => navigate("/settings")}
                className="inline-flex h-9 items-center gap-2 rounded-xl border border-zinc-200 bg-white px-4 text-sm font-medium text-zinc-700 transition-colors hover:border-violet-300 hover:bg-violet-50 hover:text-violet-700 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:border-violet-600 dark:hover:bg-violet-900/20 dark:hover:text-violet-300"
              >
                <Edit3 size={14} />
                Edit Profile
              </button>
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-4 text-sm text-zinc-500 dark:text-zinc-400">
              <div className="flex items-center gap-1.5">
                <Calendar size={13} />
                {memberSince}
              </div>
              <div className="flex items-center gap-1.5">
                <Shield size={13} />
                Verified account
              </div>
            </div>
          </div>
        </Motion.div>

        {/* ── Stats ───────────────────────────────────────────────────── */}
        <Motion.div variants={itemVariants} className="mb-8 grid grid-cols-2 gap-4 lg:grid-cols-4">
          {stats.map(({ label, value, icon: Icon, color, bg }) => (
            <Motion.div
              key={label}
              whileHover={{ y: -3, scale: 1.02, transition: SPRING }}
              className="rounded-2xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900"
            >
              <div className={`mb-3 inline-flex rounded-xl p-2.5 ${bg}`}>
                <Icon size={18} className={color} />
              </div>
              <p className="text-2xl font-bold text-zinc-900 dark:text-white">
                {isLoading ? "—" : value}
              </p>
              <p className="text-xs font-medium text-zinc-500 dark:text-zinc-400">{label}</p>
            </Motion.div>
          ))}
        </Motion.div>

        {/* ── Two-column detail ────────────────────────────────────────── */}
        <div className="grid gap-6 lg:grid-cols-2">
          {/* Owned rooms */}
          <Motion.div variants={itemVariants} className="overflow-hidden rounded-2xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
            <div className="flex items-center justify-between border-b border-zinc-100 px-5 py-4 dark:border-zinc-800">
              <h2 className="text-sm font-semibold text-zinc-900 dark:text-white">Your Rooms</h2>
              <button
                onClick={() => navigate("/home")}
                className="inline-flex items-center gap-1 text-xs font-medium text-violet-600 hover:text-violet-700 dark:text-violet-400 dark:hover:text-violet-300"
              >
                View all <ArrowRight size={12} />
              </button>
            </div>
            <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {isLoading ? (
                [1, 2, 3].map(i => (
                  <div key={i} className="animate-pulse px-5 py-3">
                    <div className="mb-1.5 h-4 w-2/3 rounded bg-zinc-100 dark:bg-zinc-800" />
                    <div className="h-3 w-1/3 rounded bg-zinc-100 dark:bg-zinc-800" />
                  </div>
                ))
              ) : ownedRooms.length === 0 ? (
                <div className="px-5 py-8 text-center">
                  <FolderGit2 size={24} className="mx-auto mb-2 text-zinc-300 dark:text-zinc-600" />
                  <p className="text-sm text-zinc-500 dark:text-zinc-400">No rooms created yet</p>
                </div>
              ) : (
                ownedRooms.slice(0, 5).map(room => (
                  <button
                    key={room.id}
                    onClick={() => navigate(`/room/${room.id}`)}
                    className="flex w-full items-center justify-between px-5 py-3 text-left transition-colors hover:bg-zinc-50 dark:hover:bg-zinc-800/50"
                  >
                    <div>
                      <p className="text-sm font-medium text-zinc-900 dark:text-white">{room.name}</p>
                      <p className="text-xs text-zinc-500 dark:text-zinc-400">
                        {room.templateName || "Blank"} · {room.fileCount || 0} files
                      </p>
                    </div>
                    <ArrowRight size={14} className="text-zinc-400" />
                  </button>
                ))
              )}
            </div>
          </Motion.div>

          {/* Collaborators */}
          <Motion.div variants={itemVariants} className="overflow-hidden rounded-2xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
            <div className="border-b border-zinc-100 px-5 py-4 dark:border-zinc-800">
              <h2 className="text-sm font-semibold text-zinc-900 dark:text-white">Collaborators</h2>
            </div>
            <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {isLoading ? (
                [1, 2, 3].map(i => (
                  <div key={i} className="animate-pulse flex items-center gap-3 px-5 py-3">
                    <div className="h-8 w-8 rounded-full bg-zinc-100 dark:bg-zinc-800" />
                    <div className="h-4 w-1/2 rounded bg-zinc-100 dark:bg-zinc-800" />
                  </div>
                ))
              ) : collaborators.length === 0 ? (
                <div className="px-5 py-8 text-center">
                  <Users size={24} className="mx-auto mb-2 text-zinc-300 dark:text-zinc-600" />
                  <p className="text-sm text-zinc-500 dark:text-zinc-400">No collaborators yet</p>
                </div>
              ) : (
                collaborators.slice(0, 6).map((collab, i) => (
                  <div key={collab.id || i} className="flex items-center gap-3 px-5 py-3">
                    <UserAvatar username={collab.username} size="sm" />
                    <div>
                      <p className="text-sm font-medium text-zinc-900 dark:text-white">{collab.username}</p>
                      {collab.email && (
                        <p className="text-xs text-zinc-500 dark:text-zinc-400">{collab.email}</p>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          </Motion.div>
        </div>

        {/* ── Quick Actions ─────────────────────────────────────────────── */}
        <Motion.div variants={itemVariants} className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3">
          {[
            { label: "Go to Dashboard",  icon: FolderGit2, path: "/home" },
            { label: "Settings",         icon: Settings,   path: "/settings" },
            { label: "Recent Activity",  icon: Clock,      path: "/home" },
          ].map(({ label, icon: Icon, path }) => (
            <Motion.button
              key={label}
              whileHover={{ y: -2, scale: 1.01, transition: SPRING }}
              whileTap={{ scale: 0.98 }}
              onClick={() => navigate(path)}
              className="flex items-center gap-3 rounded-2xl border border-zinc-200 bg-white p-4 text-left transition-colors hover:border-violet-200 hover:bg-violet-50 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-violet-800 dark:hover:bg-violet-900/10"
            >
              <Icon size={18} className="text-zinc-500 dark:text-zinc-400" />
              <span className="text-sm font-medium text-zinc-700 dark:text-zinc-200">{label}</span>
            </Motion.button>
          ))}
        </Motion.div>
      </Motion.div>
    </div>
  );
}
