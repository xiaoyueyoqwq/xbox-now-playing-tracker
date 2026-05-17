# Xbox Now Playing Tracker

An embeddable Xbox presence card for GitHub profiles and other Markdown surfaces.

```md
![Xbox Now Playing](https://your-project.vercel.app/api/card?gamertag=YourGamertag)
```

The endpoint returns an SVG image. It is designed for public, unauthenticated image requests, while provider calls and API keys stay server-side.

Open the deployment root URL to generate Markdown and HTML embed snippets:

```text
https://your-project.vercel.app/
```

## API Shape

```text
GET /
GET /api/card?gamertag=YourGamertag
GET /api/card?gamertag=YourGamertag&refresh=1
GET /api/card?gamertag=YourGamertag&mock=1
GET /api/cron/refresh
GET /api/health
```

`refresh=1` bypasses the presence cache for that request. Session and last-seen state still use Redis so timer and offline behavior remain continuous.

`/api/cron/refresh` is a protected JSON endpoint for scheduled refresh jobs. It requires `Authorization: Bearer <CRON_SECRET>` and refreshes only `DEFAULT_GAMERTAG` plus `ALLOWED_GAMERTAGS`.

## Vercel Deployment

1. Fork or clone this repository.

2. Create an OpenXBL account and create an API key at `https://xbl.io`.

3. Create a Redis database. Upstash Redis REST is recommended for Vercel Serverless because it avoids long-lived TCP connection issues.

4. Import the repository into Vercel.

5. Set the project framework to `Other` if Vercel asks. No build command is required.

6. Add environment variables in Vercel:

```env
OPENXBL_API_KEY=replace-me
OPENXBL_CONTRACT=
OPENXBL_BASE_URL=https://xbl.io/api/v2
UPSTASH_REDIS_REST_URL=https://your-upstash-url
UPSTASH_REDIS_REST_TOKEN=your-upstash-token
CACHE_TTL_SECONDS=300
STALE_TTL_SECONDS=86400
NO_CACHE=0
NO_IMAGE_CACHE=0
DEFAULT_GAMERTAG=YourGamertag
ALLOWED_GAMERTAGS=YourGamertag
CRON_SECRET=generate-a-long-random-secret
```

7. Deploy, then test:

```text
https://your-project.vercel.app/api/health
https://your-project.vercel.app/
https://your-project.vercel.app/api/card?gamertag=YourGamertag
```

8. Use the card in Markdown:

```md
![Xbox Now Playing](https://your-project.vercel.app/api/card?gamertag=YourGamertag)
```

## Vercel Region Warning

Do not deploy the Serverless Function to `hkg1` or `sin1`.

OpenXBL/API traffic from those regions has been observed returning `403` responses. Prefer a US or other non-blocked region. If you pin regions in Vercel, avoid Hong Kong and Singapore.

This repository sets Vercel's default region to `iad1` in `vercel.json`:

```json
{
  "regions": ["iad1"]
}
```

You can change it to another non-blocked region if latency is better for your audience, but keep `hkg1` and `sin1` out of the list.

## Environment Variables

| Variable | Required | Notes |
| --- | --- | --- |
| `OPENXBL_API_KEY` | Yes | Server-side OpenXBL API key. Never expose this in Markdown or client code. |
| `OPENXBL_CONTRACT` | No | Set if your OpenXBL key requires a contract value, for example `100`. |
| `OPENXBL_BASE_URL` | No | Defaults to `https://xbl.io/api/v2`. |
| `UPSTASH_REDIS_REST_URL` | Production | Recommended Redis URL for Vercel. |
| `UPSTASH_REDIS_REST_TOKEN` | Production | Recommended Redis token for Vercel. |
| `REDIS_URL` | Optional | Supports `redis://`, `rediss://`, or REST-style `https://:token@host`. REST variables are preferred on Vercel. |
| `CACHE_TTL_SECONDS` | No | Fresh presence cache TTL. Default is `300`. |
| `STALE_TTL_SECONDS` | No | Stale presence retention TTL. Default is `86400`. |
| `NO_CACHE` | No | `1` bypasses presence cache reads for debugging. |
| `NO_IMAGE_CACHE` | No | `1` bypasses Store/avatar data URI cache for debugging. |
| `DEFAULT_GAMERTAG` | No | Used when `?gamertag=` is omitted. |
| `ALLOWED_GAMERTAGS` | Recommended | Comma-separated gamertag allowlist for live OpenXBL requests. `DEFAULT_GAMERTAG` is also allowed automatically. |
| `CRON_SECRET` | Optional | Required only for `/api/cron/refresh`. Use a long random value and send it as a Bearer token. |
| `PORT` | Local only | Local preview port. Default is `3000`. |

