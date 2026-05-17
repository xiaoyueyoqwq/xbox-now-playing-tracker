const SYSTEM_TITLE_NAMES = [
  "home",
  "xbox home",
  "dashboard",
  "settings",
  "xbox settings",
  "microsoft store",
  "store",
  "my games & apps",
  "guide",
];

const APP_TITLE_NAMES = [
  "xbox app",
  "spotify",
  "youtube",
  "netflix",
  "microsoft edge",
  "edge",
  "twitch",
  "discord",
  "disney+",
  "hulu",
  "prime video",
  "apple tv",
  "media player",
];

const KNOWN_GAME_TITLE_NAMES = [
  "helldivers 2",
  "helldivers™ 2",
  "halo infinite",
  "minecraft launcher",
];

export function classifyActivity({
  titleId,
  titleName,
  storeProductFamilyName,
  storeProductKind,
  storeSource,
}) {
  const normalizedName = normalizeActivityName(titleName);

  if (!normalizedName && !titleId) {
    return {
      activityKind: "system",
      activityConfidence: "high",
      activityReason: "online-without-title",
    };
  }

  if (matchesName(normalizedName, SYSTEM_TITLE_NAMES)) {
    return {
      activityKind: "system",
      activityConfidence: "high",
      activityReason: "known-system-title",
    };
  }

  if (matchesName(normalizedName, APP_TITLE_NAMES)) {
    return {
      activityKind: "app",
      activityConfidence: "high",
      activityReason: normalizedName === "xbox app" ? "known-xbox-app" : "known-app-title",
    };
  }

  if (
    isStoreGameFamily(storeProductFamilyName)
    || isStoreGameKind(storeProductKind)
    || isStoreGameSource(storeSource)
  ) {
    return {
      activityKind: "game",
      activityConfidence: "high",
      activityReason: "microsoft-store-games-metadata",
    };
  }

  if (matchesName(normalizedName, KNOWN_GAME_TITLE_NAMES)) {
    return {
      activityKind: "game",
      activityConfidence: "medium",
      activityReason: "known-game-title",
    };
  }

  return {
    activityKind: "unknown",
    activityConfidence: "low",
    activityReason: "unclassified-title",
  };
}

export function isGameActivity(presence) {
  return presence.activityKind === "game";
}

function matchesName(normalizedName, names) {
  return names.some((name) => normalizedName === normalizeActivityName(name));
}

function isStoreGameFamily(value) {
  return normalizeActivityName(value).includes("games");
}

function isStoreGameKind(value) {
  const normalized = normalizeActivityName(value);
  return normalized === "game" || normalized === "games";
}

function isStoreGameSource(value) {
  return [
    "microsoft-store-search",
    "microsoft-store-product-id",
  ].includes(String(value ?? ""));
}

function normalizeActivityName(value) {
  return String(value ?? "")
    .toLowerCase()
    .replaceAll(/[^\p{Letter}\p{Number}+&]+/gu, " ")
    .replaceAll(/\s+/g, " ")
    .trim();
}
