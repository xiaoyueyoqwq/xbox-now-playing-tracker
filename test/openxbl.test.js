import assert from "node:assert/strict";
import test from "node:test";
import { OpenXblProvider } from "../src/openxbl.js";

test("missing XUID search uses exponential backoff capped by max delay", async () => {
  const delays = [];
  const provider = new OpenXblProvider({
    apiKey: "test-key",
    fetchImpl: async () => new Response(JSON.stringify({
      content: {
        profileUsers: [],
      },
    }), {
      status: 200,
      headers: {
        "content-type": "application/json",
      },
    }),
    delayImpl: async (ms) => {
      delays.push(ms);
    },
    xuidSearchAttempts: 7,
    retryBaseDelayMs: 1_000,
    retryMaxDelayMs: 10_000,
  });

  await assert.rejects(
    () => provider.getPresenceByGamertag("missing-user"),
    /OpenXBL did not return an XUID/,
  );

  assert.deepEqual(delays, [
    1_000,
    2_000,
    4_000,
    8_000,
    10_000,
    10_000,
  ]);
});

test("cached XUID path requests presence without gamertag search", async () => {
  const requestedPaths = [];
  const provider = new OpenXblProvider({
    apiKey: "test-key",
    fetchImpl: async (url) => {
      requestedPaths.push(new URL(url).pathname);
      return new Response(JSON.stringify({
        content: [{
          state: "Offline",
          devices: [],
        }],
      }), {
        status: 200,
        headers: {
          "content-type": "application/json",
        },
      });
    },
    delayImpl: async () => {},
  });

  const presence = await provider.getPresenceByXuid({
    gamertag: "KnownUser",
    xuid: "123456789",
    profile: {
      settings: [
        { id: "Gamertag", value: "KnownUser" },
        { id: "GameDisplayPicRaw", value: "https://example.com/avatar.png" },
      ],
    },
  });

  assert.deepEqual(requestedPaths, ["/api/v2/123456789/presence"]);
  assert.equal(presence.xuid, "123456789");
  assert.equal(presence.gamertag, "KnownUser");
  assert.equal(presence.avatarUrl, "https://example.com/avatar.png");
});
