import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildComparison, productIdentity, positiveNumber, getItemImage, httpsURL } from "./lib/rakuten-comparison.mjs";

const applicationId = process.env.RAKUTEN_APPLICATION_ID;
const accessKey = process.env.RAKUTEN_ACCESS_KEY;
const affiliateId = process.env.RAKUTEN_AFFILIATE_ID;
if (!applicationId || !accessKey) throw new Error("Rakuten Application ID / Access key is missing.");

const repositoryPath = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outputPath = process.env.RAKUTEN_OUTPUT_PATH || resolve(repositoryPath, "products.json");
const historyPath = process.env.RAKUTEN_HISTORY_PATH || resolve(repositoryPath, ".local", "price-history.json");
const requestInterval = Number(process.env.RAKUTEN_REQUEST_INTERVAL_MS ?? 1200);
const checkedAt = new Date().toISOString();
const japanDate = new Date(Date.parse(checkedAt) + 9 * 3600000).toISOString().slice(0, 10);
const endpoints = {
  product: "https://openapi.rakuten.co.jp/ichibaproduct/api/Product/Search/20250801",
  item: "https://openapi.rakuten.co.jp/ichibams/api/IchibaItem/Search/20260701"
};
const searches = [
  { category: "家電", keywords: ["掃除機", "ドライヤー"] },
  { category: "ホビー", keywords: ["ゲームソフト", "フィギュア"] },
  { category: "美容", keywords: ["美容液", "化粧水"] },
  { category: "食品", keywords: ["コーヒー", "お米"] },
  { category: "ペット", keywords: ["ドッグフード", "キャットフード"] },
  { category: "日用品", keywords: ["洗濯洗剤", "トイレットペーパー"] }
];
const summary = { version: "shop-comparison-v1", checked_at: checkedAt, requests: 0, errors: {}, categories: [] };
const shopSearchCache = new Map();

function sleep(ms) {
  return Number.isFinite(ms) && ms > 0 ? new Promise(done => setTimeout(done, ms)) : Promise.resolve();
}

function extractResults(data) {
  for (const key of ["items", "Items", "products", "Products", "Product", "product"]) {
    if (Array.isArray(data?.[key]) && data[key].length) {
      return data[key].map(row => row?.product || row?.Product || row?.item || row?.Item || row)
        .filter(row => row && typeof row === "object");
    }
  }
  return [];
}

async function request(kind, params) {
  const url = new URL(endpoints[kind]);
  for (const [key, value] of Object.entries({ applicationId, format: "json", formatVersion: "2", ...params })) {
    url.searchParams.set(key, String(value));
  }
  if (affiliateId) url.searchParams.set("affiliateId", affiliateId);
  // Serialize and throttle all calls, including product discovery.
  if (summary.requests) await sleep(requestInterval);
  summary.requests++;
  let response;
  try {
    response = await fetch(url, {
      headers: { accessKey, Referer: "https://no1-site.github.io/kyou-no-uriidashi/" },
      signal: AbortSignal.timeout(15000)
    });
  } catch { throw new Error("network_or_timeout"); }
  if (response.status === 404) return [];
  if (!response.ok) {
    const error = new Error(`HTTP_${response.status}`);
    error.fatal = [401, 403, 429].includes(response.status);
    throw error;
  }
  let data;
  try { data = await response.json(); } catch { throw new Error("invalid_json"); }
  if (data?.error || data?.errors) throw new Error("api_error");
  if (!data || typeof data !== "object") throw new Error("invalid_response");
  const rows = extractResults(data);
  if (!rows.length && Number(data.count) > 0) throw new Error("unrecognized_response");
  return rows;
}

function recordError(error) {
  // Never store request URLs, headers, raw API bodies or credentials.
  const reason = /^(HTTP_\d{3}|network_or_timeout|invalid_json|api_error|invalid_response|unrecognized_response)$/.test(error.message)
    ? error.message : "processing_error";
  summary.errors[reason] = (summary.errors[reason] || 0) + 1;
  console.log(`[API ERROR] ${reason}`);
  if (error.fatal) throw error;
}

async function readHistory() {
  try {
    const data = JSON.parse(await readFile(historyPath, "utf8"));
    if (data?.products && typeof data.products === "object" && !Array.isArray(data.products)) return data;
  } catch (error) {
    if (error.code !== "ENOENT") console.log("[HISTORY] unreadable; starting a new history");
  }
  return { products: {} };
}

async function atomicJSON(path, value) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, JSON.stringify(value, null, 2) + "\n", "utf8");
  await rename(temporary, path);
}

async function discover(search, diagnostics) {
  const lists = [];
  for (const keyword of search.keywords) {
    try {
      const rows = await request("product", { keyword, hits: 30, sort: "standard" });
      diagnostics.catalog_rows += rows.length;
      // Catalog is used for identity only; prices come from individual listings.
      lists.push(rows.map(row => productIdentity(row, search.category)).filter(Boolean));
    } catch (error) { recordError(error); }
  }
  const unique = new Map();
  // Alternate searches so one keyword cannot fill every candidate slot.
  for (let index = 0; index < 30; index++) {
    for (const list of lists) {
      const identity = list[index];
      if (identity && !unique.has(identity.id)) unique.set(identity.id, identity);
    }
  }
  diagnostics.identities = unique.size;
  return [...unique.values()];
}

