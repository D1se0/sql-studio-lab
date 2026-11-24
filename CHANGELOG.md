# Changelog

Todas las versiones notables se documentan aquí. El formato sigue
[Keep a Changelog](https://keepachangelog.com/es/1.1.0/) y el proyecto usa
versionado semántico.

## [2.1.0] — 2026-11-24

### Añadido

- Mapa de esquema interactivo con claves foráneas, zoom, arrastre y panel de
  detalles.
- Inspector de tabla en ventana: datos paginados, orden, filtro global, detalle
  de fila, estructura, índices, DDL y apertura en el editor.
- Paleta de comandos (`Ctrl+P`) con bases, tablas, acciones e historial.
- Historial local de consultas ejecutadas.
- Endpoints `/api/relations`, `/api/table`, `/api/rows` y `DELETE /api/file`.
- Instalador `install.sh`, `docker-compose.yml`, Makefile y CI de GitHub.
- Datos de ejemplo `quickstart` con relaciones y consultas.
- Documentación de arquitectura, API y pruebas.

### Cambiado

- La barra de pestañas ahora se desplaza, mantiene visible la activa y ofrece
  un menú con todas las pestañas.
- Abrir la misma tabla dos veces reutiliza la pestaña en lugar de duplicarla.
- Los modales se desmontan al instante al cerrar (animación solo de entrada).
- Las pruebas de interfaz cubren 41 casos y las de API 80.

### Corregido

- Filtro del inspector que escapaba también los comodines de los extremos.
- Los scripts de solo comentarios ya no generan sentencias vacías.
- Desbordes y saltos de la tira de pestañas al abrir muchas vistas.

## [2.0.0] — 2026-11-24

### Añadido

- Frontend reescrito con React 18, TypeScript, Vite y CodeMirror 6.
- Guardado y apertura de `.sql`, guardado como y aviso de cambios.
- Árbol plegable con búsqueda y acciones por base/tabla.
- Importación con `DELIMITER`, creación/borrado de bases y exportación CSV.
- Arnés de interfaz con CDP.

## [1.0.0] — 2026-11-10

- Laboratorio inicial: contenedor MySQL 8.4, scripts `sql-lab`, editor nano,
  banco de pruebas declarativo y app web básica.
