import { AnimatePresence, motion } from "framer-motion";
import { AlertTriangle, CheckCircle2, Info } from "lucide-react";
import type { ToastItem } from "../types";

const ICONS = {
  success: CheckCircle2,
  error: AlertTriangle,
  info: Info,
};

export function Toasts({ items }: { items: ToastItem[] }) {
  return (
    <div className="toasts">
      <AnimatePresence initial={false}>
        {items.map((item) => {
          const Icon = ICONS[item.kind];
          return (
            <motion.div
              key={item.id}
              className={`toast ${item.kind}`}
              initial={{ opacity: 0, y: 16, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, x: 24, scale: 0.97 }}
              transition={{ type: "spring", stiffness: 420, damping: 32 }}
              data-testid="toast"
            >
              <span className="t-ico">
                <Icon size={16} />
              </span>
              <span>{item.text}</span>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}
