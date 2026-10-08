[![CI](https://github.com/dfranco54/discoclub/actions/workflows/ci.yml/badge.svg)](https://github.com/dfranco54/discoclub/actions/workflows/ci.yml)

# Discoclub

Backend for a movie rental service (think of a modern video club): limited copies,
due dates, waiting lists and late fees.

> **Status: work in progress.** This is a personal project I'm building step by step
> to practice backend design. The sections below say clearly what works today and
> what is planned.

## What works today
- Express 5 + TypeScript (strict mode) API with a `/health` endpoint
- PostgreSQL 16 running locally with Docker Compose
- Versioned SQL migrations with a small custom runner (transactional, one-time apply)
- `users` table with database-level constraints (unique, lowercase email)
- Tests with Vitest and Supertest

## Planned
- User registration, login and roles (customer / staff / admin)
- Movie catalog synced from TMDB
- Rentals with protection against two users renting the last copy at once
- Waiting list, scheduled jobs and late fees
- React frontend, CI with GitHub Actions, public deployment

## Tech stack
Node.js · Express 5 · TypeScript · PostgreSQL (`pg`, no ORM) · Docker · Vitest

## Getting started
Requirements: Node.js 20.19+, Docker.

    docker compose up -d
    cd api
    cp .env.example .env      # PowerShell: copy .env.example .env
    npm install
    npm run db:migrate
    npm run dev

Check it works: `curl http://localhost:3000/health`

## Design decisions
- **Plain SQL instead of an ORM:** the hardest part of the domain (row locking,
  partial unique indexes, transactions) is SQL anyway, so I wanted full control and
  to understand exactly what runs.
- **Rules enforced in the database:** constraints such as unique/lowercase emails live
  in PostgreSQL, so a bug in the app code cannot break them.
- **Parameterized queries only:** user input is never concatenated into SQL.
