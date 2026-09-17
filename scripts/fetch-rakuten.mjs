import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const applicationId = process.env.RAKUTEN_APPLICATION_ID;
const accessKey = process.env.RAKUTEN_ACCESS_KEY;
const affiliateId = process.env.RAKUTEN_AFFILIATE_ID;

if (!applicationId || !accessKey) {
  throw new Error("楽天APIのApplication IDまたはAccess keyが設定されていません。");
}

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryPath = resolve(scriptDirectory, "..");
const outputPath = process.env.RAKUTEN_OUTPUT_PATH ||
  resolve(repositoryPath, "products.json");
const historyPath = process.env.RAKUTEN_HISTORY_PATH ||
  resolve(repositoryPath, ".local", "price-history.json");
const requestInterval = Number(
  process.env.RAKUTEN_REQUEST_INTERVAL_MS ?? 1200
);

const productEndpoint =
  "https://openapi.rakuten.co.jp/ichibaproduct/api/Product/Search/20250801";
const itemEndpoint =
  "https://openapi.rakuten.co.jp/ichibams/api/IchibaItem/Search/20260701";
const siteURL = "https://no1-site.github.io/kyou-no-uriidashi/";

const searches = [
  { category: "家電", keywords: ["掃除機", "ドライヤー"] },
  { category: "ホビー", keywords: ["ゲームソフト", "フィギュア"] },
  { category: "美容", keywords: ["美容液", "化粧水"] },
  { category: "食品", keywords: ["コーヒー", "お米"] },
  { category: "ペット", keywords: ["ドッグフード", "キャットフード"] },
  { category: "日用品", keywords: ["洗濯洗剤", "トイレットペーパー"] }
];

const checkedAt = new Date().toISOString();
const japanDate = new Date(Date.now() + 9 * 60 * 60 * 1000)
  .toISOString()
  .slice(0, 10);

function sleep(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return Promise.resolve();
  return new Promise(resolvePromise => setTimeout(resolvePromise, ms));
}

function numberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function positiveNumber(value) {
  const number = numberOrNull(value);
  return number !== null && number > 0 ? number : null;
}

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

function percentageBelow(price, referencePrice) {
  if (!price || !referencePrice || referencePrice <= price) return 0;
  return Math.round(((referencePrice - price) / referencePrice) * 100);
}

function dealLabel(score) {
  if (score >= 90) return "神セール候補";
  if (score >= 80) return "かなりお得";
  if (score >= 70) return "お得";
  return "価格差あり";
}

function calculateDealScore({
  discountPercent,
  historicalDiscountPercent,
  offerCount,
  reviewAverage,
  reviewCount
}) {
  const baseScore = 30;
  const priceScore = Math.min(40, Math.max(0, discountPercent) * 2);
  const historyScore = Math.min(
    10,
    Math.max(0, historicalDiscountPercent)
  );
  const offerScore = Math.min(
    10,
    Math.log2(Math.max(1, offerCount) + 1) * 2.5
  );
  const reviewQualityScore = reviewAverage > 0
    ? Math.min(7, (reviewAverage / 5) * 7)
    : 0;
  const reviewVolumeScore = Math.min(
    3,
    Math.log10(Math.max(0, reviewCount) + 1)
  );

  return Math.min(
    100,
    Math.round(
      baseScore +
      priceScore +
      historyScore +
      offerScore +
      reviewQualityScore +
      reviewVolumeScore
    )
  );
}

function extractResults(data) {
  for (const key of ["items", "Items", "products", "Products", "Product", "product"]) {
    if (Array.isArray(data?.[key]) && data[key].length) return data[key];
  }
  return [];
}

// Log only counts and field names, never raw API responses or credentials.
function logComparisonDiagnostics(data, results, normalized) {
  const fields = Object.keys(data || {}).filter(key => /^[a-zA-Z][a-zA-Z0-9_]{0,50}$/.test(key));
  const first = unwrapResult(results[0]);
  const productFields = Object.keys(first || {}).filter(key => /^[a-zA-Z][a-zA-Z0-9_]{0,50}$/.test(key));
  const missing = { name: 0, new_price: 0, average: 0, offers: 0, url: 0 };
  for (const result of results) {
    const p = unwrapResult(result) || {};
    if (typeof p.productName !== "string" || !p.productName.trim()) missing.name++;
    if (!positiveNumber(p.usedExcludeSalesMinPrice)) missing.new_price++;
    if (!positiveNumber(p.averagePrice)) missing.average++;
    if (!(numberOrNull(p.usedExcludeSalesItemCount) >= 2)) missing.offers++;
    if (!String(p.affiliateUrl || p.productUrlPC || "").startsWith("https://")) missing.url++;
  }
  console.log(`[PRICE CHECK] rows=${results.length} valid=${normalized.length} cheaper=${normalized.filter(p => p.discount_percent > 0).length} missing=${JSON.stringify(missing)}`);
  if (!normalized.length) {
    console.log(`[PRICE FIELDS] root=${fields.join(",")} product=${productFields.join(",")}`);
  }
}

