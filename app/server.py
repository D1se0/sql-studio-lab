#!/usr/bin/env python3
"""SQL Studio — backend local del laboratorio (solo biblioteca estándar).

Habla con el contenedor MySQL de 10_SQL_Lab usando el cliente `mysql` que
lleva dentro (salida XML, así no hace falta ningún driver de Python).
Escucha únicamente en 127.0.0.1.
"""
from __future__ import annotations

import json
import os
import re
import subprocess
import sys
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs, unquote
from xml.etree import ElementTree as ET

APP_DIR = os.path.dirname(os.path.abspath(__file__))
BASE_DIR = os.path.dirname(APP_DIR)
STATIC_DIR = os.path.join(APP_DIR, "static")
SQL_DIR = os.path.join(BASE_DIR, "sql")
SQL_NAME_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9 ._-]{0,80}\.sql$", re.IGNORECASE)
ENV_FILE = os.path.join(BASE_DIR, "config", "credenciales.env")
ROOT_ENV_FILE = os.path.join(BASE_DIR, ".env")
CONTAINER = os.environ.get("SQL_STUDIO_CONTAINER", "sql-lab")
SYSTEM_DBS = {"mysql", "information_schema", "performance_schema", "sys"}
MAX_ROWS = 5000
MAX_TABLE_PAGE = 500


# --------------------------------------------------------------------------- #
# Credenciales y acceso a MySQL
# --------------------------------------------------------------------------- #
def _read_env_file(path: str, data: dict) -> None:
    try:
        with open(path, "r", encoding="utf-8") as fh:
            for line in fh:
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                k, v = line.split("=", 1)
                data.setdefault(k.strip(), v.strip().strip('"').strip("'"))
    except OSError:
        pass


def read_env() -> dict:
    """Credenciales: variables de entorno > .env del repo > config/credenciales.env.

    El laboratorio original guarda todo en config/credenciales.env; la versión
    portable para GitHub usa un .env en la raíz, así sirve igual en ambos sitios.
    """
    data: dict = {}
    for key in ("MYSQL_ROOT_PASSWORD", "MYSQL_PORT", "SQL_STUDIO_HOST", "SQL_STUDIO_PORT"):
        value = os.environ.get(key)
        if value:
            data[key] = value
    extra = os.environ.get("SQL_STUDIO_ENV_FILE")
    for path in (extra, ROOT_ENV_FILE, ENV_FILE):
        if path:
            _read_env_file(path, data)
    return data


def container_running() -> bool:
    try:
        out = subprocess.run(
            ["docker", "inspect", "-f", "{{.State.Running}}", CONTAINER],
            capture_output=True, text=True, timeout=10,
        )
        return out.stdout.strip() == "true"
    except Exception:
        return False


class DBError(Exception):
    def __init__(self, message: str, code: str = "", state: str = ""):
        super().__init__(message)
        self.message, self.code, self.state = message, code, state


def _mysql(args: list[str], sql: str = "", timeout: int = 120) -> tuple[str, str, int]:
    """Ejecuta el cliente mysql dentro del contenedor."""
    env = read_env()
    password = env.get("MYSQL_ROOT_PASSWORD", "")
    cmd = [
        "docker", "exec", "-i",
        "-e", f"MYSQL_PWD={password}",
        CONTAINER, "mysql", "-u", "root", "--default-character-set=utf8mb4",
    ] + args
    try:
        proc = subprocess.run(
            cmd, input=sql.encode("utf-8"), capture_output=True, timeout=timeout,
        )
    except subprocess.TimeoutExpired:
        raise DBError(f"La consulta superó el tiempo límite ({timeout} s).")
    out = proc.stdout.decode("utf-8", "replace")
    err = proc.stderr.decode("utf-8", "replace")
    return out, err, proc.returncode


def parse_mysql_error(stderr: str) -> DBError | None:
    if not stderr.strip():
        return None
    match = re.search(r"ERROR (\d+) \(([0-9A-Z]{5})\)(?: at line \d+)?: (.*)", stderr, re.S)
    if match:
        return DBError(match.group(3).strip(), match.group(1), match.group(2))
    return DBError(stderr.strip())


def run_tsv(sql: str, timeout: int = 60) -> list[list[str]]:
    """Consulta de apoyo (una sola sentencia) en formato TSV."""
    out, err, rc = _mysql(["-N", "-B", "-e", sql], timeout=timeout)
    if rc != 0:
        raise parse_mysql_error(err) or DBError(err or "fallo desconocido")
    rows = []
    for line in out.splitlines():
        if not line.strip():
            continue
        rows.append([None if v == "NULL" else v for v in line.split("\t")])
    return rows


