#!/usr/bin/env bash
# Instalador de SQL Studio Lab: deja el laboratorio listo en un comando.
#
#   ./install.sh                 dependencias + .env + MySQL + build + servidor
#   ./install.sh --demo          además carga sql/examples/quickstart.sql
#   ./install.sh --desktop       crea la entrada del menú de aplicaciones
#   ./install.sh --no-start      prepara todo pero no arranca la app
#   ./install.sh --rebuild       fuerza npm ci + build del frontend
#   ./install.sh --check         solo comprueba dependencias (no cambia nada)
#   ./install.sh --status        estado del contenedor y del servidor
#   ./install.sh --stop          para la app y el contenedor (los datos se conservan)
#   ./install.sh --port 8765 --mysql-port 3306
set -euo pipefail

SELF="$(readlink -f -- "${BASH_SOURCE[0]}")"
BASE="$(cd -- "$(dirname -- "$SELF")" && pwd)"
cd "$BASE"

ENV_FILE="$BASE/.env"
PORT_OVERRIDE=""
MYSQL_PORT_OVERRIDE=""
DEMO=0
DESKTOP=0
NO_START=0
REBUILD=0
CHECK_ONLY=0
DO_STOP=0
DO_STATUS=0
LINK_CLI=1

if [ -t 1 ] && [ -z "${NO_COLOR:-}" ]; then
  GREEN=$'\033[32m' YELLOW=$'\033[33m' RED=$'\033[31m' BOLD=$'\033[1m' DIM=$'\033[2m' RESET=$'\033[0m'
else
  GREEN="" YELLOW="" RED="" BOLD="" DIM="" RESET=""
fi

info() { printf '%s==>%s %s\n' "$GREEN" "$RESET" "$*"; }
warn() { printf '%saviso:%s %s\n' "$YELLOW" "$RESET" "$*" >&2; }
die() { printf '%serror:%s %s\n' "$RED" "$RESET" "$*" >&2; exit 1; }
step() { printf '\n%s%s%s\n' "$BOLD" "$*" "$RESET"; }

usage() {
  sed -n '2,13p' "$SELF" | sed 's/^# \{0,1\}//'
}

while [ $# -gt 0 ]; do
  case "$1" in
    --demo) DEMO=1 ;;
    --desktop) DESKTOP=1 ;;
    --no-start) NO_START=1 ;;
    --no-link) LINK_CLI=0 ;;
    --rebuild) REBUILD=1 ;;
    --check) CHECK_ONLY=1 ;;
    --stop) DO_STOP=1 ;;
    --status) DO_STATUS=1 ;;
    --port) shift; PORT_OVERRIDE="${1:-}"; [ -n "$PORT_OVERRIDE" ] || die "falta el valor de --port" ;;
    --mysql-port) shift; MYSQL_PORT_OVERRIDE="${1:-}"; [ -n "$MYSQL_PORT_OVERRIDE" ] || die "falta el valor de --mysql-port" ;;
    -h|--help) usage; exit 0 ;;
    *) die "opción desconocida: $1 (usa --help)" ;;
  esac
  shift
done

load_env() {
  if [ -f "$ENV_FILE" ]; then
    set -a
    # shellcheck disable=SC1090
    . "$ENV_FILE"
    set +a
  fi
}

set_env_key() {
  local key="$1" value="$2"
  if grep -q "^${key}=" "$ENV_FILE" 2>/dev/null; then
    sed -i "s|^${key}=.*|${key}=${value}|" "$ENV_FILE"
  else
    printf '%s=%s\n' "$key" "$value" >> "$ENV_FILE"
  fi
}

ensure_env() {
  if [ ! -f "$ENV_FILE" ]; then
    local pass
    pass="$(head -c 64 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 24)"
    [ -n "$pass" ] || die "no se pudo generar la contraseña de MySQL."
    ( umask 077; printf 'MYSQL_ROOT_PASSWORD=%s\nMYSQL_PORT=%s\nSQL_STUDIO_PORT=%s\n' \
        "$pass" "${MYSQL_PORT_OVERRIDE:-3306}" "${PORT_OVERRIDE:-8765}" > "$ENV_FILE" )
    info "Creado .env con una contraseña aleatoria (permisos 600)."
  fi
  chmod 600 "$ENV_FILE" 2>/dev/null || true
  [ -n "$MYSQL_PORT_OVERRIDE" ] && set_env_key MYSQL_PORT "$MYSQL_PORT_OVERRIDE"
  [ -n "$PORT_OVERRIDE" ] && set_env_key SQL_STUDIO_PORT "$PORT_OVERRIDE"
  load_env
}

health() {
  python3 - "$1" <<'PY' >/dev/null 2>&1
import json, sys, urllib.request
try:
    with urllib.request.urlopen(sys.argv[1] + "/api/health", timeout=2) as response:
        sys.exit(0 if json.load(response).get("ok") else 1)
except Exception:
    sys.exit(1)
PY
}

