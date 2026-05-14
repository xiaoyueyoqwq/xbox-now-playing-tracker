# Xbox Now Playing Tracker

An embeddable Xbox "now playing" card for GitHub profiles and other Markdown surfaces. The goal is the Xbox equivalent of Spotify profile widgets: a small image endpoint that shows a player's current Xbox presence and the game they are playing.

```md
![Xbox Now Playing](https://your-deployment.example/api/card?gamertag=MajorNelson)
```

## Goal

- Generate a cacheable SVG card for a gamertag or XUID.
- Show current Xbox presence: online/offline state, current title, and recent status text when available.
- Work well inside GitHub profile README files, where the image may be requested many times by browsers and GitHub's image proxy.
- Avoid spending Xbox API quota on every image request.

## API Research

The first API candidate is OpenXBL (`https://xbl.io`). Its advantages are practical for this project:

- Simple API-key model.
- Xbox Live profile, title, and presence style endpoints.
- Easier to deploy for a public widget than handling raw Microsoft/Xbox authentication flows.

The main concern is rate limiting. OpenXBL's getting-started page states that free access starts with `150 requests/hour`, with options to increase that limit. That is not enough for direct per-view fetching, but it is enough for a cached profile card.

Recommended request model:

- Card image requests read from cache.
- A background refresh or request-triggered refresh calls OpenXBL at most once every 2-5 minutes per tracked player.
- Failed refreshes keep serving the last successful card with a stale timestamp.

With a 2-minute provider cache, one player costs at most 30 provider requests/hour. With a 5-minute cache, one player costs at most 12 provider requests/hour.

## Are There Less Restricted APIs?

There is no clearly better public API for this exact use case.

- **Microsoft official Xbox services APIs**: best long-term stability, but generally intended for registered Xbox title developers and partner/title scenarios. They are not a simple public profile-widget API.
- **Open-source Xbox Live wrappers**: can access Xbox Live data through Microsoft account authentication, but they shift complexity into token management and may be more fragile for a hosted public card.
- **Other third-party Xbox APIs**: may exist, but tend to have similar rate limits, unclear maintenance status, or paid plans. They should be evaluated only if OpenXBL's paid tiers or caching model do not fit.

For the initial implementation, OpenXBL plus aggressive caching is the most realistic path.

## Planned Architecture

```text
GitHub README / Browser
        |
        v
GET /api/card?gamertag=...
        |
        v
Vercel Serverless Function
        |
        +--> cache hit: render SVG from cached presence
        |
        +--> cache miss/stale: refresh provider data, store result, render SVG
```

Core modules:

- `provider`: OpenXBL integration hidden behind a small interface.
- `cache`: in-memory cache for warm serverless instances; Redis/KV adapter can be added later.
- `title-art`: game artwork lookup through known title mappings and Microsoft Store catalog search.
- `renderer`: SVG rendering with deterministic layout and safe escaping.
- `api`: Vercel Serverless Function endpoints.

## Configuration

Copy `.env.example` to `.env` and fill in the OpenXBL key:

```env
OPENXBL_API_KEY=replace-me
OPENXBL_CONTRACT=
OPENXBL_BASE_URL=https://xbl.io/api/v2
CACHE_TTL_SECONDS=300
STALE_TTL_SECONDS=86400
DEFAULT_GAMERTAG=replace-me
PORT=3000
```

## Local Development

```bash
npm install
npm run dev
```

Open these URLs:

- Mock card, no API key required: `http://localhost:3000/api/card?gamertag=YourTag&mock=1`
- Real OpenXBL card: `http://localhost:3000/api/card?gamertag=YourTag`
- Health check: `http://localhost:3000/api/health`

`npm run dev` starts the local preview server with Node watch mode. Use this for normal local development.

If you need Vercel CLI behavior specifically, use:

```bash
npm run vercel:dev
```

If you only want to test the function logic without watch mode, use:

```bash
npm run preview
```

## What You Need To Do In OpenXBL

1. Sign in or create an account at `https://xbl.io`.
2. Open the account/API area and create or copy an API key.
3. Put that key in `.env` as `OPENXBL_API_KEY`.
4. Use a real gamertag in `DEFAULT_GAMERTAG` or pass `?gamertag=...` in the card URL.

Keep the API key server-side. Do not put it in GitHub profile Markdown or frontend JavaScript.

If you use an OpenXBL app/consumer key instead of a personal API key, set:

```env
OPENXBL_CONTRACT=100
```

The default OpenXBL base URL is `https://xbl.io/api/v2`. It can be overridden with `OPENXBL_BASE_URL` if OpenXBL changes routing or asks you to use a different host.

## Rate-Limit Strategy

The project should treat provider requests as scarce:

- Never fetch OpenXBL directly from frontend code.
- Cache by normalized player identifier.
- Coalesce simultaneous refreshes for the same player.
- Prefer `stale-while-revalidate` behavior when the provider is unavailable.
- Return valid SVG even when provider data is missing or stale.

Important Vercel note: in-memory cache only persists while a serverless instance stays warm. That is fine for local development and a first deployment, but a public GitHub profile card should eventually use Vercel KV, Upstash Redis, or another shared cache to avoid quota spikes across cold starts and multiple regions.

## Game Artwork

The card can render a game icon when artwork is available:

- Known Xbox title IDs are resolved locally first.
- Unknown titles use Microsoft Store catalog autosuggest by title name.
- If artwork lookup fails, the renderer falls back to the Xbox glyph.

This keeps the OpenXBL presence integration separate from store artwork lookup and avoids depending on one unofficial endpoint for every field.

## First Milestone

- Create a minimal HTTP service. Done.
- Convert the service to Vercel Serverless Functions. Done.
- Add one SVG endpoint: `/api/card?gamertag=...`. Done.
- Add a mock mode for local SVG testing: `/api/card?gamertag=...&mock=1`. Done.
- Integrate OpenXBL presence lookup. Done locally with live API response.
- Add game artwork lookup and SVG image rendering. Done.
- Add cache with configurable TTL. Done.
- Document deployment and environment setup. Done.

## References

- OpenXBL docs: https://api.xbl.io/docs
- OpenXBL getting started: https://xbl.io/getting-started
- Microsoft Xbox services documentation: https://learn.microsoft.com/gaming/