def parse_xml_resultsets(xml: str) -> list[dict]:
    """`mysql --xml` puede devolver varios <resultset>: los convertimos en dicts."""
    if not xml.strip():
        return []
    cleaned = re.sub(r"<\?xml[^>]*\?>", "", xml)
    try:
        root = ET.fromstring("<resultsets>" + cleaned + "</resultsets>")
    except ET.ParseError:
        return []
    results = []
    for rs in root:
        columns: list[str] = []
        rows: list[list[str | None]] = []
        for row in rs:
            values = []
            for field in row:
                values.append(None if field.get("xsi:nil") == "true" or field.text is None else field.text)
            if row and not columns:
                columns = [f.get("name") or f"col{i+1}" for i, f in enumerate(row)]
            rows.append(values)
        results.append({"columns": columns, "rows": rows})
    return results


# --------------------------------------------------------------------------- #
# Separador de sentencias (respeta DELIMITER, comillas y comentarios)
# --------------------------------------------------------------------------- #
DELIMITER_RE = re.compile(r"^[ \t]*DELIMITER[ \t]+(\S+)[ \t]*$", re.IGNORECASE)


def only_comments(text: str) -> bool:
    cleaned = re.sub(r"/\*.*?\*/", "", text, flags=re.S)
    cleaned = re.sub(r"--[^\n]*", "", cleaned)
    cleaned = re.sub(r"#[^\n]*", "", cleaned)
    return not cleaned.strip()


def split_sql(script: str) -> list[str]:
    statements: list[str] = []
    buf: list[str] = []
    delimiter = ";"
    i, n = 0, len(script)

    def flush() -> None:
        text = "".join(buf).strip()
        # Un bloque de solo comentarios no es una sentencia ejecutable.
        if text and only_comments(text):
            text = ""
        if text:
            statements.append(text)
        buf.clear()

    while i < n:
        ch = script[i]

        # Comando DELIMITER (solo al principio de línea)
        if (i == 0 or script[i - 1] == "\n") and script[i:i + 9].upper() == "DELIMITER":
            line_end = script.find("\n", i)
            line = script[i: line_end if line_end != -1 else n]
            match = DELIMITER_RE.match(line)
            if match:
                flush()
                delimiter = match.group(1)
                i = n if line_end == -1 else line_end + 1
                continue

        # Comentarios
        if ch == "#" or (ch == "-" and script.startswith("--", i) and (i + 2 >= n or script[i + 2] in " \t\r\n")):
            line_end = script.find("\n", i)
            end = n if line_end == -1 else line_end
            buf.append(script[i:end])
            i = end
            continue
        if ch == "/" and script.startswith("/*", i):
            end = script.find("*/", i + 2)
            end = n if end == -1 else end + 2
            buf.append(script[i:end])
            i = end
            continue

        # Cadenas y identificadores entrecomillados
        if ch in ("'", '"', "`"):
            quote = ch
            j = i + 1
            buf.append(ch)
            while j < n:
                c = script[j]
                if c == "\\" and quote != "`":
                    buf.append(script[j:j + 2])
                    j += 2
                    continue
                if c == quote:
                    if j + 1 < n and script[j + 1] == quote:
                        buf.append(quote * 2)
                        j += 2
                        continue
                    buf.append(quote)
                    j += 1
                    break
                buf.append(c)
                j += 1
            i = j
            continue

        # ¿Delimitador actual?
        if script.startswith(delimiter, i):
            flush()
            i += len(delimiter)
            continue

        buf.append(ch)
        i += 1

    flush()
    return statements


def statement_kind(stmt: str) -> str:
    text = re.sub(r"^(?:\s*/\*.*?\*/|\s*--[^\n]*\n|\s*#[^\n]*\n|\s)+", "", stmt, flags=re.S)
    match = re.match(r"([A-Za-z]+)", text)
    return match.group(1).upper() if match else "?"


DATA_KINDS = {"SELECT", "SHOW", "DESCRIBE", "DESC", "EXPLAIN", "WITH", "TABLE", "VALUES"}
DML_KINDS = {"INSERT", "UPDATE", "DELETE", "REPLACE"}


