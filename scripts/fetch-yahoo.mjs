import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { validJAN } from "./lib/rakuten-comparison.mjs";
import { mergeYahooOffers, yahooComparisonVersion } from "./lib/yahoo-comparison.mjs";

const clientId = process.env.YAHOO_CLIENT_ID;
const affiliateId = process.env.YAHOO_AFFILIATE_ID || "";
if (!clientId) throw new Error("Yahoo Client ID is missing.");

const repositoryPath = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const productsPath = process.env.YAHOO_PRODUCTS_PATH || resolve(repositoryPath, "products.json");
const requestInterval = Number(process.env.YAHOO_REQUEST_INTERVAL_MS ?? 1100);
const endpoint = "https://shopping.yahooapis.jp/ShoppingWebService/V3/itemSearch";
const checkedAt = new Date().toISOString();

function sleep(ms) {
  return Number.isFinite(ms) && ms > 0 ? new Promise(done => setTimeout(done, ms)) : Promise.resolve();
}

async function atomicJSON(path, value) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, JSON.stringify(value, null, 2) + "\n", "utf8");
  await rename(temporary, path);
}

async function searchYahoo(jan, requestNo) {
  if (requestNo > 0) await sleep(requestInterval);

  const url = new URL(endpoint);
  url.searchParams.set("appid", clientId);
  url.searchParams.set("jan_code", jan);
  url.searchParams.set("results", "50");
  url.searchParams.set("in_stock", "true");
  url.searchParams.set("condition", "new");
  url.searchParams.set("sort", "+price");
  url.searchParams.set("image_size", "300");
  if (affiliateId) {
    url.searchParams.set("affiliate_type", "vc");
    url.searchParams.set("affiliate_id", affiliateId);
  }

  let response;
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(15000) });
  } catch {
    throw new Error("Yahoo network_or_timeout");
  }

  if (!response.ok) {
    throw new Error(`Yahoo HTTP_${response.status}`);
  }

  let data;
  try {
    data = await response.json();
  } catch {
    throw new Error("Yahoo invalid_json");
  }

  if (data?.error || data?.errors || !Array.isArray(data?.hits)) throw new Error("Yahoo invalid_response");
  return data.hits;
}

const products = JSON.parse(await readFile(productsPath, "utf8"));
if (!Array.isArray(products)) throw new Error("products.json is not an array.");

let requests = 0;
let matchedProducts = 0;
let addedOffers = 0;
const excluded = {};
const updated = [];

console.log("[YAHOO] Starting Yahoo! Shopping comparison.");
for (const product of products) {
  const jan = validJAN(product?.product_code);
  if (!jan || !Array.isArray(product?.offers) || product.offers.length < 2) {
    updated.push(product);
    continue;
  }

  const hits = await searchYahoo(jan, requests++);
  const merged = mergeYahooOffers(product, hits);
  for (const [reason, count] of Object.entries(merged.rejected)) {
    excluded[reason] = (excluded[reason] || 0) + count;
  }
  if (merged.added > 0) {
    matchedProducts++;
    addedOffers += merged.added;
  }
  updated.push(merged.product);
  console.log(`[YAHOO CHECK] jan=${jan} hits=${hits.length} added=${merged.added}`);
}

if (updated.length) {
  updated[0].collection_summary = {
    ...(updated[0].collection_summary || {}),
    yahoo: {
      version: yahooComparisonVersion,
      checked_at: checkedAt,
      requests,
      matched_products: matchedProducts,
      added_offers: addedOffers,
      excluded
    }
  };
}

await atomicJSON(productsPath, updated);
console.log(`[YAHOO RESULT] requests=${requests} matched_products=${matchedProducts} added_offers=${addedOffers}`);
