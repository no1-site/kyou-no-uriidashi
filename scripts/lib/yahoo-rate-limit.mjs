// The v3 application limit is 30 requests/minute. A 2200ms minimum allows
// at most 28 starts in any 60-second window for this serialized process.
export const minimumYahooIntervalMs = 2200;
export function yahooInterval(value) {
  const interval = value === undefined || value === "" ? minimumYahooIntervalMs : Number(value);
  if (!Number.isSafeInteger(interval) || interval < minimumYahooIntervalMs || interval > 2147483647) {
    throw new Error("Yahoo request interval must be an integer of at least 2200ms.");
  }
  return interval;
}
export function retryAfterSeconds(value, now = Date.now()) {
  if (typeof value !== "string") return null;
  let seconds;
  if (/^\d{1,6}$/.test(value)) seconds = Number(value);
  else if (/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun), \d{2} (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{4} \d{2}:\d{2}:\d{2} GMT$/.test(value)) {
    seconds = Math.max(0, Math.ceil((Date.parse(value) - now) / 1000));
  }
  return Number.isFinite(seconds) && seconds >= 0 && seconds <= 604800 ? seconds : null;
}
export function createYahooTransport({ intervalMs = minimumYahooIntervalMs, fetcher = globalThis.fetch,
  now = () => performance.now(), sleep = ms => new Promise(done => setTimeout(done, ms)), report = () => {} } = {}) {
  const interval = yahooInterval(intervalMs);
  let busy = false, completed = null, first = null, last = null, minimum = null;
  const metrics = { requests: 0, rateLimited: 0, averageIntervalMs: null, minimumIntervalMs: null, elapsedSeconds: 0, retryAfterSeconds: null };
  return async (...args) => {
    if (busy) throw new Error("Parallel Yahoo requests are forbidden.");
    busy = true;
    try {
      // Recheck monotonic time after sleeping: early timer wakeups must not
      // shorten spacing. Wait after completion, so slow responses add margin.
      while (completed !== null && now() - completed < interval) await sleep(interval - (now() - completed));
      const start = now();
      if (last !== null) minimum = minimum === null ? start - last : Math.min(minimum, start - last);
      first ??= start;
      last = start;
      metrics.requests++;
      metrics.averageIntervalMs = metrics.requests > 1 ? (last - first) / (metrics.requests - 1) : null;
      metrics.minimumIntervalMs = minimum;
      try {
        const response = await fetcher(...args);
        if (response.status === 429) {
          metrics.rateLimited++;
          metrics.retryAfterSeconds = retryAfterSeconds(response.headers?.get("retry-after"));
        }
        return response;
      } finally {
        completed = now();
        metrics.elapsedSeconds = (completed - first) / 1000;
        report({ ...metrics });
      }
    } finally { busy = false; }
  };
}
