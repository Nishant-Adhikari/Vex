# EchoClaw — Developer Makefile

.PHONY: build test dev clean lint lint-all check e2e-db-up e2e-db-down

# -- Build & Test -------------------------------------------------------------

build:
	pnpm run build

test:
	pnpm test

dev:
	pnpm run dev

clean:
	pnpm run clean

lint:
	pnpm exec tsc --noEmit

lint-all:
	pnpm exec tsc --noEmit -p tsconfig.test.json

check: lint test

# -- E2E Test DB --------------------------------------------------------------

e2e-db-up:
	docker compose -f docker/echo-agent/docker-compose.e2e.yml up -d

e2e-db-down:
	docker compose -f docker/echo-agent/docker-compose.e2e.yml down