## Cache Strategy

The project uses Redis for more than response caching:

- Presence cache.
- Gamertag to XUID identity cache.
- Play session start time.
- Last-seen game and artwork.
- Microsoft Store image data URIs.
- Xbox avatar image data URIs.

Image data URIs are cached for 12 hours. Presence freshness is controlled by `CACHE_TTL_SECONDS`. Active game SVG responses use a shorter HTTP cache window so the minute-based session display updates without increasing OpenXBL calls.

Redis is strongly recommended in production. Without Redis, Vercel instance changes can lose session and last-seen state.

Play sessions are request-driven. Vercel Serverless does not run a persistent timer; the app stores the first observed game timestamp in Redis and recomputes the elapsed minutes whenever the card endpoint is requested. A same-game session continues across short GitHub image proxy or crawler gaps, but a gap longer than 30 minutes starts a new session to avoid reviving stale play time.

Refresh failures are conservative. If OpenXBL, Microsoft Store, Redis, or the scheduled refresh path fails, the app does not delete existing session or last-seen data. The card serves stale cached state when available, and the cron endpoint reports per-gamertag failures in JSON so the next successful refresh can repair state.

OpenXBL gamertag search can occasionally return no XUID for a valid account. The app caches successful XUID lookups for 30 days and then queries presence by XUID directly. When XUID search still has to run, it retries with exponential backoff capped at 10 seconds before falling back to stale card data.

## Optional Cloudflare Scheduled Refresh

GitHub image proxy requests are not guaranteed to arrive on a schedule. For a steadier 15-30 minute observation window without Vercel Pro, deploy the bundled Cloudflare Worker in `workers/presence-refresh/`.

> [!WARNING]
> Scheduled refresh can spend your OpenXBL quota continuously. Keep `ALLOWED_GAMERTAGS` small, use a long `CRON_SECRET`, and never expose that secret in client-side code or public examples. The Worker is intentionally outbound-only: opening its public URL should return an empty `404`, and only Cloudflare's Cron Trigger should call the Vercel refresh endpoint.

Read the Worker-specific setup guide first: `workers/presence-refresh/README.md`.

The Worker uses the Cron Trigger in `workers/presence-refresh/wrangler.toml` to call the protected refresh endpoint. Its normal HTTP `fetch()` handler returns an empty `404`, so crawlers cannot use the Worker as a public refresh URL.

1. Set `CRON_SECRET` in Vercel.

Generate a long random value:

```bash
openssl rand -hex 32
```

Add the result to your Vercel project:

```text
Settings -> Environment Variables -> CRON_SECRET
```

Redeploy the Vercel project after adding the variable.

2. Verify the protected refresh endpoint.

Call Vercel directly with the same secret:

```bash
curl -i \
  -H "Authorization: Bearer YOUR_CRON_SECRET" \
  "https://your-project.vercel.app/api/cron/refresh"
```

Expected result:

- `200` means all configured gamertags refreshed successfully.
- `207` means the endpoint ran, but at least one gamertag failed. Check the JSON body and Vercel logs.
- `401` means the Bearer token does not match `CRON_SECRET`.
- `503` means `CRON_SECRET` is missing in Vercel.

3. Create the Cloudflare Worker from this repository.

In Cloudflare:

```text
Workers & Pages -> Create -> Import a repository
```

Use these build settings:

```text
Root directory: workers/presence-refresh
Deploy command: npx wrangler deploy
```

The Worker config is already in `workers/presence-refresh/wrangler.toml`:

