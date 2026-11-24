import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowRight,
  Command,
  CornerDownLeft,
  Database as DbIcon,
  History,
  Loader2,
  Search,
  Table2,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

export type PaletteKind = "action" | "database" | "table" | "history";

export interface PaletteItem {
  id: string;
  kind: PaletteKind;
  label: string;
  hint?: string;
  meta?: string;
  onSelect: () => void;
}

interface Props {
  open: boolean;
  items: PaletteItem[];
  loading?: boolean;
  onClose: () => void;
}

const GROUP_LABEL: Record<PaletteKind, string> = {
  action: "Acciones",
  database: "Bases de datos",
  table: "Tablas y vistas",
  history: "Consultas recientes",
};

const ICON: Record<PaletteKind, typeof Search> = {
  action: Command,
  database: DbIcon,
  table: Table2,
  history: History,
};

export function CommandPalette({ open, items, loading, onClose }: Props) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setActive(0);
    const timer = window.setTimeout(() => inputRef.current?.focus(), 40);
    return () => window.clearTimeout(timer);
  }, [open]);

  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return items.slice(0, 80);
    return items
      .filter(
        (item) =>
          item.label.toLowerCase().includes(needle) ||
          (item.hint ?? "").toLowerCase().includes(needle),
      )
      .slice(0, 80);
  }, [items, query]);

  useEffect(() => {
    setActive(0);
  }, [query]);

  useEffect(() => {
    const element = listRef.current?.querySelector<HTMLElement>(
      `[data-index="${active}"]`,
    );
    element?.scrollIntoView({ block: "nearest" });
  }, [active]);

  if (!open) return null;

  const choose = (item: PaletteItem) => {
    item.onSelect();
    onClose();
  };

  let previousGroup = "";

  return (
    <AnimatePresence>
      <motion.div
        className="palette-backdrop"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.14 }}
        onMouseDown={(event) => {
          if (event.target === event.currentTarget) onClose();
        }}
        data-testid="palette-backdrop"
      >
        <motion.div
          className="palette"
          role="dialog"
          aria-modal="true"
          aria-label="Paleta de comandos"
          data-testid="palette"
          initial={{ y: -12, opacity: 0, scale: 0.985 }}
          animate={{ y: 0, opacity: 1, scale: 1 }}
          exit={{ y: -8, opacity: 0 }}
          transition={{ type: "spring", stiffness: 460, damping: 34 }}
        >
          <div className="palette-input">
            <Search size={16} />
            <input
              ref={inputRef}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.preventDefault();
                  onClose();
                } else if (event.key === "ArrowDown") {
                  event.preventDefault();
                  setActive((current) => (shown.length ? (current + 1) % shown.length : 0));
                } else if (event.key === "ArrowUp") {
                  event.preventDefault();
                  setActive((current) =>
                    shown.length ? (current - 1 + shown.length) % shown.length : 0,
                  );
                } else if (event.key === "Enter") {
                  event.preventDefault();
                  const item = shown[active];
                  if (item) choose(item);
                }
              }}
              placeholder="Busca una tabla, una base o un comando…"
              spellCheck={false}
              autoComplete="off"
              data-testid="palette-input"
            />
            {loading && <Loader2 size={14} className="spin muted" />}
            <kbd>Esc</kbd>
          </div>

          <div className="palette-list" ref={listRef} data-testid="palette-list">
            {shown.length === 0 && (
              <div className="palette-empty">
                {loading ? "Cargando tablas…" : `Sin resultados para «${query}».`}
              </div>
            )}
            {shown.map((item, index) => {
              const Icon = ICON[item.kind];
              const showGroup = item.kind !== previousGroup;
              previousGroup = item.kind;
              return (
                <div key={item.id} style={{ display: "contents" }}>
                  {showGroup && <div className="palette-group">{GROUP_LABEL[item.kind]}</div>}
                  <button
                    className={`palette-item ${index === active ? "on" : ""}`}
                    onMouseEnter={() => setActive(index)}
                    onClick={() => choose(item)}
                    data-testid="palette-item"
                    data-kind={item.kind}
                    data-index={index}
                  >
                    <span className={`pi-ico ${item.kind}`}>
                      <Icon size={14} />
                    </span>
                    <span className="pi-label">{item.label}</span>
                    {item.meta && <span className="pi-meta">{item.meta}</span>}
                    {item.hint && <span className="pi-hint">{item.hint}</span>}
                    <ArrowRight size={12} className="pi-arrow" />
                  </button>
                </div>
              );
            })}
          </div>

          <div className="palette-foot">
            <span>
              <kbd>↑</kbd> <kbd>↓</kbd> mover
            </span>
            <span>
              <kbd>
                <CornerDownLeft size={10} />
              </kbd>{" "}
              abrir
            </span>
            <span>
              <kbd>Ctrl</kbd> + <kbd>P</kbd> en cualquier momento
            </span>
            <span className="spacer" />
            <span className="muted">atajos: Ctrl+Enter · Ctrl+S · Ctrl+K</span>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
