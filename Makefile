.PHONY: up down logs shell-frontend shell-backend \
        up-prod down-prod logs-prod config-prod \
        ci test test-backend test-frontend test-e2e lint typecheck \
        staging-up staging-down staging-logs staging-smoke \
        staging-deploy staging-rollback staging-status smoke

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
# Every check in .github/workflows/ci.yml, locally, in CI's order. `test`
# covers five of the eleven; this covers all of them, including the image
# builds and the compose stack. Run it before pushing — Actions minutes are
# finite, and a Docker build that fails there fails here first.
#
#   make ci                  # everything
#   make ci GROUPS=images    # one group, while iterating on a failure
ci:
	ops/ci-local.sh $(GROUPS)

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

# What cron runs on nodo0 is `ops/deploy.sh staging`; these are for a person.
staging-deploy:
	ops/deploy.sh staging $(TAG)

staging-rollback:
	ops/deploy.sh staging --rollback

staging-status:
	ops/deploy.sh staging --status
