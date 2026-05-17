import assert from "node:assert/strict";
import test from "node:test";
import {
  getImageCandidateCacheKey,
  getImageDataCacheKey,
  getImageDataUriCandidates,
  prioritizeImageCandidates,
} from "../src/image-candidates.js";

test("cover candidate list tries requested size before smaller fallbacks", () => {
  const url = "https://images-eds-ssl.xboxlive.com/image?url=avatar&format=png";
  const candidates = getImageDataUriCandidates(url, {
    purpose: "avatar",
    width: 256,
    height: 256,
  });

  assert.deepEqual(candidates, [
    "https://images-eds-ssl.xboxlive.com/image?url=avatar&format=png&w=256&h=256",
    "https://images-eds-ssl.xboxlive.com/image?url=avatar&format=png&w=192&h=192",
    "https://images-eds-ssl.xboxlive.com/image?url=avatar&format=png&w=128&h=128",
    url,
  ]);
});

test("cached successful candidate is tried first without dropping fallbacks", () => {
  const candidates = [
    "https://example.com/image?w=256&h=256",
    "https://example.com/image?w=192&h=192",
    "https://example.com/image?w=128&h=128",
    "https://example.com/image",
  ];
  const prioritized = prioritizeImageCandidates(
    candidates,
    "https://example.com/image?w=128&h=128",
  );

  assert.deepEqual(prioritized, [
    "https://example.com/image?w=128&h=128",
    "https://example.com/image?w=256&h=256",
    "https://example.com/image?w=192&h=192",
    "https://example.com/image",
  ]);
});

test("candidate cache key includes purpose and requested size", () => {
  const url = "https://example.com/image";
  const avatarKey = getImageCandidateCacheKey(url, {
    purpose: "avatar",
    width: 256,
    height: 256,
  });
  const coverKey = getImageCandidateCacheKey(url, {
    purpose: "cover",
    width: 256,
    height: 256,
  });
  const smallAvatarKey = getImageCandidateCacheKey(url, {
    purpose: "avatar",
    width: 128,
    height: 128,
  });

  assert.match(avatarKey, /^image-candidate:[a-f0-9]{32}$/);
  assert.notEqual(avatarKey, coverKey);
  assert.notEqual(avatarKey, smallAvatarKey);
});

test("data cache key is based on the final candidate URL", () => {
  const firstKey = getImageDataCacheKey("https://example.com/image?w=128&h=128");
  const secondKey = getImageDataCacheKey("https://example.com/image?w=256&h=256");

  assert.match(firstKey, /^image-data:[a-f0-9]{32}$/);
  assert.notEqual(firstKey, secondKey);
});
