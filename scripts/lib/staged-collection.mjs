import { yahooInterval } from "./yahoo-rate-limit.mjs";
import { fileURLToPath } from "node:url";
import { validateTrackingConfig, validateCatalog, mergeConfirmedCatalog } from "./product-catalog.mjs";
import { copyFile, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { finalizeProducts, validatePublication } from "./publication.mjs";

// Shared by publication and dry-run. Every write is directed to the supplied
// staging directory; this module has no Git or live-file finalization capability.
export async function collectStagedProducts({ staging, historyPath, previous, environment, runStage }) {
  const yahooRequestInterval = yahooInterval(environment.YAHOO_REQUEST_INTERVAL_MS);
  const stagedProducts = join(staging, "products.json");
  const stagedHistory = join(staging, "price-history.json");
  try {
    const history = JSON.parse(await readFile(historyPath, "utf8"));
    if (!history?.products || typeof history.products !== "object" || Array.isArray(history.products)) throw new Error("Invalid existing price history.");
    await copyFile(historyPath, stagedHistory);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  let plan;
  const root = fileURLToPath(new URL("../../", import.meta.url));
  const config = await readFile(join(root, "config/tracking.json"), "utf8").then(JSON.parse).catch(error => {
    if (error.code === "ENOENT" && !environment.TARGET_PRODUCT_COUNT) return null;
    throw error;
  });
  if (config) validateTrackingConfig(config);
  if (config && (environment.TARGET_PRODUCT_COUNT || config.productionMode === "catalog")) {
    const target = Number(environment.TARGET_PRODUCT_COUNT || config.productionTarget);
    if (environment.TARGET_PRODUCT_COUNT && !config.dryRunTargets.includes(target)) throw new Error("Invalid dry-run target.");
    const categories = config.categories.map(c => c.category);
    let catalog = validateCatalog(JSON.parse(await readFile(join(root, "data/product-catalog.json"), "utf8")), categories);
    const history = await readFile(stagedHistory, "utf8").then(JSON.parse).catch(e => { if (e.code === "ENOENT") return {}; throw e; });
    if (history.confirmed_catalog) {
      validateCatalog(history.confirmed_catalog, categories);
      const known = new Set(catalog.products.map(p => p.jan));
      catalog = { version: 1, products: [...catalog.products, ...history.confirmed_catalog.products.filter(p => !known.has(p.jan))] };
    }
    catalog = mergeConfirmedCatalog(catalog, previous, categories);
    plan = { config, catalog, target };
    await writeFile(join(staging, "tracking-plan.json"), JSON.stringify(plan));
    await writeFile(join(staging, "metrics.json"), JSON.stringify({ target, rakuten: 0, yahoo: 0, attempted: 0, apiErrors: 0, rateLimited: 0,
      deadline: Date.now() + config.maxSeconds * 1000, limits: { rakuten: config.rakutenRequests, yahoo: config.yahooRequests } }));
  }
  const stagedEnvironment = { ...environment,
    TRACKING_PLAN_PATH: "", COLLECTION_METRICS_PATH: "", COLLECTION_DEADLINE: "",
    RAKUTEN_OUTPUT_PATH: stagedProducts, RAKUTEN_HISTORY_PATH: stagedHistory,
    YAHOO_PRODUCTS_PATH: stagedProducts, VALUECOMMERCE_PRODUCTS_PATH: stagedProducts, KEEPA_PRODUCTS_PATH: stagedProducts,
    YAHOO_METRICS_PATH: join(staging, "yahoo-metrics.json"), YAHOO_REQUEST_INTERVAL_MS: String(yahooRequestInterval),
    ...(plan ? { TRACKING_PLAN_PATH: join(staging, "tracking-plan.json"), COLLECTION_METRICS_PATH: join(staging, "metrics.json"),
      COLLECTION_DEADLINE: String(Date.now() + plan.config.maxSeconds * 1000), KEEPA_API_KEY: "",
      RAKUTEN_REQUEST_INTERVAL_MS: String(Math.max(1200, Number(environment.RAKUTEN_REQUEST_INTERVAL_MS) || 1200)) } : {}) };
  await runStage("rakuten", stagedEnvironment);
  const rakuten = JSON.parse(await readFile(stagedProducts, "utf8"));
  if (Object.values(rakuten[0]?.collection_summary?.errors || {}).some(count => count > 0)) {
    throw new Error("Rakuten collection contained API errors; publication stopped.");
  }
  if (environment.YAHOO_CLIENT_ID) await runStage("yahoo", stagedEnvironment);
  if (environment.VALUECOMMERCE_TOKEN && (environment.VALUECOMMERCE_ALLOWED_EC_CODES || environment.VALUECOMMERCE_ALLOWED_MERCHANTS)) await runStage("valuecommerce", stagedEnvironment);
  if (stagedEnvironment.KEEPA_API_KEY) await runStage("keepa", stagedEnvironment);
  const products = finalizeProducts(JSON.parse(await readFile(stagedProducts, "utf8")));
  validatePublication(products, previous);
  const productBytes = JSON.stringify(products, null, 2) + "\n";
  await writeFile(stagedProducts, productBytes);
  if (plan) {
    const history = JSON.parse(await readFile(stagedHistory, "utf8"));
    history.confirmed_catalog = mergeConfirmedCatalog(plan.catalog, products, plan.config.categories.map(c => c.category));
    await writeFile(stagedHistory, JSON.stringify(history, null, 2) + "\n");
  }
  const historyBytes = await readFile(stagedHistory);
  return { products, productBytes, historyBytes, stagedProducts };
}
