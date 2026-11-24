import { AnimatePresence, motion } from "framer-motion";
import { ChevronDown, FileCode2, List, Plus, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { Tab } from "../types";

interface Props {
  tabs: Tab[];
  activeId: string;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  onAdd: () => void;
}

export function TabBar({ tabs, activeId, onSelect, onClose, onAdd }: Props) {
  const stripRef = useRef<HTMLDivElement>(null);
  const activeRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);

  // Mantiene visible la pestaña activa sin mover el scroll de la página.
  useEffect(() => {
    const strip = stripRef.current;
    const element = activeRef.current;
    if (!strip || !element) return;
    const left = element.offsetLeft;
    const right = left + element.offsetWidth;
    const padding = 10;
    if (left - padding < strip.scrollLeft) {
      strip.scrollTo({ left: Math.max(0, left - padding), behavior: "smooth" });
    } else if (right + padding > strip.scrollLeft + strip.clientWidth) {
      strip.scrollTo({
        left: right - strip.clientWidth + padding,
        behavior: "smooth",
      });
    }
  }, [activeId, tabs.length]);

  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  return (
    <div className="tabs-wrap" data-testid="tabs-wrap">
      <div className="tabs" ref={stripRef} data-testid="tabs">
        <AnimatePresence initial={false}>
          {tabs.map((tab) => (
            <motion.button
              key={tab.id}
              ref={(node) => {
                if (tab.id === activeId) activeRef.current = node;
              }}
              initial={{ opacity: 0, y: -5 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96 }}
              transition={{ duration: 0.16 }}
              className={`tab ${tab.id === activeId ? "on" : ""}`}
              onClick={() => onSelect(tab.id)}
              onAuxClick={(event) => {
                if (event.button === 1) onClose(tab.id);
              }}
              data-testid="tab"
              data-tab-id={tab.id}
              data-active={tab.id === activeId}
              title={tab.file ? `sql/${tab.file}` : tab.title}
            >
              <span className="ico">
                <FileCode2 size={14} />
              </span>
              <span className="tab-name">{tab.file ?? tab.title}</span>
              {tab.dirty && <span className="dirty-dot" title="Cambios sin guardar" />}
              <span
                className="tab-close"
                role="button"
                aria-label="Cerrar pestaña"
                data-testid="close-tab"
                onClick={(event) => {
                  event.stopPropagation();
                  onClose(tab.id);
                }}
              >
                <X size={12.5} />
              </span>
            </motion.button>
          ))}
        </AnimatePresence>
      </div>

      <div className="tab-tools">
        <button
          className="tab-add"
          onClick={onAdd}
          title="Nueva pestaña (Ctrl+T)"
          data-testid="new-tab"
        >
          <Plus size={15} />
        </button>
        <div className="tab-overflow" ref={menuRef}>
          <button
            className={`tab-more ${menuOpen ? "on" : ""}`}
            onClick={() => setMenuOpen((value) => !value)}
            title="Ver todas las pestañas"
            data-testid="tab-menu-btn"
          >
            <List size={14} />
            <span className="tab-count">{tabs.length}</span>
            <ChevronDown size={11} />
          </button>
          {menuOpen && (
            <div className="tab-menu" data-testid="tab-menu">
              <div className="tab-menu-head">Pestañas abiertas</div>
              {tabs.map((tab) => (
                <div
                  key={tab.id}
                  className={`tab-menu-row ${tab.id === activeId ? "on" : ""}`}
                  onClick={() => {
                    onSelect(tab.id);
                    setMenuOpen(false);
                  }}
                  data-testid="tab-menu-item"
                  data-tab-id={tab.id}
                >
                  <span className="tm-name">{tab.file ?? tab.title}</span>
                  {tab.dirty && <span className="dirty-dot" />}
                  <button
                    className="tm-close"
                    title="Cerrar"
                    onClick={(event) => {
                      event.stopPropagation();
                      onClose(tab.id);
                    }}
                  >
                    <X size={12} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
