import { AnimatePresence, motion } from "framer-motion";
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Braces,
  Check,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Columns3,
  Copy,
  Download,
  ExternalLink,
  FileCode2,
  KeyRound,
  Layers,
  Loader2,
  RefreshCw,
  Search,
  Table2,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api";
import { downloadCsv, humanBytes, num } from "../lib/format";
import type { TableDetail, ToastKind } from "../types";
import { Shell } from "./Modals";

interface Props {
  db: string;
  table: string;
  onClose: () => void;
  onOpenSql: (db: string, table: string) => void;
  onToast: (text: string, kind?: ToastKind) => void;
}

type Section = "data" | "structure" | "indexes" | "sql";

const PAGE_SIZES = [25, 50, 100, 200];

const shortType = (type: string): string =>
  type
    .replace(/^varchar\((\d+)\)$/i, "varchar($1)")
    .replace(/^int(eger)?/i, "int")
    .replace(/unsigned/gi, "uns")
    .replace(/character set \w+/gi, "")
    .replace(/collate \S+/gi, "")
    .trim();

function RowDetail({
  columns,
  row,
  onCopy,
}: {
  columns: string[];
  row: (string | null)[];
  onCopy: () => void;
}) {
  const pairs = columns.map((column, index) => ({
    column,
    value: row[index] ?? null,
  }));
  return (
    <motion.aside
      className="row-detail panel"
      initial={{ opacity: 0, x: 18 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 18 }}
      transition={{ duration: 0.18 }}
      data-testid="row-detail"
    >
      <div className="rd-head">
        <span>
          <Braces size={13} /> Detalle de fila
        </span>
        <button className="mini" onClick={onCopy} title="Copiar la fila como JSON">
          <Copy size={12} /> JSON
        </button>
      </div>
      <div className="rd-body">
        {pairs.map(({ column, value }) => (
          <div className="rd-row" key={column}>
            <span className="rd-key">{column}</span>
            {value === null ? (
              <span className="rd-null">NULL</span>
            ) : (
              <span className="rd-val" title={value}>
                {value}
              </span>
            )}
          </div>
        ))}
      </div>
    </motion.aside>
  );
}

