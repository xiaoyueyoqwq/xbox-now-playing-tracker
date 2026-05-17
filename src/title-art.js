import { logInfo } from "./logger.js";

const STORE_AUTOSUGGEST_URL = "https://displaycatalog.mp.microsoft.com/v7.0/productFamilies/autosuggest";
const STORE_LOOKUP_URL = "https://displaycatalog.mp.microsoft.com/v7.0/products/lookup";
const STORE_FETCH_ATTEMPTS = 2;
const STORE_FETCH_TIMEOUT_MS = 5000;

const artCache = new Map();

export async function getTitleArt({ titleId, titleName, fetchImpl = fetch }) {
  const startedAt = Date.now();
  const normalizedTitleId = String(titleId ?? "");
  const normalizedTitleName = normalizeTitleName(titleName);
  const cacheKey = normalizedTitleId || normalizedTitleName.toLowerCase();

  if (!cacheKey) {
    return null;
  }

  if (artCache.has(cacheKey)) {
    const cached = artCache.get(cacheKey);
    logTitleArtResult("memory", cacheKey, cached, startedAt);
    return cached;
  }

  if (normalizedTitleId) {
    const titleIdArt = await lookupMicrosoftStoreByTitleId(normalizedTitleId, fetchImpl);
    if (titleIdArt) {
      artCache.set(cacheKey, titleIdArt);
      logTitleArtResult("title-id", cacheKey, titleIdArt, startedAt);
      return titleIdArt;
    }
  }

  if (normalizedTitleName) {
    const storeArt = await searchMicrosoftStore(normalizedTitleName, fetchImpl);
    if (storeArt) {
      artCache.set(cacheKey, storeArt);
      logTitleArtResult("search", cacheKey, storeArt, startedAt);
      return storeArt;
    }
  }

  artCache.set(cacheKey, null);
  logTitleArtResult("miss", cacheKey, null, startedAt);
  return null;
}

async function lookupMicrosoftStoreByTitleId(titleId, fetchImpl) {
  const url = new URL(STORE_LOOKUP_URL);
  url.searchParams.set("market", "US");
  url.searchParams.set("languages", "en-US");
  url.searchParams.set("value", titleId);
  url.searchParams.set("alternateId", "XboxTitleId");
  url.searchParams.set("fieldsTemplate", "browse");

  const response = await fetchMicrosoftStore(url, fetchImpl);
  const product = response.Products?.[0] ?? null;
  return product ? getArtFromProduct(product, "microsoft-store-title-id") : null;
}

async function searchMicrosoftStore(titleName, fetchImpl) {
  const url = new URL(STORE_AUTOSUGGEST_URL);
  url.searchParams.set("languages", "en-US");
  url.searchParams.set("market", "US");
  url.searchParams.set("productFamilyNames", "Games");
  url.searchParams.set("query", titleName);
  url.searchParams.set("topProducts", "5");

  const data = await fetchMicrosoftStore(url, fetchImpl);
  const products = (data.Results ?? []).flatMap((result) => result.Products ?? []);
  const product = selectBestProduct(products, titleName);
  if (!product) {
    return null;
  }

  if (product.ProductId) {
    const productArt = await lookupMicrosoftStoreByProductId(product.ProductId, fetchImpl);
    if (productArt) {
      return productArt;
    }
  }

  return getArtFromAutosuggestProduct(product, titleName);
}

async function lookupMicrosoftStoreByProductId(productId, fetchImpl) {
  const url = new URL(`${STORE_LOOKUP_URL.replace("/lookup", "")}/${encodeURIComponent(productId)}`);
  url.searchParams.set("market", "US");
  url.searchParams.set("languages", "en-US");
  url.searchParams.set("fieldsTemplate", "browse");

  const response = await fetchMicrosoftStore(url, fetchImpl);
  const product = response.Product ?? response.Products?.[0] ?? null;
  return product ? getArtFromProduct(product, "microsoft-store-product-id") : null;
}

async function fetchMicrosoftStore(url, fetchImpl) {
  let lastError = null;

  for (let attempt = 1; attempt <= STORE_FETCH_ATTEMPTS; attempt += 1) {
    try {
      return await fetchMicrosoftStoreOnce(url, fetchImpl);
    } catch (error) {
      lastError = error;
      if (!isRetryableStoreError(error) || attempt === STORE_FETCH_ATTEMPTS) {
        throw error;
      }

      await delay(120 * attempt);
    }
  }

  throw lastError;
}

