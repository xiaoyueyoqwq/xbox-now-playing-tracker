import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { classifyActivity, isGameActivity } from "./activity-classifier.js";
import { createPresenceCache } from "./cache.js";
import { getConfig } from "./config.js";
import { logInfo, logWarn } from "./logger.js";
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
const PLAY_SESSION_TTL_SECONDS = 36 * 60 * 60;
const LAST_SEEN_TTL_SECONDS = 30 * 24 * 60 * 60;
const IMAGE_DATA_TTL_SECONDS = 12 * 60 * 60;
const IMAGE_FETCH_TIMEOUT_MS = 5000;
const IMAGE_DATA_MAX_BYTES = 600_000;
const PLAY_SESSION_RESPONSE_TTL_SECONDS = 15;
const PLAY_SESSION_RESET_GRACE_MS = Math.max(
  5 * 60 * 1000,
  (config.cacheTtlSeconds + 30) * 1000,
);

export async function handleCardRequest(request, response) {
  const url = getRequestUrl(request);
  const gamertag = normalizeGamertag(
    url.searchParams.get("gamertag") || config.defaultGamertag,
  );
  const useMock = url.searchParams.get("mock") === "1";
  const forceRefresh = url.searchParams.get("refresh") === "1";

  if (!gamertag) {
    sendSvg(
      response,
      400,
      renderCard({
        gamertag: "Missing gamertag",
        isOnline: false,
        status: "Add ?gamertag=...",
        titleName: "Configuration needed",
        fetchedAt: new Date().toISOString(),
      }),
      60,
    );
    return;
  }

  if (!useMock && !isAllowedGamertag(gamertag)) {
    logWarn(`[security] blocked gamertag="${gamertag}" reason=not-allowed`);
    sendText(
      response,
      403,
      "403 Forbidden\n\nThis deployment only serves its configured Xbox gamertags.\nFork and self-host the project to create your own card:\nhttps://github.com/xiaoyueyoqwq/xbox-now-playing-tracker\n",
      300,
    );
    return;
  }

  const cacheKey = useMock
    ? `mock:${gamertag}`
    : `openxbl:${gamertag.toLowerCase()}`;
  const bypassCache = forceRefresh || config.noCache;
  const cached = bypassCache
    ? { status: "miss", value: null }
    : await cache.get(cacheKey);

  if (cached.status === "fresh") {
    logCardResult("cache=fresh", cached.value);
    sendSvg(
      response,
      200,
      renderCard(cached.value),
      getResponseMaxAgeSeconds(cached.value),
    );
    return;
  }

  if (cached.status === "stale") {
    logCardResult("cache=stale", cached.value);
    cache
      .refresh(cacheKey, () => loadPresence(gamertag, useMock))
      .catch((error) => {
        logWarn(
          `Background refresh failed for ${gamertag}: ${formatError(error)}`,
        );
      });
    const stalePresence = { ...cached.value, stale: true };
    sendSvg(
      response,
      200,
      renderCard(stalePresence),
      getResponseMaxAgeSeconds(stalePresence, 60),
    );
    return;
  }

  try {
    const presence = await cache.refresh(cacheKey, () =>
      loadPresence(gamertag, useMock),
    );
    logCardResult(getCacheSource({ forceRefresh, bypassCache }), presence);
    sendSvg(
      response,
      200,
      renderCard(presence),
      getResponseMaxAgeSeconds(presence),
    );
  } catch (error) {
    sendSvg(
      response,
      200,
      renderCard({
        gamertag,
        isOnline: false,
        status: "Provider unavailable",
        titleName: "OpenXBL unavailable",
        fetchedAt: new Date().toISOString(),
      }),
      60,
    );
    logWarn(
      `Provider request failed for ${gamertag}: ${formatError(error)}`,
    );
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
      titleArtUrl: await readLocalImageDataUri("mock_halo_cover.jpg"),
      titleHeroUrl: await readLocalImageDataUri("mock_halo_hero.jpg"),
      deviceType: "Scarlett",
      platformName: "Xbox Series X|S",
      activityKind: "game",
      activityConfidence: "high",
      activityReason: "mock-game",
      sessionStartedAt: new Date(Date.now() - 42 * 60 * 1000).toISOString(),
      fetchedAt: new Date().toISOString(),
    };
  }

  const presence = await provider.getPresenceByGamertag(gamertag);
  const localClassification = classifyActivity({
    titleId: presence.titleId,
    titleName: presence.titleName,
  });
  const shouldLookupTitleArt = localClassification.activityReason !== "known-xbox-app";
  const art = shouldLookupTitleArt
    ? await getTitleArt({
      titleId: presence.titleId,
      titleName: presence.titleName,
    }).catch((error) => {
      if (shouldWarnForTitleArtFailure(localClassification)) {
        logWarn(
          `Title art lookup failed for ${presence.titleName || presence.titleId}: ${formatError(error)}`,
        );
      }
      return null;
    })
    : null;

  const enrichedPresence = {
    ...presence,
    titleName: presence.titleName || art?.titleName || "",
    titleArtUrl: art?.imageUrl || "",
    titleHeroUrl: art?.heroUrl || "",
    titleArtSource: art?.source || "",
    titleProductId: art?.productId || "",
    titleProductFamilyName: art?.productFamilyName || "",
    titleProductKind: art?.productKind || "",
  };

  const classifiedPresence = {
    ...enrichedPresence,
    ...classifyActivity({
      titleId: enrichedPresence.titleId,
      titleName: enrichedPresence.titleName,
      storeProductFamilyName: enrichedPresence.titleProductFamilyName,
      storeProductKind: enrichedPresence.titleProductKind,
      storeSource: enrichedPresence.titleArtSource,
    }),
  };

  const overriddenPresence = applyActivityArtworkOverrides(classifiedPresence);
  const embeddedPresence = await embedRemoteArtwork(overriddenPresence);

  return attachPresenceHistory(embeddedPresence);
}

