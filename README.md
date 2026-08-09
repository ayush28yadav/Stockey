# Stockey

First milestone for a simulated stock exchange: a TypeScript monorepo, Dockerized API/PostgreSQL/Redis, email/password authentication, and Google OAuth 2.0.

## Run locally

Requirements: Docker Desktop and a Google OAuth client (only for real Google sign-in). Node 20.19+ is only needed if you also run a workspace directly outside Docker.

```bash
docker compose up --build
```

This one command starts the frontend, API, PostgreSQL, and Redis. Open `http://localhost:5173`. The API is at `http://localhost:4000`; `GET /health` confirms its dependencies are ready.

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

Access tokens are RS256 JWTs valid for 15 minutes. The API returns them for email/password clients and also writes an HTTP-only access cookie. Refresh tokens are opaque, HTTP-only, scoped to `/api/auth`, valid for seven days, and rotated on every refresh. Clients can use the cookie (`credentials: 'include'`) or `Authorization: Bearer <access token>`.

## Development notes

- `api/sql/001_init.sql` is applied automatically only when PostgreSQL's Docker volume is first created. For a fresh local database, use `docker compose down -v` (this deletes local database data) and start Compose again.
- The `workers` and `bots` workspaces are intentionally minimal reserved entry points for the matching-engine milestone. Their directories and build configuration are already in place.
- Production needs HTTPS, `COOKIE_SECURE=true`, production origins/callback URL, and externally managed RSA keys. The API refuses to start with insecure cookies in production.
