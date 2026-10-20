# Discoclub

[![CI](https://github.com/dfranco54/discoclub/actions/workflows/ci.yml/badge.svg)](https://github.com/dfranco54/discoclub/actions/workflows/ci.yml)

Backend for a movie rental service (think of a modern video club): limited physical copies,
due dates, waiting lists and late fees.

> **Status: work in progress.** I'm building this step by step to practice backend design.
> The sections below say clearly what works today and what is planned.

## What works today

- Express 5 + TypeScript (strict mode) API, tested with Vitest and Supertest
- PostgreSQL 16 with Docker Compose and **versioned SQL migrations** (small custom runner)
- User registration and login: argon2id password hashing, JWT in an `httpOnly` cookie
- Role-based authorization (`CUSTOMER` / `STAFF` / `ADMIN`)
- Input validation with Zod, rate limiting and secure HTTP headers (helmet)
- Movie catalog loaded from a validated seed dataset, plus the `copies` schema
- Integration tests against a real PostgreSQL database
- CI with GitHub Actions: typecheck, build and tests on every push and pull request
- Catalog endpoints: search, filters and pagination

## Planned


- Copies management for staff and admins
- Rentals with protection against two users renting the last copy at the same time
- Waiting list, scheduled jobs and late fees
- OpenAPI documentation, structured logging, refresh tokens
- React frontend and public deployment

## Tech stack

Node.js · Express 5 · TypeScript · PostgreSQL (`pg`, no ORM) · Zod · argon2 · jose (JWT) ·
Docker · Vitest · GitHub Actions

## Getting started

Requirements: Node.js 20.19 or newer, Docker, Git.

```bash
# 1. Start PostgreSQL
docker compose up -d

# 2. Install dependencies and configure the environment
cd api
npm install
cp .env.example .env        # PowerShell: copy .env.example .env

# 3. Generate a random JWT secret and paste it into .env as JWT_SECRET
node --input-type=module -e "import { randomBytes } from 'node:crypto'; console.log(randomBytes(48).toString('base64url'))"

# 4. Create the tables and load the catalog
npm run db:migrate
npm run catalog:seed

# 5. Run the API
npm run dev
```

Check it works: `curl http://localhost:3000/health`

### Environment variables

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | yes | PostgreSQL connection string |
| `JWT_SECRET` | yes | Secret used to sign tokens (at least 32 characters) |
| `TRUST_PROXY` | no | Number of reverse proxies in front of the app (default `0`) |

### Scripts (run from `api/`)

| Script | What it does |
|---|---|
| `npm run dev` | Start the API with auto-reload |
| `npm run build` / `npm start` | Compile to `dist/` and run the compiled app |
| `npm run typecheck` | Type-check the whole project, tests included |
| `npm test` | Run the tests (Docker must be running) |
| `npm run db:migrate` | Apply pending SQL migrations |
| `npm run catalog:seed` | Load or refresh the movie catalog |

## API

| Method | Path | Access | Description |
|---|---|---|---|
| GET | `/health` | public | Liveness check |
| POST | `/auth/register` | public, rate limited | Create an account (`201`, `400`, `409`) |
| POST | `/auth/login` | public, rate limited | Log in; sets the `access_token` cookie |
| GET | `/auth/me` | authenticated | Current user |
| POST | `/auth/logout` | any | Clears the session cookie |
| GET | `/admin/ping` | `ADMIN` | Probe route used to test role protection |
| GET | `/movies` | public | List the catalog. Query: `q` (title or director), `genre`, `limit` (1-50, default 20), `cursor` |
| GET | `/movies/:slug` | public | Movie detail, including its number of active copies |

## Testing

```bash
cd api
npm test
```

Integration tests run against a real PostgreSQL database (`discoclub_test`), created and
migrated automatically. They never touch your development database, and the test setup
refuses to run against any database whose name doesn't end in `_test`.
I use a real database instead of mocks because most of what I want to verify
(unique constraints, foreign keys, transactions) happens inside PostgreSQL.

## Catalog

The catalog is a small hand-made dataset (`api/seed/movies.json`, 40 movies) loaded with
`npm run catalog:seed`. Titles, years and directors are factual metadata; the descriptions are
original. No third-party API is needed to run the project, which also keeps tests and CI
reproducible.

- The seed is **idempotent** (`ON CONFLICT (slug) DO UPDATE`): safe to re-run after editing the file
- It loads in a **single transaction**: all movies or none
- The file is validated with Zod, and a test makes CI fail if the dataset is broken
- A copy's availability is **derived from rentals** instead of stored, so there is a single source of truth
- No posters yet: the frontend will use a placeholder

## Security

**Implemented**
- Passwords hashed with argon2id; the plain password is never stored or logged
- Input validation with Zod at the API boundary; unknown fields are stripped
  (no client-chosen roles)
- JWT access tokens (15 min) in `httpOnly`, `SameSite=Lax` cookies, algorithm pinned on verification
- Login responds identically (message and timing) for unknown emails and wrong passwords
- Role-based authorization; 401 (not authenticated) and 403 (not allowed) handled separately
- Rate limiting on login (failed attempts only) and registration
- Secure HTTP headers via helmet; request body size limited
- Database constraints as the last line of defense (unique and lowercase emails)
- Parameterized SQL queries only

**Known limitations (and what I'd do next)**
- Logging out only clears the cookie: a stolen token stays valid until it expires
  (max 15 min). A revocable refresh-token flow would fix this.
- A role change only takes effect when the token expires, because the role is stored in the token.
- Rate limit counters live in memory (per instance, reset on restart);
  production would need a shared store such as Redis.
- Registration reveals whether an email exists (409); an email-verification flow would avoid this.

## Design decisions

- **Plain SQL instead of an ORM.** The hardest part of the domain (row locking, partial unique
  indexes, transactions) is SQL anyway, so I wanted full control and to understand exactly
  what runs. The trade-off: no compile-time check of queries, which I compensate for with
  integration tests.
- **Rules enforced in the database.** Constraints such as unique and lowercase emails live in
  PostgreSQL, so a bug in the application code cannot break them. Zod gives friendly errors;
  the database is the safety net.
- **Migrations are plain SQL files** applied once, in order, each in a transaction, guarded by
  an advisory lock so two processes can't migrate at the same time.
- **`buildApp()` is separate from `server.ts`**, so tests can exercise the app without opening a port.
- **Secure by default.** Rate limiting is on unless a test explicitly turns it off.
- **Keyset (cursor) pagination instead of OFFSET.** Cost stays constant on deep pages and results
  don't shift when rows are added or removed. The order is total (`title`, then `slug` as a
  tie-breaker). Trade-off: you can only move forward, not jump to page N, and there is no total count.
- **Dynamic filters without SQL injection.** The query is assembled from fixed fragments and
  numbered placeholders; user input only ever travels as parameters, and LIKE wildcards are escaped.

## Project structure

```
discoclub/
├── .github/
│   ├── workflows/ci.yml        # CI pipeline
│   └── dependabot.yml          # keeps GitHub Actions up to date
├── docker-compose.yml          # local PostgreSQL
└── api/
    ├── migrations/             # versioned SQL migrations
    ├── seed/movies.json        # catalog dataset
    ├── src/
    │   ├── db/                 # connection pool and migration runner
    │   ├── lib/                # password hashing, JWT
    │   ├── middleware/         # authentication, error handling, rate limiting
    │   ├── modules/            # auth, users, movies, admin (one folder per domain)
    │   ├── scripts/            # seed-movies.ts
    │   ├── app.ts              # builds the Express app
    │   ├── config.ts           # validated environment variables
    │   └── server.ts           # starts the HTTP server
    └── tests/
```