import { readFile } from "node:fs/promises";
import path from "node:path";
import { classifyActivity, isGameActivity } from "./activity-classifier.js";
import {
  applyArtworkPolicy,
  shouldEmbedAvatarArtwork,
  shouldRefreshArtworkPolicy,
} from "./artwork-manager.js";
import { createPresenceCache } from "./cache.js";
import { getConfig } from "./config.js";
import {
  getImageCandidateCacheKey,
  getImageDataCacheKey,
  getImageDataUriCandidates,
  prioritizeImageCandidates,
} from "./image-candidates.js";
import { logInfo, logWarn } from "./logger.js";
import { OpenXblProvider } from "./openxbl.js";
import { renderCard } from "./renderer.js";
import { shouldContinuePlaySession } from "./session-state.js";
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
const SVG_BACKUP_TTL_SECONDS = 24 * 60 * 60;
const IMAGE_DATA_TTL_SECONDS = 7 * 24 * 60 * 60;
const IMAGE_FETCH_TIMEOUT_MS = 5000;
const IMAGE_DATA_MAX_BYTES = 600_000;
const IMAGE_FETCH_ATTEMPTS = 3;
const NON_TIMER_RESPONSE_TTL_SECONDS = 30;
const SVG_SHARED_CACHE_MIN_SECONDS = 30;
const SVG_STALE_IF_ERROR_SECONDS = 24 * 60 * 60;
const SVG_STALE_REVALIDATE_SECONDS = 30;
const PLAY_SESSION_RESPONSE_TTL_SECONDS = 15;
const PLAY_SESSION_OBSERVATION_GRACE_MS = 30 * 60 * 1000;
const XUID_CACHE_TTL_SECONDS = 30 * 24 * 60 * 60;
const PLAY_SESSION_RESET_GRACE_MS = Math.max(
  PLAY_SESSION_OBSERVATION_GRACE_MS,
  (config.cacheTtlSeconds + 30) * 1000,
);