def build_payload(stmt: str, with_rowcount: bool) -> str:
    """Envuelve una sentencia en su propio DELIMITER: así el cliente mysql no la
    trocea por los ';' internos de un BEGIN...END."""
    delim = "//"
    while delim in stmt:
        delim += "/"
    payload = f"DELIMITER {delim}\n{stmt}\n{delim}\n"
    if with_rowcount:
        payload += "DELIMITER ;\nSELECT ROW_COUNT() AS __rc, LAST_INSERT_ID() AS __id;\n"
    return payload


def execute_script(script: str, db: str | None, limit: int = MAX_ROWS, timeout: int = 120) -> dict:
    """Ejecuta un script sentencia a sentencia y devuelve resultados estructurados."""
    if not container_running():
        raise DBError("El contenedor 'sql-lab' no está en marcha. Ejecuta ./sql-lab start.")

    started = time.perf_counter()
    statements = split_sql(script)
    results: list[dict] = []
    stopped = False

    base_args = ["--xml"]
    if db:
        base_args.append(db)

    for index, stmt in enumerate(statements):
        item: dict = {"sql": stmt, "kind": statement_kind(stmt), "ok": True}
        if stopped:
            item.update({"ok": False, "skipped": True, "error": {"message": "No ejecutada: el script se detuvo en un error anterior."}})
            results.append(item)
            continue

        t0 = time.perf_counter()
        payload = build_payload(stmt, item["kind"] in DML_KINDS)
        out, err, rc = _mysql(base_args, sql=payload, timeout=timeout)
        item["ms"] = round((time.perf_counter() - t0) * 1000, 1)

        if rc != 0:
            error = parse_mysql_error(err) or DBError("Error desconocido de MySQL")
            item.update({"ok": False, "error": {"message": error.message, "code": error.code, "state": error.state}})
            stopped = True
            results.append(item)
            continue

        sets = parse_xml_resultsets(out)
        if item["kind"] in DML_KINDS and sets:
            meta = sets[-1]
            if meta["rows"]:
                item["affected"] = int(meta["rows"][0][0] or 0)
                insert_id = int(meta["rows"][0][1] or 0) if len(meta["rows"][0]) > 1 else 0
                if insert_id:
                    item["insert_id"] = insert_id
            sets = sets[:-1]
        if item["kind"] in DATA_KINDS or sets:
            if sets:
                data = sets[0]
                columns, rows = data["columns"], data["rows"]
                item["columns"] = columns or [f"col{i+1}" for i in range(len(rows[0]) if rows else 0)]
                item["total_rows"] = len(rows)
                item["rows"] = rows[:limit]
                if len(rows) > limit:
                    item["truncated"] = True
        results.append(item)

    elapsed = round((time.perf_counter() - started) * 1000, 1)
    return {
        "ok": all(r.get("ok") for r in results) and not stopped,
        "db": db,
        "statements": results,
        "ms": elapsed,
        "count": len(results),
    }


# --------------------------------------------------------------------------- #
# Metadatos
# --------------------------------------------------------------------------- #
def list_databases() -> list[dict]:
    rows = run_tsv(
        "SELECT s.SCHEMA_NAME, "
        "  (SELECT COUNT(*) FROM information_schema.TABLES t WHERE t.TABLE_SCHEMA = s.SCHEMA_NAME), "
        "  (SELECT COALESCE(SUM(DATA_LENGTH + INDEX_LENGTH), 0) FROM information_schema.TABLES t WHERE t.TABLE_SCHEMA = s.SCHEMA_NAME), "
        "  (SELECT COALESCE(SUM(TABLE_ROWS), 0) FROM information_schema.TABLES t WHERE t.TABLE_SCHEMA = s.SCHEMA_NAME) "
        "FROM information_schema.SCHEMATA s ORDER BY s.SCHEMA_NAME;"
    )
    return [
        {
            "name": name,
            "tables": int(tables or 0),
            "size": int(size or 0),
            "rows": int(row_count or 0),
            "system": name in SYSTEM_DBS,
        }
        for name, tables, size, row_count in rows
    ]


