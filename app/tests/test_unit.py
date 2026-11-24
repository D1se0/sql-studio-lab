#!/usr/bin/env python3
"""Pruebas unitarias del servidor, sin MySQL ni contenedor.

Uso:  python3 app/tests/test_unit.py
"""
from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))

import server  # noqa: E402

PASS, FAIL = 0, 0


def check(name: str, condition: bool, detail: object = "") -> None:
    global PASS, FAIL
    if condition:
        PASS += 1
        print(f"  ✓ {name}")
    else:
        FAIL += 1
        print(f"  ✗ {name}  {detail!r}")


def main() -> int:
    print("== separador de sentencias ==")
    check(
        "dos sentencias simples",
        server.split_sql("SELECT 1; SELECT 2;") == ["SELECT 1", "SELECT 2"],
        server.split_sql("SELECT 1; SELECT 2;"),
    )
    check("sin punto y coma final", server.split_sql("SELECT 1") == ["SELECT 1"])
    check("comentarios con ;", len(server.split_sql("-- uno; dos\nSELECT 1;")) == 1)
    check(
        "punto y coma dentro de cadena",
        server.split_sql("INSERT INTO t VALUES ('a;b');") == ["INSERT INTO t VALUES ('a;b')"],
    )
    check(
        "identificador con ; dentro de backticks",
        server.split_sql("SELECT `a;b` FROM t;") == ["SELECT `a;b` FROM t"],
    )
    check(
        "comilla escapada",
        server.split_sql("SELECT 'it''s; ok';") == ["SELECT 'it''s; ok'"],
    )
    check(
        "DELIMITER para procedimientos",
        len(server.split_sql(
            "DELIMITER //\nCREATE PROCEDURE p()\nBEGIN\n  SELECT 1;\n  SELECT 2;\nEND //\nDELIMITER ;\nCALL p();"
        )) == 2,
    )
    check("script vacío", server.split_sql("  \n -- nada\n") == [])

    print("== tipo de sentencia ==")
    check("SELECT", server.statement_kind("SELECT 1") == "SELECT")
    check("con comentario delante", server.statement_kind("-- x\n/* y */ INSERT INTO t VALUES (1)") == "INSERT")
    check("WITH", server.statement_kind("WITH c AS (SELECT 1) SELECT * FROM c") == "WITH")
    check("vacía", server.statement_kind("  ") == "?")

    print("== errores de MySQL ==")
    error = server.parse_mysql_error(
        "ERROR 1146 (42S02) at line 1: Table 'sakila.nope' doesn't exist"
    )
    check("código y SQLSTATE", error is not None and error.code == "1146" and error.state == "42S02")
    check("mensaje limpio", error is not None and error.message.startswith("Table"))
    check("sin error", server.parse_mysql_error("") is None)

    print("== payload con DELIMITER ==")
    payload = server.build_payload("SELECT 1; SELECT 2;", False)
    check("abre y cierra con el delimitador", payload.startswith("DELIMITER //") and payload.rstrip().endswith("//"))
    payload_dml = server.build_payload("INSERT INTO t VALUES (1);", True)
    check("DML pide ROW_COUNT", "__rc" in payload_dml and "__id" in payload_dml)
    check(
        "delimitador alternativo si // aparece",
        "DELIMITER ///\n" in server.build_payload("SELECT '//';", False),
    )

    print("== ficheros .sql seguros ==")
    full = server.sql_file_path("mi consulta.sql")
    check("nombre válido", full.endswith(os.path.join("sql", "mi consulta.sql")), full)
    for bad in ("../fuera.sql", "sub/dir.sql", "sin_extension", ".oculto.sql", "a" * 120 + ".sql"):
        try:
            server.sql_file_path(bad)
            check(f"rechaza {bad!r}", False)
        except ValueError:
            check(f"rechaza {bad!r}", True)

    print("== literales y números ==")
    check("LIKE escapa %", server.like_literal("100%") == "'100\\%'", server.like_literal("100%"))
    check("LIKE escapa _", server.like_literal("a_b") == "'a\\_b'", server.like_literal("a_b"))
    check("LIKE escapa comillas", server.like_literal("O'Brien") == "'O''Brien'", server.like_literal("O'Brien"))
    check("LIKE contiene deja los extremos como comodines", server.like_contains("ACADEMY") == "'%ACADEMY%'", server.like_contains("ACADEMY"))
    check("LIKE contiene escapa el texto interno", server.like_contains("50%") == "'%50\\%%'", server.like_contains("50%"))
    check("solo comentarios no es sentencia", server.split_sql("-- solo un comentario\n/* y otro */") == [])
    check("clamp por arriba", server.clamp_int("9999", 50, 1, 500) == 500)
    check("clamp por abajo", server.clamp_int("-4", 50, 0, 500) == 0)
    check("clamp con basura", server.clamp_int("x", 50, 1, 500) == 50)

    print(f"\n==> {PASS + FAIL} pruebas unitarias: {PASS} correctas, {FAIL} fallidas.")
    return 1 if FAIL else 0


if __name__ == "__main__":
    sys.exit(main())
