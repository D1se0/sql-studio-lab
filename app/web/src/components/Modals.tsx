import { motion } from "framer-motion";
import {
  AlertTriangle,
  Database as DbIcon,
  FileCode2,
  Trash2,
  Upload,
} from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { humanBytes, relativeTime } from "../lib/format";
import type { DatabaseInfo, FileInfo } from "../types";

interface ShellProps {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  small?: boolean;
  wide?: boolean;
  xl?: boolean;
  flush?: boolean;
  testId?: string;
  sub?: ReactNode;
}

/** Contenedor común de modales. Exportado para el inspector y el mapa de esquema. */
export function Shell({
  title,
  onClose,
  children,
  footer,
  small,
  wide,
  xl,
  flush,
  testId,
  sub,
}: ShellProps) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <motion.div
      className="modal-backdrop"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.16 }}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <motion.div
        className={[
          "modal",
          small ? "small" : "",
          wide ? "wide" : "",
          xl ? "xl" : "",
          flush ? "flush" : "",
        ]
          .filter(Boolean)
          .join(" ")}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        data-testid={testId}
        initial={{ y: 18, scale: 0.97, opacity: 0 }}
        animate={{ y: 0, scale: 1, opacity: 1 }}
        exit={{ y: 12, scale: 0.98, opacity: 0 }}
        transition={{ type: "spring", stiffness: 380, damping: 30 }}
      >
        <div className="modal-head">
          <div>
            <h2>{title}</h2>
            {sub && <div className="modal-sub">{sub}</div>}
          </div>
          <button className="x" onClick={onClose} aria-label="Cerrar" data-testid="modal-close">
            ×
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </motion.div>
    </motion.div>
  );
}

/* ------------------------------------------------------------------ import */
interface ImportProps {
  databases: DatabaseInfo[];
  busy: boolean;
  onClose: () => void;
  onImport: (sql: string, db: string, create: boolean) => void;
}

export function ImportModal({ databases, busy, onClose, onImport }: ImportProps) {
  const [file, setFile] = useState<{ name: string; size: number; text: string } | null>(null);
  const [db, setDb] = useState("");
  const [create, setCreate] = useState(true);
  const [over, setOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const readFile = async (picked: File) => {
    const text = await picked.text();
    setFile({ name: picked.name, size: picked.size, text });
  };

  return (
    <Shell
      title="Importar archivo .sql"
      onClose={onClose}
      testId="import-modal"
      footer={
        <>
          <button className="btn subtle" onClick={onClose}>
            Cancelar
          </button>
          <button
            className="btn primary"
            disabled={!file || busy}
            onClick={() => file && onImport(file.text, db.trim(), create)}
            data-testid="import-confirm"
          >
            {busy ? "Importando…" : "Importar y ejecutar"}
          </button>
        </>
      }
    >
      <div
        className={`dropzone ${over ? "over" : ""} ${file ? "ready" : ""}`}
        onClick={() => inputRef.current?.click()}
        onDragOver={(event) => {
          event.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(event) => {
          event.preventDefault();
          setOver(false);
          const dropped = event.dataTransfer.files[0];
          if (dropped) void readFile(dropped);
        }}
        data-testid="dropzone"
      >
        <input
          ref={inputRef}
          type="file"
          accept=".sql,text/plain"
          hidden
          onChange={(event) => {
            const picked = event.target.files?.[0];
            if (picked) void readFile(picked);
          }}
        />
        {file ? (
          <>
            <FileCode2 size={22} className="dz-ico" style={{ margin: "0 auto" }} />
            <p className="dz-file">{file.name}</p>
            <p className="dz-meta">
              {humanBytes(file.size)} · listo para importar
            </p>
          </>
        ) : (
          <>
            <Upload size={22} className="dz-ico" style={{ margin: "0 auto" }} />
            <p>
              <strong>Arrastra el .sql aquí</strong> o haz clic para elegirlo
            </p>
            <p className="muted small" style={{ marginTop: 4 }}>
              Acepta DELIMITER, procedimientos y triggers.
            </p>
          </>
        )}
      </div>

      <div className="field" style={{ marginTop: 14 }}>
        <label htmlFor="import-db">Base de datos destino</label>
        <input
          id="import-db"
          value={db}
          list="import-db-options"
          placeholder="vacío = la que indique el propio script"
          onChange={(event) => setDb(event.target.value)}
          data-testid="import-db"
          autoComplete="off"
        />
        <datalist id="import-db-options">
          {databases.map((item) => (
            <option key={item.name} value={item.name} />
          ))}
        </datalist>
      </div>

      <label className="check">
        <input
          type="checkbox"
          checked={create}
          onChange={(event) => setCreate(event.target.checked)}
        />
        Crear la base si no existe
      </label>

      {busy && (
        <div className="progress">
          <i />
        </div>
      )}
    </Shell>
  );
}

/* ------------------------------------------------------------------- nueva */
interface NewDbProps {
  onClose: () => void;
  onCreate: (name: string) => Promise<void>;
}

export function NewDbModal({ onClose, onCreate }: NewDbProps) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const valid = /^[A-Za-z0-9_$][A-Za-z0-9_$-]*$/.test(name.trim());

  const submit = async () => {
    if (!valid) {
      setError("Usa letras, números, guion o guion bajo (sin espacios).");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onCreate(name.trim());
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "No se pudo crear.");
      setBusy(false);
    }
  };

  return (
    <Shell
      title="Nueva base de datos"
      onClose={onClose}
      small
      testId="newdb-modal"
      footer={
        <>
          <button className="btn subtle" onClick={onClose}>
            Cancelar
          </button>
          <button className="btn primary" onClick={submit} disabled={busy} data-testid="newdb-confirm">
            {busy ? "Creando…" : "Crear"}
          </button>
        </>
      }
    >
      <div className="field">
        <label htmlFor="new-db-name">Nombre</label>
        <input
          id="new-db-name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") void submit();
          }}
          placeholder="practica_sql"
          autoFocus
          autoComplete="off"
          data-testid="newdb-name"
        />
      </div>
      <p className="muted small" style={{ margin: "0 0 8px" }}>
        Se crea con <code>utf8mb4_unicode_ci</code>.
      </p>
      {error && <div className="warn-box">{error}</div>}
    </Shell>
  );
}

