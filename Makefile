SHELL := /usr/bin/env bash
PORT ?= 8765

.PHONY: install demo rebuild build dev start stop status up down logs test test-unit test-api test-ui clean

install:
	./install.sh

demo:
	./install.sh --demo

rebuild:
	./install.sh --rebuild --no-start

build:
	cd app/web && npm ci --no-audit --no-fund && npm run build

dev:
	@echo "Servidor API en http://127.0.0.1:$(PORT) y Vite en http://127.0.0.1:5173"
	@./sql-studio --no-open >/dev/null 2>&1 || true
	cd app/web && npm run dev

start:
	./sql-studio --no-open

stop:
	./install.sh --stop

status:
	./install.sh --status

up:
	docker compose up -d

down:
	docker compose down

logs:
	docker logs --tail 80 sql-lab

test: test-unit test-api test-ui

test-unit:
	python3 app/tests/test_unit.py

test-api:
	python3 app/tests/test_api.py

test-ui:
	cd app/web && node tools/ui-run.mjs http://127.0.0.1:$(PORT)/tests/ui.html

clean:
	rm -rf app/web/node_modules app/__pycache__ app/tests/__pycache__
	rm -f sql/ui_smoke.sql
	@echo "Dependencias y restos de pruebas eliminados (los datos de MySQL no se tocan)."