async function readLocalImageDataUri(filename) {
  const safeFilename = path.basename(filename);
  const extension = path.extname(safeFilename).toLowerCase();
  const contentTypes = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".svg": "image/svg+xml",
    ".webp": "image/webp",
  };
  const buffer = await readFile(path.join(process.cwd(), "img", safeFilename));
  return `data:${contentTypes[extension] || "application/octet-stream"};base64,${buffer.toString("base64")}`;
}

function getRequestUrl(request) {
  const host = request.headers.host ?? "localhost";
  return new URL(request.url ?? "/", `http://${host}`);
}

function normalizeGamertag(value) {
  return String(value ?? "")
    .trim()
    .slice(0, 16);
}

function isAllowedGamertag(gamertag) {
  const allowed = getAllowedGamertags();
  if (allowed.size === 0) {
    return false;
  }

  return allowed.has(gamertag.toLowerCase());
}

function getAllowedGamertags() {
  return new Set(
    [
      config.defaultGamertag,
      ...config.allowedGamertags,
    ]
      .map(normalizeGamertag)
      .filter(Boolean)
      .map((value) => value.toLowerCase()),
  );
}

function applyActivityArtworkOverrides(presence) {
  if (presence.activityReason !== "known-xbox-app") {
    return presence;
  }

  return {
    ...presence,
    titleArtUrl: "/img/Xbox_Logo_White.svg",
    titleHeroUrl: "",
    titleArtSource: "local-xbox-app-override",
  };
}

function shouldWarnForTitleArtFailure(classification) {
  return classification.activityKind === "unknown"
    || classification.activityReason === "microsoft-store-games-search";
}

async function embedRemoteArtwork(presence) {
  const [titleArtUrl, titleHeroUrl, avatarUrl] = await Promise.all([
    resolveImageDataUri(presence.titleArtUrl, { width: 256, height: 256 }),
    resolveImageDataUri(presence.titleHeroUrl, { width: 640, height: 360 }),
    resolveImageDataUri(presence.avatarUrl, { width: 256, height: 256 }),
  ]);

  return {
    ...presence,
    titleArtUrl,
    titleHeroUrl,
    avatarUrl,
  };
}

