# Presence Refresh Worker

Cloudflare Worker Cron Trigger for proactive Xbox presence refreshes.

Configure Worker variables in Cloudflare:

```text
REFRESH_URL=https://your-project.vercel.app/api/cron/refresh
CRON_SECRET=the-same-value-as-vercel-cron-secret
```

`CRON_SECRET` should be a secret, not a public variable.

The Worker intentionally returns `404` for normal HTTP requests. Only the Cloudflare `scheduled()` event calls the refresh endpoint.