export async function handleCardRequest(request, response) {
  const perf = createPerfTrace("card");
  const url = getRequestUrl(request);
  const gamertag = normalizeGamertag(
    url.searchParams.get("gamertag") || config.defaultGamertag,
  );
  const useMock = url.searchParams.get("mock") === "1";
  const forceRefresh = url.searchParams.get("refresh") === "1";

  if (!gamertag) {
    const presence = await ensureRenderablePresence({
      gamertag: "Missing gamertag",
      isOnline: false,
      status: "Add ?gamertag=...",
      titleName: "Configuration needed",
      fetchedAt: new Date().toISOString(),
    });
    sendSvg(response, 400, renderCard(presence), 60);
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
  const svgCacheKey = getSvgCacheKey(cacheKey);
  const svgBackupCacheKey = getSvgBackupCacheKey(cacheKey);
  const bypassCache = forceRefresh || config.noCache;
  const cached = bypassCache
    ? { status: "miss", value: null }
    : await timePerf(perf, "presenceGet", () => cache.get(cacheKey));
  const hasSessionTimer = hasVisibleSessionTimer(cached.value);

  if (!bypassCache && !hasSessionTimer) {
    const cachedSvg = await timePerf(perf, "svgGet", () =>
      cache.getValue(svgCacheKey),
    );
    if (cachedSvg?.body && !isTimerSvgCacheValue(cachedSvg)) {
      logInfo(`[card] cache=svg gt=${gamertag}`);
      sendSvg(
        response,
        200,
        cachedSvg.body,
        cachedSvg.maxAgeSeconds ?? config.cacheTtlSeconds,
      );
      logPerfTrace(perf, {
        gamertag,
        source: "svg",
        cacheStatus: cached.status,
        online: cached.value?.isOnline,
        kind: cached.value?.activityKind,
        bytes: Buffer.byteLength(cachedSvg.body),
      });
      return;
    }
  }

  const cachedBackupSvg = await timePerf(perf, "backupGet", () =>
    getReusableBackupSvg({
      bypassCache,
      hasSessionTimer,
      svgBackupCacheKey,
    }),
  );

  if (cached.status === "fresh") {
    const presence = await timePerf(perf, "ensureRenderable", () =>
      ensureRenderablePresence(cached.value, perf),
    );
    logCardResult("cache=fresh", presence);
    await sendRenderedSvg(
      response,
      200,
      presence,
      getResponseMaxAgeSeconds(presence),
      getSvgCacheKeyForPresence(svgCacheKey, presence),
      getSvgBackupCacheKeyForPresence(svgBackupCacheKey, presence),
      perf,
    );
    logPerfTrace(perf, {
      gamertag,
      source: "fresh",
      cacheStatus: cached.status,
      online: presence.isOnline,
      kind: presence.activityKind,
    });
    return;
  }

  if (cached.status === "stale") {
    logCardResult("cache=stale", cached.value);
    try {
      const presence = await timePerf(perf, "presenceRefresh", () =>
        cache.refresh(cacheKey, () => loadPresence(gamertag, useMock, perf)),
      );
      logCardResult("cache=stale-refresh", presence);
      await sendRenderedSvg(
        response,
        200,
        presence,
        getResponseMaxAgeSeconds(presence),
        getSvgCacheKeyForPresence(svgCacheKey, presence),
        getSvgBackupCacheKeyForPresence(svgBackupCacheKey, presence),
        perf,
      );
      logPerfTrace(perf, {
        gamertag,
        source: "stale-refresh",
        cacheStatus: cached.status,
        online: presence.isOnline,
        kind: presence.activityKind,
      });
      return;
    } catch (error) {
      logWarn(
        `Stale refresh failed for ${gamertag}; serving stale presence: ${formatError(error)}`,
      );
      const stalePresence = await timePerf(perf, "ensureRenderable", () =>
        ensureRenderablePresence(
          {
            ...cached.value,
            stale: true,
          },
          perf,
        ),
      );
      await sendRenderedSvg(
        response,
        200,
        stalePresence,
        getResponseMaxAgeSeconds(stalePresence, 60),
        getSvgCacheKeyForPresence(svgCacheKey, stalePresence),
        getSvgBackupCacheKeyForPresence(svgBackupCacheKey, stalePresence),
        perf,
      );
      logPerfTrace(perf, {
        gamertag,
        source: "stale-fallback",
        cacheStatus: cached.status,
        online: stalePresence.isOnline,
        kind: stalePresence.activityKind,
      });
      return;
    }
  }

  try {
    const presence = await timePerf(perf, "presenceRefresh", () =>
      cache.refresh(cacheKey, () => loadPresence(gamertag, useMock, perf)),
    );
    logCardResult(getCacheSource({ forceRefresh, bypassCache }), presence);
    await sendRenderedSvg(
      response,
      200,
      presence,
      getResponseMaxAgeSeconds(presence),
      getSvgCacheKeyForPresence(svgCacheKey, presence),
      getSvgBackupCacheKeyForPresence(svgBackupCacheKey, presence),
      perf,
    );
    logPerfTrace(perf, {
      gamertag,
      source: getCacheSource({ forceRefresh, bypassCache }),
      cacheStatus: cached.status,
      online: presence.isOnline,
      kind: presence.activityKind,
    });
  } catch (error) {
    if (cachedBackupSvg?.body) {
      logWarn(
        `Provider request failed for ${gamertag}; serving backup SVG: ${formatError(error)}`,
      );
      sendSvg(
        response,
        200,
        cachedBackupSvg.body,
        cachedBackupSvg.maxAgeSeconds ?? 60,
      );
      logPerfTrace(perf, {
        gamertag,
        source: "backup",
        cacheStatus: cached.status,
        bytes: Buffer.byteLength(cachedBackupSvg.body),
      });
      return;
    }

    const presence = await timePerf(perf, "ensureRenderable", () =>
      ensureRenderablePresence(
        {
          gamertag,
          isOnline: false,
          status: "Provider unavailable",
          titleName: "OpenXBL unavailable",
          fetchedAt: new Date().toISOString(),
        },
        perf,
      ),
    );
    const body = await timePerf(perf, "render", () => renderCard(presence));
    sendSvg(response, 200, body, 60);
    logWarn(`Provider request failed for ${gamertag}: ${formatError(error)}`);
    logPerfTrace(perf, {
      gamertag,
      source: "provider-error",
      cacheStatus: cached.status,
      online: presence.isOnline,
      kind: presence.activityKind,
      bytes: Buffer.byteLength(body),
    });
  }
}

export async function refreshAllowedGamertags({ force = true } = {}) {
  const gamertags = getConfiguredGamertags();
  const results = [];

  for (const gamertag of gamertags) {
    const cacheKey = `openxbl:${gamertag.toLowerCase()}`;
    const startedAt = Date.now();
    try {
      const cached = force
        ? { status: "miss", value: null }
        : await cache.get(cacheKey);
      const presence =
        cached.status === "fresh"
          ? await ensureRenderablePresence(cached.value)
          : await cache.refresh(cacheKey, () => loadPresence(gamertag, false));

      const maxAgeSeconds = getResponseMaxAgeSeconds(presence);
      await cacheRenderedSvg({
        body: renderCard(presence),
        maxAgeSeconds,
        svgCacheKey: getSvgCacheKeyForPresence(
          getSvgCacheKey(cacheKey),
          presence,
        ),
        svgBackupCacheKey: getSvgBackupCacheKeyForPresence(
          getSvgBackupCacheKey(cacheKey),
          presence,
        ),
      });

      logCardResult(force ? "cron=refresh" : `cron=${cached.status}`, presence);
      results.push({
        gamertag,
        ok: true,
        cache: cached.status,
        online: Boolean(presence.isOnline),
        activityKind: presence.activityKind || "unknown",
        titleName: presence.titleName || "",
        elapsedMs: Date.now() - startedAt,
      });
    } catch (error) {
      logWarn(`[cron] refresh failed gt=${gamertag}: ${formatError(error)}`);
      results.push({
        gamertag,
        ok: false,
        error: formatError(error),
        elapsedMs: Date.now() - startedAt,
      });
    }
  }

  return {
    ok: results.length > 0 && results.every((result) => result.ok),
    refreshedAt: new Date().toISOString(),
    count: results.length,
    results,
  };
}

async function loadPresence(gamertag, useMock, perf = null) {
  if (useMock) {
    const [titleArtUrl, titleHeroUrl] = await timePerf(perf, "mockImages", () =>
      Promise.all([
        readLocalImageDataUri("mock_halo_cover.jpg"),
        readLocalImageDataUri("mock_halo_hero.jpg"),
      ]),
    );
    return applyArtworkPolicy({
      provider: "mock",
      gamertag,
      xuid: "0",
      avatarUrl: "",
      isOnline: true,
      status: "Online",
      titleName: "Halo Infinite",
      titleId: "mock-title",
      titleArtUrl,
      titleHeroUrl,
      deviceType: "Scarlett",
      platformName: "Xbox Series X|S",
      activityKind: "game",
      activityConfidence: "high",
      activityReason: "mock-game",
      sessionStartedAt: new Date(Date.now() - 42 * 60 * 1000).toISOString(),
      fetchedAt: new Date().toISOString(),
    });
  }

  const presence = await timePerf(perf, "openxbl", () =>
    getOpenXblPresence(gamertag, perf),
  );
  const localClassification = classifyActivity({
    titleId: presence.titleId,
    titleName: presence.titleName,
  });
  const shouldLookupTitleArt =
    localClassification.activityReason !== "known-xbox-app";
  const art = shouldLookupTitleArt
    ? await timePerf(perf, "titleArt", () =>
        getTitleArt({
          titleId: presence.titleId,
          titleName: presence.titleName,
        }).catch((error) => {
          if (shouldWarnForTitleArtFailure(localClassification)) {
            logWarn(
              `Title art lookup failed for ${presence.titleName || presence.titleId}: ${formatError(error)}`,
            );
          }
          return null;
        }),
      )
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

  const embeddedPresence = await timePerf(perf, "embedArtwork", () =>
    embedPresenceArtwork(classifiedPresence),
  );

  return timePerf(perf, "history", () =>
    attachPresenceHistory(embeddedPresence, perf),
  );
}

async function getOpenXblPresence(gamertag, perf = null) {
  const xuidCacheKey = getXuidCacheKey(gamertag);
  const cachedIdentity = await timePerf(perf, "xuidGet", () =>
    cache.getValue(xuidCacheKey),
  );
  if (cachedIdentity?.xuid) {
    try {
      const presence = await timePerf(perf, "xuidPresence", () =>
        provider.getPresenceByXuid({
          gamertag,
          xuid: cachedIdentity.xuid,
          profile: cachedIdentity.profile || null,
        }),
      );
      return presence;
    } catch (error) {
      logWarn(
        `[openxbl] cached xuid failed for "${gamertag}"; falling back to gamertag search: ${formatError(error)}`,
      );
    }
  }

  const presence = await timePerf(perf, "gamertagPresence", () =>
    provider.getPresenceByGamertag(gamertag),
  );
  if (presence.xuid) {
    await timePerf(perf, "xuidSet", () =>
      cache.setValue(
        xuidCacheKey,
        {
          xuid: presence.xuid,
          profile: {
            id: presence.xuid,
            settings: [
              { id: "Gamertag", value: presence.gamertag || gamertag },
              { id: "GameDisplayPicRaw", value: presence.avatarUrl || "" },
            ],
          },
        },
        XUID_CACHE_TTL_SECONDS,
      ),
    );
  }

  return presence;
}

async function ensureRenderablePresence(presence, perf = null) {
  if (!shouldRefreshArtworkPolicy(presence)) {
    return presence;
  }

  return timePerf(perf, "embedArtwork", () => embedPresenceArtwork(presence));
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
  return new Set(getConfiguredGamertags().map((value) => value.toLowerCase()));
}

function getConfiguredGamertags() {
  const seen = new Set();
  const gamertags = [];
  for (const value of [config.defaultGamertag, ...config.allowedGamertags]) {
    const gamertag = normalizeGamertag(value);
    const key = gamertag.toLowerCase();
    if (!gamertag || seen.has(key)) {
      continue;
    }

    seen.add(key);
    gamertags.push(gamertag);
  }

  return gamertags;
}

function getXuidCacheKey(gamertag) {
  return `xuid:${String(gamertag || "").toLowerCase()}`;
}

function shouldWarnForTitleArtFailure(classification) {
  return (
    classification.activityKind === "unknown" ||
    classification.activityReason === "microsoft-store-games-search"
  );
}

async function embedPresenceArtwork(presence) {
  const resolvedPresence = applyArtworkPolicy(presence);
  const shouldResolveAvatar = shouldEmbedAvatarArtwork(resolvedPresence);
  const resolveArtworkUrl = createArtworkUrlResolver();
  const [titleArtUrl, titleHeroUrl, avatarUrl, coverImageUrl, featureImageUrl] =
    await Promise.all([
      resolveArtworkUrl(presence.titleArtUrl, {
        purpose: "cover",
        width: 256,
        height: 256,
      }),
      resolveArtworkUrl(presence.titleHeroUrl, {
        purpose: "hero",
        width: 640,
        height: 360,
      }),
      shouldResolveAvatar
        ? resolveArtworkUrl(presence.avatarUrl, {
            purpose: "avatar",
            width: 256,
            height: 256,
          })
        : Promise.resolve(presence.avatarUrl || ""),
      resolveArtworkUrl(resolvedPresence.coverImageUrl, {
        purpose: resolvedPresence.coverSource === "avatar" ? "avatar" : "cover",
        width: 256,
        height: 256,
      }),
      resolveArtworkUrl(
        resolvedPresence.featureImageUrl,
        getArtworkSize(resolvedPresence.featureSource),
      ),
    ]);

  return {
    ...resolvedPresence,
    titleArtUrl,
    titleHeroUrl,
    avatarUrl,
    coverImageUrl,
    featureImageUrl,
  };
}

function createArtworkUrlResolver() {
  const resolved = new Map();
  return (url, size) => {
    const key = JSON.stringify([url || "", size || null]);
    if (!resolved.has(key)) {
      resolved.set(key, resolveImageDataUri(url, size));
    }

    return resolved.get(key);
  };
}

function getArtworkSize(source) {
  if (source === "title-art") {
    return {
      purpose: "cover",
      width: 256,
      height: 256,
    };
  }

  return {
    purpose: "hero",
    width: 640,
    height: 360,
  };
}

async function resolveImageDataUri(url, request) {
  const startedAt = Date.now();
  if (isLocalImageUrl(url)) {
    return readLocalImageDataUri(getLocalImageFilename(url));
  }

  if (!shouldEmbedImage(url)) {
    return url || "";
  }

  const candidates = await getPrioritizedImageDataUriCandidates(url, request);
  for (const [index, imageUrl] of candidates.entries()) {
    const cacheKey = getImageDataCacheKey(imageUrl);
    if (!config.noImageCache) {
      const cached = await cache.getValue(cacheKey);
      if (cached?.dataUri) {
        logInfo(
          `[image] hit ${shortImageUrl(imageUrl)} ms=${Date.now() - startedAt}`,
        );
        return cached.dataUri;
      }
    }

    try {
      const dataUri = await fetchImageDataUriWithRetry(imageUrl);
      if (config.noImageCache) {
        logInfo(
          `[image] bypass ${shortImageUrl(imageUrl)} bytes=${dataUri.length} ms=${Date.now() - startedAt}`,
        );
      } else {
        await cache.setValue(cacheKey, { dataUri }, IMAGE_DATA_TTL_SECONDS);
        await cache.setValue(
          getImageCandidateCacheKey(url, request),
          { imageUrl },
          IMAGE_DATA_TTL_SECONDS,
        );
        logInfo(
          `[image] cached ${shortImageUrl(imageUrl)} bytes=${dataUri.length} ms=${Date.now() - startedAt}`,
        );
      }
      return dataUri;
    } catch (error) {
      const hasNextCandidate = index < candidates.length - 1;
      if (hasNextCandidate) {
        logWarn(
          `Image candidate failed for ${shortImageUrl(imageUrl)}: ${formatError(error)}; trying fallback`,
        );
        continue;
      }

      logWarn(
        `Image data cache failed for ${shortImageUrl(imageUrl)}: ${formatError(error)} ms=${Date.now() - startedAt}`,
      );
      return "";
    }
  }

  return "";
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

function createPerfTrace(name) {
  return {
    name,
    startedAt: Date.now(),
    marks: new Map(),
  };
}

async function timePerf(trace, name, action) {
  if (!trace) {
    return action();
  }

  const startedAt = Date.now();
  try {
    return await action();
  } finally {
    addPerf(trace, name, Date.now() - startedAt);
  }
}

function addPerf(trace, name, elapsedMs) {
  if (!trace) {
    return;
  }

  trace.marks.set(name, (trace.marks.get(name) || 0) + elapsedMs);
}

function recordPerf(trace, name, value) {
  if (!trace) {
    return;
  }

  trace.marks.set(name, value);
}

function logPerfTrace(trace, details = {}) {
  if (!trace) {
    return;
  }

  const totalMs = Date.now() - trace.startedAt;
  const parts = [
    "[perf]",
    trace.name,
    details.gamertag ? `gt=${details.gamertag}` : "",
    details.source ? `source=${details.source}` : "",
    details.cacheStatus ? `presence=${details.cacheStatus}` : "",
    details.online === undefined
      ? ""
      : `online=${details.online ? "yes" : "no"}`,
    details.kind ? `kind=${details.kind}` : "",
    `region=${process.env.VERCEL_REGION ?? "unknown"}`,
    `cacheType=${cache?.primary ? cache.primary.constructor.name : (cache?.constructor?.name ?? "unknown")}`,
    `total=${totalMs}`,
  ];

  for (const [name, value] of trace.marks.entries()) {
    parts.push(`${name}=${value}`);
  }

  if (details.bytes !== undefined) {
    parts.push(`bytes=${details.bytes}`);
  }

  logInfo(parts.filter(Boolean).join(" "));
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
  fallbackSeconds = NON_TIMER_RESPONSE_TTL_SECONDS,
) {
  if (hasVisibleSessionTimer(presence)) {
    return PLAY_SESSION_RESPONSE_TTL_SECONDS;
  }

  return fallbackSeconds;
}

function hasVisibleSessionTimer(presence) {
  return Boolean(
    presence?.isOnline && isGameActivity(presence) && presence.sessionStartedAt,
  );
}

function getSvgCacheKeyForPresence(svgCacheKey, presence) {
  return hasVisibleSessionTimer(presence) ? "" : svgCacheKey;
}

function getSvgBackupCacheKeyForPresence(svgBackupCacheKey, presence) {
  return hasVisibleSessionTimer(presence) ? "" : svgBackupCacheKey;
}

async function sendRenderedSvg(
  response,
  statusCode,
  presence,
  maxAgeSeconds,
  svgCacheKey,
  svgBackupCacheKey = "",
  perf = null,
) {
  const body = await timePerf(perf, "render", () => renderCard(presence));
  await timePerf(perf, "svgCacheSet", () =>
    cacheRenderedSvg({ body, maxAgeSeconds, svgCacheKey, svgBackupCacheKey }),
  );

  sendSvg(response, statusCode, body, maxAgeSeconds, {
    revalidateEveryRequest: hasVisibleSessionTimer(presence),
  });
  recordPerf(perf, "bytes", Buffer.byteLength(body));
}

async function cacheRenderedSvg({
  body,
  maxAgeSeconds,
  svgCacheKey,
  svgBackupCacheKey = "",
}) {
  if (!svgCacheKey) {
    return;
  }

  const value = {
    body,
    maxAgeSeconds,
    renderedAt: new Date().toISOString(),
  };
  await cache.setValue(
    svgCacheKey,
    value,
    getSvgCacheTtlSeconds(maxAgeSeconds),
  );

  if (svgBackupCacheKey) {
    await cache.setValue(svgBackupCacheKey, value, SVG_BACKUP_TTL_SECONDS);
  }
}

function getSvgCacheKey(cacheKey) {
  return `svg:${cacheKey}`;
}

function getSvgBackupCacheKey(cacheKey) {
  return `svg-backup:${cacheKey}`;
}

function getSvgCacheTtlSeconds(maxAgeSeconds) {
  return getCacheHeaderSeconds(maxAgeSeconds);
}

async function getReusableBackupSvg({
  bypassCache,
  hasSessionTimer,
  svgBackupCacheKey,
}) {
  if (bypassCache || hasSessionTimer) {
    return null;
  }

  const cachedBackupSvg = await cache.getValue(svgBackupCacheKey);
  return isTimerSvgCacheValue(cachedBackupSvg) ? null : cachedBackupSvg;
}

function isTimerSvgCacheValue(value) {
  return Boolean(
    value?.body &&
    getCacheHeaderSeconds(value.maxAgeSeconds) <=
      PLAY_SESSION_RESPONSE_TTL_SECONDS,
  );
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
  return (
    value.startsWith("https://store-images.s-microsoft.com/") ||
    value.startsWith("https://images-eds-ssl.xboxlive.com/") ||
    value.startsWith("https://images-eds.xboxlive.com/") ||
    value.startsWith("https://avatar-ssl.xboxlive.com/") ||
    value.startsWith("https://avatar.xboxlive.com/")
  );
}

function isLocalImageUrl(url) {
  return String(url ?? "").startsWith("/img/");
}

function getLocalImageFilename(url) {
  const localUrl = new URL(String(url), "http://localhost");
  return path.basename(localUrl.pathname);
}

async function getPrioritizedImageDataUriCandidates(url, request) {
  const candidates = getImageDataUriCandidates(url, request);
  if (config.noImageCache || candidates.length <= 1) {
    return candidates;
  }

  const cachedCandidate = await cache.getValue(
    getImageCandidateCacheKey(url, request),
  );
  const cachedImageUrl = cachedCandidate?.imageUrl;
  if (!cachedImageUrl || !candidates.includes(cachedImageUrl)) {
    return candidates;
  }

  return prioritizeImageCandidates(candidates, cachedImageUrl);
}

async function fetchImageDataUriWithRetry(url) {
  let lastError = null;
  for (let attempt = 1; attempt <= IMAGE_FETCH_ATTEMPTS; attempt += 1) {
    try {
      return await fetchImageDataUri(url);
    } catch (error) {
      lastError = error;
      if (!isRetryableImageError(error) || attempt === IMAGE_FETCH_ATTEMPTS) {
        throw error;
      }
      await delay(150 * attempt);
    }
  }

  throw lastError;
}

async function fetchImageDataUri(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), IMAGE_FETCH_TIMEOUT_MS);

  const response = await fetch(url, {
    signal: controller.signal,
    headers: {
      Accept:
        "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
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

function isRetryableImageError(error) {
  const message = error?.message || String(error);
  return (
    error?.name === "AbortError" ||
    message.includes("aborted") ||
    message.includes("fetch failed") ||
    message.includes("image request failed: 408") ||
    message.includes("image request failed: 429") ||
    /image request failed: 5\d\d/.test(message)
  );
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function attachPresenceHistory(presence, perf = null) {
  const lastSeenKey = getLastSeenKey(presence);
  const currentGameSessionKey = getCurrentGameSessionKey(presence);

  if (presence.isOnline) {
    const now = new Date().toISOString();

    if (!isGameActivity(presence)) {
      await markCurrentGameSessionAway(currentGameSessionKey, now);
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
    const sessionKey = getPlaySessionKey(presence);
    const [existingSessionValue] = await Promise.all([
      timePerf(perf, "sessionGet", () => cache.getValue(sessionKey)),
      timePerf(perf, "lastSeenSet", () =>
        cache.setValue(lastSeenKey, lastSeen, LAST_SEEN_TTL_SECONDS),
      ),
      timePerf(perf, "currentSessionAway", () =>
        markCurrentGameSessionAway(currentGameSessionKey, now, sessionKey),
      ),
    ]);

    const existingSession = normalizePlaySession(existingSessionValue);
    const sessionStartedAt = shouldContinuePlaySession(existingSession, now, {
      graceMs: PLAY_SESSION_RESET_GRACE_MS,
    })
      ? existingSession.startedAt
      : now;
    await Promise.all([
      timePerf(perf, "sessionSet", () =>
        cache.setValue(
          sessionKey,
          {
            startedAt: sessionStartedAt,
            lastObservedAt: now,
            titleId: presence.titleId || "",
            titleName: presence.titleName || "",
            awayObservedAt: "",
          },
          PLAY_SESSION_TTL_SECONDS,
        ),
      ),
      timePerf(perf, "currentSessionSet", () =>
        cache.setValue(
          currentGameSessionKey,
          {
            sessionKey,
            titleId: presence.titleId || "",
            titleName: presence.titleName || "",
            awayObservedAt: "",
          },
          PLAY_SESSION_TTL_SECONDS,
        ),
      ),
    ]);

    return {
      ...presence,
      sessionStartedAt,
    };
  }

  await markCurrentGameSessionAway(
    currentGameSessionKey,
    new Date().toISOString(),
  );

  const lastSeen = await timePerf(perf, "lastSeenGet", () =>
    cache.getValue(lastSeenKey),
  );
  if (!lastSeen) {
    return presence;
  }

  return embedPresenceArtwork({
    ...presence,
    lastSeenAt: lastSeen.seenAt,
    lastSeenTitleName: lastSeen.titleName,
    lastSeenTitleId: lastSeen.titleId,
    lastSeenTitleArtUrl: lastSeen.titleArtUrl,
    lastSeenTitleHeroUrl: lastSeen.titleHeroUrl,
    lastSeenPlatformName: lastSeen.platformName,
    lastSeenDeviceType: lastSeen.deviceType,
  });
}

async function markCurrentGameSessionAway(
  currentGameSessionKey,
  now,
  exceptSessionKey = "",
) {
  const currentSession = normalizeCurrentGameSession(
    await cache.getValue(currentGameSessionKey),
  );
  if (
    !currentSession ||
    !currentSession.sessionKey ||
    currentSession.sessionKey === exceptSessionKey ||
    currentSession.awayObservedAt
  ) {
    return;
  }

  const playSession = normalizePlaySession(
    await cache.getValue(currentSession.sessionKey),
  );
  const updates = [
    cache.setValue(
      currentGameSessionKey,
      {
        ...currentSession,
        awayObservedAt: now,
      },
      PLAY_SESSION_TTL_SECONDS,
    ),
  ];
  if (playSession && !playSession.awayObservedAt) {
    updates.push(
      cache.setValue(
        currentSession.sessionKey,
        {
          ...playSession,
          awayObservedAt: now,
        },
        PLAY_SESSION_TTL_SECONDS,
      ),
    );
  }

  await Promise.all(updates);
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

function getCurrentGameSessionKey(presence) {
  const playerKey = String(
    presence.xuid || presence.gamertag || "",
  ).toLowerCase();
  return `play-session-current:${playerKey}`;
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
    awayObservedAt: parseOptionalSessionTimestamp(value.awayObservedAt),
  };
}

function normalizeCurrentGameSession(value) {
  if (!value || typeof value !== "object") {
    return null;
  }

  return {
    sessionKey: String(value.sessionKey || ""),
    titleId: String(value.titleId || ""),
    titleName: String(value.titleName || ""),
    awayObservedAt: parseOptionalSessionTimestamp(value.awayObservedAt),
  };
}

function parseSessionTimestamp(value) {
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? "" : new Date(timestamp).toISOString();
}

function parseOptionalSessionTimestamp(value) {
  if (!value) {
    return "";
  }

  return parseSessionTimestamp(value);
}

function getLastSeenKey(presence) {
  const playerKey = String(
    presence.xuid || presence.gamertag || "",
  ).toLowerCase();
  return `last-seen:${playerKey}`;
}

function sendSvg(
  response,
  statusCode,
  body,
  maxAgeSeconds,
  { revalidateEveryRequest = false } = {},
) {
  const clientMaxAgeSeconds = getCacheHeaderSeconds(maxAgeSeconds);
  const sharedMaxAgeSeconds = getSharedCacheHeaderSeconds(clientMaxAgeSeconds);

  response.statusCode = statusCode;
  response.setHeader("Content-Type", "image/svg+xml; charset=utf-8");
  response.setHeader("Content-Length", Buffer.byteLength(body));

  if (revalidateEveryRequest) {
    const revalidateCacheControl =
      "no-cache, no-store, must-revalidate, max-age=0";
    response.setHeader("Cache-Control", revalidateCacheControl);
    response.setHeader("CDN-Cache-Control", revalidateCacheControl);
    response.setHeader("Vercel-CDN-Cache-Control", revalidateCacheControl);
    response.end(body);
    return;
  }

  const cacheControlParts = [
    "public",
    `max-age=${clientMaxAgeSeconds}`,
    `s-maxage=${sharedMaxAgeSeconds}`,
    `stale-while-revalidate=${SVG_STALE_REVALIDATE_SECONDS}`,
    `stale-if-error=${SVG_STALE_IF_ERROR_SECONDS}`,
  ];
  const sharedCacheControl = cacheControlParts.join(", ");

  response.setHeader("Cache-Control", sharedCacheControl);
  response.setHeader("CDN-Cache-Control", sharedCacheControl);
  response.setHeader("Vercel-CDN-Cache-Control", sharedCacheControl);
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

function getCacheHeaderSeconds(value) {
  const seconds = Number(value);
  return Number.isFinite(seconds) && seconds > 0
    ? Math.floor(seconds)
    : config.cacheTtlSeconds;
}

function getSharedCacheHeaderSeconds(value) {
  const seconds = getCacheHeaderSeconds(value);
  if (seconds <= PLAY_SESSION_RESPONSE_TTL_SECONDS) {
    return seconds;
  }

  return Math.max(SVG_SHARED_CACHE_MIN_SECONDS, seconds);
}

function formatError(error) {
  const code = error?.cause?.code || error?.code;
  const message = error?.message || String(error);
  return code ? `${message} (${code})` : message;
}
