// Pure matching and comparison rules. No credentials, network or file access.
export function normalizeText(value) {
  return String(value ?? "").normalize("NFKC")
    .replace(/<[^>]*>/g, " ")
    .replace(/&#(?:x([0-9a-f]+)|(\d+));/gi, (_, hex, dec) => {
      const code = Number.parseInt(hex || dec, hex ? 16 : 10);
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : " ";
    })
    .replace(/&(?:nbsp|amp|quot|lt|gt);/g, " ")
    .replace(/[‐‑‒–—−]/g, "-")
    .replace(/\s+/g, " ").trim().toLowerCase();
}

export function positiveNumber(value) {
  if (!["number", "string"].includes(typeof value) || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

export function httpsURL(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.href : "";
  } catch { return ""; }
}

export function validJAN(value) {
  const code = String(value ?? "").normalize("NFKC").trim();
  if (!/^(?:\d{8}|\d{13})$/.test(code) || /^0+$/.test(code)) return "";
  let sum = 0;
  for (let i = code.length - 2, weight = 3; i >= 0; i--, weight = 4 - weight) {
    sum += Number(code[i]) * weight;
  }
  return (10 - sum % 10) % 10 === Number(code.at(-1)) ? code : "";
}

function janCodes(text) {
  return [...new Set((text.match(/(?<!\d)(?:\d{13}|\d{8})(?!\d)/g) || [])
    .map(validJAN).filter(Boolean))];
}

function modelKey(value) {
  return normalizeText(value).replace(/[\s-]/g, "");
}

function hasExactModel(title, model) {
  const key = modelKey(model);
  // Keep suffixes (e.g. colour) significant; ABC123 must not match ABC123B.
  return (title.match(/[a-z0-9]+(?:[-][a-z0-9]+)*/g) || [])
    .some(token => modelKey(token) === key);
}

function quantities(text) {
  const values = new Set();
  const pattern = /(?<![a-z0-9.])(\d+(?:\.\d+)?)\s*(kg|mg|g|ml|l|個|本|袋|箱|枚|錠|粒|包|缶|巻|組|台|セット|パック)(?![a-z])/g;
  for (const [, amount, unit] of text.matchAll(pattern)) {
    let value = Number(amount);
    if (unit === "kg") { values.add(`weight:${value * 1000}`); continue; }
    if (unit === "mg") { values.add(`weight:${value / 1000}`); continue; }
    if (unit === "g") { values.add(`weight:${value}`); continue; }
    if (unit === "l" || unit === "ml") {
      values.add(`volume:${value * (unit === "l" ? 1000 : 1)}`); continue;
    }
    if (value > 1) values.add(`count:${unit}:${value}`);
  }
  return values;
}

const conditionPattern = /中古|ユーズド|リユース|整備済|再生品|リファービッシュ|ジャンク|訳あり|訳有|展示品|開封品|アウトレット|レンタル|お試し|試供品|サンプル|ふるさと納税|\b(?:used|refurbished|pre-owned)\b/;
const choicePattern = /選べる|よりどり|選り取り|選択式|各種|アソート|(?:容量|個数|カラー|サイズ|色).{0,8}(?:選択|選ん)|(?:色|種類|サイズ)から/;
const bundlePattern = /セット|まとめ買い|詰め合わせ|ケース販売|箱売り|おまけ|特典付/;
const multiplierPattern = /(?:[×x]\s*(?:[2-9]|\d{2,})(?!\d))|(?:(?:[2-9]|\d{2,})\s*(?:点|個|本|袋|箱)\s*(?:セット|組|まとめ))/;
const accessoryTerms = ["フィルター", "替えブラシ", "交換用", "部品", "アタッチメント", "ケース", "カバー", "充電器", "スタンド", "保護フィルム", "互換", "対応機種"];

function hasBundle(text) {
  // A headset is a product; "headset + mouse set" must still be rejected.
  return bundlePattern.test(text.replace(/ヘッドセット/g, ""));
}

export function productIdentity(product, category) {
  const name = String(product?.productName || "").trim();
  const title = normalizeText(name);
  const jan = validJAN(product?.productCode);
  const model = String(product?.productNo || "").trim();
  const brand = String(product?.brandName || product?.makerName || "").trim();
  const modelUsable = /[a-z]/.test(modelKey(model)) && /\d/.test(modelKey(model)) &&
    modelKey(model).length >= 6 && normalizeText(brand).length >= 2;
  if (!name || conditionPattern.test(title) || choicePattern.test(title) ||
      multiplierPattern.test(title) || (!jan && !modelUsable)) return null;
  // Initially compare retail units only. Multi-packs with unclear quantities are skipped.
  if (hasBundle(title)) return null;
  return {
    id: `rakuten_shops:${jan ? `jan:${jan}` : `model:${modelKey(model)}:${normalizeText(brand)}`}`,
    name, category, jan, model: modelUsable ? model : "", brand,
    product_id: String(product?.productId || ""),
    image_url: httpsURL(product?.mediumImageUrl || product?.smallImageUrl),
    compare_url: httpsURL(product?.affiliateUrl || product?.productUrlPC)
  };
}

function flag(value, expected) {
  return (typeof value === "number" || typeof value === "string") &&
    String(value).trim() !== "" && Number(value) === expected;
}

function outsideSaleTime(item, now) {
  for (const [key, isStart] of [["startTime", true], ["endTime", false]]) {
    const text = String(item[key] || "");
    if (!/^\d{4}-\d\d-\d\d \d\d:\d\d(?::\d\d)?$/.test(text)) continue;
    const time = Date.parse(text.replace(" ", "T") + "+09:00");
    if (Number.isFinite(time) && (isStart ? now < time : now >= time)) return true;
  }
  return false;
}

export function matchOffer(identity, item, now = Date.now()) {
  if (!item || typeof item !== "object") return { reason: "invalid_item" };
  const title = normalizeText(item.itemName);
  const caption = normalizeText(item.itemCaption);
  const text = `${title} ${caption}`;
  if (!title) return { reason: "missing_name" };
  if (conditionPattern.test(text)) return { reason: "condition" };
  if (choicePattern.test(title) || multiplierPattern.test(title)) return { reason: "variant_or_bundle" };
  if (hasBundle(title)) {
    return { reason: "variant_or_bundle" };
  }
  const canonicalTitle = normalizeText(identity.name);
  if (accessoryTerms.some(term => title.includes(term) && !canonicalTitle.includes(term))) {
    return { reason: "accessory_or_variant" };
  }
  if (/(?:対応|適合|専用|交換)機種|互換品|互換商品/.test(caption)) return { reason: "accessory_or_variant" };
  const expected = quantities(canonicalTitle);
  const actual = quantities(title);
  for (const quantity of actual) {
    if (!expected.has(quantity)) return { reason: "quantity_mismatch" };
  }
  // Inspect explicitly labelled contents, without treating every number in shop boilerplate as a size.
  for (const [, contents] of caption.matchAll(/(?:内容量|入数|セット内容|販売単位)\s*[:：]?\s*([^。\n]{1,40})/g)) {
    if (multiplierPattern.test(contents)) return { reason: "variant_or_bundle" };
    for (const quantity of quantities(contents)) {
      if (!expected.has(quantity)) return { reason: "quantity_mismatch" };
    }
  }
  const codes = janCodes(text);
  if (codes.some(code => code !== identity.jan)) return { reason: "conflicting_jan" };
  let matchMethod = "";
  if (identity.jan && codes.includes(identity.jan)) {
    matchMethod = "jan";
  } else if (identity.model && hasExactModel(title, identity.model) &&
      title.includes(normalizeText(identity.brand)) &&
      [...expected].every(quantity => actual.has(quantity))) {
    matchMethod = "model_brand";
  } else {
    return { reason: "identity_unconfirmed" };
  }
  if (!flag(item.availability, 1) || outsideSaleTime(item, now)) return { reason: "unavailable" };
  if (!flag(item.taxFlag, 0)) return { reason: "tax_unconfirmed" };
  const price = positiveNumber(item.itemPriceMin3) || positiveNumber(item.itemPrice);
  if (!price) return { reason: "missing_price" };
  for (const i of [1, 2, 3]) {
    const min = positiveNumber(item[`itemPriceMin${i}`]);
    const max = positiveNumber(item[`itemPriceMax${i}`]);
    if ((min && max && min !== max) || (max && max !== price) || (min && min !== price)) {
      return { reason: "variable_price" };
    }
  }
  const itemPrice = positiveNumber(item.itemPrice);
  if (itemPrice && itemPrice !== price) return { reason: "variable_price" };
  const url = httpsURL(item.affiliateUrl || item.itemUrl);
  const shopCode = String(item.shopCode || String(item.itemCode || "").split(":")[0]);
  if (!url || !/^[a-zA-Z0-9_-]+$/.test(shopCode) || !item.shopName) return { reason: "missing_shop_or_link" };
  return { offer: {
    shop_code: shopCode,
    shop_name: String(item.shopName),
    item_code: String(item.itemCode || ""),
    item_name: String(item.itemName),
    price, url,
    postage: flag(item.postageFlag, 0) ? "included" : flag(item.postageFlag, 1) ? "extra" : "unknown",
    match_method: matchMethod,
    review_average: Math.min(5, positiveNumber(item.reviewAverage) || 0),
    review_count: Math.max(0, Math.trunc(Number(item.reviewCount) || 0)),
    image_url: httpsURL(getItemImage(item))
  } };
}

export function getItemImage(item) {
  const first = (item.mediumImageUrls || item.smallImageUrls || [])[0];
  return typeof first === "string" ? first : first?.imageUrl || "";
}

export function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  if (!sorted.length) return null;
  const m = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[m] : (sorted[m - 1] + sorted[m]) / 2;
}

