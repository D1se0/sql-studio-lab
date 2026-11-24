import {
  Command,
  Database,
  FolderOpen,
  Network,
  Plus,
  RefreshCw,
  Upload,
} from "lucide-react";
import { num } from "../lib/format";

interface Props {
  databases: number;
  tables: number;
  rows: number;
  connected: boolean | null;
  refreshing: boolean;
  onRefresh: () => void;
  onImport: () => void;
  onNewDb: () => void;
  onOpenFile: () => void;
  onMap: () => void;
  onPalette: () => void;
}

function Stat({ value, label }: { value: number; label: string }) {
  return (
    <div className="stat">
      <span className="stat-value">{num(value)}</span>
      <span className="stat-label">{label}</span>
    </div>
  );
}

export function Header(props: Props) {
  const state =
    props.connected === null ? "wait" : props.connected ? "ok" : "bad";
  const text =
    props.connected === null
      ? "conectando con el contenedor…"
      : props.connected
        ? "MySQL 8.4 · sql-lab · 127.0.0.1:3306"
        : "contenedor sql-lab parado";

  return (
    <header className="topbar">
      <div className="brand">
        <div className="brand-badge">
          <Database size={20} strokeWidth={2.2} />
        </div>
        <div>
          <h1>SQL Studio</h1>
          <div className="brand-sub">
            <span className={`dot ${state}`} />
            <span data-testid="conn-text">{text}</span>
          </div>
        </div>
      </div>

      <div className="stats">
        <Stat value={props.databases} label="bases" />
        <Stat value={props.tables} label="tablas" />
        <Stat value={props.rows} label="filas est." />
      </div>

      <div className="top-actions">
        <button
          className="btn subtle palette-btn"
          onClick={props.onPalette}
          data-testid="palette-btn"
          title="Buscar tablas y comandos (Ctrl+P)"
        >
          <Command size={15} /> <span className="label">Buscar</span> <kbd>Ctrl P</kbd>
        </button>
        <button className="btn subtle" onClick={props.onMap} data-testid="map-btn" title="Mapa visual del esquema">
          <Network size={15} /> <span className="label">Mapa</span>
        </button>
        <button className="btn subtle" onClick={props.onOpenFile} data-testid="open-file-btn">
          <FolderOpen size={15} /> <span className="label">Abrir</span>
        </button>
        <button className="btn subtle" onClick={props.onImport} data-testid="import-btn">
          <Upload size={15} /> <span className="label">Importar .sql</span>
        </button>
        <button className="btn subtle" onClick={props.onNewDb} data-testid="new-db-btn">
          <Plus size={15} /> <span className="label">Nueva base</span>
        </button>
        <button
          className="btn subtle icon"
          onClick={props.onRefresh}
          title="Refrescar metadatos"
          data-testid="refresh-btn"
        >
          <RefreshCw size={15} className={props.refreshing ? "spin" : ""} />
        </button>
      </div>
    </header>
  );
}
