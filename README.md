# Xbox Now Playing Tracker

An embeddable Xbox presence card for GitHub profiles and other Markdown surfaces.

```md
![Xbox Now Playing](https://your-project.vercel.app/api/card?gamertag=YourGamertag)
```

The endpoint returns an SVG image. It is designed for public, unauthenticated image requests, while provider calls and API keys stay server-side.

## Features

- Current Xbox presence from OpenXBL.
- Game/app/system classification: `game`, `app`, `system`, `unknown`.
- Microsoft Store artwork lookup for game icons and hero images.
- Play session timer for confirmed games.
- Last-seen game state when the player goes offline.
- Xbox profile avatar fallback for non-game states without title artwork.
- Redis-backed cache for Vercel Serverless.
- Local mock mode for UI testing without an API key.

## API Shape

```text
GET /api/card?gamertag=YourGamertag
GET /api/card?gamertag=YourGamertag&refresh=1
GET /api/card?gamertag=YourGamertag&mock=1
GET /api/health
```

`refresh=1` bypasses the presence cache for that request. Session and last-seen state still use Redis so timer and offline behavior remain continuous.

## Vercel Deployment

1. Fork or clone this repository.

2. Create an OpenXBL API key at `https://xbl.io`.

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
```

7. Deploy, then test:

```text
https://your-project.vercel.app/api/health
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
| `PORT` | Local only | Local preview port. Default is `3000`. |

## Cache Strategy

The project uses Redis for more than response caching:

- Presence cache.
- Play session start time.
- Last-seen game and artwork.
- Microsoft Store image data URIs.
- Xbox avatar image data URIs.

Image data URIs are cached for 12 hours. Presence freshness is controlled by `CACHE_TTL_SECONDS`. Active game SVG responses use a shorter HTTP cache window so the minute-based session display updates without increasing OpenXBL calls.

Redis is strongly recommended in production. Without Redis, Vercel instance changes can lose session and last-seen state.

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
http://localhost:3000/api/health
```

Commands:

```bash
pnpm dev        # local preview with node --watch
pnpm preview    # local preview without watch mode
pnpm vercel:dev # Vercel CLI development server
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

## Security

- Keep `OPENXBL_API_KEY` server-side.
- Do not commit `.env` or Vercel environment files.
- Do not expose Redis tokens publicly.
- The public card endpoint should not require a user token.

## Project Structure

```text
api/                 Vercel Serverless endpoints
img/                 Local static assets
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
