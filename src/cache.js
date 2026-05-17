import { Redis } from "@upstash/redis";
import { createClient } from "redis";
import { logWarn } from "./logger.js";

export class MemoryPresenceCache {
  constructor({ ttlSeconds, staleTtlSeconds, now = () => Date.now() }) {
    this.ttlMs = ttlSeconds * 1000;
    this.staleTtlMs = staleTtlSeconds * 1000;
    this.now = now;
    this.entries = new Map();
    this.inflight = new Map();
  }

  async get(key) {
    const entry = this.entries.get(key);
    if (!entry) {
      return { status: "miss", value: null };
    }

    const ageMs = this.now() - entry.fetchedAt;
    if (ageMs <= this.ttlMs) {
      return { status: "fresh", value: entry.value };
    }

    if (ageMs <= this.staleTtlMs) {
      return { status: "stale", value: entry.value };
    }

    this.entries.delete(key);
    return { status: "miss", value: null };
  }

  async set(key, value) {
    this.entries.set(key, {
      fetchedAt: this.now(),
      value,
    });
  }

  async refresh(key, loader) {
    const existing = this.inflight.get(key);
    if (existing) {
      return existing;
    }

    const request = loader()
      .then(async (value) => {
        await this.set(key, value);
        return value;
      })
      .finally(() => {
        this.inflight.delete(key);
      });

    this.inflight.set(key, request);
    return request;
  }

  async getValue(key) {
    const entry = this.entries.get(key);
    if (entry?.expiresAt && entry.expiresAt <= this.now()) {
      this.entries.delete(key);
      return null;
    }

    return entry?.value ?? null;
  }

  async setValue(key, value, ttlSeconds = this.staleTtlMs / 1000) {
    this.entries.set(key, {
      fetchedAt: this.now(),
      expiresAt: this.now() + ttlSeconds * 1000,
      value,
    });
  }

  async close() {}
}

export class RedisPresenceCache {
  constructor({
    redisRestUrl,
    redisRestToken,
    ttlSeconds,
    staleTtlSeconds,
    namespace = "xbox-now-playing",
    now = () => Date.now(),
  }) {
    this.redis = new Redis({
      url: redisRestUrl,
      token: redisRestToken,
      enableTelemetry: false,
    });
    this.ttlMs = ttlSeconds * 1000;
    this.staleTtlSeconds = staleTtlSeconds;
    this.namespace = namespace;
    this.now = now;
    this.inflight = new Map();
  }

  async get(key) {
    const entry = await this.redis.get(this.cacheKey(key));
    if (!entry) {
      return { status: "miss", value: null };
    }

    const ageMs = this.now() - entry.fetchedAt;
    if (ageMs <= this.ttlMs) {
      return { status: "fresh", value: entry.value };
    }

    return { status: "stale", value: entry.value };
  }

  async set(key, value) {
    await this.redis.set(
      this.cacheKey(key),
      {
        fetchedAt: this.now(),
        value,
      },
      {
        ex: this.staleTtlSeconds,
      },
    );
  }

  async refresh(key, loader) {
    const existing = this.inflight.get(key);
    if (existing) {
      return existing;
    }

    const request = loader()
      .then(async (value) => {
        await this.set(key, value);
        return value;
      })
      .finally(() => {
        this.inflight.delete(key);
      });

    this.inflight.set(key, request);
    return request;
  }

  cacheKey(key) {
    return `${this.namespace}:presence:${key}`;
  }

  async getValue(key) {
    return this.redis.get(this.valueKey(key));
  }

  async setValue(key, value, ttlSeconds = this.staleTtlSeconds) {
    await this.redis.set(this.valueKey(key), value, { ex: ttlSeconds });
  }

  valueKey(key) {
    return `${this.namespace}:value:${key}`;
  }

  async close() {}
}

export class TcpRedisPresenceCache {
  constructor({
    redisUrl,
    ttlSeconds,
    staleTtlSeconds,
    namespace = "xbox-now-playing",
    now = () => Date.now(),
  }) {
    this.redisUrl = redisUrl;
    this.redis = this.createRedisClient();
    this.hasLoggedClientError = false;
    this.ready = null;
    this.ttlMs = ttlSeconds * 1000;
    this.staleTtlSeconds = staleTtlSeconds;
    this.namespace = namespace;
    this.now = now;
    this.inflight = new Map();
  }

  async get(key) {
    const raw = await this.runRedisCommand(() => this.redis.get(this.cacheKey(key)));
    if (!raw) {
      return { status: "miss", value: null };
    }

    const entry = JSON.parse(raw);
    const ageMs = this.now() - entry.fetchedAt;
    if (ageMs <= this.ttlMs) {
      return { status: "fresh", value: entry.value };
    }

    return { status: "stale", value: entry.value };
  }

  async set(key, value) {
    await this.runRedisCommand(() =>
      this.redis.set(
        this.cacheKey(key),
        JSON.stringify({
          fetchedAt: this.now(),
          value,
        }),
        {
          EX: this.staleTtlSeconds,
        },
      ),
    );
  }

  async refresh(key, loader) {
    const existing = this.inflight.get(key);
    if (existing) {
      return existing;
    }

    const request = loader()
      .then(async (value) => {
        await this.set(key, value);
        return value;
      })
      .finally(() => {
        this.inflight.delete(key);
      });

    this.inflight.set(key, request);
    return request;
  }

  cacheKey(key) {
    return `${this.namespace}:presence:${key}`;
  }

  async getValue(key) {
    const raw = await this.runRedisCommand(() => this.redis.get(this.valueKey(key)));
    return raw ? JSON.parse(raw) : null;
  }

