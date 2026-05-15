import { Redis } from "@upstash/redis";
import { createClient } from "redis";

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
}

export class TcpRedisPresenceCache {
  constructor({
    redisUrl,
    ttlSeconds,
    staleTtlSeconds,
    namespace = "xbox-now-playing",
    now = () => Date.now(),
  }) {
    this.redis = createClient({ url: redisUrl });
    this.ready = null;
    this.ttlMs = ttlSeconds * 1000;
    this.staleTtlSeconds = staleTtlSeconds;
    this.namespace = namespace;
    this.now = now;
    this.inflight = new Map();
  }

  async get(key) {
    await this.connect();
    const raw = await this.redis.get(this.cacheKey(key));
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
    await this.connect();
    await this.redis.set(
      this.cacheKey(key),
      JSON.stringify({
        fetchedAt: this.now(),
        value,
      }),
      {
        EX: this.staleTtlSeconds,
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

  async connect() {
    if (!this.ready) {
      this.ready = this.redis.connect();
    }

    await this.ready;
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
    if (redisConfig.type === "tcp") {
      return new TcpRedisPresenceCache({
        redisUrl: redisConfig.url,
        ttlSeconds,
        staleTtlSeconds,
      });
    }

    return new RedisPresenceCache({
      redisRestUrl: redisConfig.url,
      redisRestToken: redisConfig.token,
      ttlSeconds,
      staleTtlSeconds,
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
