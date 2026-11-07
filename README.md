# wx-dashboard

A self-hosted, realtime weather station dashboard that runs in Docker. It shows current conditions that update live, stores history in SQLite, and draws trend charts. It works on desktop and mobile, with light and dark themes and °F/°C units.

Station support is pluggable. The first driver reads from the **Ambient Weather Network** cloud API, which covers the WS-2000, WS-2902, WS-5000 and other stations that upload to AmbientWeather.net. A **simulator** driver is included for demos and development.

## Quick start

1. Get two keys from <https://ambientweather.net/account> (under **API Keys**):
   - an **API key**, which grants read access to your stations
   - an **Application key**, which identifies this app
2. Copy [docker-compose.yml](docker-compose.yml) and `.env.example` to the Docker host, then configure and run:

   ```sh
   cp .env.example .env      # then fill in AMBIENT_API_KEY and AMBIENT_APPLICATION_KEY
   docker compose up -d
   ```

3. Open `http://<docker-host>:8080`.

Compose always pulls `ghcr.io/justin-braun/wx-dashboard:latest`, so to upgrade, run `docker compose up -d` again. The running version appears in the dashboard footer and at `/api/health`.

On first start the app backfills the last 7 days from Ambient's history API, so the charts have data right away. After that, readings arrive over Ambient's realtime feed.

### How often does it update?

The app holds a persistent realtime connection (Socket.io) to Ambient, which pushes each reading as soon as Ambient receives it. Readings can't arrive faster than your station uploads to AmbientWeather.net. That interval is set in whole minutes in the awnet app, so once a minute is the fastest. Polling the REST API more often would only return the same reading again.

The header shows when the last reading arrived and counts down to the next one. The countdown uses the interval the server measures from actual arrivals, and starts from a one-minute estimate until it has enough data.

To try it without a station, set `STATION_DRIVER=simulator` in `.env`.

## Configuration

All settings are environment variables. See [.env.example](.env.example).

| Variable | Default | Description |
| --- | --- | --- |
| `STATION_DRIVER` | `ambient-cloud` | `ambient-cloud` or `simulator` |
| `AMBIENT_API_KEY` | — | Required for `ambient-cloud` |
| `AMBIENT_APPLICATION_KEY` | — | Required for `ambient-cloud` |
| `AMBIENT_MAC_ADDRESS` | all | Comma-separated MAC address(es) to include |
| `BACKFILL_DAYS` | `7` | Days of history to fetch on startup to fill gaps (`0` = off) |
| `RETENTION_DAYS` | `365` | Days of history kept in SQLite (`0` = forever) |
| `STORE_INTERVAL_SECONDS` | `60` | Minimum spacing between stored live readings |
| `PORT` | `8080` | Port inside the container |
| `HOST_PORT` | `8080` | Published port (docker-compose) |
| `TZ` | `America/Chicago` | Container time zone |
| `LOG_LEVEL` | `info` | `debug`, `info`, `warn`, `error` |

Data is stored in the `wx-data` volume at `/data/wx.db`.

## Why the cloud API, not the console's IP address?

The WS-2000 console has no documented local API you can poll. The only local route is the console's **Customized** upload setting, which pushes readings to a server you choose. That slot holds one destination, and if you already use it (for example, for Weather Underground), it isn't free. The Ambient cloud API works alongside any existing uploads.

A local push receiver can be added later as another driver, without changing the rest of the app.

## How it works

```
 station driver ──► normalize ──► SQLite (history)
 (ambient-cloud,       │
  simulator, …)        └────────► WebSocket /ws ──► browser dashboard
```

- **Server** ([server/](server/)): Node 22, TypeScript, Fastify. Drivers push readings into a shared data model ([server/src/types.ts](server/src/types.ts)). The server stores them, works out daily highs and lows and pressure trends, and broadcasts each reading to connected browsers.
- **Web** ([web/](web/)): React and Vite. Live updates arrive over `/ws`. Charts load from the history API and add new live readings as they arrive.

### HTTP API

| Endpoint | Description |
| --- | --- |
| `GET /api/health` | Driver status and counts (used by the Docker healthcheck) |
| `GET /api/stations` | Known stations |
| `GET /api/stations/:id/current` | Latest observation and today's summary |
| `GET /api/stations/:id/history?hours=24` | Downsampled history (up to 744 h) |
| `WS /ws` | `snapshot`, then `observation`, `status`, `backfill`, `summary` messages |

## Adding a weather station model

1. Create `server/src/drivers/<name>.ts` that implements `StationDriver` ([driver.ts](server/src/drivers/driver.ts)):
   - call `ctx.onStations([...])` with station metadata
   - convert vendor data into an `Observation` and call `ctx.onObservation(obs)` for live readings
   - optionally call `ctx.onBackfill([...])` with historical readings
   - report connection state with `ctx.onStatus(...)`
2. Export a `DriverDefinition` that lists the environment variables it needs (required ones are checked at startup).
3. Register it in [server/src/drivers/index.ts](server/src/drivers/index.ts).

Canonical units are imperial (°F, mph, inHg, inches). The dashboard converts them for display. Cards and charts appear only for metrics the station actually reports.

## Versioning and releases

Versions follow [semantic versioning](https://semver.org). The version lives in `package.json` (root, `server`, and `web` are kept in sync), and every release is a git tag `vX.Y.Z`.

**To cut a release**, run the **Release** workflow from the GitHub Actions tab, or:

```sh
gh workflow run release.yml -f bump=patch   # or minor / major
```

The workflow bumps the version, commits, tags, publishes the image, and creates a GitHub Release with generated notes.

**Image tags** published to `ghcr.io/justin-braun/wx-dashboard`:

| Trigger | Tags |
| --- | --- |
| Release tag `v1.4.2` | `1.4.2`, `1.4`, `1` (once at 1.0 or later), `latest`, `sha-<commit>` |
| Push to `main` | `main`, `sha-<commit>` (version reads `1.4.2-dev.<commit>`) |
| Pull request | Built to check it, not pushed |

`latest` always points to the newest release, not to `main`.

## Development

Requires Node 22.

```sh
npm install
STATION_DRIVER=simulator npm run dev:server   # API on :8080
npm run dev:web                               # Vite on :5173, proxies /api and /ws
```

To build and run the image locally instead of pulling it:

```sh
docker build -t wx-dashboard:local .
docker run --rm -p 8080:8080 -e STATION_DRIVER=simulator wx-dashboard:local
```