/* -------------------------------------------------------------- guardar como */
interface SaveAsProps {
  initialName: string;
  files: FileInfo[];
  onClose: () => void;
  onSave: (name: string) => void;
}

export function SaveAsModal({ initialName, files, onClose, onSave }: SaveAsProps) {
  const [name, setName] = useState(initialName);
  const clean = name.trim();
  const withExtension = /\.sql$/i.test(clean) ? clean : `${clean}.sql`;
  const exists = files.some((file) => file.name.toLowerCase() === withExtension.toLowerCase());
  const valid = /^[A-Za-z0-9][A-Za-z0-9 ._-]{0,80}\.sql$/i.test(withExtension);

  return (
    <Shell
      title="Guardar en sql/"
      onClose={onClose}
      testId="saveas-modal"
      footer={
        <>
          <button className="btn subtle" onClick={onClose}>
            Cancelar
          </button>
          <button
            className="btn primary"
            disabled={!valid}
            onClick={() => onSave(withExtension)}
            data-testid="save-confirm"
          >
            {exists ? "Sobrescribir" : "Guardar"}
          </button>
        </>
      }
    >
      <div className="field">
        <label htmlFor="save-name">Nombre del archivo</label>
        <input
          id="save-name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && valid) onSave(withExtension);
          }}
          autoFocus
          spellCheck={false}
          autoComplete="off"
          data-testid="save-name"
        />
      </div>
      {!valid && clean.length > 0 && (
        <p className="small" style={{ color: "var(--red)", margin: "0 0 10px" }}>
          Nombre no válido: solo letras, números, espacios, guion o guion bajo.
        </p>
      )}
      {exists && (
        <div className="warn-box" style={{ marginBottom: 10 }}>
          <AlertTriangle size={15} />
          <span>
            Ya existe <code>sql/{withExtension}</code>: se sobrescribirá al guardar.
          </span>
        </div>
      )}
      <div className="field">
        <label>Archivos existentes</label>
        <div className="file-list">
          {files.length === 0 && <p className="muted small">Todavía no hay ficheros en sql/.</p>}
          {files.slice(0, 40).map((file) => (
            <button
              key={file.name}
              className={`file-row ${file.name === withExtension ? "on" : ""}`}
              onClick={() => setName(file.name)}
            >
              <FileCode2 size={14} className="muted" />
              <span className="f-name">{file.name}</span>
              <span className="f-meta">
                {humanBytes(file.bytes)} · {relativeTime(file.mtime)}
              </span>
            </button>
          ))}
        </div>
      </div>
    </Shell>
  );
}

