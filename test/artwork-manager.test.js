import assert from "node:assert/strict";
import test from "node:test";
import {
  applyArtworkPolicy,
  LOCAL_XBOX_BACKGROUND_URL,
  LOCAL_XBOX_LOGO_URL,
  shouldEmbedAvatarArtwork,
  shouldRefreshArtworkPolicy,
} from "../src/artwork-manager.js";

test("active games use title cover and full hero art", () => {
  const presence = applyArtworkPolicy({
    isOnline: true,
    activityKind: "game",
    activityReason: "microsoft-store-games-metadata",
    titleName: "Halo Infinite",
    titleArtUrl: "https://example.com/cover.jpg",
    titleHeroUrl: "https://example.com/hero.jpg",
    avatarUrl: "https://example.com/avatar.png",
  });

  assert.equal(presence.artworkPolicy, "active-game");
  assert.equal(presence.coverSource, "title-art");
  assert.equal(presence.coverImageUrl, "https://example.com/cover.jpg");
  assert.equal(presence.featureSource, "title-hero");
  assert.equal(presence.featureImageUrl, "https://example.com/hero.jpg");
  assert.equal(presence.featureMode, "full");
  assert.equal(shouldEmbedAvatarArtwork(presence), false);
});

test("active games without hero art use title art as full feature fallback", () => {
  const presence = applyArtworkPolicy({
    isOnline: true,
    activityKind: "game",
    activityReason: "microsoft-store-games-metadata",
    titleName: "Indie Game",
    titleArtUrl: "https://example.com/cover.jpg",
    titleHeroUrl: "",
  });

  assert.equal(presence.artworkPolicy, "active-game");
  assert.equal(presence.coverSource, "title-art");
  assert.equal(presence.featureSource, "title-art");
  assert.equal(presence.featureImageUrl, "https://example.com/cover.jpg");
  assert.equal(presence.featureMode, "full");
});

test("Xbox App always uses local brand artwork and skips avatar fallback", () => {
  const presence = applyArtworkPolicy({
    isOnline: true,
    activityKind: "app",
    activityReason: "known-xbox-app",
    titleName: "Xbox App",
    titleArtUrl: "",
    titleHeroUrl: "",
    avatarUrl: "https://example.com/avatar.png",
  });

  assert.equal(presence.artworkPolicy, "xbox-app-local");
  assert.equal(presence.coverSource, "local-xbox-logo");
  assert.equal(presence.coverKind, "logo");
  assert.equal(presence.coverImageUrl, LOCAL_XBOX_LOGO_URL);
  assert.equal(presence.featureSource, "local-xbox-bg");
  assert.equal(presence.featureImageUrl, LOCAL_XBOX_BACKGROUND_URL);
  assert.equal(presence.featureMode, "compact");
  assert.equal(shouldEmbedAvatarArtwork(presence), false);
});

test("non-game states use avatar only when no title art exists", () => {
  const presence = applyArtworkPolicy({
    isOnline: true,
    activityKind: "system",
    activityReason: "online-without-title",
    titleName: "",
    titleArtUrl: "",
    avatarUrl: "https://example.com/avatar.png",
  });

  assert.equal(presence.artworkPolicy, "non-game-activity");
  assert.equal(presence.coverSource, "avatar");
  assert.equal(presence.coverKind, "avatar");
  assert.equal(presence.coverImageUrl, "https://example.com/avatar.png");
  assert.equal(presence.featureSource, "local-xbox-bg");
  assert.equal(presence.featureMode, "compact");
  assert.equal(shouldEmbedAvatarArtwork(presence), true);
});

test("offline cards with last-seen artwork use full last-seen feature art", () => {
  const presence = applyArtworkPolicy({
    isOnline: false,
    activityKind: "system",
    activityReason: "offline",
    avatarUrl: "https://example.com/avatar.png",
    lastSeenTitleArtUrl: "https://example.com/last-cover.jpg",
    lastSeenTitleHeroUrl: "https://example.com/last-hero.jpg",
  });

  assert.equal(presence.artworkPolicy, "offline-last-seen");
  assert.equal(presence.coverSource, "avatar");
  assert.equal(presence.featureSource, "last-seen-hero");
  assert.equal(presence.featureImageUrl, "https://example.com/last-hero.jpg");
  assert.equal(presence.featureMode, "full");
});

test("offline cached fallback artwork refreshes after last-seen artwork is attached", () => {
  const stalePresence = {
    isOnline: false,
    activityKind: "system",
    activityReason: "offline",
    avatarUrl: "https://example.com/avatar.png",
    artworkPolicy: "non-game-activity",
    coverSource: "avatar",
    coverKind: "avatar",
    coverImageUrl: "https://example.com/avatar.png",
    featureSource: "local-xbox-bg",
    featureMode: "compact",
    featureImageUrl: LOCAL_XBOX_BACKGROUND_URL,
    lastSeenTitleName: "Halo Infinite",
    lastSeenTitleArtUrl: "https://example.com/last-cover.jpg",
    lastSeenTitleHeroUrl: "https://example.com/last-hero.jpg",
  };

  assert.equal(shouldRefreshArtworkPolicy(stalePresence), true);

  const refreshedPresence = applyArtworkPolicy(stalePresence);
  assert.equal(refreshedPresence.artworkPolicy, "offline-last-seen");
  assert.equal(refreshedPresence.featureSource, "last-seen-hero");
  assert.equal(refreshedPresence.featureImageUrl, "https://example.com/last-hero.jpg");
  assert.equal(refreshedPresence.featureMode, "full");
});

test("unknown title art stays compact and does not fall through to avatar", () => {
  const presence = applyArtworkPolicy({
    isOnline: true,
    activityKind: "unknown",
    activityReason: "unclassified-title",
    titleName: "Xbox.com",
    titleArtUrl: "https://example.com/title.jpg",
    avatarUrl: "https://example.com/avatar.png",
  });

  assert.equal(presence.artworkPolicy, "non-game-activity");
  assert.equal(presence.coverSource, "title-art");
  assert.equal(presence.coverImageUrl, "https://example.com/title.jpg");
  assert.equal(presence.featureSource, "title-art");
  assert.equal(presence.featureImageUrl, "https://example.com/title.jpg");
  assert.equal(presence.featureMode, "compact");
  assert.equal(shouldEmbedAvatarArtwork(presence), false);
});

test("non-game states with no artwork keep local background and fallback cover", () => {
  const presence = applyArtworkPolicy({
    isOnline: true,
    activityKind: "system",
    activityReason: "online-without-title",
    titleName: "",
    titleArtUrl: "",
    avatarUrl: "",
  });

  assert.equal(presence.artworkPolicy, "non-game-activity");
  assert.equal(presence.coverSource, "fallback");
  assert.equal(presence.coverImageUrl, "");
  assert.equal(presence.featureSource, "local-xbox-bg");
  assert.equal(presence.featureImageUrl, LOCAL_XBOX_BACKGROUND_URL);
  assert.equal(presence.featureMode, "compact");
});
