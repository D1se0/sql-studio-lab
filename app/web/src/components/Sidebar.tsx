import { AnimatePresence, motion } from "framer-motion";
import {
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  Database as DbIcon,
  Eye,
  FileCode2,
  Maximize2,
  Network,
  Search,
  Table2,
  Trash2,
  X,
} from "lucide-react";
import type { RefObject } from "react";
import { num } from "../lib/format";
import type { DatabaseInfo, SchemaInfo } from "../types";

interface Props {
  databases: DatabaseInfo[];
  schemas: Record<string, SchemaInfo>;
  loadingSchemas: string[];
  openDbs: string[];
  search: string;
  searchRef: RefObject<HTMLInputElement>;
  onSearch: (value: string) => void;
  onToggle: (db: string) => void;
  onCollapseAll: () => void;
  onExpandAll: () => void;
  onInspect: (db: string, table: string) => void;
  onOpenTableSql: (db: string, table: string) => void;
  onMap: (db: string) => void;
  onDropDb: (db: string) => void;
  onHelp: () => void;
}

export function Sidebar(props: Props) {
  const query = props.search.trim().toLowerCase();
  const searching = query.length > 0;

  const visibleDbs = props.databases
    .map((db) => {
      if (!searching) return { db, tables: undefined as string[] | undefined };
      const schema = props.schemas[db.name];
      const matches = (schema?.tables ?? [])
        .filter((table) => table.name.toLowerCase().includes(query))
        .map((table) => table.name);
      return { db, tables: matches };
    })
    .filter(({ db, tables }) => {
      if (!searching) return true;
      return db.name.toLowerCase().includes(query) || (tables?.length ?? 0) > 0;
    });

  const matchCount = visibleDbs.reduce(
    (total, item) => total + (item.tables?.length ?? 0),
    0,
  );

  return (
    <aside className="sidebar panel" data-testid="sidebar">
      <div className="search">
        <Search size={15} />
        <input
          ref={props.searchRef}
          value={props.search}
          onChange={(event) => props.onSearch(event.target.value)}
          placeholder="Buscar base, tabla o vista…"
          spellCheck={false}
          autoComplete="off"
          data-testid="search-input"
        />
        {props.search ? (
          <button className="clear" onClick={() => props.onSearch("")} aria-label="Limpiar búsqueda">
            <X size={13} />
          </button>
        ) : (
          <kbd>Ctrl K</kbd>
        )}
      </div>

      <div className="tree-tools">
        <span>{searching ? `${matchCount} coincidencia(s)` : `${props.databases.length} bases`}</span>
        <div>
          <button onClick={props.onCollapseAll} title="Plegar todo el árbol" data-testid="collapse-all">
            <ChevronsDownUp size={15} />
          </button>
          <button onClick={props.onExpandAll} title="Desplegar todas las bases" data-testid="expand-all">
            <ChevronsUpDown size={15} />
          </button>
        </div>
      </div>

      <div className="tree" data-testid="db-tree">
        {visibleDbs.map(({ db, tables }) => {
          const open = props.openDbs.includes(db.name);
          const schema = props.schemas[db.name];
          const loading = props.loadingSchemas.includes(db.name);
          const all = schema?.tables ?? [];
          const list = searching
            ? all.filter((table) => tables?.includes(table.name))
            : all;
          const showTables = (open || searching) && !loading;

          return (
            <div className="db-block" key={db.name}>
              <div
                className={`db-row ${open || (searching && list.length > 0) ? "open" : ""}`}
                role="button"
                tabIndex={0}
                data-testid="db-node"
                data-db={db.name}
                onClick={() => props.onToggle(db.name)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") props.onToggle(db.name);
                }}
              >
                <span className="chev">
                  <ChevronRight size={14} />
                </span>
                <span className="db-ico">
                  <DbIcon size={14} />
                </span>
                <span className="db-name">{db.name}</span>
                {db.system && <span className="sys-tag">sys</span>}
                <span className="badge">{num(db.tables)}</span>
                <span
                  className="db-hover"
                  role="button"
                  title={`Mapa de esquema de ${db.name}`}
                  data-testid="db-map"
                  onClick={(event) => {
                    event.stopPropagation();
                    props.onMap(db.name);
                  }}
                >
                  <Network size={13} />
                </span>
                {!db.system && (
                  <span
                    className="db-hover"
                    role="button"
                    title={`Borrar ${db.name}`}
                    data-testid="drop-db"
                    onClick={(event) => {
                      event.stopPropagation();
                      props.onDropDb(db.name);
                    }}
                  >
                    <Trash2 size={13} />
                  </span>
                )}
              </div>

              <AnimatePresence initial={false}>
                {(loading || (showTables && list.length > 0)) && (
                  <motion.div
                    className="tables-wrap"
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
                  >
                    <div className="tables">
                      {loading
                        ? [0, 1, 2, 3].map((row) => <div className="skeleton-row" key={row} />)
                        : list.map((table) => {
                            const isView = table.type === "VIEW";
                            return (
                              <div
                                key={table.name}
                                className={`table-row ${isView ? "view" : ""}`}
                                role="button"
                                tabIndex={0}
                                onClick={() => props.onInspect(db.name, table.name)}
                                onKeyDown={(event) => {
                                  if (event.key === "Enter" || event.key === " ") {
                                    props.onInspect(db.name, table.name);
                                  }
                                }}
                                data-testid="table-node"
                                data-table={table.name}
                                title={`${table.name} · ${num(table.rows)} filas · ${table.engine || table.type}`}
                              >
                                <span className="t-ico">
                                  {isView ? <Eye size={13} /> : <Table2 size={13} />}
                                </span>
                                <span className="t-name">{table.name}</span>
                                {!isView && <span className="row-count">{num(table.rows)}</span>}
                                <span className="row-actions">
                                  <span
                                    role="button"
                                    className="row-act"
                                    title="Ver los datos en una ventana"
                                    data-testid="inspect-table"
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      props.onInspect(db.name, table.name);
                                    }}
                                  >
                                    <Maximize2 size={12} />
                                  </span>
                                  <span
                                    role="button"
                                    className="row-act"
                                    title="Abrir esta tabla en el editor"
                                    data-testid="sql-table"
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      props.onOpenTableSql(db.name, table.name);
                                    }}
                                  >
                                    <FileCode2 size={12} />
                                  </span>
                                </span>
                              </div>
                            );
                          })}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          );
        })}

        {visibleDbs.length === 0 && (
          <div className="empty" style={{ minHeight: 120 }}>
            <p className="muted small">Sin coincidencias para «{props.search}».</p>
          </div>
        )}
      </div>

      <footer className="side-foot">
        <button className="link" onClick={props.onHelp} data-testid="help-btn">
          Atajos y ayuda
        </button>
        <span className="muted small" data-testid="tree-total">
          {num(props.databases.length)} bases · {num(props.databases.reduce((sum, db) => sum + db.tables, 0))} tablas
        </span>
      </footer>
    </aside>
  );
}