check_dependencies() {
  step "Comprobando dependencias"
  command -v bash >/dev/null || die "falta bash"
  command -v python3 >/dev/null || die "falta python3 (3.10 o superior)"
  python3 -c 'import sys; raise SystemExit(0 if sys.version_info >= (3, 10) else 1)' \
    || die "se necesita Python 3.10 o superior (tienes $(python3 -V 2>&1))."
  info "python3 $(python3 -V 2>&1 | awk '{print $2}')"

  command -v docker >/dev/null || die "falta docker. Instálalo y vuelve a ejecutar."
  docker info >/dev/null 2>&1 || die "el demonio de Docker no responde. Arráncalo y reintenta."
  info "docker $(docker --version | awk '{print $3}' | tr -d ,)"

  if docker compose version >/dev/null 2>&1; then
    info "docker compose $(docker compose version --short 2>/dev/null || true)"
  else
    warn "no hay 'docker compose'; se usará 'docker run' como alternativa."
  fi

  NEED_BUILD=0
  if [ "$REBUILD" = 1 ] || [ ! -f "$BASE/app/static/index.html" ]; then
    NEED_BUILD=1
  fi
  if command -v node >/dev/null && command -v npm >/dev/null; then
    info "node $(node -v) · npm $(npm -v)"
  elif [ "$NEED_BUILD" = 1 ]; then
    die "falta Node.js 18+ para compilar el frontend. Instálalo o usa una copia con app/static ya compilado."
  else
    warn "Node.js no está instalado: se usará el frontend ya compilado en app/static/."
  fi
}

if [ "$DO_STOP" = 1 ]; then
  info "Parando SQL Studio…"
  ./sql-studio --stop || true
  ./sql-lab stop || true
  exit 0
fi

if [ "$DO_STATUS" = 1 ]; then
  ./sql-studio --status || true
  ./sql-lab status || true
  exit 0
fi

check_dependencies
if [ "$CHECK_ONLY" = 1 ]; then
  info "Todo listo. Ejecuta ./install.sh para montar el laboratorio."
  exit 0
fi

ensure_env
load_env

step "1/4 · MySQL en Docker"
./sql-lab start

step "2/4 · Frontend"
if [ "$REBUILD" = 1 ] || [ ! -f "$BASE/app/static/index.html" ]; then
  cd "$BASE/app/web"
  if [ -f package-lock.json ]; then
    npm ci --no-audit --no-fund
  else
    npm install --no-audit --no-fund
  fi
  npm run build
  cd "$BASE"
  info "Frontend compilado en app/static/."
else
  info "app/static/ ya está compilado (usa --rebuild para regenerarlo)."
fi

step "3/4 · Servidor"
if [ "$NO_START" = 1 ]; then
  info "Omitido por --no-start. Arranca con ./sql-studio."
else
  ./sql-studio --no-open
  if health "http://127.0.0.1:${SQL_STUDIO_PORT:-8765}"; then
    info "SQL Studio responde en http://127.0.0.1:${SQL_STUDIO_PORT:-8765}/"
  else
    warn "El servidor no respondió; revisa ./sql-studio --status."
  fi
fi

step "4/4 · Datos de ejemplo e integración"
if [ "$DEMO" = 1 ]; then
  if ./sql-lab list 2>/dev/null | grep -qx quickstart; then
    info "La base 'quickstart' ya existe; no se recarga (evita duplicar filas)."
  else
    ./sql-lab load sql/examples/quickstart.sql
  fi
else
  info "Sin datos de ejemplo. Añade --demo si quieres la base 'quickstart'."
fi

if [ "$LINK_CLI" = 1 ]; then
  mkdir -p "$HOME/.local/bin"
  ln -sfn "$BASE/sql-studio" "$HOME/.local/bin/sql-studio"
  ln -sfn "$BASE/sql-lab" "$HOME/.local/bin/sql-lab"
  info "Comandos enlazados en ~/.local/bin (sql-studio, sql-lab)."
  case ":$PATH:" in
    *":$HOME/.local/bin:"*) ;;
    *) warn "~/.local/bin no está en PATH; añádelo para usar los comandos globalmente." ;;
  esac
fi

if [ "$DESKTOP" = 1 ]; then
  APPS="$HOME/.local/share/applications"
  mkdir -p "$APPS"
  cat > "$APPS/sql-studio.desktop" <<DESKTOP
[Desktop Entry]
Type=Application
Name=SQL Studio
Comment=Laboratorio SQL local con MySQL en Docker
Exec=$BASE/sql-studio
Icon=$BASE/app/static/icon.svg
Terminal=false
Categories=Development;Database;
StartupWMClass=sql-studio
DESKTOP
  chmod 644 "$APPS/sql-studio.desktop"
  command -v update-desktop-database >/dev/null && update-desktop-database "$APPS" >/dev/null 2>&1 || true
  info "Entrada creada en $APPS/sql-studio.desktop"
else
  info "Para añadirlo al menú de aplicaciones: ./install.sh --desktop"
fi

PIDFILE="${XDG_RUNTIME_DIR:-/tmp}/sql-studio-${SQL_STUDIO_PORT:-8765}.pid"
printf '\n%s%sSQL Studio Lab listo%s\n' "$BOLD" "$GREEN" "$RESET"
printf '  App:       http://127.0.0.1:%s/\n' "${SQL_STUDIO_PORT:-8765}"
printf '  Terminal:  ./sql-lab shell sakila   (o sql-lab si lo enlazaste)\n'
printf '  Estado:    ./install.sh --status\n'
printf '  Parar:     ./install.sh --stop\n'
printf '  Log:       %s\n' "${XDG_RUNTIME_DIR:-/tmp}/sql-studio-${SQL_STUDIO_PORT:-8765}.log"
printf '  PID:       %s\n' "$( [ -f "$PIDFILE" ] && cat "$PIDFILE" || echo '-' )"
