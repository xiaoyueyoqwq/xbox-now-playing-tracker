const STORE_AUTOSUGGEST_URL = "https://displaycatalog.mp.microsoft.com/v7.0/productFamilies/autosuggest";

const KNOWN_TITLE_ART = new Map([
  ["1794566092", {
    titleName: "Minecraft Launcher",
    imageUrl: "https://store-images.s-microsoft.com/image/apps.31326.13510798885735219.3dfb176a-2479-4b17-ab6e-418794f3932d.a8aae002-3be2-4cd4-9ca3-b3e2e7e14882",
    source: "known",
  }],
]);

const artCache = new Map();

export async function getTitleArt({ titleId, titleName, fetchImpl = fetch }) {
  const normalizedTitleId = String(titleId ?? "");
  const normalizedTitleName = normalizeTitleName(titleName);
  const cacheKey = normalizedTitleId || normalizedTitleName.toLowerCase();

  if (!cacheKey) {
    return null;
  }

  if (artCache.has(cacheKey)) {
    return artCache.get(cacheKey);
  }

  const knownArt = KNOWN_TITLE_ART.get(normalizedTitleId);
  if (knownArt) {
    artCache.set(cacheKey, knownArt);
    return knownArt;
  }

  if (!normalizedTitleName) {
    artCache.set(cacheKey, null);
    return null;
  }

  const storeArt = await searchMicrosoftStore(normalizedTitleName, fetchImpl);
  artCache.set(cacheKey, storeArt);
  return storeArt;
}

async function searchMicrosoftStore(titleName, fetchImpl) {
  const url = new URL(STORE_AUTOSUGGEST_URL);
  url.searchParams.set("languages", "en-US");
  url.searchParams.set("market", "US");
  url.searchParams.set("productFamilyNames", "Games");
  url.searchParams.set("query", titleName);
  url.searchParams.set("topProducts", "5");

  const response = await fetchImpl(url, {
    headers: {
      "Accept": "application/json",
      "User-Agent": "XboxNowPlayingTracker/0.1",
    },
  });

  if (!response.ok) {
    throw new Error(`Microsoft Store search failed: ${response.status}`);
  }

  const data = await response.json();
  const products = (data.Results ?? []).flatMap((result) => result.Products ?? []);
  const product = selectBestProduct(products, titleName);
  if (!product?.Icon) {
    return null;
  }

  return {
    titleName: product.Title ?? titleName,
    productId: product.ProductId ?? "",
    imageUrl: normalizeImageUrl(product.Icon),
    source: "microsoft-store",
  };
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