function unwrapResult(result) {
  return result?.product ||
    result?.Product ||
    result?.item ||
    result?.Item ||
    result;
}

function getItemImage(item) {
  const images =
    item.mediumImageUrls ||
    item.imageUrls ||
    item.smallImageUrls ||
    [];
  const first = Array.isArray(images) ? images[0] : null;

  if (typeof first === "string") return first;
  return first?.imageUrl || "";
}

async function requestJSON(url, label) {
  const response = await fetch(url, {
    headers: {
      accessKey,
      Referer: siteURL
    }
  });
  const responseText = await response.text();

  if (!response.ok) {
    throw new Error(
      `${label}の取得に失敗しました: HTTP ${response.status}`
    );
  }

  try {
    return JSON.parse(responseText);
  }
  catch {
    throw new Error(`${label}の応答をJSONとして読み取れませんでした。`);
  }
}

async function loadHistory() {
  try {
    const data = JSON.parse(await readFile(historyPath, "utf8"));
    return data && typeof data === "object" && data.products
      ? data
      : { products: {} };
  }
  catch (error) {
    if (error?.code !== "ENOENT") {
      console.warn("価格履歴を読み込めなかったため、新しく作成します。");
    }
    return { products: {} };
  }
}

function normalizeProduct(product, category, history) {
  const name = typeof product.productName === "string"
    ? product.productName.trim()
    : "";
  const price = positiveNumber(product.usedExcludeSalesMinPrice);
  const marketPrice = positiveNumber(product.averagePrice);
  const offerCount = Math.max(
    0,
    Math.trunc(numberOrNull(
      product.usedExcludeSalesItemCount
    ) || 0)
  );
  const productId = String(product.productId || "").trim();
  const productCode = String(product.productCode || "").trim();
  const productKey = productId || productCode || name;
  const productURL =
    product.affiliateUrl ||
    product.productUrlPC ||
    "";

  if (
    !name ||
    !price ||
    !marketPrice ||
    offerCount < 2 ||
    !productKey ||
    !String(productURL).startsWith("https://")
  ) {
    return null;
  }

  const reviewAverage = numberOrNull(product.reviewAverage) || 0;
  const reviewCount = Math.max(
    0,
    Math.trunc(numberOrNull(product.reviewCount) || 0)
  );
  const previousPrices = Array.isArray(history.products[productKey])
    ? history.products[productKey]
        .map(entry => positiveNumber(entry?.price))
        .filter(Boolean)
    : [];
  const historicalPrice = previousPrices.length >= 2
    ? Math.round(median(previousPrices))
    : null;
  const discountPercent = percentageBelow(price, marketPrice);
  const historicalDiscountPercent = percentageBelow(price, historicalPrice);
  const score = calculateDealScore({
    discountPercent,
    historicalDiscountPercent,
    offerCount,
    reviewAverage,
    reviewCount
  });

  return {
    id: productKey,
    product_id: productId || null,
    product_code: productCode || null,
    name,
    category,
    shop: `楽天市場・販売中 ${offerCount}商品`,
    price,
    market_price: Math.round(marketPrice),
    discount_percent: discountPercent,
    historical_price: historicalPrice,
    historical_discount_percent: historicalDiscountPercent || null,
    offer_count: offerCount,
    score,
    deal_label: dealLabel(score),
    reason: `楽天市場内の新品の購入可能な最低価格と、楽天APIの平均価格との差を基に判定しています（販売中${offerCount}商品）。`,
    best_url: productURL,
    compare_url: product.productUrlPC || productURL,
    image_url: product.mediumImageUrl || product.smallImageUrl || "",
    review_average: reviewAverage,
    review_count: reviewCount,
    comparison_type: "rakuten_product",
    checked_at: checkedAt
  };
}

function selectDeals(candidates) {
  const selected = [];

  for (const search of searches) {
    const unique = new Map();

    for (const candidate of candidates.filter(
      item => item.category === search.category
    )) {
      const existing = unique.get(candidate.id);
      if (!existing || candidate.score > existing.score) {
        unique.set(candidate.id, candidate);
      }
    }

    const sorted = [...unique.values()].sort((a, b) =>
      b.score - a.score ||
      b.discount_percent - a.discount_percent ||
      b.offer_count - a.offer_count
    );
    const clearDeals = sorted.filter(item => item.discount_percent >= 5);
    const categoryDeals = [...clearDeals];

    if (categoryDeals.length < 2) {
      for (const candidate of sorted) {
        if (
          candidate.discount_percent > 0 &&
          !categoryDeals.some(item => item.id === candidate.id)
        ) {
          categoryDeals.push(candidate);
        }
        if (categoryDeals.length >= 2) break;
      }
    }

    selected.push(...categoryDeals.slice(0, 2));
  }

  return selected.sort((a, b) => b.score - a.score);
}

