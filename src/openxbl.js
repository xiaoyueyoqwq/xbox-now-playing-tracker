const OPENXBL_BASE_URL = "https://xbl.io/api/v2";
const KNOWN_TITLE_NAMES = new Map([
  ["1794566092", "Minecraft Launcher"],
]);

export class OpenXblProvider {
  constructor({ apiKey, fetchImpl = fetch }) {
    this.apiKey = apiKey;
    this.fetch = fetchImpl;
  }

  async getPresenceByGamertag(gamertag) {
    if (!this.apiKey) {
      throw new Error("OPENXBL_API_KEY is not configured");
    }

    const profile = await this.searchGamertag(gamertag);
    const xuid = profile?.id;
    if (!xuid) {
      throw new Error(`OpenXBL did not return an XUID for gamertag "${gamertag}"`);
    }

    const presence = await this.requestJson(`/${encodeURIComponent(xuid)}/presence`);
    return normalizePresence({ gamertag, xuid, profile, presence });
  }

  async searchGamertag(gamertag) {
    const data = await this.requestJson(`/friends/search?gt=${encodeURIComponent(gamertag)}`);
    const users = Array.isArray(data?.content?.profileUsers)
      ? data.content.profileUsers
      : [];
    return users[0] ?? null;
  }

  async requestJson(path) {
    const response = await this.fetch(`${OPENXBL_BASE_URL}${path}`, {
      headers: {
        "Accept": "application/json",
        "X-Authorization": this.apiKey,
      },
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`OpenXBL request failed: ${response.status} ${body.slice(0, 180)}`);
    }

    return response.json();
  }
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

  const activeTitle = titles.find((title) => title.placement === "Full")
    ?? titles.find((title) => title.state === "Active")
    ?? titles[0]
    ?? null;

  const state = String(record.state ?? "").toLowerCase();
  const isOnline = state === "online" || Boolean(activeTitle);

  const titleId = activeTitle?.id ? String(activeTitle.id) : "";
  const titleName = activeTitle?.name || KNOWN_TITLE_NAMES.get(titleId) || "";

  return {
    provider: "openxbl",
    gamertag: settings.Gamertag || gamertag,
    xuid,
    avatarUrl: settings.GameDisplayPicRaw || "",
    isOnline,
    status: isOnline ? "Online" : "Offline",
    titleName,
    titleId,
    deviceType: activeTitle?.deviceType ?? "",
    fetchedAt: new Date().toISOString(),
  };
}
