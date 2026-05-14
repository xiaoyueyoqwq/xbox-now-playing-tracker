# Xbox Now Playing Tracker Agent Notes

## Project Goal
- Build an embeddable Xbox "now playing" card similar to Spotify GitHub profile widgets.
- Primary output should be an image-friendly endpoint, likely SVG, that can be embedded in Markdown:
  `![Xbox Now Playing](https://.../api/card?gamertag=...)`
- The card should show whether the player is online and, when available, the current title being played.

## Product Constraints
- Design for GitHub profile usage first: unauthenticated public image requests, fast response, cacheable output.
- Do not call Xbox APIs once per image view. Always serve from application cache or edge cache when possible.
- Prefer stale-but-recent presence over rate-limit failures. A 2-5 minute freshness window is acceptable for a profile card.
- Do not expose Xbox API keys, user tokens, XUIDs tied to private accounts, or service credentials in client-side code or public examples.

## API Notes
- OpenXBL (`https://xbl.io`) is the current default candidate because it offers simple API-key access to Xbox Live endpoints and documented presence/title routes.
- OpenXBL free-tier rate limits are low enough that backend caching is mandatory. Treat `150 requests/hour` as the planning budget unless a paid plan or different provider is selected.
- Microsoft official Xbox services APIs are aimed at registered Xbox title developers and partner scenarios, not general public GitHub profile widgets.
- Unofficial Xbox Live API wrappers can reduce vendor dependency but usually require Microsoft/Xbox authentication handling and may be more fragile than OpenXBL.

## Implementation Preferences
- Keep the first version small: one backend endpoint that fetches/caches presence and one renderer that returns SVG.
- Put API integration behind a provider interface so OpenXBL can be replaced without changing the card renderer.
- Normalize gamertag/XUID handling in one place; do not duplicate lookup logic across route handlers.
- Use explicit cache metadata in responses: `Cache-Control`, `ETag` when practical, and provider fetch timestamps in server logs.
- Surface provider failures as a valid card state, not as a broken image response.

## Documentation Expectations
- README should clearly explain rate-limit assumptions, cache strategy, required environment variables, and deployment shape.
- Keep examples safe: use placeholder gamertags and environment variable names, never real credentials.
