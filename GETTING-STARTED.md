# Getting Started

## Quick Start

### 1. Start the database

```bash
docker-compose up -d --build
```

This starts PostgreSQL on port `5432`.

### 2. Run the database migration

```bash
bun db:migrate
```

## Running the Demo

1. Create a .env file with same values as in .env.example

2. Run the demo:

```bash
bun run demo
```

The demo processes blocks, tracks balances, demonstrates rollback functionality, and shows error handling scenarios.
