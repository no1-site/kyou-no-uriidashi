import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { validJAN } from "./lib/rakuten-comparison.mjs";
import { mergeKeepaAmazon, keepaComparisonVersion } from "./lib/keepa-comparison.mjs";

const apiKey = process.env.KEEPA_API_KEY;
const associateTag = process.env.AMAZON_ASSOCIATE_TAG || "";
if (!apiKey) throw new Error("Keepa API key is missing.");

const repositoryPath = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const productsPath = process.env.KEEPA_PRODUCTS_PATH || resolve(repositoryPath, "products.json");
const endpoint = "https://api.keepa.com/product";
const checkedAt = new Date().toISOString();

async function atomicJSON(path, value) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, JSON.stringify(value, null, 2) + "\n", "utf8");
  await rename(temporary, path);
}

async function requestByCodes(codes) {
  const url = new URL(endpoint);
  url.searchParams.set("key", apiKey);
  url.searchParams.set("domain", "5");
  url.searchParams.set("code", codes.join(","));
  url.searchParams.set("stats", "30");
  url.searchParams.set("history", "0");
  url.searchParams.set("buybox", "1");
  url.searchParams.set("update", "1");

  let response;
  try {
    response = await fetch(url, {
      headers: { "Accept-Encoding": "gzip" },
      signal: AbortSignal.timeout(30000)
    });
  } catch {
    throw new Error("Keepa network_or_timeout");
  }

  let data;
  try {
    data = await response.json();
  } catch {
    throw new Error(`Keepa HTTP_${response.status || "unknown"} invalid_json`);
  }

  if (!response.ok || data?.error) {
    const type = String(data?.error?.type || `HTTP_${response.status}`).replace(/[^A-Za-z0-9_-]/g, "_");
    throw new Error(`Keepa ${type}`);
  }

  if (!Array.isArray(data?.products)) throw new Error("Keepa invalid_response");

  return data;
}

const products = JSON.parse(await readFile(productsPath, "utf8"));
if (!Array.isArray(products)) throw new Error("products.json is not an array.");

const codes = [...new Set(products.map(product => validJAN(product?.product_code)).filter(Boolean))];
if (!codes.length) {
  console.log("[KEEPA RESULT] No JAN codes; Amazon comparison skipped.");
  process.exit(0);
}

console.log(`[KEEPA] Requesting Amazon.co.jp matches for ${codes.length} JAN codes.`);
const data = await requestByCodes(codes.slice(0, 100));
const keepaProducts = Array.isArray(data?.products) ? data.products : [];

let matchedProducts = 0;
let addedOffers = 0;
const updated = [];

for (const product of products) {
  const merged = mergeKeepaAmazon(product, keepaProducts, associateTag);
  if (merged.added) {
    matchedProducts++;
    addedOffers += merged.added;
  }
  updated.push(merged.product);
}

if (updated.length) {
  updated[0].collection_summary = {
    ...(updated[0].collection_summary || {}),
    keepa: {
      version: keepaComparisonVersion,
      checked_at: checkedAt,
      requested_codes: codes.length,
      returned_products: keepaProducts.length,
      matched_products: matchedProducts,
      added_offers: addedOffers,
      tokens_consumed: Number(data?.tokensConsumed) || 0,
      tokens_left: Number.isFinite(Number(data?.tokensLeft)) ? Number(data.tokensLeft) : null
    }
  };
}

await atomicJSON(productsPath, updated);
console.log(`[KEEPA RESULT] returned=${keepaProducts.length} matched_products=${matchedProducts} added_offers=${addedOffers} tokens_consumed=${Number(data?.tokensConsumed) || 0}`);
