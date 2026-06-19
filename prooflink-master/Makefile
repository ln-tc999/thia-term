.PHONY: help install build test test-unit test-e2e lint typecheck clean dev docker-up docker-down docker-prod db-migrate contracts-build contracts-test

help: ## Show this help message
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%-20s\033[0m %s\n", $$1, $$2}'

install: ## Install all dependencies
	pnpm install

build: ## Build all packages
	pnpm build

test: ## Run all tests
	pnpm test

test-unit: ## Run unit tests only
	pnpm test:unit

test-e2e: ## Run end-to-end tests
	pnpm test:e2e

lint: ## Run linter across all packages
	pnpm lint

typecheck: ## Run TypeScript type checking
	pnpm typecheck

clean: ## Clean build artifacts and node_modules
	rm -rf node_modules
	rm -rf apps/*/dist apps/*/node_modules
	rm -rf packages/*/dist packages/*/node_modules

dev: ## Start development environment
	docker compose --profile dev up -d
	pnpm dev

docker-up: ## Start Docker services
	docker compose up -d

docker-down: ## Stop Docker services
	docker compose down

docker-prod: ## Start production Docker environment
	docker compose -f docker-compose.production.yml up -d --build

db-migrate: ## Run database migrations
	pnpm --filter @prooflink/api db:migrate

contracts-build: ## Build smart contracts
	pnpm --filter @prooflink/contracts build

contracts-test: ## Run smart contract tests
	pnpm --filter @prooflink/contracts test