async function fetchComparedProducts(history) {
  const candidates = [];

  for (const search of searches) {
    for (const keyword of search.keywords) {
      const url = new URL(productEndpoint);
      url.searchParams.set("applicationId", applicationId);
      url.searchParams.set("keyword", keyword);
      url.searchParams.set("hits", "30");
      url.searchParams.set("sort", "-satisfied");
      url.searchParams.set("format", "json");
      url.searchParams.set("formatVersion", "2");

      if (affiliateId) {
        url.searchParams.set("affiliateId", affiliateId);
      }

      try {
        const data = await requestJSON(
          url,
          `${search.category}（${keyword}）`
        );

        const results = extractResults(data);
        const normalized = [];
        for (const result of results) {
          const candidate = normalizeProduct(
            unwrapResult(result),
            search.category,
            history
          );
          if (candidate) normalized.push(candidate);
        }
        logComparisonDiagnostics(data, results, normalized);
        candidates.push(...normalized);
      }
      catch (error) {
        console.warn(error.message);
      }

      await sleep(requestInterval);
    }
  }

  return selectDeals(candidates);
}

async function fetchPopularFallback(targetSearches = searches) {
  const products = [];

  for (const search of targetSearches) {
    const url = new URL(itemEndpoint);
    url.searchParams.set("applicationId", applicationId);
    url.searchParams.set("keyword", search.keywords[0]);
    url.searchParams.set("hits", "2");
    url.searchParams.set("sort", "-reviewCount");
    url.searchParams.set("format", "json");

    if (affiliateId) {
      url.searchParams.set("affiliateId", affiliateId);
    }

    let data;
    try {
      data = await requestJSON(url, `${search.category}の人気商品`);
    }
    catch (error) {
      console.warn(error.message);
      await sleep(requestInterval);
      continue;
    }

    for (const result of extractResults(data).slice(0, 2)) {
      const item = unwrapResult(result);
      const reviewAverage = numberOrNull(item.reviewAverage) || 0;
      const reviewCount = Math.max(
        0,
        Math.trunc(numberOrNull(item.reviewCount) || 0)
      );

      products.push({
        id: item.itemCode || item.itemUrl,
        name: item.itemName,
        category: search.category,
        shop: item.shopName || "楽天市場",
        price: positiveNumber(item.itemPrice),
        market_price: null,
        discount_percent: null,
        historical_price: null,
        historical_discount_percent: null,
        offer_count: null,
        score: null,
        deal_label: "価格比較待ち",
        reason: "価格比較APIで候補を取得できなかったため、楽天市場のレビュー評価と件数を基に掲載しています。",
        best_url: item.affiliateUrl || item.itemUrl,
        compare_url: item.itemUrl,
        image_url: getItemImage(item),
        review_average: reviewAverage,
        review_count: reviewCount,
        comparison_type: "review_only",
        checked_at: checkedAt
      });
    }

    await sleep(requestInterval);
  }

  return products;
}

async function saveHistory(history, products) {
  const retentionLimit = Date.now() - 120 * 24 * 60 * 60 * 1000;

  for (const product of products.filter(
    item => item.comparison_type === "rakuten_product"
  )) {
    const existing = Array.isArray(history.products[product.id])
      ? history.products[product.id]
      : [];
    const retained = existing.filter(entry => {
      const timestamp = Date.parse(entry?.checked_at);
      return Number.isFinite(timestamp) &&
        timestamp >= retentionLimit &&
        entry.date !== japanDate;
    });

    retained.push({
      date: japanDate,
      price: product.price,
      average_price: product.market_price,
      checked_at: checkedAt
    });
    history.products[product.id] = retained.slice(-120);
  }

  history.updated_at = checkedAt;
  await mkdir(dirname(historyPath), { recursive: true });
  await writeFile(
    historyPath,
    JSON.stringify(history, null, 2) + "\n",
    "utf8"
  );
}

const history = await loadHistory();
let products = await fetchComparedProducts(history);
const comparedCategories = new Set(
  products.map(product => product.category)
);
const missingSearches = searches.filter(
  search => !comparedCategories.has(search.category)
);

if (missingSearches.length > 0) {
  console.warn(
    `${missingSearches.map(search => search.category).join("・")}は` +
    "価格比較候補を取得できなかったため、人気商品を表示します。"
  );
  const fallbackProducts = await fetchPopularFallback(missingSearches);
  products = [...products, ...fallbackProducts];
}

if (products.length === 0) {
  throw new Error("楽天の商品を取得できませんでした。");
}

await saveHistory(history, products);
await writeFile(
  outputPath,
  JSON.stringify(products, null, 2) + "\n",
  "utf8"
);

const comparedCount = products.filter(
  product => product.comparison_type === "rakuten_product"
).length;
console.log(
  `${products.length}件をproducts.jsonへ保存しました（価格比較済み${comparedCount}件）。`
);
console.log(`[PRICE RESULT] compared=${comparedCount} popular=${products.length - comparedCount}`);
