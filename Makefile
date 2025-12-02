.PHONY: up down logs shell

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
