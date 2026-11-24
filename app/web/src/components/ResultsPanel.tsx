import { useEffect, useMemo, useRef } from "react";
import {
  AlertTriangle,
  Check,
  Download,
  Eraser,
  Table2,
} from "lucide-react";
import { num } from "../lib/format";
import type { StatementResult, Tab } from "../types";

const RENDER_LIMIT = 800;

const NUMERIC = /^-?\d+([.,]\d+)?$/;

interface Props {
  tab: Tab;
  onSelectStatement: (index: number) => void;
  onClear: () => void;
  onExport: () => void;
}

function DataTable({ statement }: { statement: StatementResult }) {
  const columns = statement.columns ?? [];
  const rows = statement.rows ?? [];
  const shown = rows.slice(0, RENDER_LIMIT);
  const numericColumns = useMemo(
    () =>
      columns.map((_, index) =>
        rows.length > 0 &&
        rows.slice(0, 40).every((row) => {
          const value = row[index];
          return value === null || value === undefined || NUMERIC.test(String(value));
        }),
      ),
    [columns, rows],
  );

  return (
    <>
      <div className="grid-wrap">
        <table className="data-grid" data-testid="result-table">
          <thead>
            <tr>
              {columns.map((column, index) => (
                <th key={`${column}-${index}`}>{column}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.map((row, rowIndex) => (
              <tr key={rowIndex}>
                {row.map((cell, cellIndex) => (
                  <td
                    key={cellIndex}
                    className={[
                      cell === null ? "null" : "",
                      cell !== null && numericColumns[cellIndex] ? "num" : "",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                    title={cell === null ? "NULL" : String(cell)}
                  >
                    {cell === null ? "NULL" : String(cell)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="note">
        <span data-testid="row-count">{num(statement.total_rows ?? rows.length)} fila(s)</span>
        {rows.length > RENDER_LIMIT
          ? ` · mostrando las primeras ${num(RENDER_LIMIT)} en pantalla`
          : ""}
        {statement.truncated ? " · resultado truncado por el límite del servidor" : ""}
        {rows.length === 0 ? " · sin resultados" : ""}
      </div>
    </>
  );
}

export function ResultsPanel({ tab, onSelectStatement, onClear, onExport }: Props) {
  const result = tab.result;
  const bodyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bodyRef.current?.scrollTo({ top: 0 });
  }, [tab.activeStatement, result]);

  const statement = result?.statements[tab.activeStatement] ?? result?.statements[0];
  const hasError = Boolean(statement && !statement.ok);

  return (
    <section className="output panel" data-testid="output">
      <div className="output-head">
        <div className="output-title">
          <span className="terminal-dots">
            <i />
            <i />
            <i />
          </span>
          <span>Salida</span>
          <span
            className={`pill ${result ? (hasError ? "err" : "ok") : ""}`}
            data-testid="output-summary"
          >
            {!result
              ? "sin ejecutar"
              : hasError
                ? `error${statement?.error?.code ? ` ${statement.error.code}` : ""}`
                : `${result.count} sentencia(s) · ${num(Math.round(result.ms))} ms`}
          </span>
        </div>
        <div className="output-actions">
          <button className="mini" onClick={onExport} data-testid="export-btn" title="Descargar el resultado en CSV">
            <Download size={12} style={{ verticalAlign: "-2px", marginRight: 4 }} />
            CSV
          </button>
          <button className="mini" onClick={onClear} data-testid="clear-output">
            <Eraser size={12} style={{ verticalAlign: "-2px", marginRight: 4 }} />
            Limpiar
          </button>
        </div>
      </div>

      {tab.loading && <div className="loading-strip" />}

      {result && result.statements.length > 1 && (
        <div className="stmt-chips">
          {result.statements.map((item, index) => (
            <button
              key={index}
              className={`chip ${index === tab.activeStatement ? "on" : ""} ${item.ok ? "" : "err"}`}
              onClick={() => onSelectStatement(index)}
              data-testid="stmt-chip"
            >
              <span className="chip-kind">{index + 1} · {item.kind}</span>
              <span className="chip-state">
                {item.ok
                  ? item.columns
                    ? `${num(item.total_rows ?? item.rows?.length ?? 0)} filas`
                    : item.affected !== undefined
                      ? `${num(item.affected)} afectadas`
                      : item.ms !== undefined
                        ? `${num(Math.round(item.ms))} ms`
                        : "ok"
                  : `error ${item.error?.code ?? ""}`}
              </span>
            </button>
          ))}
        </div>
      )}

      <div className="output-body" ref={bodyRef}>
        {!result && !tab.error && (
          <div className="empty">
            <div className="empty-icon">
              <Table2 size={20} />
            </div>
            <p>Ejecuta una consulta para ver los resultados aquí.</p>
            <p className="muted small">
              Los errores de MySQL, los <code>SIGNAL</code> y los avisos también aparecen en este panel.
            </p>
            <p className="muted small" style={{ marginTop: 10 }}>
              <kbd>Ctrl</kbd> + <kbd>Enter</kbd> ejecutar · <kbd>Ctrl</kbd> + <kbd>S</kbd> guardar en
              sql/
            </p>
          </div>
        )}

        {tab.error && !result && (
          <div className="error-card" data-testid="error-card">
            <span className="err-ico">
              <AlertTriangle size={18} />
            </span>
            <div>
              <div className="error-title">No se pudo ejecutar</div>
              <p>{tab.error}</p>
            </div>
          </div>
        )}

        {statement && statement.skipped && (
          <div className="exec-note">
            <AlertTriangle size={15} />
            <span>No ejecutada: el script se detuvo en un error anterior.</span>
          </div>
        )}

        {statement && !statement.ok && !statement.skipped && statement.error && (
          <div className="error-card" data-testid="error-card">
            <span className="err-ico">
              <AlertTriangle size={18} />
            </span>
            <div>
              <div className="error-title">
                ERROR {statement.error.code || "?"}{" "}
                {statement.error.state && <span className="state">({statement.error.state})</span>}
              </div>
              <p data-testid="error-message">{statement.error.message}</p>
            </div>
          </div>
        )}

        {statement && statement.ok && statement.columns && <DataTable statement={statement} />}

        {statement && statement.ok && !statement.columns && (
          <div className="exec-note" data-testid="exec-note">
            <Check size={15} style={{ color: "var(--mint)" }} />
            <span>
              {statement.affected !== undefined ? (
                <>
                  <strong>{num(statement.affected)}</strong> fila(s) afectada(s)
                  {statement.insert_id ? ` · LAST_INSERT_ID = ${num(statement.insert_id)}` : ""}
                </>
              ) : (
                <>Sentencia <code>{statement.kind}</code> ejecutada sin resultados.</>
              )}
            </span>
          </div>
        )}
      </div>
    </section>
  );
}