def describe_database(db: str) -> dict:
    safe = db.replace("'", "''")
    tables = run_tsv(
        f"SELECT TABLE_NAME, TABLE_TYPE, COALESCE(ENGINE,''), COALESCE(TABLE_ROWS,0), "
        f"COALESCE(DATA_LENGTH+INDEX_LENGTH,0), COALESCE(TABLE_COLLATION,'') "
        f"FROM information_schema.TABLES WHERE TABLE_SCHEMA='{safe}' ORDER BY TABLE_TYPE, TABLE_NAME;"
    )
    columns = run_tsv(
        f"SELECT TABLE_NAME, COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_KEY, "
        f"COALESCE(COLUMN_DEFAULT,''), EXTRA, COALESCE(COLUMN_COMMENT,'') "
        f"FROM information_schema.COLUMNS WHERE TABLE_SCHEMA='{safe}' "
        f"ORDER BY TABLE_NAME, ORDINAL_POSITION;"
    )
    routines = run_tsv(
        f"SELECT ROUTINE_NAME, ROUTINE_TYPE FROM information_schema.ROUTINES "
        f"WHERE ROUTINE_SCHEMA='{safe}' ORDER BY ROUTINE_NAME;"
    )
    triggers = run_tsv(
        f"SELECT TRIGGER_NAME, ACTION_TIMING, EVENT_MANIPULATION, EVENT_OBJECT_TABLE "
        f"FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA='{safe}' ORDER BY TRIGGER_NAME;"
    )

    table_list = []
    for name, ttype, engine, trows, size, collation in tables:
        table_list.append({
            "name": name,
            "type": ttype,
            "engine": engine,
            "rows": int(trows or 0),
            "size": int(size or 0),
            "collation": collation,
            "columns": [],
        })
    by_name = {t["name"]: t for t in table_list}
    for table, col, ctype, nullable, key, default, extra, comment in columns:
        target = by_name.get(table)
        if target is None:
            continue
        target["columns"].append({
            "name": col, "type": ctype, "nullable": nullable == "YES",
            "key": key, "default": default, "extra": extra, "comment": comment,
        })
    return {
        "name": db,
        "tables": table_list,
        "routines": [{"name": n, "type": t} for n, t in routines],
        "triggers": [{"name": n, "timing": tm, "event": ev, "table": tb} for n, tm, ev, tb in triggers],
    }


def quote_ident(name: str) -> str:
    return "`" + name.replace("`", "``") + "`"


def clamp_int(value, default: int, low: int, high: int) -> int:
    try:
        number = int(value)
    except (TypeError, ValueError):
        return default
    return max(low, min(high, number))


# --------------------------------------------------------------------------- #
# Datos de una tabla (inspector) y relaciones (mapa de esquema)
# --------------------------------------------------------------------------- #
NON_SEARCHABLE = re.compile(r"blob|binary|geometry|point|polygon|json|bit", re.IGNORECASE)


def _escape_like(text: str) -> str:
    return text.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def like_literal(text: str) -> str:
    """Literal LIKE entre comillas: escapa comodines y comillas simples."""
    return "'" + _escape_like(text).replace("'", "''") + "'"


def like_contains(text: str) -> str:
    """LIKE '%texto%' dejando los comodines de los extremos sin escapar."""
    return "'%" + _escape_like(text).replace("'", "''") + "%'"


def get_table_columns(db: str, table: str) -> list[dict]:
    safe_db, safe_table = db.replace("'", "''"), table.replace("'", "''")
    rows = run_tsv(
        "SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_KEY, "
        "COALESCE(COLUMN_DEFAULT,''), EXTRA, COALESCE(COLUMN_COMMENT,'') "
        "FROM information_schema.COLUMNS "
        f"WHERE TABLE_SCHEMA='{safe_db}' AND TABLE_NAME='{safe_table}' "
        "ORDER BY ORDINAL_POSITION;"
    )
    return [
        {
            "name": name,
            "type": ctype,
            "nullable": nullable == "YES",
            "key": key or "",
            "default": default or "",
            "extra": extra or "",
            "comment": comment or "",
        }
        for name, ctype, nullable, key, default, extra, comment in rows
    ]


