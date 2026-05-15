const STORE_AUTOSUGGEST_URL = "https://displaycatalog.mp.microsoft.com/v7.0/productFamilies/autosuggest";
const STORE_LOOKUP_URL = "https://displaycatalog.mp.microsoft.com/v7.0/products/lookup";

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

  if (normalizedTitleId) {
    const titleIdArt = await lookupMicrosoftStoreByTitleId(normalizedTitleId, fetchImpl);
    if (titleIdArt) {
      artCache.set(cacheKey, titleIdArt);
      return titleIdArt;
    }
  }

  if (normalizedTitleName) {
    const storeArt = await searchMicrosoftStore(normalizedTitleName, fetchImpl);
    if (storeArt) {
      artCache.set(cacheKey, storeArt);
      return storeArt;
    }
  }

  artCache.set(cacheKey, null);
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

  return getArtFromAutosuggestProduct(product, titleName);
}

async function fetchMicrosoftStore(url, fetchImpl) {
  const response = await fetchImpl(url, {
    headers: {
      "Accept": "application/json",
      "User-Agent": "XboxNowPlayingTracker/0.1",
    },
  });

  if (!response.ok) {
    throw new Error(`Microsoft Store request failed: ${response.status}`);
  }

  return response.json();
}

function getArtFromProduct(product, source) {
  const localized = product.LocalizedProperties?.[0];
  const images = localized?.Images ?? [];
  const icon = selectImage(images, ["Logo", "BoxArt"]);
  const hero = selectImage(images, ["TitledHeroArt", "SuperHeroArt", "Screenshot", "BoxArt"]);

  if (!icon?.Uri && !hero?.Uri) {
    return null;
  }

  return {
    titleName: localized?.ProductTitle ?? "",
    productId: product.ProductId ?? "",
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
    imageUrl: normalizeImageUrl(product.Icon),
    heroUrl: "",
    source: "microsoft-store-search",
  };
}

function selectImage(images, purposes) {
  return purposes
    .map((purpose) => images.find((image) => image.ImagePurpose === purpose))
    .find(Boolean) ?? null;
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
