import { applyShippingPolicy } from "../../shipping-policy.mjs";
import { httpsURL, positiveNumber, validJAN } from "./rakuten-comparison.mjs";

export const yahooComparisonVersion = "yahoo-jan-v1";

export function yahooOffer(hit, expectedJan) {
  if (!hit || typeof hit !== "object") return null;
  const jan = validJAN(hit.janCode);
  if (!jan || jan !== validJAN(expectedJan)) return null;
  if (hit.condition && hit.condition !== "new") return null;
  if (hit.inStock !== true) return null;

  const price = positiveNumber(hit.price);
  const url = httpsURL(hit.url);
  const sellerId = String(hit.seller?.sellerId || "").trim();
  const sellerName = String(hit.seller?.name || "").trim();
  if (!price || !url || !sellerId || !sellerName) return null;

  const shippingCode = Number(hit.shipping?.code);
  const postage = shippingCode === 2 ? "included" : "unknown";
  const imageUrl = httpsURL(hit.exImage?.url || hit.image?.medium || hit.image?.small);

  return {
    shop_code: `yahoo:${sellerId}`,
    shop_name: `Yahoo!ショッピング｜${sellerName}`,
    item_code: `yahoo:${String(hit.code || "")}`,
    item_name: String(hit.name || ""),
    price,
    url,
    postage,
    match_method: "jan",
    review_average: Math.min(5, positiveNumber(hit.review?.rate) || 0),
    review_count: Math.max(0, Math.trunc(Number(hit.review?.count) || 0)),
    image_url: imageUrl,
    marketplace: "Yahoo!ショッピング",
    marketplace_code: "yahoo"
  };
}

export function mergeYahooOffers(product, hits) {
  const expectedJan = validJAN(product?.product_code);
  if (!expectedJan || !Array.isArray(product?.offers)) return { product, added: 0 };

  const shops = new Map();
  for (const offer of product.offers) {
    if (!offer?.shop_code || !positiveNumber(offer.price)) continue;
    shops.set(offer.shop_code, offer);
  }

  let added = 0;
  for (const hit of Array.isArray(hits) ? hits : []) {
    const offer = yahooOffer(hit, expectedJan);
    if (!offer) continue;
    const previous = shops.get(offer.shop_code);
    if (!previous || Number(offer.price) < Number(previous.price)) {
      if (!previous) added++;
      shops.set(offer.shop_code, offer);
    }
  }

  if (!added) return { product, added: 0 };

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

  return { product: merged, added };
}