export function percentageBelow(price, reference) {
  return reference > price ? Math.floor((reference - price) / reference * 100) : 0;
}

export function buildComparison(identity, items, { history = { products: {} }, checkedAt = new Date().toISOString() } = {}) {
  const shops = new Map();
  const rejected = {};
  for (const item of items) {
    const { offer, reason } = matchOffer(identity, item, Date.parse(checkedAt));
    if (!offer) { rejected[reason] = (rejected[reason] || 0) + 1; continue; }
    const current = shops.get(offer.shop_code);
    if (!current || offer.price < current.price) shops.set(offer.shop_code, offer);
  }
  const offers = [...shops.values()].sort((a, b) => a.price - b.price || a.shop_code.localeCompare(b.shop_code));
  if (offers.length < 2) return { product: null, rejected, matchedShops: offers.length };
  const lowest = offers[0];
  const average = offers.reduce((sum, offer) => sum + offer.price, 0) / offers.length;
  const discount = percentageBelow(lowest.price, average);
  const today = new Date(Date.parse(checkedAt) + 9 * 3600000).toISOString().slice(0, 10);
  const days = new Map();
  const previous = history.products?.[identity.id];
  for (const entry of Array.isArray(previous) ? previous : []) {
    if (!entry || typeof entry.date !== "string") continue;
    const timestamp = Date.parse(entry.checked_at);
    if (entry.date !== today && timestamp < Date.parse(checkedAt) && timestamp >= Date.parse(checkedAt) - 120 * 86400000 && positiveNumber(entry.price)) {
      days.set(entry.date, entry.price);
    }
  }
  const historicalPrice = days.size >= 2 ? Math.round(median([...days.values()])) : null;
  const historicalDiscount = historicalPrice ? percentageBelow(lowest.price, historicalPrice) : 0;
  const score = Math.min(100, Math.round(30 + Math.min(40, discount * 2) +
    Math.min(10, historicalDiscount) + Math.min(10, Math.log2(offers.length + 1) * 2.5) +
    lowest.review_average / 5 * 7 + Math.min(3, Math.log10(lowest.review_count + 1))));
  return { rejected, matchedShops: offers.length, product: {
    id: identity.id, product_id: identity.product_id || null,
    product_code: identity.jan || null, model: identity.model || null,
    name: identity.name, category: identity.category, shop: lowest.shop_name,
    price: lowest.price, market_price: Math.round(average), discount_percent: discount,
    historical_price: historicalPrice, historical_discount_percent: historicalDiscount || null,
    offer_count: offers.length, offers,
    score, deal_label: discount >= 15 ? "ショップ間の価格差大" : discount > 0 ? "ショップ間の価格差あり" : "ショップ比較済み",
    reason: `確認した${offers.length}ショップの商品価格を比較。同じ店の重複出品は1件にまとめています。楽天全体の最安値・平均価格を保証するものではありません。`,
    best_url: lowest.url, compare_url: identity.compare_url,
    image_url: identity.image_url || lowest.image_url,
    review_average: lowest.review_average, review_count: lowest.review_count,
    comparison_type: "rakuten_shops", comparison_basis: "listed_price_tax_included",
    checked_at: checkedAt
  } };
}
