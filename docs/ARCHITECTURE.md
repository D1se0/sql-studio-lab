# Arquitectura

SQL Studio Lab es una aplicación **local** de tres capas que evita
deliberadamente dependencias pesadas: un contenedor MySQL oficial, un servidor
HTTP de la biblioteca estándar de Python y un frontend React compilado a
estáticos.

```text
┌─────────────────────────────┐        HTTP 127.0.0.1:8765
│  Navegador / ventana Chromium│ ◄──────────────────────────┐
│  React 18 + CodeMirror 6     │                            │
└─────────────────────────────┘                            │
                                                            │
┌───────────────────────────────────────────────────────────┴──────────────┐
│ app/server.py · ThreadingHTTPServer (stdlib)                             │
│  · sirve app/static/                                                     │
│  · API JSON: catálogo, esquema, relaciones, datos, consultas, ficheros   │
│  · sin ORM ni driver: docker exec + cliente mysql --xml                  │
└───────────────────────────────┬──────────────────────────────────────────┘
                                │ docker exec
┌───────────────────────────────▼──────────────────────────────────────────┐
│ Contenedor sql-lab · mysql:8.4                                           │
│  · escucha en 127.0.0.1:${MYSQL_PORT}                                    │
│  · volumen ./volumen → /var/lib/mysql                                    │
│  · ./sql → /lab/sql (ro) y ./historial → /lab/historial                  │
└──────────────────────────────────────────────────────────────────────────┘
```

## Flujo de una consulta

1. El editor envía `POST /api/query` con `{ db, sql }`.
2. El backend parte el script con un separador propio que respeta cadenas,
   identificadores entrecomillados, comentarios y `DELIMITER`.
3. Cada sentencia se envuelve en su propio `DELIMITER` para que el cliente
   `mysql` no la vuelva a trocear (importante en `BEGIN … END`).
4. Se ejecuta con `docker exec … mysql --xml`, se parsean los `resultset` y se
   devuelve un array de resultados con tipo, `ms`, columnas/filas o error.
5. El frontend guarda el resultado en la pestaña y muestra chips por sentencia.

## Por qué `docker exec` y no un driver

- Cero dependencias de Python: el repo se instala con `python3` y Docker.
- El cliente `mysql` ya está dentro de la imagen oficial y respeta
  `DELIMITER`, procedimientos y sesiones exactamente como la terminal.
- La salida XML evita ambigüedades de TSV con tabuladores, saltos de línea y
  valores `NULL`.
- Contrapartida: el backend necesita Docker disponible. Es un laboratorio
  local, así que se asume.

## Frontend

```text
app/web/src/
├── App.tsx                 estado global, pestañas, consultas, atajos
├── api.ts                  cliente tipado de la API
├── types.ts                contratos compartidos
├── lib/format.ts           números, bytes, fechas, CSV, formateo SQL
├── lib/graph.ts            layout determinista del mapa (fuerza + colisiones)
├── components/
│   ├── Header / Sidebar / TabBar
│   ├── EditorPane          CodeMirror + barra de acciones
│   ├── ResultsPanel        rejilla y errores
│   ├── TableInspector      datos, estructura, índices y SQL
│   ├── SchemaMap           SVG con zoom, pan, arrastre y panel lateral
│   ├── CommandPalette      tablas, bases, acciones e historial
│   └── Modals / Toasts
└── styles.css              sistema de diseño (tokens, paneles, modales)
```

Decisiones relevantes:

- **Sin router**: es una aplicación de una sola vista; el estado de las
  pestañas se persiste en `localStorage` (`sql-studio:v2`) sin resultados.
- **Pestañas de tabla deduplicadas** por `db.tabla`: abrir dos veces la misma
  vista no crea pestañas fantasma y evita el temblor de animaciones de layout.
- **Inspector en modal** en lugar de pestaña: mantiene el editor intacto y
  permite paginar/ordenar/filtrar sin ensuciar el historial de pestañas.
- **Mapa determinista**: el layout se calcula con semilla derivada de los
  nombres, así el mismo esquema se dibuja siempre igual. No hay dependencias de
  d3; ~200 líneas de simulación y resolución de solapes.
- **Cierre inmediato de modales**: se anima la entrada, pero el desmontaje no
  espera a JavaScript; evita diálogos colgados si el navegador congela
  animaciones (pestañas en segundo plano, iframes, etc.).

## Seguridad

- `ThreadingHTTPServer` se enlaza a `127.0.0.1` por defecto
  (`SQL_STUDIO_HOST` permite cambiarlo, pero no se recomienda).
- MySQL publica el puerto solo en `127.0.0.1`.
- `.env` se crea con `umask 077`; `.gitignore` excluye `.env`, `volumen/`,
  `historial/` y `config/`.
- Los identificadores se citan con backticks duplicados; los nombres de bases
  se validan con una expresión regular; el orden solo se acepta si coincide
  con una columna real.
- La búsqueda del inspector usa literales `LIKE` con `%`, `_`, `\` y comillas
  escapados; nunca se interpola texto del usuario en SQL.
- Los ficheros `.sql` se confinan a `sql/` (se rechazan `/`, `..`, nombres sin
  extensión y rutas absolutas) y se escriben con `.tmp` + `os.replace`.
- No hay autenticación porque no hay exposición de red. **No publiques el
  puerto 8765 ni el 3306 en Internet**; si necesitas acceso remoto, usa SSH o
  una VPN.

## Persistencia y copias

`volumen/` es un bind mount del directorio de datos de MySQL. Parar o borrar el
contenedor no afecta a los datos. Para una copia consistente:

```bash
./install.sh --stop
tar czf sql-studio-backup-$(date +%F).tgz volumen sql
./install.sh
```

## Límites conocidos

- Resultados de `SELECT` truncados a 5.000 filas por sentencia (configurable en
  `MAX_ROWS`) para no saturar el navegador.
- El inspector pagina de 25 a 200 filas; el recuento con filtro recorre la
  tabla, por lo que en tablas enormes puede tardar.
- Sin WebSocket: los metadatos se refrescan a mano (botón o `Ctrl+P`).
- El lanzador de ventana usa Chromium/Chrome/Firefox si están instalados; en
  cualquier otro caso abre el navegador por defecto o imprime la URL.
