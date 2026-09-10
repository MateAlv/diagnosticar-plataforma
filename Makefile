.PHONY: up down logs shell-frontend shell-backend \
        up-prod down-prod logs-prod config-prod \
        test test-backend test-frontend test-e2e lint typecheck \
        staging-up staging-down staging-logs staging-smoke \
        deploy deploy-rollback smoke

# --- Local development -----------------------------------------------------
up:
	docker compose up --build -d

down:
	docker compose down

logs:
	docker compose logs -f

shell-frontend:
	docker compose exec frontend sh

shell-backend:
	docker compose exec backend sh

# --- Tests -----------------------------------------------------------------
# Backend integration tests need Postgres. Without TEST_DATABASE_URL they skip;
# `make test-backend` starts a throwaway database so they actually run.
test: lint typecheck test-backend test-frontend test-e2e

lint:
	cd frontend && npm run lint
	cd backend && npm run lint

typecheck:
	cd frontend && npm run typecheck
	cd backend && npm run typecheck

test-backend:
	docker rm -f diagnosticar-test-db 2>/dev/null || true
	docker run -d --name diagnosticar-test-db \
		-e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=diagnosticar_test \
		-p 127.0.0.1:55432:5432 postgres:15-alpine >/dev/null
	@sleep 4
	cd backend && TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55432/diagnosticar_test npm test; \
		status=$$?; docker rm -f diagnosticar-test-db >/dev/null; exit $$status

test-frontend:
	cd frontend && npm test

test-e2e:
	cd frontend && npm run build && npm run test:e2e

# --- Production (nodo0) ----------------------------------------------------
up-prod:
	docker compose -f docker-compose.yml -f docker-compose.prod.yml up --build -d

down-prod:
	docker compose -f docker-compose.yml -f docker-compose.prod.yml down

logs-prod:
	docker compose -f docker-compose.yml -f docker-compose.prod.yml logs -f

config-prod:
	docker compose --env-file .env -f docker-compose.yml -f docker-compose.prod.yml config

# Pull-based deploy of a CI-built release, with smoke test and auto-rollback.
deploy:
	ops/deploy.sh $(TAG)

deploy-rollback:
	ops/deploy.sh --rollback

smoke:
	ops/smoke.sh

# --- Staging (nodo0, separate project + volume) ----------------------------
staging-up:
	ops/staging.sh up $(TAG)

staging-down:
	ops/staging.sh down

staging-logs:
	ops/staging.sh logs

staging-smoke:
	ops/staging.sh smoke
