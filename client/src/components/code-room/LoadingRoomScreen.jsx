import { LoaderCircle } from "lucide-react";

export default function LoadingRoomScreen() {
  return (
    <div className="flex h-screen items-center justify-center bg-white text-zinc-600 dark:bg-zinc-950 dark:text-zinc-300">
      <div className="flex items-center gap-3">
        <LoaderCircle className="animate-spin" size={18} />
        Loading room...
      </div>
    </div>
  );
}
