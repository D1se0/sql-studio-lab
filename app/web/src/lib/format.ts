const numberFormat = new Intl.NumberFormat("es-ES");

export const num = (value: number | null | undefined): string =>
  numberFormat.format(value ?? 0);

export function humanBytes(value: number): string {
  if (!value) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let size = value;
  let index = 0;
  while (size >= 1024 && index < units.length - 1) {
    size /= 1024;
    index += 1;
  }
  return `${size.toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

export function relativeTime(seconds: number): string {
  const diff = Math.max(0, Date.now() / 1000 - seconds);
  if (diff < 90) return "hace un momento";
  if (diff < 3600) return `hace ${Math.floor(diff / 60)} min`;
  if (diff < 86400) return `hace ${Math.floor(diff / 3600)} h`;
  if (diff < 604800) return `hace ${Math.floor(diff / 86400)} d`;
  return new Date(seconds * 1000).toLocaleDateString("es-ES");
}

const csvEscape = (value: string | null): string => {
  if (value === null) return "";
  return /[",\n;]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
};

/** Convierte filas en CSV (con BOM para que Excel respete los acentos). */
export function toCsv(columns: string[], rows: (string | null)[][]): string {
  return [
    columns.map(csvEscape).join(","),
    ...rows.map((row) => row.map(csvEscape).join(",")),
  ].join("\n");
}

export function downloadCsv(
  name: string,
  columns: string[],
  rows: (string | null)[][],
): void {
  const blob = new Blob(["\ufeff" + toCsv(columns, rows)], {
    type: "text/csv;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name.replace(/\.sql$/i, "") + ".csv";
  anchor.click();
  URL.revokeObjectURL(url);
}

export function sqlFilename(title: string): string {
  const base = title
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return `${base || "consulta"}.sql`;
}

const KEYWORDS = new Set([
  "SELECT", "FROM", "WHERE", "GROUP", "ORDER", "BY", "HAVING", "LIMIT",
  "OFFSET", "JOIN", "LEFT", "RIGHT", "INNER", "OUTER", "CROSS", "ON",
  "INSERT", "INTO", "VALUES", "UPDATE", "SET", "DELETE", "REPLACE",
  "CREATE", "ALTER", "DROP", "TABLE", "VIEW", "DATABASE", "SCHEMA",
  "PROCEDURE", "FUNCTION", "TRIGGER", "BEGIN", "END", "IF", "THEN", "ELSE",
  "ELSEIF", "WHILE", "DO", "DECLARE", "RETURN", "CALL", "AS", "AND", "OR",
  "NOT", "NULL", "IS", "IN", "EXISTS", "DISTINCT", "UNION", "ALL", "CASE",
  "WHEN", "DEFAULT", "PRIMARY", "KEY", "FOREIGN", "REFERENCES", "INDEX",
  "UNIQUE", "AUTO_INCREMENT", "USE", "SHOW", "DESCRIBE", "EXPLAIN", "WITH",
  "ASC", "DESC", "LIKE", "BETWEEN", "SIGNAL", "SQLSTATE", "MESSAGE_TEXT",
]);

const BREAK_BEFORE = new Set([
  "SELECT", "FROM", "WHERE", "HAVING", "LIMIT", "OFFSET", "UNION",
  "INSERT", "VALUES", "UPDATE", "SET", "DELETE", "JOIN", "LEFT", "RIGHT",
  "INNER", "CROSS", "CREATE", "ALTER", "DROP", "USE", "CALL", "BEGIN", "END",
]);

const INDENT_BEFORE = new Set(["AND", "OR", "ON", "WHEN", "ELSE"]);

const TOKEN_RE =
  /('(?:[^'\\]|\\.|'')*'|"(?:[^"\\]|\\.|"")*"|`(?:[^`]|``)*`|--[^\n]*|#[^\n]*|\/\*[\s\S]*?\*\/|[A-Za-z_][A-Za-z0-9_$]*|\s+|.)/g;

/** Formateo ligero: mayúsculas en palabras clave y saltos de línea por cláusula. */
export function formatSql(input: string): string {
  if (!input.trim()) return input;
  const tokens = input.match(TOKEN_RE) ?? [];
  let out = "";
  let selectList = false;
  let groupPending = false;
  let orderPending = false;

  const newline = (indent = 0) => {
    out = out.replace(/[ \t]+$/, "");
    if (out && !out.endsWith("\n")) out += "\n";
    else if (out && out.endsWith("\n\n")) out = out.slice(0, -1);
    out += " ".repeat(indent);
  };

  for (const raw of tokens) {
    if (/^\s+$/.test(raw)) {
      if (!out.endsWith("\n") && !out.endsWith(" ")) out += " ";
      continue;
    }
    if (raw.startsWith("--") || raw.startsWith("#") || raw.startsWith("/*")) {
      if (!out.endsWith("\n") && out.trim()) newline();
      out += raw.trimEnd() + "\n";
      continue;
    }
    const upper = raw.toUpperCase();
    const isWord = /^[A-Za-z_][A-Za-z0-9_$]*$/.test(raw);
    if (!isWord) {
      if (raw === "," && selectList) {
        newline(2);
        continue;
      }
      out += raw;
      continue;
    }
    if (!KEYWORDS.has(upper)) {
      out += raw;
      continue;
    }

    if (upper === "GROUP" || upper === "ORDER") {
      groupPending = upper === "GROUP";
      orderPending = upper === "ORDER";
      out += upper;
      continue;
    }
    if ((groupPending || orderPending) && upper === "BY") {
      if (!out.endsWith("\n")) newline();
      out += upper + " ";
      groupPending = false;
      orderPending = false;
      continue;
    }
    groupPending = false;
    orderPending = false;

    if (BREAK_BEFORE.has(upper) || INDENT_BEFORE.has(upper)) {
      const indent = INDENT_BEFORE.has(upper) ? 2 : 0;
      if (!(out.trim() === "" && indent === 0)) newline(indent);
    }
    out += upper + " ";
    if (upper === "SELECT") {
      selectList = true;
    } else if (upper === "FROM") {
      selectList = false;
    }
  }

  return out
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
