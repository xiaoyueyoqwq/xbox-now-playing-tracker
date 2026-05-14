export class PresenceCache {
  constructor({ ttlSeconds, staleTtlSeconds, now = () => Date.now() }) {
    this.ttlMs = ttlSeconds * 1000;
    this.staleTtlMs = staleTtlSeconds * 1000;
    this.now = now;
    this.entries = new Map();
    this.inflight = new Map();
  }

  get(key) {
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

  set(key, value) {
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
      .then((value) => {
        this.set(key, value);
        return value;
      })
      .finally(() => {
        this.inflight.delete(key);
      });

    this.inflight.set(key, request);
    return request;
  }
}
