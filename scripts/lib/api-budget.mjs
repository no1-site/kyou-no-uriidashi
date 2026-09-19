import { readFileSync, writeFileSync } from "node:fs";

// Shared across sequential processes. Only counters, never URLs or API data.
export function createBudgetedFetch(market, environment = process.env, fetcher = globalThis.fetch, now = Date.now) {
  const path = environment.COLLECTION_METRICS_PATH;
  if (!path) return fetcher;
  return async (...args) => {
    const state = JSON.parse(readFileSync(path, "utf8"));
    if (now() + 16000 >= state.deadline || state[market] >= state.limits[market]) {
      state.budgetExceeded = true;
      writeFileSync(path, JSON.stringify(state));
      throw Object.assign(new Error("collection_budget_exceeded"), { fatal: true });
    }
    state[market]++;
    writeFileSync(path, JSON.stringify(state));
    try {
      const response = await fetcher(...args);
      if (!response.ok && !(market === "rakuten" && response.status === 404)) {
        state.apiErrors++;
        if (response.status === 429) state.rateLimited++;
        writeFileSync(path, JSON.stringify(state));
      }
      return response;
    } catch (error) {
      state.apiErrors++;
      writeFileSync(path, JSON.stringify(state));
      throw error;
    }
  };
}

export function remainingStageMilliseconds(environment) {
  const deadline = Number(environment.COLLECTION_DEADLINE);
  return Number.isFinite(deadline) && deadline > 0 ? Math.max(1, deadline - Date.now()) : undefined;
}

export function recordResponseError(environment = process.env) {
  if (!environment.COLLECTION_METRICS_PATH) return;
  const state = JSON.parse(readFileSync(environment.COLLECTION_METRICS_PATH, "utf8"));
  state.apiErrors++;
  writeFileSync(environment.COLLECTION_METRICS_PATH, JSON.stringify(state));
}
