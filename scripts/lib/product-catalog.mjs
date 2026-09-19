import { validJAN, productIdentity, validationVersion } from "./rakuten-comparison.mjs";
import { selectionExclusion } from "./product-selection.mjs";

export function validateTrackingConfig(config) {
  if (!["legacy", "catalog"].includes(config.productionMode) ||
      !Number.isInteger(config.productionTarget) || config.productionTarget < 1 || config.productionTarget > 100 ||
      !Array.isArray(config.dryRunTargets) || config.dryRunTargets.some(n => ![20, 50, 100].includes(n)) ||
      !Number.isInteger(config.maxSeconds) || config.maxSeconds < 1 || config.maxSeconds > 1020 ||
      !Number.isInteger(config.rakutenRequests) || config.rakutenRequests < 1 || config.rakutenRequests > 380 ||
      !Number.isInteger(config.yahooRequests) || config.yahooRequests < 1 || config.yahooRequests > 100 ||
      !Number.isInteger(config.candidateMultiplier) || config.candidateMultiplier < 1 || config.candidateMultiplier > 3 ||
      !Array.isArray(config.categories) || !config.categories.length) throw new Error("Invalid tracking config.");
  const names = new Set();
  for (const c of config.categories) {
    if (!c.category || names.has(c.category) || !Number.isInteger(c.weight) || c.weight < 1 ||
        !Array.isArray(c.keywords) || !c.keywords.length || c.keywords.length > 4 || c.keywords.some(k => typeof k !== "string" || !k.trim())) throw new Error("Invalid category config.");
    names.add(c.category);
  }
  return config;
}

// Largest remainder allocation: deterministic, totals exactly the requested count.
export function allocateCategories(config, target) {
  validateTrackingConfig(config);
  if (!Number.isInteger(target) || target < 1 || target > 100) throw new Error("Invalid target.");
  const sum = config.categories.reduce((n, c) => n + c.weight, 0);
  const rows = config.categories.map((c, index) => ({ ...c, index, quota: Math.floor(target * c.weight / sum), remainder: target * c.weight % sum }));
  let remaining = target - rows.reduce((n, c) => n + c.quota, 0);
  for (const c of [...rows].sort((a, b) => b.remainder - a.remainder || a.index - b.index)) if (remaining-- > 0) c.quota++;
  return rows;
}

const fields = ["jan", "name", "brand", "model", "capacity", "count", "category", "enabled"];
export function validateCatalog(catalog, categories) {
  if (catalog?.version !== 1 || !Array.isArray(catalog.products)) throw new Error("Invalid product catalog.");
  const seen = new Set();
  for (const p of catalog.products) {
    if (!p || Object.keys(p).some(k => !fields.includes(k)) || (!validJAN(p.jan) || validJAN(p.jan) !== p.jan) || seen.has(p.jan) ||
        !categories.includes(p.category) || typeof p.enabled !== "boolean" ||
        ["jan", "name", "brand", "model", "capacity", "count"].some(k => typeof p[k] !== "string") ||
        !catalogIdentity(p) || selectionExclusion(p.name, p.category)) throw new Error("Invalid or duplicate catalog entry.");
    seen.add(p.jan);
  }
  return catalog;
}
export function catalogIdentity(p) {
  // Explicit unit fields participate in matching; no unit conversion is guessed.
  const name = [p.name, p.capacity, p.count].filter(Boolean).join(" ");
  const identity = productIdentity({ productCode: p.jan, productName: name, brandName: p.brand, productNo: p.model }, p.category);
  return identity ? { ...identity, model: p.model || identity.model } : null;
}
export function catalogEntry(p) {
  return { jan: p.product_code, name: p.name, brand: p.brand || "", model: p.model || "",
    capacity: "", count: "", category: p.category, enabled: true };
}
export function mergeConfirmedCatalog(catalog, products, categories) {
  validateCatalog(catalog, categories);
  const known = new Set(catalog.products.map(p => p.jan));
  const entries = [...catalog.products];
  for (const p of products) {
    if (known.has(p.product_code) || !validJAN(p.product_code) || p.validation_version !== validationVersion ||
        p.comparison_type !== "rakuten_shops" || p.comparison_hold_reason || !categories.includes(p.category) ||
        !p.offers?.length || p.offers.some(o => o.matched_jan !== p.product_code) || selectionExclusion(p.name, p.category)) continue;
    const entry = catalogEntry(p);
    if (!catalogIdentity(entry)) continue;
    entries.push(entry);
    known.add(entry.jan);
  }
  return validateCatalog({ version: 1, products: entries }, categories);
}

// Track every selected fixed identity first, then discover only missing slots.
// Disabled and failed tracked JANs remain reserved across ALL categories.
export async function collectCatalog({ catalog, config, target, compare, discover }) {
  const plans = allocateCategories(config, target);
  validateCatalog(catalog, plans.map(c => c.category));
  const seen = new Set(catalog.products.map(p => p.jan));
  const products = [];
  const diagnostics = plans.map(c => ({ category: c.category, target: c.quota, attempted: 0, tracked: 0, unavailable: 0, discovered: 0 }));
  async function attempt(identity, d, tracking) {
    d.attempted++;
    const product = await compare(identity);
    if (!product) { if (tracking) d.unavailable++; return; }
    products.push(product);
    d[tracking ? "tracked" : "discovered"]++;
  }
  for (const [index, plan] of plans.entries()) {
    for (const entry of catalog.products.filter(p => p.enabled && p.category === plan.category)) {
      if (diagnostics[index].tracked >= plan.quota || diagnostics[index].attempted >= plan.quota * config.candidateMultiplier) break;
      await attempt(catalogIdentity(entry), diagnostics[index], true);
    }
  }
  for (const [index, plan] of plans.entries()) {
    const d = diagnostics[index];
    if (d.tracked >= plan.quota) continue;
    const candidates = await discover(plan);
    let attempts = 0;
    for (const identity of candidates) {
      if (d.tracked + d.discovered >= plan.quota || attempts >= plan.quota * config.candidateMultiplier) break;
      if (!validJAN(identity.jan) || identity.category !== plan.category || seen.has(identity.jan)) continue;
      seen.add(identity.jan);
      attempts++;
      await attempt(identity, d, false);
    }
    d.shortfall = plan.quota - d.tracked - d.discovered;
  }
  return { products, diagnostics };
}