async function listingSearch(keyword) {
  if (!shopSearchCache.has(keyword)) {
    const rows = await request("item", {
      keyword, hits: 30, sort: "standard", availability: 1, purchaseType: 0, field: 0
    });
    shopSearchCache.set(keyword, rows);
  }
  return shopSearchCache.get(keyword);
}

async function compareCategory(search, history, diagnostics) {
  const identities = await discover(search, diagnostics);
  const products = [];
  for (const identity of identities.slice(0, 8)) {
    diagnostics.attempted++;
    let rows = [];
    let result;
    const queries = [...new Set([identity.jan, identity.model ? `${identity.brand} ${identity.model}` : ""].filter(Boolean))];
    for (const keyword of queries) {
      try {
        const found = await listingSearch(keyword);
        rows = [...new Map([...rows, ...found].map(item => [item.itemCode || item.itemUrl, item])).values()];
        result = buildComparison(identity, rows, { history, checkedAt });
        if (result.product) break;
      } catch (error) { recordError(error); }
    }
    diagnostics.listing_rows += rows.length;
    if (!result) continue;
    for (const [reason, count] of Object.entries(result.rejected)) {
      diagnostics.excluded[reason] = (diagnostics.excluded[reason] || 0) + count;
    }
    if (result.matchedShops < 2) diagnostics.insufficient_shops++;
    console.log(`[SHOP CHECK] category=${search.category} candidate=${diagnostics.attempted} rows=${rows.length} shops=${result.matchedShops}`);
    if (result.product) products.push(result.product);
    if (products.length >= 2) break;
  }
  diagnostics.compared = products.length;
  return products;
}

async function popularFallback(search) {
  try {
    const rows = await request("item", {
      keyword: search.keywords[0], hits: 10, sort: "-reviewCount", availability: 1, purchaseType: 0
    });
    return rows.filter(item => item.itemName && positiveNumber(item.itemPrice) && httpsURL(item.affiliateUrl || item.itemUrl))
      .slice(0, 2).map(item => ({
        id: item.itemCode || item.itemUrl, name: item.itemName, category: search.category,
        shop: item.shopName || "楽天市場", price: positiveNumber(item.itemPrice),
        market_price: null, discount_percent: null, score: null, offer_count: null,
        offers: [], deal_label: "比較条件未確認",
        reason: "同一商品として比較できる2ショップ以上を確認できなかったため、価格差を判定せず参考商品として掲載しています。",
        best_url: httpsURL(item.affiliateUrl || item.itemUrl), compare_url: httpsURL(item.itemUrl),
        image_url: httpsURL(getItemImage(item)), review_average: Number(item.reviewAverage) || 0,
        review_count: Number(item.reviewCount) || 0, comparison_type: "review_only", checked_at: checkedAt
      }));
  } catch (error) { recordError(error); return []; }
}

async function saveHistory(history, products) {
  const cutoff = Date.parse(checkedAt) - 120 * 86400000;
  for (const [key, entries] of Object.entries(history.products)) {
    const retained = Array.isArray(entries) ? entries.filter(entry => Date.parse(entry.checked_at) >= cutoff) : [];
    if (retained.length) history.products[key] = retained;
    else delete history.products[key];
  }
  for (const product of products.filter(item => item.comparison_type === "rakuten_shops")) {
    const entries = (history.products[product.id] || []).filter(entry => entry.date !== japanDate);
    entries.push({ date: japanDate, price: product.price, average_price: product.market_price, checked_at: checkedAt });
    history.products[product.id] = entries.slice(-120);
  }
  history.updated_at = checkedAt;
  await atomicJSON(historyPath, history);
}

const history = await readHistory();
let products = [];
console.log("[SHOP COMPARISON] Starting. This may take a few minutes.");
for (const search of searches) {
  const diagnostics = {
    category: search.category, catalog_rows: 0, identities: 0, attempted: 0,
    listing_rows: 0, compared: 0, insufficient_shops: 0, excluded: {}
  };
  const compared = await compareCategory(search, history, diagnostics);
  summary.categories.push(diagnostics);
  products.push(...(compared.length ? compared : await popularFallback(search)));
}
if (!products.length) throw new Error("No products fetched. Existing product data has been kept.");
products.sort((a, b) => Number(b.comparison_type === "rakuten_shops") - Number(a.comparison_type === "rakuten_shops") || (b.score || 0) - (a.score || 0));
const comparedCount = products.filter(product => product.comparison_type === "rakuten_shops").length;
summary.compared = comparedCount;
summary.reference_only = products.length - comparedCount;
// Aggregate diagnostics travel with the normal products.json update. No raw responses.
products[0].collection_summary = summary;
await saveHistory(history, products);
await atomicJSON(outputPath, products);
console.log(`[PRICE RESULT] compared=${comparedCount} reference_only=${summary.reference_only}`);
if (!comparedCount) console.log("[NOTICE] Product update finished, but no shop comparison was confirmed. Check collection_summary.");
