# Pruebas

El proyecto tiene tres baterías complementarias. Todas están pensadas para
ejecutarse en local; la de interfaz necesita Chromium.

| Batería | Comando | Casos | Necesita |
| --- | --- | ---: | --- |
| Unitarias | `python3 app/tests/test_unit.py` | 33 | Python |
| API | `python3 app/tests/test_api.py` | 79 | Docker + API en marcha |
| Interfaz | `cd app/web && node tools/ui-run.mjs http://127.0.0.1:8765/tests/ui.html` | 41 | Chromium + API |

## Unitarias

No tocan MySQL. Cubren las piezas donde un error silencioso es peligroso:

- separación de sentencias con `;` dentro de cadenas, comentarios y backticks;
- `DELIMITER` para procedimientos y triggers;
- detección de scripts de solo comentarios;
- parseo de `ERROR 1146 (42S02) …`;
- `build_payload` y `ROW_COUNT()`;
- validación de nombres de `.sql` y rechazo de traversal;
- escapado de `LIKE` (`%`, `_`, comillas) y acotado de límites.

```bash
python3 app/tests/test_unit.py
# ==> 33 pruebas unitarias: 33 correctas, 0 fallidas.
```

## API

Requiere el contenedor y la API:

```bash
./install.sh            # o ./sql-lab start && ./sql-studio --no-open
python3 app/tests/test_api.py
```

Crea y destruye sus propias bases/tablas (`studio_*`, `api_*.sql`) y comprueba,
entre otras cosas:

- catálogo, esquema, triggers y rutinas;
- consultas multi-sentencia, errores, `SIGNAL` y `DELIMITER`;
- filas afectadas e `insert_id`;
- importación real con claves foráneas;
- paginación, orden, filtro, comodines escapados e inyección en `order`;
- límites de página y `offset` fuera de rango;
- mapa de relaciones (23 tablas y 22 FK en `sakila`);
- guardado, lectura, borrado y validación de `.sql`;
- que las pruebas no modifican datos de usuario.

Si el servidor no está en marcha, todas las llamadas fallan con un mensaje
claro; arráncalo antes.

## Interfaz

El arnés vive en `app/web/public/tests/ui.html` y se sirve en
`/tests/ui.html`. No usa Playwright ni Selenium: `tools/ui-run.mjs` lanza
Chromium con CDP, navega al arnés y espera a que escriba `RESULTADO n correctas`.

El iframe de la app se mantiene fijo y el log va en un panel superpuesto: si el
log empujara el iframe fuera de la ventana, Chromium congela las animaciones y
las esperas de cierre fallarían (falso negativo).

Cubre 41 casos con clics e interacción real:

- árbol, búsqueda, plegado y expansión;
- consultas, errores, `SIGNAL`, chips y limpieza de salida;
- guardado en disco, apertura y borrado del `.sql` de prueba;
- pestañas: no duplicar vistas, scroll, menú y visibilidad de la activa;
- inspector: paginación, orden, filtro, detalle de fila, estructura, índices,
  DDL y apertura en el editor;
- mapa: 23 tablas, 22 aristas, selección, zoom, filtros y cambio de base;
- paleta: `Ctrl+P`, búsqueda de tablas y recuperación del historial;
- atajos `Ctrl+Shift+M`, `Escape` y selector de base.

```bash
cd app/web
node tools/ui-run.mjs http://127.0.0.1:8765/tests/ui.html /tmp/ui.png
# RESUMEN: RESULTADO 41 correctas, 0 fallidas
```

La captura es opcional; el segundo argumento es la ruta del PNG.

### Capturas de estados reales

`tools/shot.mjs` abre escenarios concretos y guarda una imagen:

```bash
cd app/web
node tools/shot.mjs /tmp/app.png preview
node tools/shot.mjs /tmp/inspector.png inspector
node tools/shot.mjs /tmp/map.png map
node tools/shot.mjs /tmp/palette.png palette
```

## CI

`.github/workflows/ci.yml` ejecuta en cada push/PR:

1. pruebas unitarias con Python 3.12;
2. `npm ci` + `npm run build` con Node 20 (TypeScript + Vite);
3. `bash -n` de `install.sh`, `sql-lab` y `sql-studio`.

La integración con MySQL real y el arnés de Chromium quedan fuera de CI porque
el backend usa `docker exec` sobre un contenedor concreto y el arnés necesita un
Chromium con display. Se ejecutan en local antes de publicar una release.

## Añadir pruebas

- Unitarias: añade un `check(...)` en `test_unit.py`; sin dependencias.
- API: usa `call()` y `check()`; crea datos con prefijo `studio_` y límpialos.
- Interfaz: añade un `await check("…", async () => { … })` al final del `main()`
  del arnés. Usa `waitFor` en lugar de `sleep` fijos y `fire()` para elementos
  SVG, que no implementan `HTMLElement.click()`.
