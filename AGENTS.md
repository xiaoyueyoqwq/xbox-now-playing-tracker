# Xbox Now Playing Tracker Agent Notes

## Project Goal
- Build an embeddable Xbox "now playing" card similar to Spotify GitHub profile widgets.
- Primary output should be an image-friendly endpoint, likely SVG, that can be embedded in Markdown:
  `![Xbox Now Playing](https://.../api/card?gamertag=...)`
- The card should show whether the player is online and, when available, the current title being played.
- Use pnpm package manager
- Use Redis for production card cache; in-memory cache is only a local fallback.

## Product Constraints
- Design for GitHub profile usage first: unauthenticated public image requests, fast response, cacheable output.
- Do not call Xbox APIs once per image view. Always serve from application cache or edge cache when possible.
- Prefer stale-but-recent presence over rate-limit failures. A 2-5 minute freshness window is acceptable for a profile card.
- Do not expose Xbox API keys, user tokens, XUIDs tied to private accounts, or service credentials in client-side code or public examples.
- Live non-mock card requests must be restricted to configured gamertags before cache/provider lookup. Unknown gamertags should return `403 text/plain` with self-hosting guidance, not a normal SVG card, so public deployments do not become OpenXBL proxies.
- Redis is not only response cache: it also stores last-seen game, session timers, and image data. If TCP Redis disconnects, rebuild the Redis client and retry once before falling back to memory; otherwise offline cards can lose last-seen artwork.

## API Notes
- OpenXBL (`https://xbl.io`) is the current default candidate because it offers simple API-key access to Xbox Live endpoints and documented presence/title routes.
- OpenXBL free-tier rate limits are low enough that backend caching is mandatory. Treat `150 requests/hour` as the planning budget unless a paid plan or different provider is selected.
- Microsoft official Xbox services APIs are aimed at registered Xbox title developers and partner scenarios, not general public GitHub profile widgets.
- Unofficial Xbox Live API wrappers can reduce vendor dependency but usually require Microsoft/Xbox authentication handling and may be more fragile than OpenXBL.
- Treat missing XUID from OpenXBL gamertag search as provider jitter before failing. Retry at least 3 times for empty search results; retry transient request failures such as 408, 429, and 5xx, but do not retry obvious auth/config failures such as 401/403.

## Activity Classification
- Presence title records do not expose a reliable `isGame` flag. Classify activity through `src/activity-classifier.js` as `game`, `app`, `system`, or `unknown`; do not collapse this into a binary game/other check.
- Classification priority is: online with no title -> `system`; known system title denylist -> `system`; known app title denylist -> `app`; Microsoft Store game metadata (`ProductFamilyName` containing `Games`, `ProductKind` as `Game`, or a Games autosuggest/product lookup source) -> `game`; known game allowlist -> `game`; otherwise -> `unknown`.
- Known system titles currently include Home/Dashboard/Settings/Store/My Games & Apps/Guide. Known app titles include Xbox App, Spotify, YouTube, Netflix, Edge, Twitch, Discord, Disney+, Hulu, Prime Video, Apple TV, and Media Player.
- `Xbox App` is a special app override: use local Xbox brand artwork instead of Microsoft Store or avatar artwork because Store-derived art can be misleading for this title. Its cover should be `Xbox_Logo_White.svg` and its compact background should be `Xbox_bg.png`.
- Only confirmed `game` activity should write play-session and last-seen game history. `app`, `system`, and `unknown` should avoid polluting game history unless a future rule intentionally promotes them to `game`.
- Play sessions are request-observed, not background timers. Continue same-game sessions across short GitHub image proxy/crawler gaps, but reset when the same game has not been observed for more than 30 minutes or when an away/non-game observation exceeds the grace window.
- Renderer layout differs by kind: confirmed games may use full feature art; app/system/unknown states should use the compact right-corner artwork treatment unless there is a deliberate design change.
- Artwork source decisions must go through `src/artwork-manager.js`. Do not add new renderer-side fallback chains over `titleArtUrl`, `titleHeroUrl`, or `avatarUrl`; renderer should consume resolved `coverImageUrl`, `coverKind`, `featureImageUrl`, and `featureMode`.
- OpenXBL can return multiple active titles across devices. Title selection should score active game-like titles above app/system titles so Xbox App presence does not hide a currently playing game.

## Implementation Preferences
- Keep the first version small: one backend endpoint that fetches/caches presence and one renderer that returns SVG.
- Put API integration behind a provider interface so OpenXBL can be replaced without changing the card renderer.
- Normalize gamertag/XUID handling in one place; do not duplicate lookup logic across route handlers.
- Use explicit cache metadata in responses: `Cache-Control`, `ETag` when practical, and provider fetch timestamps in server logs.
- Surface provider failures as a valid card state, not as a broken image response.
- Keep presence/provider cache TTL separate from SVG response TTL. Session text is static SVG output, so active game cards need a short HTTP `max-age` while still using the backend presence cache to avoid extra OpenXBL calls.
- In Vercel/Serverless paths, do not depend on background work after `response.end()` for correctness-critical presence state. Stale presence must be refreshed before responding, and old stale SVG should be served only when that refresh fails.
- Remote image embedding uses two cache layers: `image-data:<hash(candidateUrl)>` stores data URIs, while `image-candidate:<hash(sourceUrl,purpose,size)>` stores the last successful resized URL for 12 hours so known-bad 4xx resize variants are not retried first.
- SVG card typography must not depend on Vercel or GitHub viewer system fonts. Keep card fonts in `fonts/` and render visible card text as SVG paths when stable visual layout matters, because SVGs embedded through `<img>` can apply fonts differently from standalone SVG documents.

## Documentation Expectations
- README should clearly explain rate-limit assumptions, cache strategy, required environment variables, and deployment shape.
- Keep examples safe: use placeholder gamertags and environment variable names, never real credentials.
- Public deployment docs should target Vercel Serverless with Upstash Redis REST as the recommended production cache.
- Do not remove the Vercel region warning: avoid `hkg1` and `sin1` because OpenXBL/API traffic from those regions may return `403`.