async function resolveImageDataUri(url, size) {
  const startedAt = Date.now();
  if (!shouldEmbedImage(url)) {
    return url || "";
  }

  const imageUrl = size ? getSizedStoreImageUrl(url, size) : url;
  const cacheKey = getImageDataCacheKey(imageUrl);
  if (!config.noImageCache) {
    const cached = await cache.getValue(cacheKey);
    if (cached?.dataUri) {
      logInfo(`[image] hit ${shortImageUrl(imageUrl)} ms=${Date.now() - startedAt}`);
      return cached.dataUri;
    }
  }

  try {
    const dataUri = await fetchImageDataUri(imageUrl);
    if (config.noImageCache) {
      logInfo(`[image] bypass ${shortImageUrl(imageUrl)} bytes=${dataUri.length} ms=${Date.now() - startedAt}`);
    } else {
      await cache.setValue(cacheKey, { dataUri }, IMAGE_DATA_TTL_SECONDS);
      logInfo(`[image] cached ${shortImageUrl(imageUrl)} bytes=${dataUri.length} ms=${Date.now() - startedAt}`);
    }
    return dataUri;
  } catch (error) {
    if (size) {
      logWarn(`Image resize failed for ${imageUrl}: ${formatError(error)}; retrying original`);
      return resolveImageDataUri(url, null);
    }

    logWarn(`Image data cache failed for ${imageUrl}: ${formatError(error)} ms=${Date.now() - startedAt}`);
    return "";
  }
}

export async function shutdownCardHandler() {
  await cache.close?.();
}

function logCardResult(source, presence) {
  if (presence.provider === "mock") {
    return;
  }

  const parts = [
    "[card]",
    source,
    `gt=${presence.gamertag || "unknown"}`,
    `online=${presence.isOnline ? "yes" : "no"}`,
    `kind=${presence.activityKind || "unknown"}`,
    presence.titleName ? `title="${presence.titleName}"` : "",
    presence.platformName ? `platform="${presence.platformName}"` : "",
    presence.activityReason ? `reason=${presence.activityReason}` : "",
    presence.stale ? "stale=yes" : "",
  ].filter(Boolean);
  logInfo(parts.join(" "));
}

function getCacheSource({ forceRefresh, bypassCache }) {
  if (forceRefresh) {
    return "cache=refresh";
  }

  if (bypassCache) {
    return "cache=bypass";
  }

  return "cache=miss";
}

function getResponseMaxAgeSeconds(
  presence,
  fallbackSeconds = config.cacheTtlSeconds,
) {
  if (presence?.isOnline && isGameActivity(presence) && presence.sessionStartedAt) {
    return PLAY_SESSION_RESPONSE_TTL_SECONDS;
  }

  return fallbackSeconds;
}

function shortImageUrl(url) {
  const value = String(url ?? "");
  if (value.length <= 96) {
    return value;
  }

  return `${value.slice(0, 72)}...${value.slice(-16)}`;
}

function shouldEmbedImage(url) {
  const value = String(url ?? "");
  return value.startsWith("https://store-images.s-microsoft.com/")
    || value.startsWith("https://images-eds-ssl.xboxlive.com/")
    || value.startsWith("https://images-eds.xboxlive.com/")
    || value.startsWith("https://avatar-ssl.xboxlive.com/")
    || value.startsWith("https://avatar.xboxlive.com/");
}

function getImageDataCacheKey(url) {
  const hash = createHash("sha256").update(url).digest("hex").slice(0, 32);
  return `image-data:${hash}`;
}

function getSizedStoreImageUrl(url, { width, height }) {
  const imageUrl = new URL(url);
  imageUrl.searchParams.set("w", String(width));
  imageUrl.searchParams.set("h", String(height));
  return imageUrl.toString();
}

async function fetchImageDataUri(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), IMAGE_FETCH_TIMEOUT_MS);

  const response = await fetch(url, {
    signal: controller.signal,
    headers: {
      "Accept": "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
      "User-Agent": "XboxNowPlayingTracker/0.1",
    },
  }).finally(() => clearTimeout(timeout));

  if (!response.ok) {
    throw new Error(`image request failed: ${response.status}`);
  }

  const contentType = response.headers.get("content-type") || "image/jpeg";
  if (!contentType.startsWith("image/")) {
    throw new Error(`unexpected image content-type: ${contentType}`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length > IMAGE_DATA_MAX_BYTES) {
    throw new Error(`image too large: ${buffer.length} bytes`);
  }

  return `data:${contentType.split(";")[0]};base64,${buffer.toString("base64")}`;
}