def table_rows_page(
    db: str,
    table: str,
    columns: list[dict],
    limit: int = 50,
    offset: int = 0,
    order: str = "",
    direction: str = "asc",
    search: str = "",
) -> dict:
    """Una página de filas, con búsqueda en todas las columnas y orden seguro."""
    limit = clamp_int(limit, 50, 1, MAX_TABLE_PAGE)
    offset = clamp_int(offset, 0, 0, 10_000_000)
    direction = "DESC" if str(direction).lower() == "desc" else "ASC"
    qualified = f"{quote_ident(db)}.{quote_ident(table)}"

    where = ""
    needle = (search or "").strip()
    if needle:
        usable = [
            column["name"]
            for column in columns
            if not NON_SEARCHABLE.search(column.get("type") or "")
        ][:20]
        if usable:
            like = like_contains(needle)
            conditions = " OR ".join(
                f"CONVERT({quote_ident(name)} USING utf8mb4) LIKE {like}" for name in usable
            )
            where = f" WHERE ({conditions})"

    order_sql = ""
    names = {column["name"] for column in columns}
    if order and order in names:
        order_sql = f" ORDER BY {quote_ident(order)} {direction}"

    count_rows = run_tsv(f"SELECT COUNT(*) FROM {qualified}{where};")
    total = int(count_rows[0][0] or 0) if count_rows and count_rows[0] else 0

    select = f"SELECT * FROM {qualified}{where}{order_sql} LIMIT {limit} OFFSET {offset};"
    out, err, rc = _mysql(["--xml"], build_payload(select, False))
    if rc != 0:
        raise parse_mysql_error(err) or DBError(err or "No se pudieron leer las filas")
    sets = parse_xml_resultsets(out)
    data = sets[0] if sets else {"columns": [], "rows": []}

    return {
        "columns": data["columns"] or [column["name"] for column in columns],
        "rows": data["rows"],
        "total": total,
        "offset": offset,
        "limit": limit,
        "order": order if order in names else "",
        "direction": direction.lower(),
        "search": needle,
    }


def table_detail(
    db: str,
    table: str,
    limit: int = 50,
    offset: int = 0,
    order: str = "",
    direction: str = "asc",
    search: str = "",
) -> dict:
    columns = get_table_columns(db, table)
    if not columns:
        raise DBError(f"La tabla {db}.{table} no existe.", "1146", "42S02")

    safe_db, safe_table = db.replace("'", "''"), table.replace("'", "''")
    stats = run_tsv(
        "SELECT TABLE_TYPE, COALESCE(ENGINE,''), COALESCE(TABLE_ROWS,0), "
        "COALESCE(DATA_LENGTH+INDEX_LENGTH,0), COALESCE(TABLE_COLLATION,''), "
        "COALESCE(TABLE_COMMENT,'') FROM information_schema.TABLES "
        f"WHERE TABLE_SCHEMA='{safe_db}' AND TABLE_NAME='{safe_table}';"
    )
    ttype, engine, estimated, size, collation, comment = stats[0] if stats else ("BASE TABLE", "", "0", "0", "", "")

    index_rows = run_tsv(
        "SELECT INDEX_NAME, NON_UNIQUE, SEQ_IN_INDEX, COALESCE(COLUMN_NAME, '(expresión)'), INDEX_TYPE "
        "FROM information_schema.STATISTICS "
        f"WHERE TABLE_SCHEMA='{safe_db}' AND TABLE_NAME='{safe_table}' "
        "ORDER BY INDEX_NAME, SEQ_IN_INDEX;"
    )
    indexes: list[dict] = []
    index_by_name: dict[str, dict] = {}
    for name, non_unique, _seq, column, index_type in index_rows:
        item = index_by_name.get(name)
        if item is None:
            item = {"name": name, "unique": str(non_unique) == "0", "type": index_type, "columns": []}
            index_by_name[name] = item
            indexes.append(item)
        item["columns"].append(column)

    trigger_rows = run_tsv(
        "SELECT TRIGGER_NAME, ACTION_TIMING, EVENT_MANIPULATION "
        "FROM information_schema.TRIGGERS "
        f"WHERE TRIGGER_SCHEMA='{safe_db}' AND EVENT_OBJECT_TABLE='{safe_table}' "
        "ORDER BY TRIGGER_NAME;"
    )

    ddl = ""
    ddl_rows = run_tsv(f"SHOW CREATE TABLE {quote_ident(db)}.{quote_ident(table)};")
    if ddl_rows and ddl_rows[0]:
        ddl = ddl_rows[0][1] if len(ddl_rows[0]) > 1 else ddl_rows[0][0]

    page = table_rows_page(db, table, columns, limit, offset, order, direction, search)
    return {
        "db": db,
        "table": table,
        "type": ttype,
        "engine": engine,
        "rows_estimate": int(estimated or 0),
        "size": int(size or 0),
        "collation": collation,
        "comment": comment,
        "columns": columns,
        "indexes": indexes,
        "triggers": [
            {"name": name, "timing": timing, "event": event}
            for name, timing, event in trigger_rows
        ],
        "ddl": ddl or f"-- Sin DDL disponible para {db}.{table}",
        "pk": [column["name"] for column in columns if column["key"] == "PRI"],
        "data": page,
    }


