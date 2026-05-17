import { createHash } from "node:crypto";

export function getImageCandidateCacheKey(url, request) {
  const hash = createHash("sha256")
    .update(JSON.stringify([
      url || "",
      request?.purpose || "",
      request?.width || "",
      request?.height || "",
    ]))
    .digest("hex")
    .slice(0, 32);
  return `image-candidate:${hash}`;
}

export function getImageDataCacheKey(url) {
  const hash = createHash("sha256").update(url).digest("hex").slice(0, 32);
  return `image-data:${hash}`;
}

export function getImageDataUriCandidates(url, request) {
  if (!request) {
    return [url];
  }

  const sizes = getFallbackImageSizes(request);
  return [
    ...sizes.map((fallbackSize) => getSizedImageUrl(url, fallbackSize)),
    url,
  ];
}

export function prioritizeImageCandidates(candidates, cachedImageUrl) {
  if (!cachedImageUrl || !candidates.includes(cachedImageUrl)) {
    return candidates;
  }

  return [
    cachedImageUrl,
    ...candidates.filter((candidate) => candidate !== cachedImageUrl),
  ];
}

function getSizedImageUrl(url, { width, height }) {
  const imageUrl = new URL(url);
  imageUrl.searchParams.set("w", String(width));
  imageUrl.searchParams.set("h", String(height));
  return imageUrl.toString();
}

function getFallbackImageSizes({ width, height }) {
  const minDimension = Math.min(width, height);
  const maxDimension = Math.max(width, height);
  if (maxDimension >= 640) {
    return [
      { width, height },
      { width: 512, height: 288 },
      { width: 384, height: 216 },
    ];
  }

  if (minDimension >= 256) {
    return [
      { width, height },
      { width: 192, height: 192 },
      { width: 128, height: 128 },
    ];
  }

  return [{ width, height }];
}
