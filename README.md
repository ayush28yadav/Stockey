# Stockey

A simulated stock exchange built as a production-grade portfolio project. Implements OAuth 2.0 + JWT authentication, WebSocket-based live order book streaming, a Redis-backed matching engine, BullMQ async job processing, PostgreSQL persistence — and an automated market simulation (trading bots) that keeps the exchange active 24/7.

## Run locally

Requirements: Docker Desktop and a Google OAuth client (only for real Google sign-in). Node 20.19+ is only needed if you also run a workspace directly outside Docker.

```bash
docker compose up --build
```

This one command starts the frontend, API, PostgreSQL, and Redis. Open `http://localhost:5173`. The API is at `http://localhost:4000`; `GET /health` confirms its dependencies are ready.

> **Secrets & local overrides.** Copy the repo-root [`.env.example`](./.env.example) to `.env` and set `POSTGRES_PASSWORD`, `REDIS_PASSWORD` and (only if you use the bots profile) `BOT_PASSWORD`. Docker Compose reads this file automatically. Development fallbacks exist in `docker-compose.yml` but the PostgreSQL/Redis ports are bound to loopback only — never deploy these defaults outside a throwaway local environment. **If you already created the `postgres_data` volume with an earlier password, run `docker compose down -v` once** so the database is re-initialised with the configured password.

On its first start, the API automatically creates `api/.env` with a development RSA key pair and session secret. It never overwrites an existing file. Treat that file as a secret; it is ignored by Git.

## Enable Google OAuth

1. In [Google Cloud Console](https://console.cloud.google.com/apis/credentials), create an **OAuth client ID** of type **Web application**.
2. Add this exact Authorized redirect URI: `http://localhost:4000/api/auth/google/callback`.
3. Add `http://localhost:5173` to **Authorized JavaScript origins**.
4. Put the client ID and client secret into `api/.env`:

```dotenv
GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your-client-secret
GOOGLE_CALLBACK_URL=http://localhost:4000/api/auth/google/callback
```

5. Restart the API container: `docker compose restart api`.

The callback URL must match Google Console character-for-character. The backend uses a Redis-backed, cryptographically generated OAuth state, creates or links the verified Google identity, stores the refresh token only as a SHA-256 hash in PostgreSQL, and redirects without placing any token in the URL.

## Auth API

| Method | Endpoint | Purpose |
| --- | --- | --- |
| POST | `/api/auth/register` | `{ "email", "password" }`; creates user and session |
| POST | `/api/auth/login` | `{ "email", "password" }`; creates user and session |
| GET | `/api/auth/google` | starts Google OAuth |
| GET | `/api/auth/google/callback` | Google-only callback |
| POST | `/api/auth/refresh` | rotates refresh token and returns fresh access token |
| POST | `/api/auth/logout` | revokes the active refresh token |
| GET | `/api/users/me` | authenticated smoke-test endpoint |
| POST | `/api/orders` | authenticated order submission; requires an `Idempotency-Key` UUID header |

Access tokens are RS256 JWTs valid for 15 minutes. The API returns them for email/password clients and also writes an HTTP-only access cookie. Refresh tokens are opaque, HTTP-only, scoped to `/api/auth`, valid for seven days, and rotated on every refresh. Clients can use the cookie (`credentials: 'include'`) or `Authorization: Bearer <access token>`.

## Automated Market Simulation (Trading Bots)

The exchange includes a standalone bot service that continuously places realistic buy/sell orders, keeping the order book liquid and the matching engine under realistic load. Bots authenticate through the same REST API as real users, so they exercise the full system stack.

### Run the bots

```bash
docker compose --profile bots up --build
```

This starts the bot service alongside the API, frontend, PostgreSQL, and Redis. On first start, the service seeds `BOT_COUNT` bot accounts (with cash balances and share holdings) directly into PostgreSQL, then each bot logs in via the API and begins its tick loop.

**You must set `BOT_PASSWORD`** in the repo-root `.env` first — the bots service deliberately has no default password (a predictable one would let anyone log in as the funded bot accounts) and will exit with a configuration error if it is missing or equals the old example value.

### Bot strategies

| Strategy | Behaviour |
| --- | --- |
| `random-market-maker` | Places both bid and ask orders within a spread around fair value (default liquidity provider) |
| `trend-follower` | Buys when price is rising, sells when falling (creates momentum) |
| `mean-reverter` | Buys when price dips below average, sells when above (stabilises swings) |
| `volume-bot` | Places large orders at random intervals (stress-tests the matching engine) |
| `mixed` | Distributes all strategies round-robin across bots (default) |

### Bot configuration

All bot behaviour is tunable via environment variables (see `bots/.env.example` for the full list). Key settings:

| Variable | Default | Purpose |
| --- | --- | --- |
| `BOT_COUNT` | `10` | Number of simultaneous bot instances |
| `TICK_INTERVAL_MS` | `500` | Delay (ms) between each bot's order attempts |
| `PRICE_VARIANCE` | `0.005` | Max fractional distance from fair value for limit prices |
| `MARKET_ORDER_PROBABILITY` | `0.2` | Probability of a market order vs limit |
| `ENABLED_STOCKS` | `AAPL,RELIANCE,INFY` | Symbols the bots trade |
| `STRATEGY` | `mixed` | Strategy distribution across bots |

Override any of these when starting Compose, e.g.:

```bash
BOT_COUNT=20 TICK_INTERVAL_MS=250 docker compose --profile bots up --build
```

## Development notes

- `api/sql/001_init.sql` is applied automatically only when PostgreSQL's Docker volume is first created. For a fresh local database, use `docker compose down -v` (this deletes local database data) and start Compose again.
- The `workers` workspace is a reserved entry point for future background-processing milestones (settlement, notifications, scheduled jobs).
- Production needs HTTPS, `COOKIE_SECURE=true`, production origins/callback URL, and externally managed RSA keys. The API refuses to start with insecure cookies in production.

## Run API integration tests

With the Compose stack running, execute:

```bash
npm run test:api
```

The suite creates an isolated user, checks registration, login failure/success, refresh-token rotation, authenticated order submission, and idempotent replay, then removes its test data.
