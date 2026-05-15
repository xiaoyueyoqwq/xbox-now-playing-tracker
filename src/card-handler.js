import { createPresenceCache } from "./cache.js";
import { getConfig } from "./config.js";
import { OpenXblProvider } from "./openxbl.js";
import { renderCard } from "./renderer.js";
import { getTitleArt } from "./title-art.js";

const config = getConfig();
const provider = new OpenXblProvider({
  apiKey: config.openXblApiKey,
  contract: config.openXblContract,
  baseUrl: config.openXblBaseUrl,
});
const cache = createPresenceCache({
  redisUrl: config.redisUrl,
  redisRestUrl: config.redisRestUrl,
  redisRestToken: config.redisRestToken,
  ttlSeconds: config.cacheTtlSeconds,
  staleTtlSeconds: config.staleTtlSeconds,
});

export async function handleCardRequest(request, response) {
  const url = getRequestUrl(request);
  const gamertag = normalizeGamertag(url.searchParams.get("gamertag") || config.defaultGamertag);
  const useMock = url.searchParams.get("mock") === "1";
  const forceRefresh = url.searchParams.get("refresh") === "1";

  if (!gamertag) {
    sendSvg(response, 400, renderCard({
      gamertag: "Missing gamertag",
      isOnline: false,
      status: "Add ?gamertag=...",
      titleName: "Configuration needed",
      fetchedAt: new Date().toISOString(),
    }), 60);
    return;
  }

  const cacheKey = useMock ? `mock:${gamertag}` : `openxbl:${gamertag.toLowerCase()}`;
  const cached = forceRefresh ? { status: "miss", value: null } : await cache.get(cacheKey);

  if (cached.status === "fresh") {
    sendSvg(response, 200, renderCard(cached.value), config.cacheTtlSeconds);
    return;
  }

  if (cached.status === "stale") {
    cache.refresh(cacheKey, () => loadPresence(gamertag, useMock)).catch((error) => {
      console.error(`Background refresh failed for ${gamertag}:`, error);
    });
    sendSvg(response, 200, renderCard({ ...cached.value, stale: true }), 60);
    return;
  }

  try {
    const presence = await cache.refresh(cacheKey, () => loadPresence(gamertag, useMock));
    sendSvg(response, 200, renderCard(presence), config.cacheTtlSeconds);
  } catch (error) {
    sendSvg(response, 200, renderCard({
      gamertag,
      isOnline: false,
      status: "Provider unavailable",
      titleName: "OpenXBL unavailable",
      fetchedAt: new Date().toISOString(),
    }), 60);
    console.error(`Provider request failed for ${gamertag}:`, error);
  }
}

async function loadPresence(gamertag, useMock) {
  if (useMock) {
    return {
      provider: "mock",
      gamertag,
      xuid: "0",
      avatarUrl: "",
      isOnline: true,
      status: "Online",
      titleName: "Halo Infinite",
      titleId: "mock-title",
      titleArtUrl: "https://store-images.s-microsoft.com/image/apps.54721.13727851868390641.c9cc5f66-aff8-406c-af6b-440838730be0.a80b262c-005c-4958-bb83-77411ba3d3b4",
      deviceType: "Xbox",
      fetchedAt: new Date().toISOString(),
    };
  }

  const presence = await provider.getPresenceByGamertag(gamertag);
  const art = await getTitleArt({
    titleId: presence.titleId,
    titleName: presence.titleName,
  }).catch((error) => {
    console.error(`Title art lookup failed for ${presence.titleName || presence.titleId}:`, error);
    return null;
  });

  return {
    ...presence,
    titleName: presence.titleName || art?.titleName || "",
    titleArtUrl: art?.imageUrl || "",
    titleArtSource: art?.source || "",
  };
}

function getRequestUrl(request) {
  const host = request.headers.host ?? "localhost";
  return new URL(request.url ?? "/", `http://${host}`);
}

function normalizeGamertag(value) {
  return String(value ?? "").trim().slice(0, 64);
}

function sendSvg(response, statusCode, body, maxAgeSeconds) {
  response.statusCode = statusCode;
  response.setHeader("Content-Type", "image/svg+xml; charset=utf-8");
  response.setHeader("Cache-Control", `public, max-age=${maxAgeSeconds}, stale-while-revalidate=${maxAgeSeconds}`);
  response.end(body);
}
