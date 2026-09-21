import { applyShippingPolicy } from "../../shipping-policy.mjs";
import { httpsURL, matchIdentity, positiveNumber, validJAN } from "./rakuten-comparison.mjs";

export const valueCommerceComparisonVersion = "valuecommerce-jan-v1";

function janCodes(value) {
  return [...new Set((String(value ?? "").match(/(?<!\d)(?:\d{13}|\d{8})(?!\d)/g) || [])
    .map(validJAN).filter(Boolean))];
}

function safePrice(value) {
  const price = positiveNumber(value);
  return Number.isSafeInteger(price) ? price : null;
}

export function evaluateValueCommerceOffer(item, expectedJan, product = {}, allowedEcCodes = []) {
  if (!item || typeof item !== "object") return { reason: "invalid_item" };
  const jan = validJAN(expectedJan);
  if (!jan || !janCodes(item.janCode).includes(jan)) return { reason: "jan_mismatch" };

  const ecCode = String(item.ecCode || "").trim();
  const allowed = new Set((Array.isArray(allowedEcCodes) ? allowedEcCodes : [])
    .map(code => String(code).trim()).filter(Boolean));
  if (!/^[A-Za-z0-9]+$/.test(ecCode) || (allowed.size && !allowed.has(ecCode))) {
    return { reason: "merchant_not_allowed" };
  }

  const productCategory = String(item.product_category || item.productCategory || "").trim();
  if (productCategory && productCategory !== "新品") return { reason: "condition" };
  if (String(item.stock || "").trim() === "なし") return { reason: "unavailable" };

  const identity = {
    jan,
    name: product.name || "",
    model: product.model || "",
    brand: product.brand || ""
  };
  const description = `${item.description || ""} JAN ${jan}`;
  const { reason } = matchIdentity(identity, item.title, description);
  if (reason) return { reason };

  const price = safePrice(item.sale_price || item.salePrice) || safePrice(item.price);
  const url = httpsURL(item.link);
  const merchantName = String(item.subStoreName || item.merchantName || "").trim();
  if (!price) return { reason: "missing_price" };
  if (!url || !merchantName) return { reason: "missing_shop_or_link" };

  const postageText = String(item.postage || "").trim();
  const postage = postageText === "なし" ? "included" : postageText === "あり" ? "extra" : "unknown";
  const imageUrl = httpsURL(item.imageLarge?.url || item.imageFree?.url || item.imageSmall?.url);

  return { offer: {
    shop_code: `valuecommerce:${ecCode}`,
    shop_name: merchantName,
    item_code: `valuecommerce:${ecCode}:${String(item.productCode || item.modelCode || jan)}`,
    item_name: String(item.title || ""),
    price,
    url,
    postage,
    match_method: "jan",
    matched_jan: jan,
    identity_validation_version: valueCommerceComparisonVersion,
    review_average: 0,
    review_count: 0,
    image_url: imageUrl,
    marketplace: "提携EC",
    marketplace_code: "valuecommerce",
    data_source: "ValueCommerce",
    ec_code: ecCode
  } };
}

export function mergeValueCommerceOffers(product, items, allowedEcCodes = []) {
  const expectedJan = validJAN(product?.product_code);
  const rejected = {};
  if (!expectedJan || !Array.isArray(product?.offers)) return { product, added: 0, rejected };

  const shops = new Map();
  for (const offer of product.offers) {
    if (!offer?.shop_code || !positiveNumber(offer.price)) continue;
    shops.set(offer.shop_code, offer);
  }

  let added = 0;
  for (const item of Array.isArray(items) ? items : []) {
    const { offer, reason } = evaluateValueCommerceOffer(item, expectedJan, product, allowedEcCodes);
    if (!offer) {
      rejected[reason] = (rejected[reason] || 0) + 1;
      continue;
    }
    const previous = shops.get(offer.shop_code);
    if (previous) rejected.duplicate_shop = (rejected.duplicate_shop || 0) + 1;
    if (!previous || Number(offer.price) < Number(previous.price)) {
      if (!previous) added++;
      shops.set(offer.shop_code, offer);
    }
  }

  if (!added) return { product, added: 0, rejected };

  const offers = [...shops.values()].sort((a, b) => Number(a.price) - Number(b.price));
  const marketplaces = [...new Set([
    ...(Array.isArray(product.marketplaces) ? product.marketplaces : ["楽天市場"]),
    "提携EC"
  ])];

  const merged = applyShippingPolicy({
    ...product,
    offers,
    offer_count: offers.length,
    historical_price: null,
    historical_discount_percent: null,
    marketplaces,
    comparison_scope: marketplaces.join("・"),
    valuecommerce_comparison_version: valueCommerceComparisonVersion
  });

  return { product: merged, added, rejected };
}