def database_relations(db: str) -> dict:
    """Tablas, columnas y claves foráneas para dibujar el mapa de esquema."""
    safe = db.replace("'", "''")
    table_rows = run_tsv(
        "SELECT TABLE_NAME, TABLE_TYPE, COALESCE(TABLE_ROWS,0) FROM information_schema.TABLES "
        f"WHERE TABLE_SCHEMA='{safe}' ORDER BY TABLE_NAME;"
    )
    column_rows = run_tsv(
        "SELECT TABLE_NAME, COLUMN_NAME, COLUMN_TYPE, COALESCE(COLUMN_KEY,'') "
        "FROM information_schema.COLUMNS "
        f"WHERE TABLE_SCHEMA='{safe}' ORDER BY TABLE_NAME, ORDINAL_POSITION;"
    )
    fk_rows = run_tsv(
        "SELECT k.CONSTRAINT_NAME, k.TABLE_NAME, k.COLUMN_NAME, k.REFERENCED_TABLE_NAME, "
        "k.REFERENCED_COLUMN_NAME, rc.DELETE_RULE, rc.UPDATE_RULE "
        "FROM information_schema.KEY_COLUMN_USAGE k "
        "JOIN information_schema.REFERENTIAL_CONSTRAINTS rc "
        "ON rc.CONSTRAINT_SCHEMA = k.CONSTRAINT_SCHEMA "
        "AND rc.CONSTRAINT_NAME = k.CONSTRAINT_NAME AND rc.TABLE_NAME = k.TABLE_NAME "
        f"WHERE k.TABLE_SCHEMA='{safe}' AND k.REFERENCED_TABLE_NAME IS NOT NULL "
        "ORDER BY k.TABLE_NAME, k.CONSTRAINT_NAME, k.ORDINAL_POSITION;"
    )

    tables: list[dict] = []
    by_name: dict[str, dict] = {}
    for name, ttype, estimated in table_rows:
        node = {"name": name, "type": ttype, "rows": int(estimated or 0), "columns": []}
        tables.append(node)
        by_name[name] = node
    for table, column, ctype, key in column_rows:
        node = by_name.get(table)
        if node is not None:
            node["columns"].append({"name": column, "type": ctype, "key": key})

    relations = [
        {
            "name": constraint,
            "from": {"table": table, "column": column},
            "to": {"table": referenced_table, "column": referenced_column},
            "on_delete": delete_rule,
            "on_update": update_rule,
        }
        for constraint, table, column, referenced_table, referenced_column, delete_rule, update_rule in fk_rows
    ]
    return {"db": db, "tables": tables, "relations": relations}


# --------------------------------------------------------------------------- #
# Ficheros .sql del usuario (sql/)
# --------------------------------------------------------------------------- #
def sql_file_path(name: str) -> str:
    name = (name or "").strip()
    if not SQL_NAME_RE.match(name) or "/" in name or "\\" in name:
        raise ValueError("Nombre no válido: letras, números, espacios, guion o guion bajo, y extensión .sql.")
    full = os.path.normpath(os.path.join(SQL_DIR, name))
    if os.path.dirname(full) != os.path.normpath(SQL_DIR):
        raise ValueError("Nombre no válido.")
    return full


def list_sql_files() -> list[dict]:
    try:
        entries = sorted(os.listdir(SQL_DIR), key=str.lower)
    except FileNotFoundError:
        return []
    files = []
    for entry in entries:
        if not SQL_NAME_RE.match(entry):
            continue
        full = os.path.join(SQL_DIR, entry)
        if not os.path.isfile(full):
            continue
        stat = os.stat(full)
        files.append({"name": entry, "bytes": stat.st_size, "mtime": int(stat.st_mtime)})
    return files


