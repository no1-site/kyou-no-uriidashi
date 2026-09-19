import { applyShippingPolicy, effectivePostage, includedOffers } from "../../shipping-policy.mjs";
import { validJAN, httpsURL, validationVersion } from "./rakuten-comparison.mjs";
import { yahooComparisonVersion } from "./yahoo-comparison.mjs";

const marketNames = { rakuten: "楽天市場", yahoo: "Yahoo!ショッピング", amazon: "Amazon.co.jp" };
const minimumRetainedRatio = 0.7;
// An operational review limit, not a statement about a product's fair value.
export const maximumPublicationPrice = 100_000_000;

function fail(reason) { throw new Error(`Publication validation: ${reason}`); }
function validPrice(price) {
  return typeof price === "number" && Number.isSafeInteger(price) && price > 0 && price <= maximumPublicationPrice;
}
function marketCode(offer) {
  return offer.marketplace_code || (offer.shop_code?.startsWith("yahoo:") ? "yahoo"
    : offer.shop_code?.startsWith("amazon:") ? "amazon" : "rakuten");
}

export function priceSpreadHeld(product) {
  const offers = [...product.offers].sort((a, b) => a.price - b.price);
  const included = includedOffers(offers);
  const group = included.length >= 2 ? included : offers;
  return group.length >= 2 && group.at(-1).price > group[0].price * 3;
}

function validateRawProducts(products) {
  if (!Array.isArray(products) || !products.length) fail("empty_products");
  const ids = new Set();
  const jans = new Set();
  for (const product of products) {
    if (!product || typeof product.id !== "string" || !product.id || ids.has(product.id)) fail("duplicate_or_missing_product");
    ids.add(product.id);
    if (typeof product.name !== "string" || !product.name.trim() || !validPrice(product.price) || !httpsURL(product.best_url)) fail("invalid_product");
    if (!Number.isFinite(Date.parse(product.checked_at))) fail("missing_checked_at");
    if (!["rakuten_shops", "review_only"].includes(product.comparison_type)) fail("unknown_comparison_type");
    const jan = validJAN(product.product_code);
    if (product.product_code && !jan) fail("invalid_jan");
    if (jan && jans.has(jan)) fail("duplicate_jan");
    if (jan) jans.add(jan);
    if (!Array.isArray(product.offers)) fail("missing_offers");
    if (product.comparison_type === "rakuten_shops" &&
        (product.validation_version !== validationVersion || product.offers.length < 2)) fail("unconfirmed_comparison");
    if (product.comparison_type === "review_only" && product.offers.length) fail("unexpected_reference_offers");
    const shops = new Set();
    for (const offer of product.offers) {
      if (!offer || !offer.shop_code || shops.has(offer.shop_code)) fail("duplicate_or_missing_shop");
      shops.add(offer.shop_code);
      if (!validPrice(offer.price) || !httpsURL(offer.url) || !offer.shop_name) fail("invalid_offer");
      if (!["included", "extra", "unknown"].includes(offer.postage)) fail("invalid_postage");
      const market = marketCode(offer);
      if (!marketNames[market]) fail("unknown_marketplace");
      if (offer.matched_jan && (!validJAN(offer.matched_jan) || validJAN(offer.matched_jan) !== jan)) fail("jan_mismatch");
      if (["jan", "jan_model"].includes(offer.match_method)) {
        if (!jan || validJAN(offer.matched_jan) !== jan) fail("missing_jan_evidence");
      } else if (market !== "rakuten" || offer.match_method !== "model_brand" || !product.model) {
        fail("missing_identity_evidence");
      }
      if (market === "yahoo" && offer.identity_validation_version !== yahooComparisonVersion) fail("legacy_yahoo_validation");
    }
  }
}

export function finalizeProduct(product) {
  const offers = product.offers.map(offer => ({
    ...offer, postage: effectivePostage(offer),
    marketplace_code: marketCode(offer), marketplace: marketNames[marketCode(offer)]
  })).sort((a, b) => a.price - b.price || a.shop_code.localeCompare(b.shop_code));
  const marketplaces = Object.values(marketNames).filter(name => offers.some(offer => offer.marketplace === name));
  if (!offers.length && product.comparison_type === "review_only") marketplaces.push("楽天市場");
  let result = applyShippingPolicy({ ...product, offers, offer_count: offers.length,
    market_price: offers.length ? Math.round(offers.reduce((sum, offer) => sum + offer.price, 0) / offers.length) : null,
    marketplaces, comparison_scope: marketplaces.join("・"),
    shipping_offer_count: includedOffers(offers).length,
    shipping_reference_count: offers.length - includedOffers(offers).length });
  result.comparison_hold_reason = priceSpreadHeld(result) ? "price_spread_unconfirmed" : null;
  if (result.comparison_hold_reason || result.comparison_type === "review_only") {
    result = { ...result, market_price: null, discount_percent: null, score: null,
      historical_price: null, historical_discount_percent: null };
  }
  return result;
}

function summaryFor(products) {
  return {
    compared: products.filter(p => p.comparison_type === "rakuten_shops" && !p.comparison_hold_reason).length,
    reference_only: products.filter(p => p.comparison_type === "review_only").length,
    comparison_held: products.filter(p => p.comparison_hold_reason).length,
    shipping_included_compared: products.filter(p => p.comparison_type === "rakuten_shops" && !p.comparison_hold_reason && p.shipping_comparison === "included").length,
    shipping_price_only: products.filter(p => p.comparison_type === "rakuten_shops" && !p.comparison_hold_reason && p.shipping_comparison === "price_only").length
  };
}

export function finalizeProducts(products) {
  // Reject corrupt prices/duplicates before recalculation can hide them.
  validateRawProducts(products);
  const finalized = products.map(finalizeProduct);
  const summary = { ...(products[0].collection_summary || {}), ...summaryFor(finalized), publication_validation_version: "publication-v1" };
  if (Array.isArray(summary.categories)) summary.categories = summary.categories.map(category => ({
    ...category, ...summaryFor(finalized.filter(product => product.category === category.category))
  }));
  for (const product of finalized) delete product.collection_summary;
  finalized[0].collection_summary = summary;
  return finalized;
}

export function validatePublication(products, previous = []) {
  validateRawProducts(products);
  if (!Array.isArray(previous)) fail("invalid_previous_products");
  if (products.length < Math.ceil(previous.length * minimumRetainedRatio)) fail("product_count_drop");
  const previousCompared = previous.filter(p => p.comparison_type === "rakuten_shops").length;
  if (products.filter(p => p.comparison_type === "rakuten_shops").length < Math.ceil(previousCompared * minimumRetainedRatio)) fail("comparison_count_drop");
  const fields = ["offer_count", "shipping_offer_count", "shipping_reference_count", "marketplaces", "comparison_scope",
    "price", "best_url", "shop", "market_price", "score", "discount_percent", "historical_price", "historical_discount_percent",
    "shipping_comparison", "shipping_policy_version", "comparison_hold_reason"];
  for (const product of products) {
    const expected = finalizeProduct(product);
    for (const field of fields) {
      if (JSON.stringify(product[field]) !== JSON.stringify(expected[field])) fail(`inconsistent_${field}`);
    }
    if (product.offers.some(o => o.postage !== effectivePostage(o))) fail("unconfirmed_shipping");
  }
  for (const [key, value] of Object.entries(summaryFor(products))) {
    if (products[0].collection_summary?.[key] !== value) fail("inconsistent_summary");
  }
  return true;
}
