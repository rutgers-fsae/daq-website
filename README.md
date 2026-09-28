# DAQ CSV Grapher

Web app for selecting CSV files from `data/`, exploring columns, and plotting graphs.

## Stack

- Backend: FastAPI + pandas
- Frontend: React + Vite + Plotly
- Dataset identity: permanent slug per CSV in `backend/app/storage/datasets.json`

## Features

- List datasets and navigate by slug (`/datasets/:slug`)
- Read schema from CSV columns
- Build charts from selected columns
- Password-protected CSV uploads

## Docker Compose (Dev)

1. Copy env file:

```bash
cp infra/.env.example infra/.env
```

2. Update `UPLOAD_PASSWORD` in `infra/.env`.

3. Start both services:

```bash
docker compose up --build
```

4. Open:

- Frontend: `http://localhost:5173`
- Backend API: `http://localhost:8000`

5. Stop services:

```bash
docker compose down
```

## Production: kebab.sevenlayer.org

The production Compose file serves the built React app with Nginx and proxies `/api` and `/health` to the FastAPI backend. It binds to `127.0.0.1:8080` so your existing reverse proxy can own public ports `80` and `443`.

1. Point DNS for `kebab.sevenlayer.org` at the server running Docker.

2. Create/update `infra/.env`:

```bash
UPLOAD_PASSWORD=replace_me
CORS_ORIGINS=https://kebab.sevenlayer.org
VITE_API_BASE_URL=
```

3. Start production services:

```bash
docker compose -f docker-compose.prod.yml up --build -d
```

4. Verify locally on the server:

```bash
curl -f http://127.0.0.1:8080/health
```

5. Configure your existing reverse proxy for `kebab.sevenlayer.org`:

```text
upstream: http://127.0.0.1:8080
websocket support: not required
max upload/body size: at least 1024 MB if uploading large CSVs
```

6. Verify from a browser:

- `https://kebab.sevenlayer.org`
- `https://kebab.sevenlayer.org/health`

## Local Run (Without Docker)

1. Backend:

```bash
cd backend
uv venv .venv
uv pip install --python .venv/bin/python -e ".[dev]"
source .venv/bin/activate
uvicorn app.main:app --reload
```

2. Frontend:

```bash
cd frontend
npm install
npm run dev
```

## API

- `GET /health`
- `GET /api/datasets`
- `GET /api/datasets/{slug}/schema`
- `POST /api/datasets/{slug}/preview`
- `POST /api/datasets/{slug}/chart-data`
- `POST /api/upload` with `Authorization: Bearer <UPLOAD_PASSWORD>`

## Formatting and linting

Install Node.js 22+ and [uv](https://docs.astral.sh/uv/getting-started/installation/),
then run from the repository root:

```sh
npm ci
npm ci --prefix frontend
uv sync --locked --project backend --extra dev
npm run format
npm run check
```

`npm ci` enables Husky commit and push hooks. They run the same checks as CI:
Prettier formatting, the existing ESLint rules with no warnings allowed,
TypeScript type checking, Ruff linting and formatting, and ty Python type checking.
The hooks check without modifying or staging files; `npm run format` applies
formatting and safe lint fixes. Dataset files, generated registries, dependencies,
and build output are excluded from Prettier.

GitHub Actions runs on pushes to every branch and on pull requests. Require the
`Code quality / quality` status check in repository rulesets to block failing
merges. CI reports failed pushes; GitHub rulesets enforce merge restrictions.
