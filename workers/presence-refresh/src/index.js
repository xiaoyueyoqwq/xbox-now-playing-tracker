export default {
  async scheduled(_event, env, ctx) {
    ctx.waitUntil(refresh(env));
  },

  async fetch() {
    return new Response(null, {
      status: 404,
      headers: {
        "Cache-Control": "no-store",
      },
    });
  },
};

async function refresh(env) {
  const response = await fetch(env.REFRESH_URL, {
    headers: {
      Authorization: `Bearer ${env.CRON_SECRET}`,
    },
  });

  if (!response.ok) {
    throw new Error(`refresh failed: ${response.status}`);
  }
}
