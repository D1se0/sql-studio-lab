import { AnimatePresence, motion } from "framer-motion";
import {
  AlertTriangle,
  Columns3,
  Database as DbIcon,
  ExternalLink,
  Focus,
  KeyRound,
  Layers,
  Loader2,
  Maximize2,
  Minus,
  Network,
  Plus,
  Search,
  Table2,
  Waypoints,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api";
import { edgePath, layoutGraph, nodeHeight, type Point } from "../lib/graph";
import { humanBytes, num } from "../lib/format";
import type { DatabaseInfo, RelationsPayload } from "../types";
import { Shell } from "./Modals";

interface Props {
  databases: DatabaseInfo[];
  initialDb: string | null;
  onClose: () => void;
  onInspect: (db: string, table: string) => void;
  onOpenSql: (db: string, table: string) => void;
}

const NODE_W = 196;
const MIN_ZOOM = 0.12;
const MAX_ZOOM = 2.6;

const clamp = (value: number, low: number, high: number) =>
  Math.max(low, Math.min(high, value));

const shortType = (type: string) =>
  type
    .replace(/^varchar\((\d+)\)$/i, "varchar($1)")
    .replace(/^int(eger)?/i, "int")
    .replace(/unsigned/gi, "u")
    .replace(/character set \w+/gi, "")
    .replace(/collate \S+/gi, "")
    .trim();

interface DragState {
  id: string;
  startX: number;
  startY: number;
  baseX: number;
  baseY: number;
}

export function SchemaMap({
  databases,
  initialDb,
  onClose,
  onInspect,
  onOpenSql,
}: Props) {
  const fallback =
    initialDb ||
    databases.find((database) => !database.system)?.name ||
    databases[0]?.name ||
    "";
  const [db, setDb] = useState(fallback);
  const [payload, setPayload] = useState<RelationsPayload | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [onlyRelated, setOnlyRelated] = useState(false);
  const [showColumns, setShowColumns] = useState(true);
  const [selected, setSelected] = useState<string | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const [positions, setPositions] = useState<Record<string, Point>>({});
  const [view, setView] = useState({ x: 0, y: 0, k: 1 });
  const [drag, setDrag] = useState<DragState | null>(null);
  const [panning, setPanning] = useState(false);
  const viewportRef = useRef<HTMLDivElement>(null);
  const panRef = useRef<{ startX: number; startY: number; baseX: number; baseY: number } | null>(
    null,
  );
  const fittedRef = useRef("");

  useEffect(() => {
    let alive = true;
    setBusy(true);
    setError(null);
    setPayload(null);
    setSelected(null);
    api
      .relations(db)
      .then(({ relations }) => {
        if (!alive) return;
        setPayload(relations);
      })
      .catch((problem: unknown) => {
        if (!alive) return;
        setError(problem instanceof Error ? problem.message : String(problem));
      })
      .finally(() => {
        if (alive) setBusy(false);
      });
    return () => {
      alive = false;
    };
  }, [db]);

  const relatedTables = useMemo(() => {
    const names = new Set<string>();
    for (const relation of payload?.relations ?? []) {
      names.add(relation.from.table);
      names.add(relation.to.table);
    }
    return names;
  }, [payload]);

  const visibleTables = useMemo(() => {
    if (!payload) return [];
    return payload.tables.filter((table) => !onlyRelated || relatedTables.has(table.name));
  }, [payload, onlyRelated, relatedTables]);

  const sizes = useMemo(
    () =>
      visibleTables.map((table) => ({
        id: table.name,
        width: NODE_W,
        height: nodeHeight(table.columns.length, showColumns),
      })),
    [visibleTables, showColumns],
  );

  const edges = useMemo(() => {
    const visible = new Set(visibleTables.map((table) => table.name));
    return (payload?.relations ?? []).filter(
      (relation) => visible.has(relation.from.table) && visible.has(relation.to.table),
    );
  }, [payload, visibleTables]);

  const layoutEdges = useMemo(
    () => edges.map((relation) => ({ from: relation.from.table, to: relation.to.table })),
    [edges],
  );

  const layout = useMemo(() => layoutGraph(sizes, layoutEdges), [sizes, layoutEdges]);

  const tableByName = useMemo(() => {
    const map = new Map<string, RelationsPayload["tables"][number]>();
    for (const table of payload?.tables ?? []) map.set(table.name, table);
    return map;
  }, [payload]);

  const fitTo = useCallback(
    (points: Record<string, Point>) => {
      const element = viewportRef.current;
      if (!element || sizes.length === 0) return;
      const rect = element.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (const size of sizes) {
        const point = points[size.id];
        if (!point) continue;
        minX = Math.min(minX, point.x - size.width / 2);
        maxX = Math.max(maxX, point.x + size.width / 2);
        minY = Math.min(minY, point.y - size.height / 2);
        maxY = Math.max(maxY, point.y + size.height / 2);
      }
      if (!Number.isFinite(minX)) return;
      const k = clamp(
        Math.min((rect.width - 90) / (maxX - minX), (rect.height - 90) / (maxY - minY)),
        MIN_ZOOM,
        1.2,
      );
      setView({
        k,
        x: rect.width / 2 - ((minX + maxX) / 2) * k,
        y: rect.height / 2 - ((minY + maxY) / 2) * k,
      });
    },
    [sizes],
  );

  useEffect(() => {
    setPositions(layout);
    const key = `${db}:${visibleTables.map((table) => table.name).join(",")}:${showColumns}`;
    const id = window.requestAnimationFrame(() => {
      if (fittedRef.current !== key) {
        fittedRef.current = key;
        fitTo(layout);
      }
    });
    return () => window.cancelAnimationFrame(id);
  }, [layout, db, visibleTables, showColumns, fitTo]);

  useEffect(() => {
    if (!drag) return;
    const move = (event: PointerEvent) => {
      setPositions((current) => ({
        ...current,
        [drag.id]: {
          x: drag.baseX + (event.clientX - drag.startX) / view.k,
          y: drag.baseY + (event.clientY - drag.startY) / view.k,
        },
      }));
    };
    const up = () => setDrag(null);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up, { once: true });
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
  }, [drag, view.k]);

  useEffect(() => {
    const element = viewportRef.current;
    if (!element) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = element.getBoundingClientRect();
      const pointerX = event.clientX - rect.left;
      const pointerY = event.clientY - rect.top;
      setView((current) => {
        const next = clamp(current.k * Math.exp(-event.deltaY * 0.0015), MIN_ZOOM, MAX_ZOOM);
        return {
          k: next,
          x: pointerX - (pointerX - current.x) * (next / current.k),
          y: pointerY - (pointerY - current.y) * (next / current.k),
        };
      });
    };
    element.addEventListener("wheel", onWheel, { passive: false });
    return () => element.removeEventListener("wheel", onWheel);
  }, [payload]);

  useEffect(() => {
    if (!panning) return;
    const move = (event: PointerEvent) => {
      const start = panRef.current;
      if (!start) return;
      setView((current) => ({
        ...current,
        x: start.baseX + (event.clientX - start.startX),
        y: start.baseY + (event.clientY - start.startY),
      }));
    };
    const up = () => {
      setPanning(false);
      panRef.current = null;
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up, { once: true });
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
  }, [panning]);

  const zoomBy = (factor: number) => {
    const element = viewportRef.current;
    if (!element) return;
    const rect = element.getBoundingClientRect();
    setView((current) => {
      const next = clamp(current.k * factor, MIN_ZOOM, MAX_ZOOM);
      return {
        k: next,
        x: rect.width / 2 - ((rect.width / 2 - current.x) * next) / current.k,
        y: rect.height / 2 - ((rect.height / 2 - current.y) * next) / current.k,
      };
    });
  };

  const query = search.trim().toLowerCase();
  const matches = useMemo(() => {
    if (!query) return null;
    const set = new Set<string>();
    for (const table of visibleTables) {
      if (
        table.name.toLowerCase().includes(query) ||
        table.columns.some((column) => column.name.toLowerCase().includes(query))
      ) {
        set.add(table.name);
      }
    }
    return set;
  }, [query, visibleTables]);

  const highlighted = hover ?? selected;
  const relatedToSelected = useMemo(() => {
    if (!highlighted) return new Set<string>();
    const set = new Set<string>([highlighted]);
    for (const relation of edges) {
      if (relation.from.table === highlighted) set.add(relation.to.table);
      if (relation.to.table === highlighted) set.add(relation.from.table);
    }
    return set;
  }, [highlighted, edges]);

  const selectedTable = selected ? tableByName.get(selected) : undefined;
  const selectedRelations = useMemo(
    () =>
      selected
        ? edges.filter(
            (relation) =>
              relation.from.table === selected || relation.to.table === selected,
          )
        : [],
    [edges, selected],
  );

  const databaseInfo = databases.find((database) => database.name === db);

  return (
    <Shell
      title="Mapa de esquema"
      sub={
        <>
          <span className="mono-chip">{db || "sin base"}</span>
          {payload && (
            <>
              <span className="dot-sep">·</span>
              <span>{num(payload.tables.length)} tablas</span>
              <span className="dot-sep">·</span>
              <span>{num(payload.relations.length)} relaciones</span>
            </>
          )}
          {databaseInfo && (
            <>
              <span className="dot-sep">·</span>
              <span>{humanBytes(databaseInfo.size)}</span>
            </>
          )}
        </>
      }
      onClose={onClose}
      xl
      flush
      testId="map-modal"
      footer={
        <>
          <span className="muted small map-hint">
            Arrastra una tabla para colocarla · arrastra el fondo para mover · rueda para acercar
          </span>
          <div className="spacer" />
          <button className="btn subtle" onClick={onClose}>
            Cerrar
          </button>
        </>
      }
    >
      <div className="map-layout">
        <aside className="map-dbs">
          <div className="map-dbs-head">
            <Network size={14} /> Bases
          </div>
          {databases.map((database) => (
            <button
              key={database.name}
              className={`map-db ${database.name === db ? "on" : ""}`}
              onClick={() => setDb(database.name)}
              data-testid="map-db"
              data-db={database.name}
              title={`${database.name} · ${num(database.tables)} tablas`}
            >
              <DbIcon size={13} />
              <span className="map-db-name">{database.name}</span>
              <span className="map-db-count">{num(database.tables)}</span>
            </button>
          ))}
          <div className="map-dbs-foot">
            Elige una base para dibujar sus tablas y sus claves foráneas.
          </div>
        </aside>

        <div className="map-main">
          <div className="map-tools">
            <div className="search map-search">
              <Search size={14} />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Resaltar tabla o columna…"
                spellCheck={false}
                data-testid="map-search"
              />
              {search && (
                <button className="clear" onClick={() => setSearch("")} aria-label="Limpiar">
                  <X size={12} />
                </button>
              )}
            </div>
            <button
              className={`map-toggle ${showColumns ? "on" : ""}`}
              onClick={() => setShowColumns((value) => !value)}
              data-testid="map-toggle-columns"
              title="Mostrar u ocultar las columnas"
            >
              <Columns3 size={14} /> Columnas
            </button>
            <button
              className={`map-toggle ${onlyRelated ? "on" : ""}`}
              onClick={() => setOnlyRelated((value) => !value)}
              data-testid="map-only-related"
              title="Ocultar tablas sin claves foráneas"
            >
              <Waypoints size={14} /> Con relaciones
            </button>
            <div className="spacer" />
            <div className="map-zoom">
              <button className="icon-btn" onClick={() => zoomBy(1 / 1.25)} title="Alejar" data-testid="map-zoom-out">
                <Minus size={14} />
              </button>
              <span className="zoom-label" data-testid="map-zoom">{Math.round(view.k * 100)}%</span>
              <button className="icon-btn" onClick={() => zoomBy(1.25)} title="Acercar" data-testid="map-zoom-in">
                <Plus size={14} />
              </button>
              <button className="icon-btn" onClick={() => fitTo(positions)} title="Encajar todo" data-testid="map-fit">
                <Focus size={14} />
              </button>
            </div>
          </div>

          <div
            className={`map-canvas ${panning ? "panning" : ""}`}
            ref={viewportRef}
            data-testid="map-canvas"
            onPointerDown={(event) => {
              if (event.target !== event.currentTarget) return;
              panRef.current = {
                startX: event.clientX,
                startY: event.clientY,
                baseX: view.x,
                baseY: view.y,
              };
              setPanning(true);
            }}
          >
            {busy && (
              <div className="map-loading">
                <Loader2 size={20} className="spin" />
                <span>Leyendo relaciones de {db}…</span>
              </div>
            )}
            {!busy && error && (
              <div className="error-card" data-testid="map-error">
                <span className="err-ico">
                  <AlertTriangle size={18} />
                </span>
                <div>
                  <div className="error-title">No se pudo leer el esquema</div>
                  <p>{error}</p>
                </div>
              </div>
            )}
            {!busy && !error && payload && visibleTables.length === 0 && (
              <div className="map-empty" data-testid="map-empty">
                <Layers size={26} />
                <p>No hay tablas que mostrar con este filtro.</p>
              </div>
            )}

            {!error && payload && visibleTables.length > 0 && (
              <svg className="map-svg" width="100%" height="100%" role="img" aria-label={`Mapa de ${db}`}>
                <defs>
                  <marker
                    id="map-arrow"
                    viewBox="0 0 10 10"
                    refX="8"
                    refY="5"
                    markerWidth="7"
                    markerHeight="7"
                    orient="auto-start-reverse"
                  >
                    <path d="M 0 0 L 10 5 L 0 10 z" className="arrow-head" />
                  </marker>
                  <pattern id="map-dots" width="26" height="26" patternUnits="userSpaceOnUse">
                    <circle cx="1.2" cy="1.2" r="1.1" className="map-dot" />
                  </pattern>
                </defs>
                <rect width="100%" height="100%" fill="url(#map-dots)" pointerEvents="none" />
                <g transform={`translate(${view.x} ${view.y}) scale(${view.k})`}>
                  <g className="map-edges">
                    {edges.map((relation, index) => {
                      const fromPoint = positions[relation.from.table];
                      const toPoint = positions[relation.to.table];
                      const fromTable = tableByName.get(relation.from.table);
                      const toTable = tableByName.get(relation.to.table);
                      if (!fromPoint || !toPoint || !fromTable || !toTable) return null;
                      const fromSize = {
                        x: fromPoint.x,
                        y: fromPoint.y,
                        width: NODE_W,
                        height: nodeHeight(fromTable.columns.length, showColumns),
                      };
                      const toSize = {
                        x: toPoint.x,
                        y: toPoint.y,
                        width: NODE_W,
                        height: nodeHeight(toTable.columns.length, showColumns),
                      };
                      const hot =
                        highlighted !== null &&
                        (relation.from.table === highlighted || relation.to.table === highlighted);
                      return (
                        <path
                          key={`${relation.name}-${index}`}
                          d={edgePath(fromSize, toSize)}
                          className={`map-edge ${hot ? "hot" : ""} ${
                            highlighted && !hot ? "dim" : ""
                          }`}
                          markerEnd="url(#map-arrow)"
                          data-testid="map-edge"
                        />
                      );
                    })}
                  </g>

                  {visibleTables.map((table) => {
                    const point = positions[table.name];
                    if (!point) return null;
                    const height = nodeHeight(table.columns.length, showColumns);
                    const isDim =
                      (matches !== null && !matches.has(table.name)) ||
                      (highlighted !== null && !relatedToSelected.has(table.name));
                    const shown = table.columns.slice(0, 5);
                    const more = table.columns.length - shown.length;
                    return (
                      <g
                        key={table.name}
                        transform={`translate(${point.x - NODE_W / 2} ${point.y - height / 2})`}
                        className={`map-node ${selected === table.name ? "selected" : ""} ${
                          isDim ? "dim" : ""
                        } ${highlighted === table.name ? "hot" : ""}`}
                        onPointerDown={(event) => {
                          event.stopPropagation();
                          setDrag({
                            id: table.name,
                            startX: event.clientX,
                            startY: event.clientY,
                            baseX: point.x,
                            baseY: point.y,
                          });
                        }}
                        onClick={(event) => {
                          event.stopPropagation();
                          setSelected((current) =>
                            current === table.name ? null : table.name,
                          );
                        }}
                        onDoubleClick={(event) => {
                          event.stopPropagation();
                          onInspect(db, table.name);
                        }}
                        onMouseEnter={() => setHover(table.name)}
                        onMouseLeave={() => setHover((current) => (current === table.name ? null : current))}
                        data-testid="map-node"
                        data-table={table.name}
                        data-type={table.type}
                      >
                        <rect width={NODE_W} height={height} rx={12} className="node-body" />
                        <path
                          d={`M 0 12 Q 0 0 12 0 L ${NODE_W - 12} 0 Q ${NODE_W} 0 ${NODE_W} 12 L ${NODE_W} 4 L 0 4 Z`}
                          className="node-accent"
                        />
                        <text x={12} y={22} className="node-title">
                          {table.name.length > 22 ? `${table.name.slice(0, 21)}…` : table.name}
                        </text>
                        <text x={NODE_W - 12} y={22} className="node-rows" textAnchor="end">
                          {table.type === "VIEW" ? "vista" : `${num(table.rows)}`}
                        </text>
                        {showColumns &&
                          shown.map((column, index) => {
                            const y = 45 + index * 18;
                            return (
                              <g key={column.name} className="node-col">
                                {column.key === "PRI" ? (
                                  <text x={12} y={y} className="col-key">
                                    PK
                                  </text>
                                ) : (
                                  <circle cx={17} cy={y - 3.5} r={2.1} className="col-dot" />
                                )}
                                <text x={32} y={y} className="col-name">
                                  {column.name.length > 17
                                    ? `${column.name.slice(0, 16)}…`
                                    : column.name}
                                </text>
                                <text x={NODE_W - 12} y={y} className="col-type" textAnchor="end">
                                  {shortType(column.type).slice(0, 14)}
                                </text>
                              </g>
                            );
                          })}
                        {showColumns && more > 0 && (
                          <text x={12} y={height - 6} className="node-more">
                            + {more} columna(s)
                          </text>
                        )}
                      </g>
                    );
                  })}
                </g>
              </svg>
            )}

            <div className="map-legend">
              <span>
                <i className="legend-line" /> clave foránea
              </span>
              <span>
                <KeyRound size={11} /> clave primaria
              </span>
              <span className="muted">doble clic: abrir datos</span>
            </div>

            <AnimatePresence>
              {selectedTable && (
                <motion.aside
                  className="map-side panel"
                  initial={{ opacity: 0, x: 22 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 22 }}
                  transition={{ duration: 0.18 }}
                  data-testid="map-side"
                >
                  <div className="map-side-head">
                    <div>
                      <div className="ms-title">
                        <Table2 size={14} /> {selectedTable.name}
                      </div>
                      <div className="muted small">
                        {selectedTable.columns.length} columnas · {num(selectedTable.rows)} filas ·{" "}
                        {selectedTable.type === "VIEW" ? "vista" : "tabla"}
                      </div>
                    </div>
                    <button className="x" onClick={() => setSelected(null)} aria-label="Cerrar detalle">
                      ×
                    </button>
                  </div>

                  <div className="map-side-cols">
                    {selectedTable.columns.map((column) => (
                      <div className="ms-col" key={column.name}>
                        {column.key === "PRI" ? (
                          <span className="key-pill pri">PK</span>
                        ) : (
                          <span className="ms-dot" />
                        )}
                        <span className="mono">{column.name}</span>
                        <span className="muted small">{shortType(column.type)}</span>
                      </div>
                    ))}
                  </div>

                  {selectedRelations.length > 0 && (
                    <div className="map-side-rel">
                      <div className="ms-sub">Relaciones</div>
                      {selectedRelations.map((relation, index) => (
                        <div className="ms-rel" key={`${relation.name}-${index}`}>
                          <span className="mono">
                            {relation.from.table}.{relation.from.column}
                          </span>
                          <span className="muted">→</span>
                          <span className="mono">
                            {relation.to.table}.{relation.to.column}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}

                  <div className="map-side-actions">
                    <button
                      className="btn subtle"
                      onClick={() => onOpenSql(db, selectedTable.name)}
                      data-testid="map-open-sql"
                    >
                      <ExternalLink size={13} /> SQL
                    </button>
                    <button
                      className="btn primary"
                      onClick={() => onInspect(db, selectedTable.name)}
                      data-testid="map-inspect"
                    >
                      <Maximize2 size={13} /> Ver datos
                    </button>
                  </div>
                </motion.aside>
              )}
            </AnimatePresence>
          </div>
        </div>
      </div>
    </Shell>
  );
}
