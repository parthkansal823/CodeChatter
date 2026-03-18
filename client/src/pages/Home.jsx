import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { Plus, ArrowRight, Users, Flame, Zap, Code2 } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import toast from "react-hot-toast";
import { secureFetch, sanitizeInput, validateRoomId } from "../utils/security";
import { API_ENDPOINTS } from "../config/security";

// Skeleton Loader Component
const SkeletonCard = () => (
  <div className="rounded-xl p-6 bg-white dark:bg-zinc-900 animate-pulse">
    <div className="h-6 bg-gray-300 dark:bg-zinc-700 rounded mb-4 w-3/4"></div>
    <div className="h-4 bg-gray-300 dark:bg-zinc-700 rounded w-1/2"></div>
  </div>
);

export default function Home() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [joinRoomId, setJoinRoomId] = useState("");
  const [loading, setLoading] = useState(false);
  const [rooms, setRooms] = useState([]);
  const [publicRooms, setPublicRooms] = useState([]);
  const [collaborators, setCollaborators] = useState([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    setIsLoading(true);
    try {
      // Fetch recent rooms
      try {
        const data = await secureFetch(API_ENDPOINTS.GET_ROOMS, {}, user?.token);
        setRooms(data || []);
      } catch (error) {
        console.warn("Failed to fetch recent rooms:", error);
        toast.error("Could not load recent rooms");
        setRooms([]);
      }

      // Fetch public rooms
      try {
        const data = await secureFetch(API_ENDPOINTS.GET_PUBLIC_ROOMS, {}, user?.token);
        setPublicRooms(data || []);
      } catch (error) {
        console.warn("Failed to fetch public rooms:", error);
        toast.error("Could not load featured rooms");
        setPublicRooms([]);
      }

      // Fetch collaborators
      try {
        const data = await secureFetch(API_ENDPOINTS.GET_COLLABORATORS, {}, user?.token);
        setCollaborators(data || []);
      } catch (error) {
        console.warn("Failed to fetch collaborators:", error);
        setCollaborators([]);
      }
    } catch (error) {
      console.error("Error fetching data:", error);
      toast.error("Failed to load data");
    }
    setIsLoading(false);
  };

  const handleCreateRoom = () => {
    const roomId = Math.random().toString(36).substring(2, 8).toUpperCase();
    navigate(`/room/${roomId}`);
  };

  const handleJoinRoom = async (e) => {
    e.preventDefault();
    const trimmedRoomId = joinRoomId.trim();

    if (!trimmedRoomId) {
      toast.error("Please enter a room ID");
      return;
    }

    // Validate room ID format
    if (!validateRoomId(trimmedRoomId)) {
      toast.error("Invalid room ID format. Use 6-20 alphanumeric characters");
      return;
    }

    setLoading(true);
    try {
      const sanitizedRoomId = sanitizeInput(trimmedRoomId);

      const response = await secureFetch(
        API_ENDPOINTS.JOIN_ROOM,
        {
          method: "POST",
          body: JSON.stringify({ roomId: sanitizedRoomId }),
        },
        user?.token
      );

      if (response) {
        toast.success("Joining room...");
        navigate(`/room/${sanitizedRoomId}`);
      }
    } catch (error) {
      console.error("Error joining room:", error);
      toast.error(error.message || "Failed to join room");
    } finally {
      setLoading(false);
      setJoinRoomId("");
    }
  };

  const avatarColors = [
    "bg-red-500", "bg-blue-500", "bg-green-500", "bg-purple-500",
    "bg-pink-500", "bg-yellow-500"
  ];

  const containerVariants = {
    hidden: { opacity: 0 },
    visible: {
      opacity: 1,
      transition: { staggerChildren: 0.1, delayChildren: 0.2 }
    }
  };

  const itemVariants = {
    hidden: { opacity: 0, y: 20 },
    visible: { opacity: 1, y: 0, transition: { duration: 0.5 } }
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.3 }}
      className="min-h-screen bg-gradient-to-br from-white to-gray-50 dark:from-zinc-950 dark:to-zinc-900 text-black dark:text-white"
    >
      {/* Hero Section */}
      <motion.div
        variants={containerVariants}
        initial="hidden"
        animate="visible"
        className="relative overflow-hidden"
      >
        {/* Gradient Background */}
        <div className="absolute inset-0 bg-gradient-to-r from-purple-500/10 via-transparent to-blue-500/10 dark:from-purple-900/20 dark:to-blue-900/20" />

        <div className="relative px-4 sm:px-6 md:px-12 lg:px-20 py-12 sm:py-16 md:py-20 max-w-7xl mx-auto w-full">
          {/* Welcome Section */}
          <motion.div variants={itemVariants} className="mb-8 sm:mb-12">
            <h1 className="text-3xl sm:text-4xl md:text-5xl lg:text-6xl font-bold mb-3 sm:mb-4 bg-gradient-to-r from-purple-600 via-blue-600 to-cyan-600 dark:from-purple-400 dark:via-blue-400 dark:to-cyan-400 bg-clip-text text-transparent">
              Welcome back, {user?.username}! 🚀
            </h1>
            <p className="text-base sm:text-lg text-gray-600 dark:text-gray-400 max-w-2xl">
              Ready to collaborate? Start coding with your team in real-time.
            </p>
          </motion.div>

          {/* Stats Section */}
          <motion.div variants={itemVariants} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4 mb-12">
            <div className="rounded-xl p-4 sm:p-6 bg-white/50 dark:bg-zinc-900/50 backdrop-blur border border-gray-200 dark:border-zinc-700">
              <div className="flex items-center gap-2 sm:gap-3">
                <Code2 size={20} className="text-purple-600 dark:text-purple-400 flex-shrink-0" />
                <div className="min-w-0">
                  <p className="text-xs sm:text-sm text-gray-600 dark:text-gray-400">Total Rooms</p>
                  <p className="text-xl sm:text-2xl font-bold">{rooms.length}</p>
                </div>
              </div>
            </div>
            <div className="rounded-xl p-4 sm:p-6 bg-white/50 dark:bg-zinc-900/50 backdrop-blur border border-gray-200 dark:border-zinc-700">
              <div className="flex items-center gap-2 sm:gap-3">
                <Users size={20} className="text-blue-600 dark:text-blue-400 flex-shrink-0" />
                <div className="min-w-0">
                  <p className="text-xs sm:text-sm text-gray-600 dark:text-gray-400">Collaborators</p>
                  <p className="text-xl sm:text-2xl font-bold">{collaborators.length}</p>
                </div>
              </div>
            </div>
            <div className="rounded-xl p-4 sm:p-6 bg-white/50 dark:bg-zinc-900/50 backdrop-blur border border-gray-200 dark:border-zinc-700">
              <div className="flex items-center gap-2 sm:gap-3">
                <Zap size={20} className="text-yellow-600 dark:text-yellow-400 flex-shrink-0" />
                <div className="min-w-0">
                  <p className="text-xs sm:text-sm text-gray-600 dark:text-gray-400">Featured</p>
                  <p className="text-xl sm:text-2xl font-bold">{publicRooms.length}</p>
                </div>
              </div>
            </div>
          </motion.div>

          {/* Quick Actions */}
          <motion.div variants={itemVariants} className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-6 mb-12 sm:mb-16">
            {/* Create Room */}
            <button
              onClick={handleCreateRoom}
              className="group relative overflow-hidden rounded-xl sm:rounded-2xl p-6 sm:p-8 bg-gradient-to-br from-purple-600 to-blue-600 hover:shadow-2xl hover:shadow-purple-500/50 transition-all duration-300 transform hover:scale-105 text-left"
            >
              <div className="absolute inset-0 bg-white/10 opacity-0 group-hover:opacity-100 transition" />
              <div className="relative flex items-center justify-between gap-4">
                <div className="flex-1">
                  <h3 className="text-xl sm:text-2xl font-bold text-white mb-1 sm:mb-2">Create New Room</h3>
                  <p className="text-sm sm:text-base text-purple-100">Start a new coding session instantly</p>
                </div>
                <Plus size={32} className="text-white opacity-80 flex-shrink-0 hidden sm:block" />
              </div>
            </button>

            {/* Join Room */}
            <form
              onSubmit={handleJoinRoom}
              className="rounded-xl sm:rounded-2xl p-6 sm:p-8 border-2 border-dashed border-zinc-300 dark:border-zinc-700 bg-gradient-to-br from-zinc-50 to-gray-100 dark:from-zinc-900 dark:to-zinc-800 hover:border-purple-500 transition-colors"
            >
              <h3 className="text-xl sm:text-2xl font-bold mb-3 sm:mb-4">Join Existing Room</h3>
              <p className="text-xs sm:text-sm text-gray-600 dark:text-gray-400 mb-3 sm:mb-4">
                Enter a room ID to join your team
              </p>
              <div className="flex flex-col sm:flex-row gap-2">
                <input
                  type="text"
                  placeholder="e.g., ABC123"
                  value={joinRoomId}
                  onChange={(e) => setJoinRoomId(e.target.value.toUpperCase())}
                  className="flex-1 px-3 sm:px-4 py-2.5 sm:py-3 rounded-lg bg-white dark:bg-zinc-800 border border-gray-300 dark:border-zinc-700 focus:outline-none focus:ring-2 focus:ring-purple-500 transition text-black dark:text-white text-sm sm:text-base"
                />
                <button
                  type="submit"
                  disabled={loading}
                  className="px-4 sm:px-6 py-2.5 sm:py-3 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition disabled:opacity-50 font-medium text-sm sm:text-base whitespace-nowrap"
                >
                  {loading ? "Joining..." : "Join"}
                </button>
              </div>
            </form>
          </motion.div>

          {/* Recent Rooms Section */}
          {isLoading ? (
            <motion.div variants={itemVariants} className="mb-12 sm:mb-16">
              <h2 className="text-2xl sm:text-3xl font-bold mb-6 sm:mb-8">Recent Rooms</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
                {[1, 2, 3].map((i) => (
                  <SkeletonCard key={i} />
                ))}
              </div>
            </motion.div>
          ) : rooms.length > 0 && (
            <motion.div variants={itemVariants} className="mb-12 sm:mb-16">
              <div className="flex items-center gap-3 mb-6 sm:mb-8 flex-wrap">
                <h2 className="text-2xl sm:text-3xl font-bold">Recent Rooms</h2>
                <span className="px-3 py-1 rounded-full bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 text-xs sm:text-sm font-medium">
                  {rooms.length}
                </span>
              </div>
              <motion.div
                variants={containerVariants}
                initial="hidden"
                animate="visible"
                className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6"
              >
                {rooms.map((room) => (
                  <motion.button
                    key={room.id}
                    variants={itemVariants}
                    onClick={() => navigate(`/room/${room.id}`)}
                    className="group text-left rounded-xl p-4 sm:p-6 bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 hover:border-purple-500 dark:hover:border-purple-500 hover:shadow-lg transition-all duration-300"
                  >
                    <h3 className="text-base sm:text-lg font-semibold mb-2 group-hover:text-purple-600 dark:group-hover:text-purple-400 truncate">
                      {room.name || `Room ${room.id}`}
                    </h3>
                    <div className="flex items-center justify-between text-xs sm:text-sm text-gray-600 dark:text-gray-400">
                      <span className="truncate">{room.collaborators?.length || 0} collaborators</span>
                      <ArrowRight size={16} className="group-hover:translate-x-1 transition flex-shrink-0" />
                    </div>
                  </motion.button>
                ))}
              </motion.div>
            </motion.div>
          )}

          {/* Active Collaborators Section */}
          {collaborators.length > 0 && (
            <motion.div variants={itemVariants} className="mb-12 sm:mb-16">
              <div className="flex items-center gap-2 sm:gap-3 mb-6 sm:mb-8 flex-wrap">
                <h2 className="text-2xl sm:text-3xl font-bold flex items-center gap-2">
                  <Users size={28} className="hidden sm:block" />
                  <Users size={24} className="block sm:hidden" />
                  Active Collaborators
                </h2>
                <span className="px-3 py-1 rounded-full bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300 text-xs sm:text-sm font-medium">
                  {collaborators.length} online
                </span>
              </div>
              <motion.div
                variants={containerVariants}
                initial="hidden"
                animate="visible"
                className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3 sm:gap-4"
              >
                {collaborators.map((collab, index) => (
                  <motion.div
                    key={collab.id}
                    variants={itemVariants}
                    className="flex flex-col items-center gap-2 sm:gap-3 p-3 sm:p-4 rounded-xl bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 hover:shadow-md transition"
                  >
                    <div className={`w-12 sm:w-14 h-12 sm:h-14 rounded-full flex items-center justify-center text-white font-bold text-sm sm:text-lg ${avatarColors[index % avatarColors.length]} border-2 border-purple-500 shadow-md flex-shrink-0`}>
                      {collab.username?.charAt(0).toUpperCase()}
                    </div>
                    <div className="text-center min-w-0">
                      <p className="text-xs sm:text-sm font-semibold truncate">{collab.username}</p>
                      <span className="text-xs text-green-500 font-medium flex items-center gap-1 justify-center">
                        <span className="w-2 h-2 bg-green-500 rounded-full"></span> Online
                      </span>
                    </div>
                  </motion.div>
                ))}
              </motion.div>
            </motion.div>
          )}

          {/* Featured Public Rooms Section */}
          {publicRooms.length > 0 && (
            <motion.div variants={itemVariants} className="mb-12 sm:mb-16">
              <div className="flex items-center gap-2 sm:gap-3 mb-6 sm:mb-8 flex-wrap">
                <h2 className="text-2xl sm:text-3xl font-bold flex items-center gap-2">
                  <Flame size={28} className="text-orange-500 hidden sm:block" />
                  <Flame size={24} className="text-orange-500 block sm:hidden" />
                  Featured Rooms
                </h2>
                <span className="px-3 py-1 rounded-full bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-300 text-xs sm:text-sm font-medium">
                  {publicRooms.length}
                </span>
              </div>
              <motion.div
                variants={containerVariants}
                initial="hidden"
                animate="visible"
                className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6"
              >
                {publicRooms.map((room) => (
                  <motion.button
                    key={room.id}
                    variants={itemVariants}
                    onClick={() => navigate(`/room/${room.id}`)}
                    className="group text-left rounded-xl p-4 sm:p-6 bg-gradient-to-br from-orange-50 to-yellow-50 dark:from-orange-900/20 dark:to-yellow-900/20 border border-orange-200 dark:border-orange-700/50 hover:shadow-lg transition-all duration-300"
                  >
                    <div className="flex items-start justify-between mb-2 sm:mb-3 gap-2">
                      <h3 className="text-base sm:text-lg font-semibold group-hover:text-orange-600 dark:group-hover:text-orange-400 truncate">
                        {room.name || `Room ${room.id}`}
                      </h3>
                      <Flame size={18} className="text-orange-500 flex-shrink-0" />
                    </div>
                    <p className="text-xs sm:text-sm text-gray-600 dark:text-gray-400 mb-3 sm:mb-4 line-clamp-2">
                      {room.description || "Python, JavaScript, Algorithms"}
                    </p>
                    <div className="flex items-center justify-between text-xs sm:text-sm text-gray-600 dark:text-gray-400">
                      <span className="truncate">{room.participantCount || 0} currently coding</span>
                      <ArrowRight size={16} className="group-hover:translate-x-1 transition flex-shrink-0" />
                    </div>
                  </motion.button>
                ))}
              </motion.div>
            </motion.div>
          )}

          {/* Empty State */}
          {!isLoading && rooms.length === 0 && publicRooms.length === 0 && (
            <motion.div variants={itemVariants} className="text-center py-12 sm:py-20">
              <div className="mb-6 sm:mb-8">
                <Zap size={48} className="mx-auto text-purple-600 dark:text-purple-400 opacity-20 mb-3 sm:mb-4" />
              </div>
              <p className="text-lg sm:text-xl text-gray-600 dark:text-gray-400 mb-6 sm:mb-8">
                No rooms yet. Create one to get started!
              </p>
              <button
                onClick={handleCreateRoom}
                className="px-6 sm:px-8 py-3 sm:py-4 bg-gradient-to-r from-purple-600 to-blue-600 text-white rounded-xl hover:shadow-lg transition-all transform hover:scale-105 font-semibold text-base sm:text-lg"
              >
                Create Your First Room
              </button>
            </motion.div>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}
