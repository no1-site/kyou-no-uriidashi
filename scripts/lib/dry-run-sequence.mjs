export const scaleTargets = Object.freeze([20, 50, 100]);
export const cooldownMs = 65000;

// Stages are awaited serially, with no retries. Missing/failed metrics stop
// progression, even when a caller incorrectly marks a result successful.
export async function runDryRunSequence({ run, report = async () => {},
  now = () => performance.now(), sleep = ms => new Promise(done => setTimeout(done, ms)) }) {
  const results = [];
  const cooldownsMilliseconds = [];
  for (const target of scaleTargets) {
    if (results.length) {
      const started = now();
      while (now() - started < cooldownMs) await sleep(Math.min(30000, cooldownMs - (now() - started)));
      cooldownsMilliseconds.push(now() - started);
    }
    const result = await run(target);
    results.push(result);
    await report(result, target);
    if (!result.ok || result.metrics?.apiErrors !== 0 || result.metrics?.rateLimited !== 0 ||
        result.metrics?.budgetExceeded || result.yahooTiming?.rateLimited !== 0) break;
  }
  return { ok: results.length === scaleTargets.length && results.every(r => r.ok && r.metrics?.apiErrors === 0 &&
    r.metrics?.rateLimited === 0 && !r.metrics?.budgetExceeded && r.yahooTiming?.rateLimited === 0), results, cooldownsMilliseconds };
}
