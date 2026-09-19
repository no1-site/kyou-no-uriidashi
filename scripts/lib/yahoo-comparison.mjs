import { applyShippingPolicy } from "../../shipping-policy.mjs";
import { httpsURL, positiveNumber, validJAN, matchIdentity } from "./rakuten-comparison.mjs";

export const yahooComparisonVersion = "yahoo-jan-quantity-v2";

export function evaluateYahooOffer(hit, expectedJan, product = {}) {
  if (!hit || typeof hit !== "object") return { reason: "invalid_item" };
  const jan = validJAN(hit.janCode);
  if (!jan || jan !== validJAN(expectedJan)) return { reason: "jan_mismatch" };
  if (hit.condition !== "new") return { reason: "condition" };
  if (hit.inStock !== true) return { reason: "unavailable" };
  const identity = { jan, name: product.name || "", model: product.model || "", brand: product.brand || "" };
  const description = `${hit.description || ""} ${hit.headline || ""} JAN ${jan}`;
  const { reason } = matchIdentity(identity, hit.name, description, { strict: true });
  if (reason) return { reason };

  const price = positiveNumber(hit.price);
  const url = httpsURL(hit.url);
  const sellerId = String(hit.seller?.sellerId || "").trim();
  const sellerName = String(hit.seller?.name || "").trim();
  if (!price) return { reason: "missing_price" };
  if (!url || !sellerId || !sellerName) return { reason: "missing_shop_or_link" };

  const shippingCode = Number(hit.shipping?.code);
  const postage = shippingCode === 2 ? "included" : "unknown";
  const imageUrl = httpsURL(hit.exImage?.url || hit.image?.medium || hit.image?.small);

  return { offer: {
    shop_code: `yahoo:${sellerId}`,
    shop_name: `Yahoo!ショッピング｜${sellerName}`,
    item_code: `yahoo:${String(hit.code || "")}`,
    item_name: String(hit.name || ""),
    price,
    url,
    postage,
    match_method: "jan",
    matched_jan: jan,
    identity_validation_version: yahooComparisonVersion,
    review_average: Math.min(5, positiveNumber(hit.review?.rate) || 0),
    review_count: Math.max(0, Math.trunc(Number(hit.review?.count) || 0)),
    image_url: imageUrl,
    marketplace: "Yahoo!ショッピング",
    marketplace_code: "yahoo"
  } };
}

// Preserve the original offer/null interface for callers that need no diagnostics.
export function yahooOffer(hit, expectedJan, product = {}) {
  return evaluateYahooOffer(hit, expectedJan, product).offer || null;
}

export function mergeYahooOffers(product, hits) {
  const expectedJan = validJAN(product?.product_code);
  const rejected = {};
  if (!expectedJan || !Array.isArray(product?.offers)) return { product, added: 0, rejected };

  const shops = new Map();
  for (const offer of product.offers) {
    if (!offer?.shop_code || !positiveNumber(offer.price)) continue;
    shops.set(offer.shop_code, offer);
  }

  let added = 0;
  for (const hit of Array.isArray(hits) ? hits : []) {
    const { offer, reason } = evaluateYahooOffer(hit, expectedJan, product);
    if (!offer) {
      rejected[reason] = (rejected[reason] || 0) + 1;
      continue;
    }
    const previous = shops.get(offer.shop_code);
    // One additional result from the same shop is excluded even if its lower
    // price replaces the previously selected result. Count each hit only once.
    if (previous) rejected.duplicate_shop = (rejected.duplicate_shop || 0) + 1;
    if (!previous || Number(offer.price) < Number(previous.price)) {
      if (!previous) added++;
      shops.set(offer.shop_code, offer);
    }
  }

  if (!added) return { product, added: 0, rejected };

  const offers = [...shops.values()].sort((a, b) => Number(a.price) - Number(b.price));
  const marketplaces = [...new Set([
    "楽天市場",
    ...offers.map(offer => offer.marketplace).filter(Boolean)
  ])];

  const merged = applyShippingPolicy({
    ...product,
    offers,
    offer_count: offers.length,
    historical_price: null,
    historical_discount_percent: null,
    marketplaces,
    comparison_scope: "楽天市場・Yahoo!ショッピング",
    yahoo_comparison_version: yahooComparisonVersion
  });

  return { product: merged, added, rejected };
}
