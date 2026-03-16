import { useState } from "react";
import { motion } from "framer-motion";
import { Plus, LogIn, Bell, Users, Code, Clock } from "lucide-react";

export default function Home() {
  const [rooms] = useState([
    { name: "DSA Practice", lang: "C++", last: "2 hours ago" },
    { name: "React Project", lang: "JavaScript", last: "Yesterday" },
  ]);

  const [onlineUsers] = useState(["Rahul", "Aman", "Niyati"]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-black via-gray-900 to-black text-white p-6">
      {/* Navbar */}
      <div className="flex justify-between items-center mb-8">
        <h1 className="text-2xl font-bold bg-gradient-to-r from-purple-400 to-blue-500 bg-clip-text text-transparent">
          CodeChatter
        </h1>

        <div className="flex items-center gap-6">
          <Bell className="cursor-pointer" />
          <img
            src="https://i.pravatar.cc/40"
            className="rounded-full border border-gray-600"
          />
        </div>
      </div>

      {/* Welcome Section */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="bg-white/5 backdrop-blur-lg border border-gray-700 rounded-2xl p-6 mb-8"
      >
        <h2 className="text-xl font-semibold mb-4">Welcome back 👋</h2>

        <div className="flex gap-4">
          <button className="flex items-center gap-2 bg-purple-600 hover:bg-purple-700 px-4 py-2 rounded-lg">
            <Plus size={18} /> Create Room
          </button>

          <button className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 px-4 py-2 rounded-lg">
            <LogIn size={18} /> Join Room
          </button>
        </div>
      </motion.div>

      {/* Grid Section */}
      <div className="grid md:grid-cols-2 gap-6">
        {/* Recent Rooms */}
        <div className="bg-white/5 backdrop-blur-lg border border-gray-700 rounded-2xl p-6">
          <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
            <Clock size={18} /> Recent Rooms
          </h3>

          <div className="space-y-3">
            {rooms.map((room, i) => (
              <div
                key={i}
                className="flex justify-between items-center bg-black/30 p-3 rounded-lg"
              >
                <div>
                  <p className="font-medium">{room.name}</p>
                  <p className="text-sm text-gray-400">{room.lang}</p>
                </div>
                <span className="text-xs text-gray-500">{room.last}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Online Developers */}
        <div className="bg-white/5 backdrop-blur-lg border border-gray-700 rounded-2xl p-6">
          <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
            <Users size={18} /> Online Developers
          </h3>

          <div className="space-y-3">
            {onlineUsers.map((user, i) => (
              <div
                key={i}
                className="flex items-center gap-3 bg-black/30 p-3 rounded-lg"
              >
                <span className="w-2 h-2 bg-green-500 rounded-full"></span>
                {user}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Quick Playground */}
      <div className="mt-8 bg-white/5 backdrop-blur-lg border border-gray-700 rounded-2xl p-6">
        <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
          <Code size={18} /> Quick Code Playground
        </h3>

        <textarea
          placeholder="Write quick code here..."
          className="w-full h-40 bg-black/40 border border-gray-700 rounded-lg p-4 font-mono text-sm focus:outline-none"
        />

        <div className="flex gap-3 mt-4">
          <button className="bg-green-600 hover:bg-green-700 px-4 py-2 rounded-lg">
            Run Code
          </button>

          <button className="bg-gray-700 hover:bg-gray-600 px-4 py-2 rounded-lg">
            Open Full Editor
          </button>
        </div>
      </div>

      {/* Activity Feed */}
      <div className="mt-8 bg-white/5 backdrop-blur-lg border border-gray-700 rounded-2xl p-6">
        <h3 className="text-lg font-semibold mb-4">Activity Feed</h3>

        <ul className="space-y-2 text-gray-300 text-sm">
          <li>Rahul created a Python room</li>
          <li>Niyati shared a code snippet</li>
          <li>Aman joined your collaboration</li>
        </ul>
      </div>
    </div>
  );
}
