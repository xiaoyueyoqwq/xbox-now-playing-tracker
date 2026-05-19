# Presence Refresh Worker

Cloudflare Worker Cron Trigger for proactive Xbox presence refreshes.

Configure Worker variables in Cloudflare:

```text
CRON_SECRET=the-same-value-as-vercel-cron-secret
```

`CRON_SECRET` should be a secret, not a public variable. The same value must also be configured in Vercel. `REFRESH_URL` is configured as a normal variable in `wrangler.toml`; update it there if you deploy under a different domain.

When importing this repository in Cloudflare, use:

```text
Root directory: workers/presence-refresh
Deploy command: npx wrangler deploy
```

The Worker intentionally returns an empty `404` for normal HTTP requests. Only the Cloudflare `scheduled()` event calls the refresh endpoint.

The schedule is defined in `wrangler.toml`:

```toml
[triggers]
crons = ["*/3 * * * *"]
```

Cloudflare runs this cron expression every 3 minutes and invokes the Worker's `scheduled()` handler. Browser visits invoke `fetch()` instead, so opening the Worker URL does not refresh presence.
