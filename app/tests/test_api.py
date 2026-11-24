#!/usr/bin/env python3
"""Pruebas de integración de SQL Studio contra el servidor y el contenedor real.

Uso:  python3 app/tests/test_api.py
Requiere el servidor en marcha (./sql-app --no-open) y el contenedor sql-lab.
"""
import json
import os
import sys
import urllib.error
import urllib.request

BASE = os.environ.get("SQL_STUDIO_URL", "http://127.0.0.1:8765").rstrip("/")
PASS, FAIL = 0, 0


def call(path, payload=None, method=None):
    data = json.dumps(payload).encode() if payload is not None else None
    req = urllib.request.Request(
        BASE + path, data=data, method=method or ("POST" if data else "GET"),
        headers={"Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            return resp.status, json.load(resp)
    except urllib.error.HTTPError as exc:
        return exc.code, json.load(exc)


def check(name, condition, detail=""):
    global PASS, FAIL
    if condition:
        PASS += 1
        print(f"  ✓ {name}")
    else:
        FAIL += 1
        print(f"  ✗ {name}  {detail}")


def statements(response):
    return response.get("result", {}).get("statements", [])


def main():
    print("== salud y metadatos ==")
    status, health = call("/api/health")
    check("health responde", status == 200 and health["ok"] and health["running"], health)
    check("contenedor sql-lab en marcha", health.get("running") is True)

    status, dbs = call("/api/databases")
    names = [d["name"] for d in dbs["databases"]]
    check("lista de bases", status == 200 and "sakila" in names and "lab_demo" in names, names)
    sakila = next((d for d in dbs["databases"] if d["name"] == "sakila"), None)
    check("sakila con 23 objetos y tamaño", sakila and sakila["tables"] >= 20 and sakila["size"] > 0, sakila)

    status, schema = call("/api/schema?db=sakila")
    tables = [t["name"] for t in schema["schema"]["tables"]]
    check("esquema de sakila trae rental/actor", "rental" in tables and "actor" in tables, tables[:5])
    rental = next(t for t in schema["schema"]["tables"] if t["name"] == "rental")
    check("columnas de rental", len(rental["columns"]) == 7, len(rental["columns"]))
    check("clave primaria detectada", any(c["key"] == "PRI" for c in rental["columns"]))
    check("triggers de sakila", any(t["name"] == "rental_date" for t in schema["schema"]["triggers"]))
    check("rutinas listadas", isinstance(schema["schema"]["routines"], list))

    print("== consultas ==")
    status, r = call("/api/query", {"db": "sakila", "sql": "SELECT COUNT(*) AS total FROM actor;"})
    st = statements(r)[0]
    check("SELECT devuelve columna/valor", st["ok"] and st["columns"] == ["total"] and st["rows"][0][0] == "200", st)

    status, r = call("/api/query", {"db": "sakila", "sql": "SELECT * FROM tabla_inexistente;"})
    st = statements(r)[0]
    check("error 1146 capturado", not st["ok"] and st["error"]["code"] == "1146" and st["error"]["state"] == "42S02", st)

    status, r = call("/api/query", {"db": "sakila", "sql": "SELECT 1 AS a; SELECT 2 AS b;"})
    check("dos sentencias en una petición", len(statements(r)) == 2, len(statements(r)))

    status, r = call("/api/query", {"db": "sakila", "sql": "SELECT 1; SELEC mal;"})
    sts = statements(r)
    check("se detiene en el error", sts[0]["ok"] and not sts[1]["ok"], sts)
    check("resultado global no ok", r["result"]["ok"] is False)

    status, r = call("/api/query", {"db": None, "sql": "SHOW DATABASES;"})
    st = statements(r)[0]
    check("SHOW DATABASES", st["ok"] and len(st["rows"]) >= 5, st.get("rows", [])[:3])

    print("== DELIMITER, procedimientos y SIGNAL ==")
    setup = """
DROP PROCEDURE IF EXISTS studio_probe;
DELIMITER //
CREATE PROCEDURE studio_probe(IN v INT)
BEGIN
    IF v < 0 THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'negativo no permitido';
    END IF;
    SELECT 'ok' AS result;
END //
DELIMITER ;
CALL studio_probe(1);
CALL studio_probe(-1);
"""
    status, r = call("/api/query", {"db": "lab_demo", "sql": setup})
    sts = statements(r)
    kinds = [s["kind"] for s in sts]
    check("DELIMITER genera sentencias separadas", len(sts) == 4, kinds)
    check("CREATE PROCEDURE ok", sts[1]["ok"], sts[1])
    check("CALL positiva ok", sts[2]["ok"] and sts[2]["rows"][0][0] == "ok", sts[2])
    signal = sts[3] if len(sts) > 3 else {}
    check("CALL negativa captura el SIGNAL",
          bool(signal) and not signal.get("ok") and signal.get("error", {}).get("code") == "1644"
          and "negativo no permitido" in signal.get("error", {}).get("message", ""), signal)

    status, r = call("/api/query", {"db": "lab_demo", "sql": "DROP PROCEDURE IF EXISTS studio_probe;"})
    check("DROP PROCEDURE", statements(r)[0]["ok"])

    print("== DML: filas afectadas e id ==")
    ddl = """
DROP TABLE IF EXISTS studio_probe_t;
CREATE TABLE studio_probe_t (id INT AUTO_INCREMENT PRIMARY KEY, v VARCHAR(20));
INSERT INTO studio_probe_t (v) VALUES ('a'),('b');
UPDATE studio_probe_t SET v='c' WHERE id=1;
DELETE FROM studio_probe_t WHERE id=2;
SELECT COUNT(*) AS quedan FROM studio_probe_t;
DROP TABLE studio_probe_t;
"""
    status, r = call("/api/query", {"db": "lab_demo", "sql": ddl})
    sts = statements(r)
    check("7 sentencias DDL/DML", len(sts) == 7, [s["kind"] for s in sts])
    check("INSERT afectó 2 filas", sts[2].get("affected") == 2, sts[2])
    check("UPDATE afectó 1 fila", sts[3].get("affected") == 1, sts[3])
    check("DELETE afectó 1 fila", sts[4].get("affected") == 1, sts[4])
    check("SELECT final deja 1 fila", sts[5]["rows"][0][0] == "1", sts[5].get("rows"))

    print("== importación real de .sql ==")
    script = """
CREATE TABLE clientes (
  id INT AUTO_INCREMENT PRIMARY KEY,
  nombre VARCHAR(60) NOT NULL
);
CREATE TABLE pedidos (
  id INT AUTO_INCREMENT PRIMARY KEY,
  cliente_id INT NOT NULL,
  total DECIMAL(10,2) NOT NULL DEFAULT 0,
  CONSTRAINT fk_pedidos_cliente FOREIGN KEY (cliente_id)
    REFERENCES clientes(id) ON DELETE CASCADE
);
INSERT INTO clientes (nombre) VALUES ('Ana'),('Luis');
INSERT INTO pedidos (cliente_id, total) VALUES (1, 19.95), (2, 42.00);
CREATE VIEW resumen_clientes AS
  SELECT c.nombre, COUNT(p.id) AS pedidos, COALESCE(SUM(p.total),0) AS total
  FROM clientes c LEFT JOIN pedidos p ON p.cliente_id = c.id
  GROUP BY c.id, c.nombre;
"""
    status, r = call("/api/import", {"sql": script, "db": "studio_import_test", "create": True})
    sts = statements(r)
    check("import de un script con FK sin errores", r["result"]["ok"], [s.get("error") for s in sts if not s["ok"]][:2])
    check("import con varias sentencias", len(sts) >= 5, len(sts))
    check("la vista importada existe", any(s["kind"] == "CREATE" for s in sts))
    status, schema = call("/api/schema?db=studio_import_test")
    check("base importada con tablas", len(schema["schema"]["tables"]) > 0, [t["name"] for t in schema["schema"]["tables"]])

    status, r = call("/api/preview?db=studio_import_test&table=" + schema["schema"]["tables"][0]["name"])
    st = statements(r)[0]
    check("preview de tabla", st["ok"] and st["columns"], st)

    status, r = call("/api/query", {"db": None, "sql": "DROP DATABASE studio_import_test;"})
    check("limpieza de la base de importación", statements(r)[0]["ok"])

    print("== crear / borrar base ==")
    status, r = call("/api/database", {"action": "create", "name": "studio_db_test"})
    check("crear base", statements(r)[0]["ok"])
    status, dbs = call("/api/databases")
    check("base aparece en la lista", "studio_db_test" in [d["name"] for d in dbs["databases"]])
    status, r = call("/api/database", {"action": "drop", "name": "studio_db_test"})
    check("borrar base", statements(r)[0]["ok"])
    status, r = call("/api/database", {"action": "create", "name": "mal nombre!"})
    check("nombre inválido rechazado", status == 400 and r["ok"] is False, r)

    print("== ficheros .sql (guardar y abrir) ==")
    status, r = call("/api/files")
    listed = [f["name"] for f in r.get("files", [])]
    check("lista de .sql de sql/", status == 200 and any(n.endswith(".sql") for n in listed), listed[:5])

    content = "-- guardado desde las pruebas de API\nSELECT 1 AS uno;\n"
    status, r = call("/api/file", {"name": "api_smoke.sql", "sql": content})
    check("guardar .sql en disco", status == 200 and r["file"]["name"] == "api_smoke.sql" and r["file"]["bytes"] > 0, r)
    check("el fichero existe en sql/", os.path.isfile("sql/api_smoke.sql"))

    status, r = call("/api/files")
    check("el .sql guardado aparece en la lista", "api_smoke.sql" in [f["name"] for f in r.get("files", [])])

    status, r = call("/api/file?name=api_smoke.sql")
    check("leer .sql guardado", status == 200 and "SELECT 1 AS uno" in r["sql"], r.get("sql"))

    status, r = call("/api/file", {"name": "../fuera.sql", "sql": "SELECT 1;"})
    check("nombre con ../ rechazado", status == 400 and r["ok"] is False, r)

    status, r = call("/api/file", {"name": "sin_extension", "sql": "SELECT 1;"})
    check("nombre sin .sql rechazado", status == 400 and r["ok"] is False, r)

    status, r = call("/api/file?name=no_existe.sql")
    check("leer .sql inexistente da 404", status == 404, r)

    status, r = call("/api/file", {"name": "api_delete.sql", "sql": "SELECT 2;"})
    check("crear .sql para borrar", status == 200 and os.path.isfile("sql/api_delete.sql"), r)
    status, r = call("/api/file?name=api_delete.sql", None, "DELETE")
    check("borrar .sql con DELETE", status == 200 and not os.path.exists("sql/api_delete.sql"), r)
    status, r = call("/api/file?name=api_delete.sql", None, "DELETE")
    check("borrar dos veces da 404", status == 404, r)
    status, r = call("/api/file?name=../mal.sql", None, "DELETE")
    check("DELETE valida el nombre", status == 400, r)

    os.remove("sql/api_smoke.sql")
    check("limpieza del .sql de prueba", not os.path.exists("sql/api_smoke.sql"))

    print("== inspector de tabla: datos, orden, filtro y paginación ==")
    status, r = call("/api/table?db=sakila&table=film&limit=5&order=title&dir=asc")
    detail = r.get("table", {})
    check("metadatos de film", status == 200 and detail.get("table") == "film" and len(detail.get("columns", [])) == 13, detail.get("columns"))
    check("clave primaria de film", detail.get("pk") == ["film_id"], detail.get("pk"))
    check("índices de film", len(detail.get("indexes", [])) >= 3, detail.get("indexes"))
    check("DDL de film", "CREATE TABLE" in detail.get("ddl", ""), detail.get("ddl", "")[:60])
    check("motor y tamaño de film", detail.get("engine") == "InnoDB" and detail.get("size", 0) > 0, detail.get("engine"))
    first_page = detail.get("data", {})
    check("página de 5 filas ordenadas", len(first_page.get("rows", [])) == 5 and first_page["rows"][0][1] == "ACADEMY DINOSAUR", first_page.get("rows"))
    check("total real de film", first_page.get("total") == 1000, first_page.get("total"))

    status, r = call("/api/table?db=sakila&table=film&limit=5&offset=5&order=title&dir=asc")
    second = r.get("table", {}).get("data", {})
    check("segunda página distinta", len(second.get("rows", [])) == 5 and second["rows"][0][1] != "ACADEMY DINOSAUR", second.get("rows", [])[:1])
    check("el total no cambia al paginar", second.get("total") == 1000)

    status, r = call("/api/table?db=sakila&table=film&limit=5&order=title&dir=desc")
    desc = r.get("table", {}).get("data", {})
    check("orden descendente", desc.get("rows") and desc["rows"][0][1] > "ACADEMY DINOSAUR", desc.get("rows", [])[:1])

    status, r = call("/api/table?db=sakila&table=film&q=ACADEMY")
    search = r.get("table", {}).get("data", {})
    check("filtro en todas las columnas", status == 200 and search.get("total", 0) >= 1 and "ACADEMY" in search["rows"][0][1], search.get("total"))

    status, r = call("/api/table?db=sakila&table=film&q=%25")
    wildcard = r.get("table", {}).get("data", {})
    check("el comodín % se escapa", status == 200 and wildcard.get("total", -1) == 0, wildcard.get("total"))

    status, r = call("/api/table?db=sakila&table=film&q=O%27Brien")
    check("búsqueda con comilla simple no rompe el SQL", status == 200, r)

    status, r = call("/api/table?db=sakila&table=film&order=title%60%3B%20DROP%20TABLE%20film%3B%20--")
    check("orden con inyección se ignora", status == 200 and r["table"]["data"]["order"] == "" and r["table"]["data"]["total"] == 1000, r.get("table", {}).get("data", {}).get("order"))

    status, r = call("/api/table?db=sakila&table=film&limit=9999")
    check("límite de página acotado a 500", status == 200 and len(r["table"]["data"]["rows"]) == 500, len(r.get("table", {}).get("data", {}).get("rows", [])))

    status, r = call("/api/table?db=sakila&table=film&offset=2000")
    check("offset más allá del final", status == 200 and r["table"]["data"]["rows"] == [] and r["table"]["data"]["total"] == 1000)

    status, r = call("/api/table?db=sakila&table=no_existe")
    check("tabla inexistente da 404 y 1146", status == 404 and r.get("error", {}).get("code") == "1146", r)

    status, r = call("/api/table?db=sakila&table=actor_info&limit=5")
    view = r.get("table", {})
    check("vista con estructura y DDL", status == 200 and view.get("type") == "VIEW" and "VIEW" in view.get("ddl", "").upper(), view.get("type"))

    status, r = call("/api/rows?db=sakila&table=film&limit=2&offset=1&order=film_id")
    page = r.get("data", {})
    check("endpoint /api/rows pagina sin metadatos", status == 200 and page.get("rows") and page["rows"][0][0] == "2" and page.get("total") == 1000, page.get("rows"))

    status, r = call("/api/table?db=sakila")
    check("/api/table sin tabla da 400", status == 400, r)

    print("== relaciones para el mapa de esquema ==")
    status, r = call("/api/relations?db=sakila")
    rel = r.get("relations", {})
    pairs = [(item["from"]["table"], item["from"]["column"], item["to"]["table"], item["to"]["column"]) for item in rel.get("relations", [])]
    check("mapa con 23 tablas y 22 relaciones", status == 200 and len(rel.get("tables", [])) == 23 and len(pairs) == 22, (len(rel.get("tables", [])), len(pairs)))
    check("FK film_category → category", ("film_category", "category_id", "category", "category_id") in pairs, pairs[:3])
    check("FK rental → inventory", ("rental", "inventory_id", "inventory", "inventory_id") in pairs, pairs[:3])
    film_node = next((t for t in rel.get("tables", []) if t["name"] == "film"), None)
    check("columnas y PK en el mapa", film_node and any(c["key"] == "PRI" for c in film_node["columns"]), film_node and film_node["columns"][:2])

    status, r = call("/api/relations?db=sakila_mapa_inexistente")
    check("mapa de base inexistente no rompe", status == 200 and r["relations"]["tables"] == [] and r["relations"]["relations"] == [], r)

    status, r = call("/api/relations")
    check("mapa sin parámetro da 400", status == 400, r)

    status, r = call("/api/query", {"db": "sakila", "sql": "SELECT COUNT(*) FROM actor;"})
    check("las pruebas no han modificado sakila", statements(r)[0]["rows"][0][0] == "200")

    print("== casos límite ==")
    status, r = call("/api/query", {"db": "sakila", "sql": "   "})
    check("consulta vacía rechazada", status == 400)
    status, r = call("/api/nope")
    check("ruta desconocida 404", status == 404)
    status, r = call("/api/query", {"db": "sakila", "sql": "SELECT * FROM rental;", "limit": 5})
    st = statements(r)[0]
    check("límite de filas aplicado", len(st["rows"]) == 5 and st["truncated"] is True, st.get("total_rows"))
    status, r = call("/api/query", {"db": "no_existe_db", "sql": "SELECT 1;"})
    check("base inexistente da error claro", not statements(r)[0]["ok"], statements(r)[0].get("error"))

    print(f"\n==> {PASS + FAIL} pruebas: {PASS} correctas, {FAIL} fallidas.")
    return 1 if FAIL else 0


if __name__ == "__main__":
    sys.exit(main())
