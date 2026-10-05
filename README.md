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
- Nano R4 airspeed logger (legacy and protocol v2) and VectorNav VN-300 CSVs, alongside MoTeC exports
- Logger timestamps support date axes and time filters; blank readings remain gaps
- VectorNav GPS track view with INS/GNSS selection, time slider, recorded-time playback, and graph time filters
- Numeric chart channels support per-graph display-unit conversion for speed, pressure, distance, temperature, acceleration, angle, angular speed, time, force, torque, power, voltage, current, and frequency. Select a compatible display unit and click **Render**; values, labels, tooltips, and statistics convert together. Selections persist with graph settings. Time filters and CSV downloads use source units; channels with unknown units remain unchanged.
- Channel units are shown in the chart builder. VectorNav `pressure_pa` contains SDK values in kPa and is labeled accordingly; airspeed pressure is in Pa.

## Cascadia EEPROM via USB

Open **Cascadia EEPROM** in the header (`/cascadia`) using Chrome or Edge on
HTTPS or localhost. USB access uses the browser's Web Serial API and connects
to the computer viewing the website, without a backend serial service.
**Check USB ports** lists connected ports already authorized for this site;
**Choose USB port & connect** opens the browser chooser for a new device.
Close the firmware TUI and other applications using the CANdapter first.

Defaults match `../firmware/cascadia-can`: serial 115200 baud, CAN 500 kbit/s,
standard identifiers, base `0xA0`. Connection settings include extended/J1939
mode, reply timeout, telemetry freshness, and request gap. Connecting does not
read or write EEPROM automatically. Read a row or explicitly read all 85
parameters, search by name/address, then edit a successfully read value in
engineering units or as a raw decimal/hex word. The catalog is copied from the
firmware's CAN Protocol 6.3 catalog; reserved/factory/command addresses are excluded.

Review one value, type `WRITE`, and apply. Every write checks its live baseline,
related temperature/CAN settings, and fresh inverter-disabled Internal States
telemetry, then requires acknowledgment and independent readback. Writes are
never retried. Missing/stale/enabled telemetry blocks writes. Errors may leave
EEPROM changed but unverified; reconnect and reread before proceeding. Motor
parameter changes clear other observed values because flux/gamma can reset.
Communication changes can interrupt verification. Power-cycle requirements
are shown per row; the website does not perform power cycles or motor commands.
Only one CAN node should issue parameter requests during a session.

Offline protocol checks: `npm --prefix frontend test -- src/cascadia/candapter.test.ts`.
Hardware acceptance still requires an attached CANdapter/inverter: read a known
parameter, write an operator-selected value while disabled, verify readback,
and check persistence after an operator-performed power cycle.

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
