# Contribuir

Gracias por querer mejorar SQL Studio Lab. Es un proyecto pequeño: los cambios
pequeños, bien probados y explicados son los más fáciles de revisar.

## Antes de empezar

- Busca en los issues existentes para no duplicar trabajo.
- Para cambios grandes, abre antes un issue con el problema y la propuesta.
- No incluyas credenciales, `.env`, volúmenes de MySQL, historiales ni capturas
  con datos personales.

## Entorno de desarrollo

```bash
git clone https://github.com/TU-USUARIO/sql-studio-lab.git
cd sql-studio-lab
./install.sh --demo
```

Frontend con recarga en caliente (la API debe estar en el puerto 8765):

```bash
./sql-studio --no-open
cd app/web
npm install
npm run dev        # http://127.0.0.1:5173 con proxy /api
```

Compilar lo que se sirve en producción local:

```bash
cd app/web
npm run build      # escribe en app/static/
```

## Estilo

- **Backend**: Python 3.10+, solo biblioteca estándar, 4 espacios. Mantén las
  funciones sin estado y los identificadores citados con `quote_ident`.
- **Frontend**: TypeScript estricto, componentes funcionales, sin `any`
  innecesario. Los estilos viven en `src/styles.css` con los tokens existentes.
- **Bash**: `set -euo pipefail`, comillas en todas las variables y mensajes en
  castellano.
- **Commits**: imperativo y corto (`arregla el foco del inspector`, no
  `fixed stuff`). Un commit = un cambio coherente.

## Pruebas obligatorias

```bash
python3 app/tests/test_unit.py
python3 app/tests/test_api.py
cd app/web && npm run build
node tools/ui-run.mjs http://127.0.0.1:8765/tests/ui.html
```

Si tocas la interfaz, añade o actualiza un caso del arnés. Si tocas el backend,
añade una prueba unitaria y/o de API. Un PR con pruebas en rojo no se fusiona.

## Pull request

1. Haz fork y crea una rama descriptiva (`feature/mapa-esquema`).
2. Incluye el «por qué» en la descripción, no solo el «qué».
3. Adjunta una captura si cambia la interfaz.
4. Marca la checklist del template y espera la revisión.

## Licencia

Al contribuir aceptas que tu aportación se publique bajo la licencia MIT del
proyecto.
