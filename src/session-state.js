export function shouldContinuePlaySession(session, now, { graceMs }) {
  if (!session) {
    return false;
  }

  const lastObservedAtMs = Date.parse(session.lastObservedAt);
  const nowMs = Date.parse(now);
  if (Number.isNaN(lastObservedAtMs) || Number.isNaN(nowMs)) {
    return false;
  }

  if (nowMs - lastObservedAtMs > graceMs) {
    return false;
  }

  if (!session.awayObservedAt) {
    return true;
  }

  const awayObservedAtMs = Date.parse(session.awayObservedAt);
  if (Number.isNaN(awayObservedAtMs)) {
    return false;
  }

  return nowMs - awayObservedAtMs <= graceMs;
}
