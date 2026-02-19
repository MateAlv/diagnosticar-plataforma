.PHONY: up down logs shell up-prod down-prod logs-prod config-prod

up:
	docker compose up --build -d

up-prod:
	docker compose -f docker-compose.yml -f docker-compose.prod.yml up --build -d

down:
	docker compose down

down-prod:
	docker compose -f docker-compose.yml -f docker-compose.prod.yml down

logs:
	docker compose logs -f

logs-prod:
	docker compose -f docker-compose.yml -f docker-compose.prod.yml logs -f

config-prod:
	docker compose --env-file .env -f docker-compose.yml -f docker-compose.prod.yml config

shell-frontend:
	docker compose exec frontend sh

shell-backend:
	docker compose exec backend sh
