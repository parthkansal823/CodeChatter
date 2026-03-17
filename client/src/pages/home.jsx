import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { Plus, ArrowRight, Users, Flame } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import toast from "react-hot-toast";

export default function Home() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [joinRoomId, setJoinRoomId] = useState("");
  const [loading, setLoading] = useState(false);
  const [rooms, setRooms] = useState([]);
  const [publicRooms, setPublicRooms] = useState([]);
  const [collaborators, setCollaborators] = useState([]);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      // Fetch recent rooms
      try {
        const roomsRes = await fetch("http://localhost:8000/api/rooms", {
          headers: { Authorization: `Bearer ${localStorage.getItem("authToken")}` }
        });
        if (roomsRes.ok) {
          const data = await roomsRes.json();
          setRooms(data || []);
        }
      } catch (error) {
        console.warn("Failed to fetch recent rooms:", error);
        setRooms([]);
      }

      // Fetch public rooms
      try {
        const publicRes = await fetch("http://localhost:8000/api/rooms/public", {
          headers: { Authorization: `Bearer ${localStorage.getItem("authToken")}` }
        });
        if (publicRes.ok) {
          const data = await publicRes.json();
          setPublicRooms(data || []);
        }
      } catch (error) {
        console.warn("Failed to fetch public rooms:", error);
        setPublicRooms([]);
      }

      // Fetch collaborators
      try {
        const collabRes = await fetch("http://localhost:8000/api/collaborators", {
          headers: { Authorization: `Bearer ${localStorage.getItem("authToken")}` }
        });
        if (collabRes.ok) {
          const data = await collabRes.json();
          setCollaborators(data || []);
        }
      } catch (error) {
        console.warn("Failed to fetch collaborators:", error);
        setCollaborators([]);
      }
    } catch (error) {
      console.error("Error fetching data:", error);
    }
  };

  const handleCreateRoom = () => {
    const roomId = Math.random().toString(36).substring(2, 8).toUpperCase();
    navigate(`/room/${roomId}`);
  };

  const handleJoinRoom = async (e) => {
    e.preventDefault();
    if (!joinRoomId.trim()) {
      toast.error("Please enter a room ID");
      return;
    }

    setLoading(true);
    try {
      // Try backend first
      try {
        const response = await fetch("http://localhost:8000/api/rooms/join", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${localStorage.getItem("authToken")}`
          },
          body: JSON.stringify({ roomId: joinRoomId })
        });

        if (response.ok) {
          toast.success("Joining room...");
          navigate(`/room/${joinRoomId}`);
          return;
        }
      } catch (backendError) {
        console.warn("Backend join failed, navigating anyway:", backendError);
      }

      // Fallback: navigate anyway (room will be created dynamically)
      toast.success("Joining room...");
      navigate(`/room/${joinRoomId}`);
    } catch (error) {
      toast.error("Error joining room");
    } finally {
      setLoading(false);
      setJoinRoomId("");
    }
  };

  const avatarColors = [
    "bg-red-500",
    "bg-blue-500",
    "bg-green-500",
    "bg-purple-500",
    "bg-pink-500",
    "bg-yellow-500"
  ];

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      transition={{ duration: 0.3 }}
      className="min-h-screen bg-white dark:bg-zinc-950 text-black dark:text-white"
    >
      {/* Hero Section */}
      <div className="px-6 md:px-12 lg:px-20 py-12">
        <div className="mb-8">
          <h1 className="text-4xl md:text-5xl font-bold mb-2">
            Welcome back, <span className="text-purple-600 dark:text-purple-400">{user?.username}</span>
          </h1>
          <p className="text-gray-600 dark:text-gray-400">
            Ready to collaborate? Jump into a room or create a new one.
          </p>
        </div>

        {/* Quick Actions */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-12">
          {/* Create Room */}
          <button
            onClick={handleCreateRoom}
            className="group relative overflow-hidden rounded-2xl p-8
            bg-gradient-to-br from-purple-600 to-blue-600
            hover:shadow-2xl hover:shadow-purple-500/50 transition duration-300
            transform hover:scale-105"
          >
            <div className="absolute inset-0 bg-white/10 opacity-0 group-hover:opacity-100 transition" />
            <div className="relative flex items-center justify-between">
              <div>
                <h3 className="text-xl font-bold text-white mb-2">Create New Room</h3>
                <p className="text-purple-100">Start a new coding session</p>
              </div>
              <Plus size={32} className="text-white" />
            </div>
          </button>

          {/* Join Room */}
          <form
            onSubmit={handleJoinRoom}
            className="rounded-2xl p-8 border-2 border-dashed
            border-zinc-300 dark:border-zinc-700
            bg-zinc-100 dark:bg-zinc-900 hover:bg-zinc-200 dark:hover:bg-zinc-800 transition"
          >
            <h3 className="text-xl font-bold mb-4">Join Existing Room</h3>
            <div className="flex gap-2">
              <input
                type="text"
                placeholder="Enter room ID"
                value={joinRoomId}
                onChange={(e) => setJoinRoomId(e.target.value.toUpperCase())}
                className="flex-1 px-4 py-2 rounded-lg bg-white dark:bg-zinc-800
                border border-zinc-300 dark:border-zinc-700
                focus:outline-none focus:ring-2 focus:ring-purple-500
                text-black dark:text-white"
              />
              <button
                type="submit"
                disabled={loading}
                className="px-6 py-2 bg-purple-600 text-white rounded-lg
                hover:bg-purple-700 transition
                disabled:opacity-50"
              >
                {loading ? "Joining..." : "Join"}
              </button>
            </div>
          </form>
        </div>

        {/* Recent Rooms */}
        {rooms.length > 0 && (
          <div className="mb-12">
            <h2 className="text-2xl font-bold mb-6">Recent Rooms</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {rooms.map((room) => (
                <button
                  key={room.id}
                  onClick={() => navigate(`/room/${room.id}`)}
                  className="group text-left rounded-xl p-6
                  bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800
                  hover:border-purple-500 dark:hover:border-purple-500
                  hover:shadow-lg transition duration-300"
                >
                  <h3 className="text-lg font-semibold mb-2 group-hover:text-purple-600 dark:group-hover:text-purple-400">
                    {room.name || `Room ${room.id}`}
                  </h3>
                  <div className="flex items-center justify-between text-sm text-gray-600 dark:text-gray-400">
                    <span>{room.collaborators?.length || 0} collaborators</span>
                    <ArrowRight size={16} className="group-hover:translate-x-1 transition" />
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Active Collaborators */}
        {collaborators.length > 0 && (
          <div className="mb-12">
            <h2 className="text-2xl font-bold mb-6 flex items-center gap-2">
              <Users size={24} /> Active Collaborators
            </h2>
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
              {collaborators.map((collab, index) => (
                <div
                  key={collab.id}
                  className="flex flex-col items-center gap-2 p-4 rounded-lg
                  hover:bg-zinc-100 dark:hover:bg-zinc-900 transition"
                >
                  <div
                    className={`w-12 h-12 rounded-full flex items-center justify-center
                    text-white font-bold text-sm
                    ${avatarColors[index % avatarColors.length]}
                    border-2 border-purple-500`}
                  >
                    {collab.username?.charAt(0).toUpperCase()}
                  </div>
                  <p className="text-sm font-medium text-center">{collab.username}</p>
                  <span className="text-xs text-green-500 font-medium">Online</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Featured Public Rooms */}
        {publicRooms.length > 0 && (
          <div className="mb-12">
            <h2 className="text-2xl font-bold mb-6 flex items-center gap-2">
              <Flame size={24} className="text-orange-500" /> Featured Rooms
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {publicRooms.map((room) => (
                <button
                  key={room.id}
                  onClick={() => navigate(`/room/${room.id}`)}
                  className="group text-left rounded-xl p-6
                  bg-gradient-to-br from-orange-50 to-yellow-50
                  dark:from-orange-900/20 dark:to-yellow-900/20
                  border border-orange-200 dark:border-orange-700/50
                  hover:shadow-lg transition duration-300"
                >
                  <div className="flex items-start justify-between mb-2">
                    <h3 className="text-lg font-semibold group-hover:text-orange-600 dark:group-hover:text-orange-400">
                      {room.name || `Room ${room.id}`}
                    </h3>
                    <Flame size={18} className="text-orange-500" />
                  </div>
                  <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
                    {room.description || "Python, JavaScript, Algorithms"}
                  </p>
                  <div className="flex items-center justify-between text-sm text-gray-600 dark:text-gray-400">
                    <span>{room.participantCount || 0} currently coding</span>
                    <ArrowRight size={16} className="group-hover:translate-x-1 transition" />
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Empty State */}
        {rooms.length === 0 && publicRooms.length === 0 && (
          <div className="text-center py-12">
            <p className="text-gray-600 dark:text-gray-400 mb-6">
              No rooms yet. Create one to get started!
            </p>
            <button
              onClick={handleCreateRoom}
              className="px-8 py-3 bg-purple-600 text-white rounded-lg
              hover:bg-purple-700 transition"
            >
              Create Your First Room
            </button>
          </div>
        )}
      </div>
    </motion.div>
  );
}
