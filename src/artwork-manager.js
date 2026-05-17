export const LOCAL_XBOX_LOGO_URL = "/img/Xbox_Logo_White.svg";
export const LOCAL_XBOX_BACKGROUND_URL = "/img/Xbox_bg.png";

export function applyArtworkPolicy(presence) {
  const policy = resolveArtworkPolicy(presence);
  const cover = selectCoverArtwork(presence, policy);
  const feature = selectFeatureArtwork(presence, policy);

  return {
    ...presence,
    artworkPolicy: policy.name,
    coverSource: cover.source,
    coverKind: cover.kind,
    coverImageUrl: cover.url,
    featureSource: feature.source,
    featureMode: feature.mode,
    featureImageUrl: feature.url,
    allowAvatarFallback: policy.allowAvatarFallback,
  };
}

export function resolveArtworkPolicy(presence) {
  if (isXboxAppActivity(presence)) {
    return {
      name: "xbox-app-local",
      allowAvatarFallback: false,
      coverPreference: ["local-xbox-logo"],
      featurePreference: ["local-xbox-bg"],
      featureMode: "compact",
    };
  }

  if (isActiveGame(presence)) {
    return {
      name: "active-game",
      allowAvatarFallback: false,
      coverPreference: ["title-art"],
      featurePreference: ["title-hero", "title-art", "local-xbox-bg"],
      featureMode: hasTitleArtwork(presence) ? "full" : "compact",
    };
  }

  if (isOfflineWithLastSeenArtwork(presence)) {
    return {
      name: "offline-last-seen",
      allowAvatarFallback: true,
      coverPreference: ["avatar"],
      featurePreference: ["last-seen-hero", "last-seen-art", "local-xbox-bg"],
      featureMode: "full",
    };
  }

  return {
    name: "non-game-activity",
    allowAvatarFallback: true,
    coverPreference: ["title-art", "avatar"],
    featurePreference: ["title-art", "local-xbox-bg"],
    featureMode: "compact",
  };
}

export function shouldEmbedAvatarArtwork(presence) {
  const resolved = applyArtworkPolicy(presence);
  return resolved.coverSource === "avatar" && Boolean(resolved.coverImageUrl);
}

function selectCoverArtwork(presence, policy) {
  for (const source of policy.coverPreference) {
    const url = getArtworkUrl(presence, source);
    if (url) {
      return {
        source,
        kind: getCoverKind(source),
        url,
      };
    }
  }

  return {
    source: "fallback",
    kind: "fallback",
    url: "",
  };
}

function selectFeatureArtwork(presence, policy) {
  for (const source of policy.featurePreference) {
    const url = getArtworkUrl(presence, source);
    if (url) {
      return {
        source,
        mode: policy.featureMode,
        url,
      };
    }
  }

  return {
    source: "fallback",
    mode: "compact",
    url: LOCAL_XBOX_BACKGROUND_URL,
  };
}

function getArtworkUrl(presence, source) {
  const urls = {
    "title-art": presence.titleArtUrl,
    "title-hero": presence.titleHeroUrl,
    "last-seen-art": presence.lastSeenTitleArtUrl,
    "last-seen-hero": presence.lastSeenTitleHeroUrl,
    "avatar": presence.avatarUrl,
    "local-xbox-logo": LOCAL_XBOX_LOGO_URL,
    "local-xbox-bg": LOCAL_XBOX_BACKGROUND_URL,
  };

  return urls[source] || "";
}

function getCoverKind(source) {
  if (source === "local-xbox-logo") {
    return "logo";
  }

  if (source === "avatar") {
    return "avatar";
  }

  return "image";
}

function isXboxAppActivity(presence) {
  return presence.activityReason === "known-xbox-app";
}

function isActiveGame(presence) {
  return presence.isOnline
    && presence.activityKind === "game"
    && Boolean(presence.titleName);
}

function hasTitleArtwork(presence) {
  return Boolean(presence.titleHeroUrl || presence.titleArtUrl);
}

function isOfflineWithLastSeenArtwork(presence) {
  return !presence.isOnline
    && Boolean(presence.lastSeenTitleHeroUrl || presence.lastSeenTitleArtUrl);
}