async function fetchMicrosoftStoreOnce(url, fetchImpl) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), STORE_FETCH_TIMEOUT_MS);

  const response = await fetchImpl(url, {
    signal: controller.signal,
    headers: {
      "Accept": "application/json",
      "User-Agent": "XboxNowPlayingTracker/0.1",
    },
  }).finally(() => clearTimeout(timeout));

  if (!response.ok) {
    const error = new Error(`Microsoft Store request failed: ${response.status}`);
    error.status = response.status;
    throw error;
  }

  return response.json();
}

function isRetryableStoreError(error) {
  if (error?.name === "AbortError") {
    return true;
  }

  if (error?.status) {
    return error.status >= 400;
  }

  return true;
}

function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function getArtFromProduct(product, source) {
  const localized = product.LocalizedProperties?.[0];
  const images = localized?.Images ?? [];
  const icon = selectBestImage(images, [
    "BoxArt",
    "FeaturePromotionalSquareArt",
    "Tile",
    "Logo",
    "Poster",
    "BrandedKeyArt",
  ], { targetRatio: 1 });
  const hero = selectBestImage(images, ["SuperHeroArt", "TitledHeroArt", "Screenshot", "BoxArt"], { targetRatio: 16 / 9 });

  if (!icon?.Uri && !hero?.Uri) {
    return null;
  }

  return {
    titleName: localized?.ProductTitle ?? "",
    productId: product.ProductId ?? "",
    productFamilyName: product.ProductFamilyName ?? "",
    productKind: product.ProductKind ?? "",
    imageUrl: normalizeImageUrl(icon?.Uri || hero?.Uri),
    heroUrl: normalizeImageUrl(hero?.Uri || icon?.Uri),
    source,
  };
}

function getArtFromAutosuggestProduct(product, titleName) {
  if (!product?.Icon) {
    return null;
  }

  return {
    titleName: product.Title ?? titleName,
    productId: product.ProductId ?? "",
    productFamilyName: "Games",
    productKind: "",
    imageUrl: normalizeImageUrl(product.Icon),
    heroUrl: "",
    source: "microsoft-store-search",
  };
}

function selectBestImage(images, purposes, { targetRatio }) {
  return images
    .filter((image) => purposes.includes(image.ImagePurpose))
    .map((image) => ({
      image,
      score: getImageScore(image, purposes, targetRatio),
    }))
    .sort((left, right) => right.score - left.score)[0]?.image ?? null;
}

function getImageScore(image, purposes, targetRatio) {
  const purposeScore = (purposes.length - purposes.indexOf(image.ImagePurpose)) * 1000;
  const width = Number(image.Width || 0);
  const height = Number(image.Height || 0);
  const ratio = width > 0 && height > 0 ? width / height : targetRatio;
  const ratioPenalty = Math.abs(ratio - targetRatio) * 100;
  const sizeScore = Math.min(width, 3840) / 100;
  const minDimension = Math.min(width, height);
  const lowResolutionPenalty = minDimension > 0 && minDimension < 256 ? 8000 : 0;
  return purposeScore + sizeScore - ratioPenalty - lowResolutionPenalty;
}

function selectBestProduct(products, titleName) {
  const normalizedTitle = normalizeForMatch(titleName);
  return products.find((product) => normalizeForMatch(product.Title) === normalizedTitle)
    ?? products.find((product) => normalizeForMatch(product.Title).includes(normalizedTitle))
    ?? products[0]
    ?? null;
}

function normalizeTitleName(value) {
  return String(value ?? "").trim();
}

function normalizeForMatch(value) {
  return normalizeTitleName(value)
    .toLowerCase()
    .replaceAll(/[^\p{Letter}\p{Number}]+/gu, " ")
    .trim();
}

function normalizeImageUrl(value) {
  const url = String(value ?? "");
  if (url.startsWith("//")) {
    return `https:${url}`;
  }

  return url;
}

function logTitleArtResult(stage, cacheKey, art, startedAt) {
  const elapsedMs = Date.now() - startedAt;
  logInfo([
    "[art]",
    `stage=${stage}`,
    `key=${cacheKey}`,
    `ms=${elapsedMs}`,
    art?.source ? `source=${art.source}` : "",
    art?.imageUrl ? "icon=yes" : "icon=no",
    art?.heroUrl ? "hero=yes" : "hero=no",
  ].filter(Boolean).join(" "));
}
