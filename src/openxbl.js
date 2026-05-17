import { classifyActivity } from "./activity-classifier.js";
import { logInfo, logWarn } from "./logger.js";

const OPENXBL_REQUEST_ATTEMPTS = 4;
const OPENXBL_RETRY_DELAY_MS = 250;

const KNOWN_TITLE_NAMES = new Map([
  ["1794566092", "Minecraft Launcher"],
]);

const DEVICE_PLATFORM_LABELS = new Map([
  ["android", "Android"],
  ["appletv", "Apple TV"],
  ["ios", "iOS"],
  ["mcapensis", "Xbox One"],
  ["molive", "Windows"],
  ["nintendo", "Nintendo"],
  ["pc", "PC"],
  ["playstation", "PlayStation"],
  ["scarlett", "Xbox Series X|S"],
  ["web", "Xbox.com"],
  ["win32", "PC Xbox"],
  ["windows8", "Windows"],
  ["windowsonecore", "Windows"],
  ["windowsonecoremobile", "Windows Mobile"],
  ["windowsphone", "Windows Phone"],
  ["windowsphone7", "Windows Phone"],
  ["xbox360", "Xbox 360"],
  ["xboxone", "Xbox One"],
]);

export class OpenXblProvider {
  constructor({
    apiKey,
    contract = "",
    baseUrl = "https://xbl.io/api/v2",
    fetchImpl = fetch,
  }) {
    this.apiKey = apiKey;
    this.contract = contract;
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.fetch = fetchImpl;
  }

  async getPresenceByGamertag(gamertag) {
    if (!this.apiKey) {
      throw new Error("OPENXBL_API_KEY is not configured");
    }

    const profile = await this.searchGamertagWithRetry(gamertag);
    const xuid = profile?.id;
    if (!xuid) {
      throw new Error(`OpenXBL did not return an XUID for gamertag "${gamertag}"`);
    }

    const presence = await this.requestJsonWithRetry(`/${encodeURIComponent(xuid)}/presence`);
    return normalizePresence({ gamertag, xuid, profile, presence });
  }

  async searchGamertagWithRetry(gamertag) {
    let lastProfile = null;

    for (let attempt = 1; attempt <= OPENXBL_REQUEST_ATTEMPTS; attempt += 1) {
      const profile = await this.searchGamertag(gamertag);
      if (profile?.id) {
        return profile;
      }

      lastProfile = profile;
      if (attempt < OPENXBL_REQUEST_ATTEMPTS) {
        logWarn(`[openxbl] missing xuid for "${gamertag}", retry ${attempt}/${OPENXBL_REQUEST_ATTEMPTS - 1}`);
        await delay(OPENXBL_RETRY_DELAY_MS * attempt);
      }
    }

    return lastProfile;
  }

  async searchGamertag(gamertag) {
    const data = await this.requestJson(`/friends/search?gt=${encodeURIComponent(gamertag)}`);
    const users = Array.isArray(data?.content?.profileUsers)
      ? data.content.profileUsers
      : [];
    return users[0] ?? null;
  }

  async requestJsonWithRetry(path) {
    let lastError = null;

    for (let attempt = 1; attempt <= OPENXBL_REQUEST_ATTEMPTS; attempt += 1) {
      try {
        return await this.requestJson(path);
      } catch (error) {
        lastError = error;
        if (!isRetryableOpenXblError(error) || attempt === OPENXBL_REQUEST_ATTEMPTS) {
          throw error;
        }

        logWarn(`[openxbl] request retry ${attempt}/${OPENXBL_REQUEST_ATTEMPTS - 1} ${path}: ${formatError(error)}`);
        await delay(OPENXBL_RETRY_DELAY_MS * attempt);
      }
    }

    throw lastError;
  }

  async requestJson(path) {
    const headers = {
      "Accept": "application/json",
      "Accept-Language": "en-US,en;q=0.9",
      "User-Agent": "Mozilla/5.0 (compatible; XboxNowPlayingTracker/0.1; +https://github.com/xiaoyueyoqwq/xbox-now-playing-tracker)",
      "X-Authorization": this.apiKey,
    };

    if (this.contract) {
      headers["X-Contract"] = this.contract;
    }

    const response = await this.fetch(`${this.baseUrl}${path}`, { headers });

    if (!response.ok) {
      const body = await response.text();
      const ray = response.headers.get("cf-ray");
      const contentType = response.headers.get("content-type");
      const error = new Error([
        `OpenXBL request failed: ${response.status}`,
        ray ? `cf-ray=${ray}` : "",
        contentType ? `content-type=${contentType}` : "",
        body.slice(0, 180),
      ].filter(Boolean).join(" "));
      error.status = response.status;
      throw error;
    }

    return response.json();
  }
}