# --------------------------------------------------------------------------- #
# HTTP
# --------------------------------------------------------------------------- #
class Handler(BaseHTTPRequestHandler):
    server_version = "SQLStudio/1.0"
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt: str, *args) -> None:  # silencio en consola
        pass

    # --- utilidades ------------------------------------------------------- #
    def send_json(self, payload, status: int = 200) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def read_json(self) -> dict:
        length = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(length) if length else b""
        if not raw:
            return {}
        try:
            return json.loads(raw.decode("utf-8"))
        except json.JSONDecodeError:
            return {}

    def send_static(self, path: str) -> None:
        rel = unquote(path.lstrip("/")) or "index.html"
        if rel in ("", "/"):
            rel = "index.html"
        full = os.path.normpath(os.path.join(STATIC_DIR, rel))
        if not full.startswith(STATIC_DIR) or not os.path.isfile(full):
            self.send_json({"ok": False, "error": {"message": "No encontrado"}}, 404)
            return
        ext = os.path.splitext(full)[1].lower()
        types = {
            ".html": "text/html; charset=utf-8",
            ".css": "text/css; charset=utf-8",
            ".js": "application/javascript; charset=utf-8",
            ".svg": "image/svg+xml",
            ".png": "image/png",
            ".ico": "image/x-icon",
            ".woff2": "font/woff2",
        }
        with open(full, "rb") as fh:
            body = fh.read()
        self.send_response(200)
        self.send_header("Content-Type", types.get(ext, "application/octet-stream"))
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-cache")
        self.end_headers()
        self.wfile.write(body)

    # --- rutas ------------------------------------------------------------ #
    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        route = parsed.path
        query = parse_qs(parsed.query)
        try:
            if route == "/api/health":
                self.send_json({
                    "ok": True,
                    "container": CONTAINER,
                    "running": container_running(),
                    "version": "2.0",
                })
            elif route == "/api/databases":
                self.send_json({"ok": True, "databases": list_databases()})
            elif route == "/api/schema":
                db = (query.get("db") or [""])[0]
                if not db:
                    self.send_json({"ok": False, "error": {"message": "Falta el parámetro db"}}, 400)
                    return
                self.send_json({"ok": True, "schema": describe_database(db)})
            elif route == "/api/preview":
                db = (query.get("db") or [""])[0]
                table = (query.get("table") or [""])[0]
                limit = clamp_int((query.get("limit") or ["100"])[0], 100, 1, 500)
                if not db or not table:
                    self.send_json({"ok": False, "error": {"message": "Faltan parámetros"}}, 400)
                    return
                result = execute_script(f"SELECT * FROM {quote_ident(db)}.{quote_ident(table)} LIMIT {limit};", db)
                self.send_json({"ok": True, "result": result})
            elif route == "/api/relations":
                db = (query.get("db") or [""])[0]
                if not db:
                    self.send_json({"ok": False, "error": {"message": "Falta el parámetro db"}}, 400)
                    return
                self.send_json({"ok": True, "relations": database_relations(db)})
            elif route in ("/api/table", "/api/rows"):
                db = (query.get("db") or [""])[0]
                table = (query.get("table") or [""])[0]
                if not db or not table:
                    self.send_json({"ok": False, "error": {"message": "Faltan db y table"}}, 400)
                    return
                limit = clamp_int((query.get("limit") or ["50"])[0], 50, 1, MAX_TABLE_PAGE)
                offset = clamp_int((query.get("offset") or ["0"])[0], 0, 0, 10_000_000)
                order = (query.get("order") or [""])[0]
                direction = (query.get("dir") or ["asc"])[0]
                search = (query.get("q") or [""])[0]
                if route == "/api/table":
                    payload = table_detail(db, table, limit, offset, order, direction, search)
                    self.send_json({"ok": True, "table": payload})
                else:
                    columns = get_table_columns(db, table)
                    if not columns:
                        raise DBError(f"La tabla {db}.{table} no existe.", "1146", "42S02")
                    self.send_json({
                        "ok": True,
                        "data": table_rows_page(db, table, columns, limit, offset, order, direction, search),
                    })
            elif route == "/api/files":
                self.send_json({"ok": True, "files": list_sql_files()})
            elif route == "/api/file":
                name = (query.get("name") or [""])[0]
                try:
                    full = sql_file_path(name)
                except ValueError as exc:
                    self.send_json({"ok": False, "error": {"message": str(exc)}}, 400)
                    return
                if not os.path.isfile(full):
                    self.send_json({"ok": False, "error": {"message": "Ese fichero no existe en sql/."}}, 404)
                    return
                with open(full, "r", encoding="utf-8", errors="replace") as fh:
                    self.send_json({"ok": True, "name": name, "sql": fh.read()})
            elif route.startswith("/api/"):
                self.send_json({"ok": False, "error": {"message": "Ruta desconocida"}}, 404)
            else:
                self.send_static(route)
        except DBError as exc:
            status = 404 if exc.code == "1146" else 500
            self.send_json({"ok": False, "error": {"message": exc.message, "code": exc.code, "state": exc.state}}, status)
        except Exception as exc:  # noqa: BLE001
            self.send_json({"ok": False, "error": {"message": str(exc)}}, 500)

    def do_DELETE(self) -> None:
        parsed = urlparse(self.path)
        route = parsed.path
        query = parse_qs(parsed.query)
        if route != "/api/file":
            self.send_json({"ok": False, "error": {"message": "Ruta desconocida"}}, 404)
            return
        name = (query.get("name") or [""])[0]
        try:
            full = sql_file_path(name)
        except ValueError as exc:
            self.send_json({"ok": False, "error": {"message": str(exc)}}, 400)
            return
        if not os.path.isfile(full):
            self.send_json({"ok": False, "error": {"message": "Ese fichero no existe en sql/."}}, 404)
            return
        try:
            os.remove(full)
            self.send_json({"ok": True, "deleted": name})
        except OSError as exc:
            self.send_json({"ok": False, "error": {"message": f"No se pudo borrar: {exc}"}}, 500)

    def do_POST(self) -> None:
        route = urlparse(self.path).path
        body = self.read_json()
        try:
            if route == "/api/query":
                db = body.get("db") or None
                sql = body.get("sql") or ""
                if not sql.strip():
                    self.send_json({"ok": False, "error": {"message": "La consulta está vacía."}}, 400)
                    return
                limit = int(body.get("limit") or MAX_ROWS)
                self.send_json({"ok": True, "result": execute_script(sql, db, limit=limit)})
            elif route == "/api/import":
                sql = body.get("sql") or ""
                db = (body.get("db") or "").strip() or None
                create = bool(body.get("create", True))
                if not sql.strip():
                    self.send_json({"ok": False, "error": {"message": "El fichero está vacío."}}, 400)
                    return
                if db and create:
                    execute_script(f"CREATE DATABASE IF NOT EXISTS {quote_ident(db)} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;", None)
                result = execute_script(sql, db, timeout=600)
                self.send_json({"ok": True, "result": result})
            elif route == "/api/database":
                action = body.get("action")
                name = (body.get("name") or "").strip()
                if not re.fullmatch(r"[A-Za-z0-9_$][A-Za-z0-9_$-]*", name or ""):
                    self.send_json({"ok": False, "error": {"message": "Nombre de base de datos no válido."}}, 400)
                    return
                if action == "create":
                    result = execute_script(f"CREATE DATABASE IF NOT EXISTS {quote_ident(name)} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;", None)
                elif action == "drop":
                    result = execute_script(f"DROP DATABASE {quote_ident(name)};", None)
                else:
                    self.send_json({"ok": False, "error": {"message": "Acción no válida."}}, 400)
                    return
                self.send_json({"ok": True, "result": result})
            elif route == "/api/file":
                name = (body.get("name") or "").strip()
                sql = body.get("sql") or ""
                try:
                    full = sql_file_path(name)
                except ValueError as exc:
                    self.send_json({"ok": False, "error": {"message": str(exc)}}, 400)
                    return
                os.makedirs(SQL_DIR, exist_ok=True)
                tmp = full + ".tmp"
                with open(tmp, "w", encoding="utf-8", newline="\n") as fh:
                    fh.write(sql if sql.endswith("\n") else sql + "\n")
                os.replace(tmp, full)
                self.send_json({"ok": True, "file": {"name": name, "bytes": os.path.getsize(full), "mtime": int(os.path.getmtime(full))}})
            else:
                self.send_json({"ok": False, "error": {"message": "Ruta desconocida"}}, 404)
        except DBError as exc:
            status = 404 if exc.code == "1146" else 500
            self.send_json({"ok": False, "error": {"message": exc.message, "code": exc.code, "state": exc.state}}, status)
        except Exception as exc:  # noqa: BLE001
            self.send_json({"ok": False, "error": {"message": str(exc)}}, 500)


def main() -> None:
    port = int(os.environ.get("SQL_STUDIO_PORT", "8765"))
    host = os.environ.get("SQL_STUDIO_HOST", "127.0.0.1")
    if not os.path.isdir(STATIC_DIR):
        sys.exit("Falta el directorio static/")
    server = ThreadingHTTPServer((host, port), Handler)
    server.daemon_threads = True
    print(f"SQL Studio en http://{host}:{port}", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
