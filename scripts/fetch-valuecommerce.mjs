import { readFile, writeFile, rename, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { validJAN } from "./lib/rakuten-comparison.mjs";
import { mergeValueCommerceOffers, valueCommerceComparisonVersion } from "./lib/valuecommerce-comparison.mjs";

const token = String(process.env.VALUECOMMERCE_TOKEN || "").trim();
const allowedEcCodes = String(process.env.VALUECOMMERCE_ALLOWED_EC_CODES || "")
  .split(",").map(value => value.trim()).filter(Boolean);
const allowedMerchants = String(process.env.VALUECOMMERCE_ALLOWED_MERCHANTS || "")
  .split(",").map(value => value.trim()).filter(Boolean);
if (!token) throw new Error("ValueCommerce token is missing.");
if (allowedEcCodes.some(code => !/^[A-Za-z0-9]+$/.test(code))) {
  throw new Error("ValueCommerce allowed EC codes are invalid.");
}
if (!allowedEcCodes.length && !allowedMerchants.length) {
  throw new Error("ValueCommerce allowed merchants are missing.");
}

const repositoryPath = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const productsPath = process.env.VALUECOMMERCE_PRODUCTS_PATH || resolve(repositoryPath, "products.json");
const endpoint = "https://webservice.valuecommerce.ne.jp/productdb/search";
const intervalMs = Math.max(1500, Number(process.env.VALUECOMMERCE_REQUEST_INTERVAL_MS) || 1500);
const checkedAt = new Date().toISOString();

function sleep(ms) {
  return ms > 0 ? new Promise(done => setTimeout(done, ms)) : Promise.resolve();
}

async function atomicJSON(path, value) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, JSON.stringify(value, null, 2) + "\n", "utf8");
  await rename(temporary, path);
}

async function searchValueCommerce(jan, merchant = "") {
  const url = new URL(endpoint);
  url.searchParams.set("token", token);
  url.searchParams.set("keyword", jan);
  if (allowedEcCodes.length) url.searchParams.set("ec_code", allowedEcCodes.join(","));
  if (merchant) url.searchParams.set("merchant", merchant);
  url.searchParams.set("format", "json");
  url.searchParams.set("results_per_page", "50");
  url.searchParams.set("sort_by", "price");
  url.searchParams.set("sort_order", "asc");

  let response;
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(15000) });
  } catch {
    throw new Error("ValueCommerce network_or_timeout");
  }
  if (!response.ok) throw new Error(`ValueCommerce HTTP_${response.status}`);

  let data;
  try {
    data = await response.json();
  } catch {
    throw new Error("ValueCommerce invalid_json");
  }
  if (data?.status !== "OK" || !Array.isArray(data?.items)) {
    throw new Error(`ValueCommerce ${String(data?.status || "invalid_response").replace(/[^A-Za-z0-9_-]/g, "_")}`);
  }
  return data.items;
}

const products = JSON.parse(await readFile(productsPath, "utf8"));
if (!Array.isArray(products)) throw new Error("products.json is not an array.");

let requests = 0;
let matchedProducts = 0;
let addedOffers = 0;
const excluded = {};
const merchants = new Set();
const updated = [];

console.log("[VALUECOMMERCE] Starting partner merchant comparison.");
for (const product of products) {
  const jan = validJAN(product?.product_code);
  if (!jan || !Array.isArray(product?.offers) || product.offers.length < 2) {
    updated.push(product);
    continue;
  }
  const searches = allowedEcCodes.length ? [""] : allowedMerchants;
  const items = [];
  for (const merchant of searches) {
    if (requests) await sleep(intervalMs);
    items.push(...await searchValueCommerce(jan, merchant));
    requests++;
  }
  const merged = mergeValueCommerceOffers(product, items, allowedEcCodes, allowedMerchants);
  for (const [reason, count] of Object.entries(merged.rejected)) {
    excluded[reason] = (excluded[reason] || 0) + count;
  }
  for (const offer of merged.product?.offers || []) {
    if (offer?.marketplace_code === "valuecommerce") merchants.add(offer.shop_name);
  }
  if (merged.added > 0) {
    matchedProducts++;
    addedOffers += merged.added;
  }
  updated.push(merged.product);
  console.log(`[VALUECOMMERCE CHECK] jan=${jan} items=${items.length} added=${merged.added}`);
}

if (updated.length) {
  updated[0].collection_summary = {
    ...(updated[0].collection_summary || {}),
    valuecommerce: {
      version: valueCommerceComparisonVersion,
      checked_at: checkedAt,
      requests,
      matched_products: matchedProducts,
      added_offers: addedOffers,
      merchants: [...merchants].sort(),
      excluded
    }
  };
}

await atomicJSON(productsPath, updated);
console.log(`[VALUECOMMERCE RESULT] requests=${requests} matched_products=${matchedProducts} added_offers=${addedOffers} merchants=${merchants.size}`);
