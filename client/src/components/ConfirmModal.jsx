import { motion as Motion, AnimatePresence } from "framer-motion";
import { Button } from "./ui/Button";

export default function ConfirmModal({
  isOpen,
  title,
  description,
  confirmText = "Confirm",
  cancelText = "Cancel",
  isDestructive = false,
  onConfirm,
  onCancel,
}) {
  return (
    <AnimatePresence>
      {isOpen && (
        <Motion.div 
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[100] flex items-center justify-center bg-zinc-950/30 p-4 backdrop-blur-sm"
        >
          <Motion.div
            initial={{ opacity: 0, y: 20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.95 }}
            transition={{ type: "spring", bounce: 0.4, duration: 0.5 }}
            className="w-full max-w-md overflow-hidden rounded-3xl border border-zinc-200 bg-white/90 p-6 shadow-2xl backdrop-blur-xl dark:border-white/10 dark:bg-[#09090b]/90"
          >
            <h2 className="text-xl font-semibold">{title}</h2>
            {description && (
              <p className="mt-3 text-sm text-zinc-600 dark:text-zinc-400 whitespace-pre-line leading-relaxed">
                {description}
              </p>
            )}
            
            <div className="mt-8 flex items-center justify-end gap-3">
              <Button
                type="button"
                onClick={onCancel}
                variant="ghost"
              >
                {cancelText}
              </Button>
              <Button
                type="button"
                onClick={onConfirm}
                variant={isDestructive ? "danger" : "primary"}
              >
                {confirmText}
              </Button>
            </div>
          </Motion.div>
        </Motion.div>
      )}
    </AnimatePresence>
  );
}