function isRetryableOpenXblError(error) {
  if (error?.status) {
    return error.status >= 500 || error.status === 408 || error.status === 429;
  }

  return true;
}

function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function formatError(error) {
  const code = error?.cause?.code || error?.code;
  const message = error?.message || String(error);
  return code ? `${message} (${code})` : message;
}

export function normalizePresence({ gamertag, xuid, profile, presence }) {
  const settings = Object.fromEntries(
    (profile?.settings ?? []).map((setting) => [setting.id, setting.value]),
  );

  const payload = presence?.content ?? presence;
  const records = Array.isArray(payload) ? payload : [payload];
  const record = records.find(Boolean) ?? {};
  const devices = Array.isArray(record.devices) ? record.devices : [];
  const titles = devices.flatMap((device) => (
    Array.isArray(device.titles)
      ? device.titles.map((title) => ({ ...title, deviceType: device.type }))
      : []
  ));

  const activeTitle = selectActiveTitle(titles);
  logTitleSelection(titles, activeTitle);

  const state = String(record.state ?? "").toLowerCase();
  const isOnline = state === "online" || Boolean(activeTitle);

  const titleId = activeTitle?.id ? String(activeTitle.id) : "";
  const titleName = activeTitle?.name || KNOWN_TITLE_NAMES.get(titleId) || "";
  const deviceType = activeTitle?.deviceType ?? "";

  return {
    provider: "openxbl",
    gamertag: settings.Gamertag || gamertag,
    xuid,
    avatarUrl: settings.GameDisplayPicRaw || "",
    isOnline,
    status: isOnline ? "Online" : "Offline",
    titleName,
    titleId,
    titleState: activeTitle?.state || "",
    titlePlacement: activeTitle?.placement || "",
    deviceType,
    platformName: getPlatformName(deviceType),
    fetchedAt: new Date().toISOString(),
  };
}

function selectActiveTitle(titles) {
  return titles
    .map((title, index) => ({
      title,
      index,
      score: getTitleScore(title),
    }))
    .sort((left, right) => (
      right.score - left.score || left.index - right.index
    ))[0]?.title ?? null;
}

function getTitleScore(title) {
  const titleId = title?.id ? String(title.id) : "";
  const titleName = title?.name || KNOWN_TITLE_NAMES.get(titleId) || "";
  const classification = classifyActivity({ titleId, titleName });
  const isFull = title?.placement === "Full";
  const isActive = title?.state === "Active";

  const activeScore = isFull ? 110 : (isActive ? 100 : 0);
  const kindScores = {
    game: 40,
    unknown: 30,
    app: 10,
    system: 0,
  };

  return activeScore + (kindScores[classification.activityKind] ?? 0);
}

function logTitleSelection(titles, activeTitle) {
  if (titles.length <= 1) {
    return;
  }

  const selectedId = activeTitle?.id ? String(activeTitle.id) : "";
  const summary = titles.map((title) => {
    const titleId = title?.id ? String(title.id) : "";
    const titleName = title?.name || KNOWN_TITLE_NAMES.get(titleId) || "";
    const classification = classifyActivity({ titleId, titleName });
    return [
      titleId === selectedId ? "*" : "-",
      titleName || titleId || "untitled",
      `kind=${classification.activityKind}`,
      `device=${getPlatformName(title?.deviceType) || title?.deviceType || "unknown"}`,
      `placement=${title?.placement || "none"}`,
      `state=${title?.state || "none"}`,
      `score=${getTitleScore(title)}`,
    ].join(" ");
  });

  logInfo(`[openxbl] title selection ${summary.join(" | ")}`);
}

export function getPlatformName(deviceType) {
  const normalized = String(deviceType ?? "").trim();
  if (!normalized) {
    return "";
  }

  return DEVICE_PLATFORM_LABELS.get(normalized.toLowerCase()) || normalized;
}
