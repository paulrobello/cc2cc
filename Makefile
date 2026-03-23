.PHONY: build test lint fmt typecheck checkall dev-redis dev-hub dev-dashboard docker-up docker-down docker-dev-up docker-dev-down install-hooks check-secrets

# ── Build ────────────────────────────────────────────────────────────────────
build:
	bun run --workspaces build

# ── Quality ──────────────────────────────────────────────────────────────────
test:
	bun run --workspaces test

lint:
	bun run --workspaces lint

fmt:
	bun run --workspaces fmt

typecheck:
	bun run --workspaces typecheck

checkall: fmt lint typecheck test

# ── Security ─────────────────────────────────────────────────────────────────
install-hooks:
	cp scripts/check-secrets.sh .git/hooks/pre-commit
	chmod +x .git/hooks/pre-commit
	@echo "Pre-commit hook installed. Run 'make check-secrets' to test it."

check-secrets:
	@bash scripts/check-secrets.sh

# ── Dev ──────────────────────────────────────────────────────────────────────
dev-redis:
	docker compose -f docker-compose.dev.yml up -d

dev-hub:
	cd hub && bun run dev

dev-dashboard:
	cd dashboard && bun run dev

# ── Docker ───────────────────────────────────────────────────────────────────
docker-up:
	docker compose up -d --build

docker-down:
	docker compose down

docker-dev-up:
	docker compose -f docker-compose.dev.yml up -d

docker-dev-down:
	docker compose -f docker-compose.dev.yml down
