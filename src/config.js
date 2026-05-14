import fs from "node:fs";

loadDotEnv();

export function getConfig(env = process.env) {
  return {
    port: Number.parseInt(env.PORT ?? "3000", 10),
    openXblApiKey: env.OPENXBL_API_KEY ?? "",
    openXblContract: env.OPENXBL_CONTRACT ?? "",
    openXblBaseUrl: env.OPENXBL_BASE_URL ?? "https://xbl.io/api/v2",
    cacheTtlSeconds: Number.parseInt(env.CACHE_TTL_SECONDS ?? "300", 10),
    staleTtlSeconds: Number.parseInt(env.STALE_TTL_SECONDS ?? "86400", 10),
    defaultGamertag: env.DEFAULT_GAMERTAG ?? "",
  };
}

function loadDotEnv(path = ".env") {
  if (!fs.existsSync(path)) {
    return;
  }

  const contents = fs.readFileSync(path, "utf8");
  for (const line of contents.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex === -1) {
      continue;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    const value = trimmed.slice(separatorIndex + 1).trim();
    if (key && process.env[key] === undefined) {
      process.env[key] = stripQuotes(value);
    }
  }
}

function stripQuotes(value) {
  if (
    (value.startsWith('"') && value.endsWith('"'))
    || (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }

  return value;
}