```toml
name = "xbox-refresh-cron"
main = "src/index.js"
compatibility_date = "2026-05-17"

[triggers]
crons = ["*/15 * * * *"]
```

4. Set Worker variables.

In the Worker settings, add:

```text
REFRESH_URL=https://your-project.vercel.app/api/cron/refresh
CRON_SECRET=the-same-value-as-vercel-cron-secret
```

Set `CRON_SECRET` as a secret value. `REFRESH_URL` can be a normal variable.

5. Confirm it is working.

Browser visits to the Worker URL should return an empty `404`; this is intentional. The scheduled job runs through Cloudflare's Cron Trigger and invokes the Worker's `scheduled()` handler instead of the HTTP `fetch()` handler.

Check:

- Cloudflare Worker logs for scheduled invocations.
- Vercel logs for `GET /api/cron/refresh`.
- Card logs such as `cache=stale-refresh` or `cron=refresh`.

At 15-minute intervals this costs about 4 refreshes per hour per configured deployment, before OpenXBL provider retries. Keep `ALLOWED_GAMERTAGS` small on the free OpenXBL plan.

## Local Development

```bash
pnpm install
cp .env.example .env
pnpm dev
```

Useful URLs:

```text
http://localhost:3000/api/card?gamertag=YourGamertag&mock=1
http://localhost:3000/api/card?gamertag=YourGamertag
http://localhost:3000/api/card?gamertag=YourGamertag&refresh=1
http://localhost:3000/api/cron/refresh
http://localhost:3000/api/health
http://localhost:3000/
```

Commands:

```bash
pnpm dev        # local preview with node --watch
pnpm preview    # local preview without watch mode
pnpm vercel:dev # Vercel CLI through pnpm dlx
```

## Activity Classification

Xbox presence records do not provide a reliable `isGame` field. The app classifies activity as:

- `game`
- `app`
- `system`
- `unknown`

Classification uses local known app/system lists, Microsoft Store game metadata, and conservative fallbacks. Only confirmed `game` activity writes play session and last-seen game history.

## Artwork

Game artwork comes from Microsoft Store metadata:

- Hero art prefers `SuperHeroArt`.
- Cover art prefers high-resolution square images such as `BoxArt`, `FeaturePromotionalSquareArt`, or `Tile`.
- Very small `Logo` assets are avoided when better candidates exist.
- Store resize failures fall back to the original image URL.
- Non-game states without title artwork use the player's Xbox avatar.

## Rate Limits

OpenXBL free-tier limits are low enough that per-view provider calls are not acceptable. This project is built around cache-first rendering:

- Browsers and GitHub request the SVG endpoint.
- The endpoint renders from Redis when possible.
- OpenXBL refreshes are coalesced per player.
- Provider failures produce a valid SVG instead of a broken image.
- Scheduled refresh calls the same cache and session pipeline as live card refreshes.

Live OpenXBL requests are restricted to configured gamertags. If a request uses a gamertag that is not in `DEFAULT_GAMERTAG` or `ALLOWED_GAMERTAGS`, the endpoint returns `403 text/plain` with a self-hosting message instead of calling OpenXBL. `mock=1` remains public so the generator page can preview cards without spending API quota.

## Security

- Keep `OPENXBL_API_KEY` server-side.
- Do not commit `.env` or Vercel environment files.
- Do not expose Redis tokens publicly.
- Do not treat a deployment as a shared public Xbox lookup service; allowlist only the gamertags you own or explicitly support.

## Project Structure

```text
api/                 Vercel Serverless endpoints
img/                 Local static assets
index.html           Markdown snippet generator
scripts/dev-server.js Local preview server
src/cache.js         Redis and memory cache
src/card-handler.js  Request handling and data enrichment
src/openxbl.js       OpenXBL provider
src/renderer.js      SVG renderer
src/title-art.js     Microsoft Store artwork lookup
```

## References

- OpenXBL docs: https://api.xbl.io/docs
- OpenXBL getting started: https://xbl.io/getting-started
- Microsoft Xbox services documentation: https://learn.microsoft.com/gaming/