async function attachPresenceHistory(presence) {
  const lastSeenKey = getLastSeenKey(presence);

  if (presence.isOnline) {
    const now = new Date().toISOString();

    if (!isGameActivity(presence)) {
      return presence;
    }

    const lastSeen = {
      seenAt: now,
      titleName: presence.titleName || "",
      titleId: presence.titleId || "",
      titleArtUrl: presence.titleArtUrl || "",
      titleHeroUrl: presence.titleHeroUrl || "",
      platformName: presence.platformName || "",
      deviceType: presence.deviceType || "",
      activityKind: presence.activityKind || "",
    };
    await cache.setValue(lastSeenKey, lastSeen, LAST_SEEN_TTL_SECONDS);

    const sessionKey = getPlaySessionKey(presence);
    const existingSession = normalizePlaySession(await cache.getValue(sessionKey));
    const sessionStartedAt = shouldContinuePlaySession(existingSession, now)
      ? existingSession.startedAt
      : now;
    await cache.setValue(
      sessionKey,
      {
        startedAt: sessionStartedAt,
        lastObservedAt: now,
        titleId: presence.titleId || "",
        titleName: presence.titleName || "",
      },
      PLAY_SESSION_TTL_SECONDS,
    );

    return {
      ...presence,
      sessionStartedAt,
    };
  }

  const lastSeen = await cache.getValue(lastSeenKey);
  if (!lastSeen) {
    return presence;
  }

  return {
    ...presence,
    lastSeenAt: lastSeen.seenAt,
    lastSeenTitleName: lastSeen.titleName,
    lastSeenTitleId: lastSeen.titleId,
    lastSeenTitleArtUrl: lastSeen.titleArtUrl,
    lastSeenTitleHeroUrl: lastSeen.titleHeroUrl,
    lastSeenPlatformName: lastSeen.platformName,
    lastSeenDeviceType: lastSeen.deviceType,
  };
}

function getPlaySessionKey(presence) {
  const playerKey = String(
    presence.xuid || presence.gamertag || "",
  ).toLowerCase();
  const titleKey = String(
    presence.titleId || presence.titleName || "",
  ).toLowerCase();
  return `play-session:${playerKey}:${titleKey}`;
}

function normalizePlaySession(value) {
  if (!value || typeof value !== "object") {
    return null;
  }

  const startedAt = parseSessionTimestamp(value.startedAt);
  const lastObservedAt = parseSessionTimestamp(value.lastObservedAt);
  if (!startedAt || !lastObservedAt) {
    return null;
  }

  return {
    ...value,
    startedAt,
    lastObservedAt,
  };
}

function shouldContinuePlaySession(session, now) {
  if (!session) {
    return false;
  }

  const lastObservedAtMs = Date.parse(session.lastObservedAt);
  const nowMs = Date.parse(now);
  if (Number.isNaN(lastObservedAtMs) || Number.isNaN(nowMs)) {
    return false;
  }

  return nowMs - lastObservedAtMs <= PLAY_SESSION_RESET_GRACE_MS;
}

function parseSessionTimestamp(value) {
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? "" : new Date(timestamp).toISOString();
}

function getLastSeenKey(presence) {
  const playerKey = String(
    presence.xuid || presence.gamertag || "",
  ).toLowerCase();
  return `last-seen:${playerKey}`;
}

function sendSvg(response, statusCode, body, maxAgeSeconds) {
  response.statusCode = statusCode;
  response.setHeader("Content-Type", "image/svg+xml; charset=utf-8");
  response.setHeader(
    "Cache-Control",
    `public, max-age=${maxAgeSeconds}, stale-while-revalidate=${maxAgeSeconds}`,
  );
  response.end(body);
}

function sendText(response, statusCode, body, maxAgeSeconds) {
  response.statusCode = statusCode;
  response.setHeader("Content-Type", "text/plain; charset=utf-8");
  response.setHeader(
    "Cache-Control",
    `public, max-age=${maxAgeSeconds}, stale-while-revalidate=${maxAgeSeconds}`,
  );
  response.end(body);
}

function formatError(error) {
  const code = error?.cause?.code || error?.code;
  const message = error?.message || String(error);
  return code ? `${message} (${code})` : message;
}
