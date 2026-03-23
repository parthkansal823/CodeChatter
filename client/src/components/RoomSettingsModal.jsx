import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { motion as Motion, AnimatePresence } from "framer-motion";
import toast from "react-hot-toast";

import { Button } from "./ui/Button";

import { useAuth } from "../hooks/useAuth";
import { API_ENDPOINTS } from "../config/security";
import { secureFetch, sanitizeInput } from "../utils/security";

export default function RoomSettingsModal({ room, isOpen, onClose, onUpdate }) {
  const { token } = useAuth();
  const [name, setName] = useState(room?.name || "");
  const [description, setDescription] = useState(room?.description || "");
  const [shell, setShell] = useState(room?.terminalShell || "bash");
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    setName(room?.name || "");
    setDescription(room?.description || "");
    setShell(room?.terminalShell || "bash");
  }, [isOpen, room?.description, room?.name, room?.terminalShell]);



  const handleSave = async (e) => {
    e.preventDefault();
    setIsSaving(true);
    
    try {
      const updatedRoom = await secureFetch(
        API_ENDPOINTS.UPDATE_ROOM_SETTINGS(room.id),
        {
          method: "PUT",
          body: JSON.stringify({
            name: sanitizeInput(name) || null,
            description: sanitizeInput(description) || null,
            terminalShell: shell,
          }),
        },
        token
      );
      
      toast.success("Settings saved");
      if (onUpdate) {
        onUpdate(updatedRoom);
      }
      onClose();
    } catch (error) {
      toast.error(error.message || "Failed to save settings");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <Motion.div 
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/30 p-4 backdrop-blur-sm"
        >
          <Motion.form
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            transition={{ type: "spring", bounce: 0.4, duration: 0.5 }}
            onSubmit={handleSave}
            className="w-full max-w-lg overflow-hidden rounded-3xl border border-zinc-200 bg-white/95 shadow-2xl backdrop-blur-xl dark:border-white/10 dark:bg-[#09090b]/95"
          >
            <div className="flex items-center justify-between border-b border-zinc-200 px-6 py-4 dark:border-white/10">
          <h2 className="text-lg font-semibold text-zinc-900 dark:text-white">Workspace Settings</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-2 text-zinc-500 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800 transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        <div className="space-y-5 p-6 text-zinc-900 dark:text-zinc-100">
          <div>
            <label className="mb-2 block text-sm font-medium">Room Name</label>
            <input
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Workspace name"
              className="w-full rounded-lg border border-zinc-200 bg-white px-4 py-2 text-sm outline-none transition focus:border-zinc-400 dark:border-zinc-700 dark:bg-zinc-950"
            />
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium">Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional description"
              rows={2}
              className="w-full resize-none rounded-lg border border-zinc-200 bg-white px-4 py-2 text-sm outline-none transition focus:border-zinc-400 dark:border-zinc-700 dark:bg-zinc-950"
            />
          </div>
          
          <div>
            <label className="mb-2 block text-sm font-medium">Terminal Shell</label>
            <p className="mb-3 text-xs text-zinc-500 dark:text-zinc-400">
              Changes will apply next time you open the terminal or refresh.
            </p>
            <div className="grid grid-cols-3 gap-2">
              {[
                { id: "bash", name: "Git Bash" },
                { id: "powershell", name: "PowerShell" },
                { id: "cmd", name: "CMD" }
              ].map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setShell(s.id)}
                  className={`rounded-lg border px-3 py-2 text-center text-sm font-medium transition-colors ${
                    shell === s.id
                      ? "border-zinc-900 bg-zinc-900 text-white dark:border-white dark:bg-white dark:text-zinc-950 shadow-sm"
                      : "border-zinc-200 bg-white text-zinc-600 hover:border-zinc-300 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-400 dark:hover:border-zinc-700"
                  }`}
                >
                  {s.name}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="flex items-center justify-end gap-3 border-t border-zinc-200 px-6 py-4 dark:border-white/10">
          <Button
            type="button"
            onClick={onClose}
            variant="ghost"
          >
            Cancel
          </Button>
          <Button
            type="submit"
            disabled={isSaving || !name.trim()}
            isLoading={isSaving}
          >
            Save Settings
          </Button>
        </div>
      </Motion.form>
    </Motion.div>
    )}
    </AnimatePresence>
  );
}
