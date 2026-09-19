import { applyShippingPolicy } from "../../shipping-policy.mjs";
import { normalizeText, positiveNumber, validJAN } from "./rakuten-comparison.mjs";

export const keepaComparisonVersion = "keepa-amazon-jan-v1";
const BUY_BOX_SHIPPING = 18;
const NEW = 1;

function productCodes(product) {
  return [...new Set([
    ...(Array.isArray(product?.eanList) ? product.eanList : []),
    ...(Array.isArray(product?.gtinList) ? product.gtinList : []),
    ...(Array.isArray(product?.upcList) ? product.upcList : [])
  ].map(validJAN).filter(Boolean))];
}

function modelKey(value) {
  return normalizeText(value).replace(/[^a-z0-9]/g, "");
}

function bigrams(value) {
  const text = normalizeText(value).replace(/\s+/g, "");
  const set = new Set();
  for (let i = 0; i < text.length - 1; i++) set.add(text.slice(i, i + 2));
  return set;
}

function titleSimilarity(a, b) {
  const aa = bigrams(a);
  const bb = bigrams(b);
  if (!aa.size || !bb.size) return 0;
  let overlap = 0;
  for (const gram of aa) if (bb.has(gram)) overlap++;
  return 2 * overlap / (aa.size + bb.size);
}

function amazonURL(asin, associateTag = "") {
  if (!/^[A-Z0-9]{10}$/.test(String(asin || ""))) return "";
  const url = new URL(`https://www.amazon.co.jp/dp/${asin}`);
  if (/^[A-Za-z0-9_-]+-\d{2}$/.test(associateTag)) {
    url.searchParams.set("tag", associateTag);
  }
  return url.href;
}

function priceFromKeepa(product) {
  const current = product?.stats?.current;
  if (!Array.isArray(current)) return null;

  const buyBox = positiveNumber(current[BUY_BOX_SHIPPING]);
  if (buyBox) {
    return {
      price: buyBox,
      postage: "included",
      basis: "keepa_buy_box_shipping"
    };
  }

  const marketplaceNew = positiveNumber(current[NEW]);
  if (marketplaceNew) {
    return {
      price: marketplaceNew,
      postage: "unknown",
      basis: "keepa_marketplace_new"
    };
  }

  return null;
}

export function keepaAmazonOffer(sourceProduct, keepaProducts, associateTag = "") {
  const expectedJan = validJAN(sourceProduct?.product_code);
  if (!expectedJan) return null;

  const sourceModel = modelKey(sourceProduct?.model);
  const candidates = [];

  for (const product of Array.isArray(keepaProducts) ? keepaProducts : []) {
    if (!product || typeof product !== "object") continue;
    if (Number(product.productType ?? 0) !== 0) continue;
    if (!productCodes(product).includes(expectedJan)) continue;

    const price = priceFromKeepa(product);
    const url = amazonURL(product.asin, associateTag);
    if (!price || !url || !String(product.title || "").trim()) continue;

    const candidateModels = [product.model, product.partNumber].map(modelKey).filter(Boolean);
    const modelMatch = sourceModel && candidateModels.includes(sourceModel);
    const similarity = titleSimilarity(sourceProduct?.name, product.title);
    candidates.push({ product, price, url, modelMatch, similarity });
  }

  if (!candidates.length) return null;

  candidates.sort((a, b) =>
    Number(b.modelMatch) - Number(a.modelMatch) ||
    b.similarity - a.similarity ||
    a.price.price - b.price.price
  );

  const selected = candidates[0];
  // Exact JAN is the primary identity check. When a source model exists and Keepa
  // exposes a model/part number, prefer an exact model match; otherwise require
  // enough title overlap to avoid obvious code collisions/duplicates.
  if (sourceModel && !selected.modelMatch && selected.similarity < 0.30) return null;

  const imageName = selected.product?.images?.[0]?.m || selected.product?.images?.[0]?.l ||
    String(selected.product?.imagesCSV || "").split(",")[0].trim();
  const imageUrl = imageName
    ? `https://m.media-amazon.com/images/I/${imageName}`
    : "";

  return {
    shop_code: `amazon:${selected.product.asin}`,
    shop_name: "Amazon.co.jp",
    item_code: `amazon:${selected.product.asin}`,
    item_name: String(selected.product.title),
    price: selected.price.price,
    url: selected.url,
    postage: selected.price.postage,
    price_basis: selected.price.basis,
    match_method: selected.modelMatch ? "jan_model" : "jan",
    matched_jan: expectedJan,
    review_average: 0,
    review_count: 0,
    image_url: imageUrl,
    marketplace: "Amazon.co.jp",
    marketplace_code: "amazon",
    data_source: "Keepa",
    asin: String(selected.product.asin),
    source_last_update: Number(selected.product.lastUpdate) || null
  };
}

export function mergeKeepaAmazon(product, keepaProducts, associateTag = "") {
  if (!Array.isArray(product?.offers)) return { product, added: 0 };

  const amazon = keepaAmazonOffer(product, keepaProducts, associateTag);
  if (!amazon) return { product, added: 0 };

  const shops = new Map();
  for (const offer of product.offers) {
    if (!offer?.shop_code || !positiveNumber(offer.price)) continue;
    shops.set(offer.shop_code, offer);
  }
  shops.set(amazon.shop_code, amazon);

  const offers = [...shops.values()].sort((a, b) => Number(a.price) - Number(b.price));
  const marketplaces = [...new Set([
    ...(Array.isArray(product.marketplaces) ? product.marketplaces : ["楽天市場"]),
    "Amazon.co.jp"
  ])];

  const merged = applyShippingPolicy({
    ...product,
    offers,
    offer_count: offers.length,
    historical_price: null,
    historical_discount_percent: null,
    marketplaces,
    comparison_scope: marketplaces.join("・"),
    keepa_comparison_version: keepaComparisonVersion
  });

  return { product: merged, added: 1 };
}
