# API HTTP

Base: `http://127.0.0.1:8765`. Todas las respuestas son JSON UTF-8. La API está
pensada para uso local y **no tiene autenticación**: no la expongas a Internet.

## Formato de error

```json
{
  "ok": false,
  "error": {
    "message": "Table 'sakila.nope' doesn't exist",
    "code": "1146",
    "state": "42S02"
  }
}
```

`code` y `state` solo aparecen en errores de MySQL. Los códigos HTTP usados son
`400` (parámetros/nombres), `404` (no existe) y `500` (fallo del contenedor o de
MySQL).

## Salud y catálogo

### `GET /api/health`

```json
{ "ok": true, "container": "sql-lab", "running": true, "version": "2.0" }
```

### `GET /api/databases`

Lista bases con número de tablas, tamaño y filas estimadas (`TABLE_ROWS`).

```json
{
  "ok": true,
  "databases": [
    { "name": "sakila", "tables": 23, "size": 6782976, "rows": 46788, "system": false }
  ]
}
```

### `GET /api/schema?db=sakila`

Devuelve tablas/vistas, columnas (tipo, nulabilidad, clave, extra, comentario),
rutinas y triggers.

### `GET /api/relations?db=sakila`

Payload compacto para el mapa:

```json
{
  "ok": true,
  "relations": {
    "db": "sakila",
    "tables": [
      {
        "name": "film",
        "type": "BASE TABLE",
        "rows": 1000,
        "columns": [{ "name": "film_id", "type": "smallint unsigned", "key": "PRI" }]
      }
    ],
    "relations": [
      {
        "name": "fk_film_language",
        "from": { "table": "film", "column": "language_id" },
        "to": { "table": "language", "column": "language_id" },
        "on_delete": "RESTRICT",
        "on_update": "CASCADE"
      }
    ]
  }
}
```

## Datos de una tabla

### `GET /api/table?db=&table=`

Metadatos completos + primera página de filas.

| Parámetro | Por defecto | Límites |
| --- | --- | --- |
| `db` | — | obligatorio |
| `table` | — | obligatorio |
| `limit` | 50 | 1–500 |
| `offset` | 0 | 0–10.000.000 |
| `order` | — | una columna real; si no, se ignora |
| `dir` | `asc` | `asc` / `desc` |
| `q` | — | busca en todas las columnas (máx. 20) |

Respuesta (resumida):

```json
{
  "ok": true,
  "table": {
    "db": "sakila",
    "table": "film",
    "type": "BASE TABLE",
    "engine": "InnoDB",
    "rows_estimate": 1000,
    "size": 272640,
    "collation": "utf8mb4_0900_ai_ci",
    "comment": "",
    "columns": [],
    "indexes": [{ "name": "PRIMARY", "unique": true, "type": "BTREE", "columns": ["film_id"] }],
    "triggers": [],
    "ddl": "CREATE TABLE `film` (...)",
    "pk": ["film_id"],
    "data": {
      "columns": ["film_id", "title"],
      "rows": [["1", "ACADEMY DINOSAUR"]],
      "total": 1000,
      "offset": 0,
      "limit": 50,
      "order": "title",
      "direction": "asc",
      "search": ""
    }
  }
}
```

Si la tabla no existe: `404` con `error.code = "1146"`.

### `GET /api/rows?db=&table=`

Igual que la página de `/api/table`, pero solo devuelve `data` y evita releer
índices y DDL en cada cambio de página.

```bash
curl "http://127.0.0.1:8765/api/rows?db=sakila&table=film&limit=5&order=title"
```

### `GET /api/preview?db=&table=&limit=100`

Atajo heredado que devuelve el mismo formato que `/api/query` con un
`SELECT * … LIMIT n`.

## Ejecución

### `POST /api/query`

```json
{ "db": "sakila", "sql": "SELECT 1 AS uno; SELECT 2 AS dos;", "limit": 5000 }
```

Respuesta:

```json
{
  "ok": true,
  "result": {
    "ok": true,
    "db": "sakila",
    "ms": 12.4,
    "count": 2,
    "statements": [
      {
        "sql": "SELECT 1 AS uno",
        "kind": "SELECT",
        "ok": true,
        "ms": 3.1,
        "columns": ["uno"],
        "rows": [["1"]],
        "total_rows": 1
      }
    ]
  }
}
```

- Respeta `DELIMITER`, comillas y comentarios.
- Se detiene en el primer error; las sentencias restantes vuelven con
  `skipped: true`.
- `INSERT/UPDATE/DELETE/REPLACE` añaden `affected` y, si aplica, `insert_id`.
- `truncated: true` si se supera el límite de filas.

## Importación y bases

### `POST /api/import`

```json
{ "sql": "CREATE TABLE …", "db": "practica", "create": true }
```

Crea la base con `utf8mb4_unicode_ci` si `create` es cierto y ejecuta el script
con un tiempo límite de 600 s.

### `POST /api/database`

```json
{ "action": "create", "name": "practica" }
{ "action": "drop", "name": "practica" }
```

El nombre debe cumplir `[A-Za-z0-9_$][A-Za-z0-9_$-]*`.

## Ficheros `.sql`

Trabajan únicamente dentro de `sql/`. Nombres válidos:
`[A-Za-z0-9][A-Za-z0-9 ._-]{0,80}.sql`.

| Método | Ruta | Descripción |
| --- | --- | --- |
| `GET` | `/api/files` | Lista con nombre, bytes y `mtime`. |
| `GET` | `/api/file?name=consulta.sql` | Devuelve el contenido. |
| `POST` | `/api/file` | Guarda `{ name, sql }` con escritura atómica. |
| `DELETE` | `/api/file?name=consulta.sql` | Borra el fichero. |

```bash
curl -X POST http://127.0.0.1:8765/api/file \
  -H 'Content-Type: application/json' \
  -d '{"name":"demo.sql","sql":"SELECT NOW();"}'

curl "http://127.0.0.1:8765/api/file?name=demo.sql"
curl -X DELETE "http://127.0.0.1:8765/api/file?name=demo.sql"
```

Se rechazan `../`, rutas absolutas, subdirectorios y nombres sin `.sql`. La
respuesta de un guardado correcto incluye el tamaño final y el `mtime`.

## Límites

- `MAX_ROWS = 5000` filas por sentencia en `/api/query`.
- `MAX_TABLE_PAGE = 500` filas por página en el inspector.
- Tiempo máximo de ejecución: 120 s (600 s en importaciones).
- `q` examina como máximo 20 columnas y omite `BLOB`, `BINARY`, `JSON`,
  `GEOMETRY` y `BIT` para evitar comparaciones costosas o inválidas.