export function TableInspector({ db, table, onClose, onOpenSql, onToast }: Props) {
  const [detail, setDetail] = useState<TableDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);
  const [section, setSection] = useState<Section>("data");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [pageSize, setPageSize] = useState(50);
  const [page, setPage] = useState(0);
  const [order, setOrder] = useState("");
  const [dir, setDir] = useState<"asc" | "desc">("asc");
  const [selected, setSelected] = useState<number | null>(null);
  const [reload, setReload] = useState(0);
  const requestId = useRef(0);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setSearch(searchInput.trim());
      setPage(0);
    }, 280);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  useEffect(() => {
    const current = ++requestId.current;
    setBusy(true);
    setSelected(null);
    api
      .table(db, table, {
        limit: pageSize,
        offset: page * pageSize,
        order: order || undefined,
        dir,
        q: search || undefined,
      })
      .then(({ table: data }) => {
        if (current !== requestId.current) return;
        setDetail(data);
        setError(null);
      })
      .catch((problem: unknown) => {
        if (current !== requestId.current) return;
        setError(problem instanceof Error ? problem.message : String(problem));
      })
      .finally(() => {
        if (current === requestId.current) setBusy(false);
      });
  }, [db, table, page, pageSize, order, dir, search, reload]);

  const data = detail?.data;
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const currentPage = Math.min(page, totalPages - 1);

  useEffect(() => {
    if (page > totalPages - 1) setPage(totalPages - 1);
  }, [page, totalPages]);

  const toggleSort = (column: string) => {
    if (order !== column) {
      setOrder(column);
      setDir("asc");
    } else if (dir === "asc") {
      setDir("desc");
    } else {
      setOrder("");
      setDir("asc");
    }
    setPage(0);
  };

  const selectSql = useMemo(() => {
    const orderSql = order ? `\nORDER BY \`${order.replace(/`/g, "``")}\` ${dir.toUpperCase()}` : "";
    const filter = search
      ? `\n-- filtro aplicado en la ventana: ${search.replace(/\n/g, " ")}`
      : "";
    return `SELECT *\nFROM \`${db.replace(/`/g, "``")}\`.\`${table.replace(/`/g, "``")}\`${filter}${orderSql}\nLIMIT 100;`;
  }, [db, table, order, dir, search]);

  const copySelected = () => {
    if (!data || selected === null) return;
    const row = data.rows[selected];
    if (!row) return;
    const record = Object.fromEntries(
      data.columns.map((column, index) => [column, row[index] ?? null]),
    );
    void navigator.clipboard
      .writeText(JSON.stringify(record, null, 2))
      .then(() => onToast("Fila copiada como JSON", "success"))
      .catch(() => onToast("El portapapeles no está disponible.", "error"));
  };

  const exportPage = () => {
    if (!data) return;
    downloadCsv(`${db}.${table}`, data.columns, data.rows);
    onToast(`CSV exportado · ${data.rows.length} fila(s)`, "success");
  };

  const selectedRow =
    selected !== null && data?.rows[selected] ? data.rows[selected] : null;

  return (
    <Shell
      title={table}
      sub={
        <>
          <span className="mono-chip">{db}</span>
          <span className="dot-sep">·</span>
          <span>{detail?.type === "VIEW" ? "vista" : detail?.engine || "tabla"}</span>
          {detail && (
            <>
              <span className="dot-sep">·</span>
              <span>{num(detail.rows_estimate)} filas est.</span>
              <span className="dot-sep">·</span>
              <span>{humanBytes(detail.size)}</span>
            </>
          )}
          {detail?.comment && <span className="tbl-comment">— {detail.comment}</span>}
        </>
      }
      onClose={onClose}
      wide
      flush
      testId="table-modal"
      footer={
        <div className="inspector-foot">
          <div className="pager">
            <button
              className="icon-btn"
              disabled={currentPage === 0}
              onClick={() => setPage(0)}
              title="Primera página"
              data-testid="table-first"
            >
              <ChevronsLeft size={15} />
            </button>
            <button
              className="icon-btn"
              disabled={currentPage === 0}
              onClick={() => setPage((value) => Math.max(0, value - 1))}
              title="Página anterior"
              data-testid="table-prev"
            >
              <ChevronLeft size={15} />
            </button>
            <span className="pager-label" data-testid="table-page-info">
              Página <strong>{currentPage + 1}</strong> de {num(totalPages)}
              <span className="muted"> · {num(total)} fila(s)</span>
            </span>
            <button
              className="icon-btn"
              disabled={currentPage >= totalPages - 1}
              onClick={() => setPage((value) => Math.min(totalPages - 1, value + 1))}
              title="Página siguiente"
              data-testid="table-next"
            >
              <ChevronRight size={15} />
            </button>
            <button
              className="icon-btn"
              disabled={currentPage >= totalPages - 1}
              onClick={() => setPage(totalPages - 1)}
              title="Última página"
              data-testid="table-last"
            >
              <ChevronsRight size={15} />
            </button>
          </div>
          <div className="foot-actions">
            <button className="btn subtle" onClick={exportPage} disabled={!data} data-testid="table-export">
              <Download size={14} /> CSV
            </button>
            <button
              className="btn primary"
              onClick={() => onOpenSql(db, table)}
              data-testid="open-table-sql"
              title="Abrir esta tabla como consulta en el editor"
            >
              <ExternalLink size={14} /> Abrir en el editor
            </button>
          </div>
        </div>
      }
    >
      <div className="tbl-tabs" role="tablist">
        {(
          [
            ["data", "Datos", Table2],
            ["structure", "Estructura", Columns3],
            ["indexes", "Índices", KeyRound],
            ["sql", "SQL", FileCode2],
          ] as const
        ).map(([key, label, Icon]) => (
          <button
            key={key}
            role="tab"
            aria-selected={section === key}
            className={`tbl-tab ${section === key ? "on" : ""}`}
            onClick={() => setSection(key)}
            data-testid={`tbl-tab-${key}`}
          >
            <Icon size={14} /> {label}
            {key === "indexes" && detail && <span className="tbl-count">{detail.indexes.length}</span>}
            {key === "structure" && detail && (
              <span className="tbl-count">{detail.columns.length}</span>
            )}
          </button>
        ))}
        <div className="spacer" />
        <button
          className="icon-btn"
          onClick={() => setReload((value) => value + 1)}
          title="Recargar datos"
          data-testid="table-reload"
        >
          <RefreshCw size={14} className={busy ? "spin" : ""} />
        </button>
      </div>

      {error && (
        <div className="error-card" data-testid="table-error">
          <span className="err-ico">
            <AlertTriangle size={18} />
          </span>
          <div>
            <div className="error-title">No se pudo abrir la tabla</div>
            <p>{error}</p>
          </div>
        </div>
      )}

      {!error && section === "data" && (
        <div className="inspector-data">
          <div className="inspector-tools">
            <div className="search table-search">
              <Search size={14} />
              <input
                value={searchInput}
                onChange={(event) => setSearchInput(event.target.value)}
                placeholder="Filtrar en todas las columnas…"
                spellCheck={false}
                data-testid="table-search"
              />
              {searchInput && (
                <button className="clear" onClick={() => setSearchInput("")} aria-label="Limpiar filtro">
                  <X size={12} />
                </button>
              )}
            </div>
            <span className="muted small" data-testid="table-total">
              {busy ? "leyendo…" : `${num(total)} fila(s)${search ? " filtradas" : ""}`}
            </span>
            <div className="spacer" />
            <label className="page-size">
              Filas
              <select
                value={pageSize}
                onChange={(event) => {
                  setPageSize(Number(event.target.value));
                  setPage(0);
                }}
                data-testid="table-page-size"
              >
                {PAGE_SIZES.map((size) => (
                  <option key={size} value={size}>
                    {size}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className={`inspector-split ${selectedRow ? "with-detail" : ""}`}>
            <div className="grid-wrap inspector-grid">
              {busy && <div className="loading-strip" />}
              <table className="data-grid table-grid" data-testid="table-grid">
                <thead>
                  <tr>
                    <th className="row-num">#</th>
                    {(data?.columns ?? detail?.columns.map((column) => column.name) ?? []).map(
                      (column) => {
                        const info = detail?.columns.find((item) => item.name === column);
                        const active = order === column;
                        return (
                          <th
                            key={column}
                            className={`sortable ${active ? "sorted" : ""}`}
                            onClick={() => toggleSort(column)}
                            data-testid="table-col"
                            data-column={column}
                            title={`Ordenar por ${column}`}
                          >
                            <span className="th-inner">
                              {info?.key === "PRI" && <KeyRound size={11} className="pk-key" />}
                              <span>{column}</span>
                              <span className="th-type">{info ? shortType(info.type) : ""}</span>
                              {active ? (
                                dir === "asc" ? (
                                  <ArrowUp size={11} />
                                ) : (
                                  <ArrowDown size={11} />
                                )
                              ) : (
                                <ArrowUpDown size={11} className="th-sort" />
                              )}
                            </span>
                          </th>
                        );
                      },
                    )}
                  </tr>
                </thead>
                <tbody>
                  {(data?.rows ?? []).map((row, rowIndex) => (
                    <tr
                      key={rowIndex}
                      className={selected === rowIndex ? "selected" : ""}
                      onClick={() => setSelected(selected === rowIndex ? null : rowIndex)}
                      data-testid="table-row"
                      data-index={rowIndex}
                    >
                      <td className="row-num">{page * pageSize + rowIndex + 1}</td>
                      {row.map((cell, cellIndex) => (
                        <td
                          key={cellIndex}
                          className={cell === null ? "null" : ""}
                          title={cell === null ? "NULL" : String(cell)}
                        >
                          {cell === null ? "NULL" : String(cell)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
              {!busy && data && data.rows.length === 0 && (
                <div className="empty" style={{ minHeight: 200 }}>
                  <Layers size={22} />
                  <p>{search ? `Ninguna fila contiene «${search}».` : "La tabla no tiene filas."}</p>
                </div>
              )}
            </div>

            <AnimatePresence>
              {selectedRow && data && (
                <RowDetail columns={data.columns} row={selectedRow} onCopy={copySelected} />
              )}
            </AnimatePresence>
          </div>
        </div>
      )}

      {!error && section === "structure" && (
        <div className="inspector-scroll">
          <table className="struct-table" data-testid="structure-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Columna</th>
                <th>Tipo</th>
                <th>Nulo</th>
                <th>Clave</th>
                <th>Por defecto</th>
                <th>Extra</th>
              </tr>
            </thead>
            <tbody>
              {(detail?.columns ?? []).map((column, index) => (
                <tr key={column.name}>
                  <td className="muted">{index + 1}</td>
                  <td className="mono">{column.name}</td>
                  <td className="mono type">{column.type}</td>
                  <td>{column.nullable ? "sí" : "no"}</td>
                  <td>
                    {column.key === "PRI" && <span className="key-pill pri">PK</span>}
                    {column.key === "UNI" && <span className="key-pill uni">UQ</span>}
                    {column.key === "MUL" && <span className="key-pill mul">IDX</span>}
                    {!column.key && <span className="muted">—</span>}
                  </td>
                  <td className="mono">{column.default || <span className="muted">NULL</span>}</td>
                  <td className="mono muted">{column.extra || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {detail && detail.triggers.length > 0 && (
            <div className="triggers-box">
              <h3>Triggers</h3>
              {detail.triggers.map((trigger) => (
                <div className="trigger-row" key={trigger.name}>
                  <FileCode2 size={13} />
                  <span className="mono">{trigger.name}</span>
                  <span className="muted small">
                    {trigger.timing} {trigger.event}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {!error && section === "indexes" && (
        <div className="inspector-scroll">
          {(detail?.indexes.length ?? 0) === 0 && (
            <div className="empty" style={{ minHeight: 200 }}>
              <KeyRound size={22} />
              <p>Esta tabla no tiene índices.</p>
            </div>
          )}
          <div className="index-grid">
            {(detail?.indexes ?? []).map((index) => (
              <div className="index-card panel" key={index.name} data-testid="index-card">
                <div className="idx-head">
                  <span className="idx-ico">
                    <KeyRound size={14} />
                  </span>
                  <span className="mono">{index.name}</span>
                  {index.unique && <span className="key-pill uni">UNIQUE</span>}
                  <span className="idx-type">{index.type}</span>
                </div>
                <div className="idx-cols">
                  {index.columns.map((column, index2) => (
                    <span className="idx-col" key={`${column}-${index2}`}>
                      {column}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {!error && section === "sql" && (
        <div className="inspector-scroll sql-section">
          <div className="sql-block">
            <div className="sql-block-head">
              <span>Consulta para abrir en el editor</span>
              <div className="foot-actions">
                <button
                  className="mini"
                  onClick={() => {
                    void navigator.clipboard
                      .writeText(selectSql)
                      .then(() => onToast("SQL copiado", "success"))
                      .catch(() => onToast("El portapapeles no está disponible.", "error"));
                  }}
                >
                  <Copy size={12} /> Copiar
                </button>
                <button className="mini" onClick={() => onOpenSql(db, table)}>
                  <ExternalLink size={12} /> Abrir
                </button>
              </div>
            </div>
            <pre data-testid="sql-preview">{selectSql}</pre>
          </div>
          <div className="sql-block">
            <div className="sql-block-head">
              <span>DDL de la tabla</span>
              <button
                className="mini"
                onClick={() => {
                  if (!detail?.ddl) return;
                  void navigator.clipboard
                    .writeText(detail.ddl)
                    .then(() => onToast("DDL copiado", "success"))
                    .catch(() => onToast("El portapapeles no está disponible.", "error"));
                }}
              >
                <Copy size={12} /> Copiar
              </button>
            </div>
            <pre data-testid="ddl-preview">{detail?.ddl || "-- cargando…"}</pre>
          </div>
          <div className="sql-meta">
            <Check size={13} /> {detail?.collation || "—"} · {detail?.type || "tabla"}
          </div>
        </div>
      )}

      {busy && !detail && !error && (
        <div className="empty" style={{ minHeight: 260 }}>
          <Loader2 size={22} className="spin" />
          <p>Leyendo {db}.{table}…</p>
        </div>
      )}
    </Shell>
  );
}