  async setValue(key, value, ttlSeconds = this.staleTtlSeconds) {
    await this.runRedisCommand(() =>
      this.redis.set(this.valueKey(key), JSON.stringify(value), {
        EX: ttlSeconds,
      }),
    );
  }

  valueKey(key) {
    return `${this.namespace}:value:${key}`;
  }

  async connect() {
    if (!this.redis.isOpen && this.ready) {
      this.ready = null;
    }

    if (!this.ready) {
      this.ready = this.redis.connect().catch((error) => {
        this.ready = null;
        if (isClosedClientError(error)) {
          this.replaceRedisClient();
        }
        throw error;
      });
    }

    await this.ready;
  }

  async runRedisCommand(command, retry = true) {
    await this.connect();

    try {
      return await command();
    } catch (error) {
      if (!retry || !isClosedClientError(error)) {
        throw error;
      }

      logWarn("Redis TCP cache client was closed; reconnecting.");
      this.ready = null;
      this.replaceRedisClient();
      return this.runRedisCommand(command, false);
    }
  }

  logClientError(error) {
    if (this.hasLoggedClientError) {
      return;
    }

    this.hasLoggedClientError = true;
    logWarn(`Redis TCP cache error: ${formatError(error)}`);
  }

  createRedisClient() {
    const client = createClient({
      url: this.redisUrl,
      socket: {
        connectTimeout: 1000,
        reconnectStrategy: false,
      },
    });

    client.on("error", (error) => this.logClientError(error));
    return client;
  }

  replaceRedisClient() {
    this.redis.removeAllListeners();
    this.redis = this.createRedisClient();
  }

  async close() {
    if (!this.redis.isOpen) {
      return;
    }

    await this.redis.quit();
  }
}

export class ResilientPresenceCache {
  constructor({ primary, fallback }) {
    this.primary = primary;
    this.fallback = fallback;
    this.warnedOperations = new Set();
  }

  async get(key) {
    try {
      return await this.primary.get(key);
    } catch (error) {
      this.warnOnce("get", error);
      return this.fallback.get(key);
    }
  }

  async set(key, value) {
    await this.fallback.set(key, value);

    try {
      await this.primary.set(key, value);
    } catch (error) {
      this.warnOnce("set", error);
    }
  }

  async refresh(key, loader) {
    return this.fallback.refresh(key, async () => {
      const value = await loader();
      try {
        await this.primary.set(key, value);
      } catch (error) {
        this.warnOnce("refresh", error);
      }
      return value;
    });
  }

  async getValue(key) {
    try {
      return await this.primary.getValue(key);
    } catch (error) {
      this.warnOnce("getValue", error);
      return this.fallback.getValue(key);
    }
  }

  async setValue(key, value, ttlSeconds) {
    await this.fallback.setValue(key, value, ttlSeconds);

    try {
      await this.primary.setValue(key, value, ttlSeconds);
    } catch (error) {
      this.warnOnce("setValue", error);
    }
  }

  warnOnce(operation, error) {
    if (this.warnedOperations.has(operation)) {
      return;
    }

    this.warnedOperations.add(operation);
    logWarn(`Redis cache ${operation} failed; using in-memory cache fallback: ${formatError(error)}`);
  }

  async close() {
    await Promise.allSettled([
      this.primary.close?.(),
      this.fallback.close?.(),
    ]);
  }
}

export function createPresenceCache({
  redisUrl = "",
  redisRestUrl = "",
  redisRestToken = "",
  ttlSeconds,
  staleTtlSeconds,
}) {
  const redisConfig = resolveRedisConfig({ redisUrl, redisRestUrl, redisRestToken });
  if (redisConfig) {
    const fallback = new MemoryPresenceCache({
      ttlSeconds,
      staleTtlSeconds,
    });

    if (redisConfig.type === "tcp") {
      return new ResilientPresenceCache({
        primary: new TcpRedisPresenceCache({
          redisUrl: redisConfig.url,
          ttlSeconds,
          staleTtlSeconds,
        }),
        fallback,
      });
    }

    return new ResilientPresenceCache({
      primary: new RedisPresenceCache({
        redisRestUrl: redisConfig.url,
        redisRestToken: redisConfig.token,
        ttlSeconds,
        staleTtlSeconds,
      }),
      fallback,
    });
  }

  return new MemoryPresenceCache({
    ttlSeconds,
    staleTtlSeconds,
  });
}

function resolveRedisConfig({ redisUrl, redisRestUrl, redisRestToken }) {
  if (redisRestUrl && redisRestToken) {
    return {
      url: redisRestUrl,
      token: redisRestToken,
    };
  }

  if (!redisUrl) {
    return null;
  }

  const parsed = new URL(redisUrl);
  if (parsed.protocol === "redis:" || parsed.protocol === "rediss:") {
    return {
      type: "tcp",
      url: redisUrl,
    };
  }

  if (parsed.protocol !== "https:") {
    throw new Error("REDIS_URL must use https://, redis://, or rediss://.");
  }

  const token = decodeURIComponent(parsed.password || parsed.username);
  if (!token) {
    throw new Error("REDIS_URL is missing a Redis REST token.");
  }

  parsed.username = "";
  parsed.password = "";

  return {
    type: "rest",
    url: parsed.toString().replace(/\/$/, ""),
    token,
  };
}

function isClosedClientError(error) {
  return error?.name === "ClientClosedError"
    || String(error?.message || "").toLowerCase().includes("client is closed");
}

function formatError(error) {
  const code = error?.cause?.code || error?.code || error?.name;
  const message = error?.message || String(error);
  return code ? `${message} (${code})` : message;
}