/* ------------------------------------------------------------------- abrir */
interface OpenFileProps {
  files: FileInfo[];
  onClose: () => void;
  onOpen: (name: string) => void;
}

export function OpenFileModal({ files, onClose, onOpen }: OpenFileProps) {
  const [query, setQuery] = useState("");
  const shown = files.filter((file) =>
    file.name.toLowerCase().includes(query.trim().toLowerCase()),
  );

  return (
    <Shell
      title="Abrir un .sql de sql/"
      onClose={onClose}
      testId="open-modal"
      footer={
        <button className="btn subtle" onClick={onClose}>
          Cerrar
        </button>
      }
    >
      <div className="field">
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Filtrar archivos…"
          autoFocus
          spellCheck={false}
          data-testid="open-filter"
        />
      </div>
      <div className="file-list" style={{ maxHeight: 320 }}>
        {shown.length === 0 && (
          <p className="muted small">{files.length ? "Ningún archivo coincide." : "No hay .sql en sql/."}</p>
        )}
        {shown.map((file) => (
          <button
            key={file.name}
            className="file-row"
            onClick={() => onOpen(file.name)}
            data-testid="file-row"
            data-file={file.name}
          >
            <DbIcon size={14} className="muted" />
            <span className="f-name">{file.name}</span>
            <span className="f-meta">
              {humanBytes(file.bytes)} · {relativeTime(file.mtime)}
            </span>
          </button>
        ))}
      </div>
    </Shell>
  );
}

/* -------------------------------------------------------------------- borrar */
interface DropDbProps {
  name: string;
  onClose: () => void;
  onConfirm: () => void;
}

export function DropDbModal({ name, onClose, onConfirm }: DropDbProps) {
  return (
    <Shell
      title={`Borrar la base ${name}`}
      onClose={onClose}
      small
      testId="dropdb-modal"
      footer={
        <>
          <button className="btn subtle" onClick={onClose}>
            Cancelar
          </button>
          <button
            className="btn"
            style={{ background: "rgba(251,113,133,.15)", borderColor: "rgba(251,113,133,.4)", color: "#ffd6dd" }}
            onClick={onConfirm}
            data-testid="dropdb-confirm"
          >
            <Trash2 size={14} /> Borrar definitivamente
          </button>
        </>
      }
    >
      <div className="warn-box" style={{ marginBottom: 10 }}>
        <AlertTriangle size={16} />
        <span>
          Se eliminarán <strong>{name}</strong> y todas sus tablas. Esto no se puede deshacer.
        </span>
      </div>
      <p className="muted small">
        Si quieres conservar algo, exporta antes las tablas a CSV o haz una copia del volumen.
      </p>
    </Shell>
  );
}

/* --------------------------------------------------------------------- ayuda */
export function HelpModal({ onClose }: { onClose: () => void }) {
  const rows: [string, string][] = [
    ["Ctrl + Enter", "Ejecutar todo el editor (o solo la selección)"],
    ["Ctrl + S", "Guardar la pestaña en sql/ (pide nombre la primera vez)"],
    ["Ctrl + P", "Paleta de comandos: tablas, bases y acciones"],
    ["Ctrl + T", "Nueva pestaña de consulta"],
    ["Ctrl + W", "Cerrar la pestaña actual"],
    ["Ctrl + K", "Buscar base, tabla o vista en el árbol"],
    ["Ctrl + L", "Limpiar el panel de salida"],
    ["Ctrl + Shift + M", "Abrir el mapa de esquema de la base actual"],
    ["Clic en una tabla", "Abrir la ventana de datos con paginación, orden y filtro"],
    ["Doble clic en el mapa", "Abrir los datos de esa tabla"],
    ["Súper + Espacio", "Menú de aplicaciones → «SQL Studio»"],
  ];

  return (
    <Shell title="Atajos y ayuda" onClose={onClose} testId="help-modal" footer={
      <button className="btn primary" onClick={onClose}>
        Entendido
      </button>
    }>
      <div className="help-grid">
        {rows.map(([keys, text]) => (
          <div key={keys} style={{ display: "contents" }}>
            <div>
              <kbd>{keys}</kbd>
            </div>
            <div>{text}</div>
          </div>
        ))}
      </div>
      <p className="muted small">
        El SQL que guardas queda en <code>10_SQL_Lab/sql/</code>, junto a los ficheros que cargas con
        <code> ./sql-lab load</code>.
      </p>
    </Shell>
  );
}
