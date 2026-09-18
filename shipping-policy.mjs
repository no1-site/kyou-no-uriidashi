// Shared by the updater and the browser. No shipping amount is inferred.
export const shippingPolicyVersion = "postage-subset-v2";

export function effectivePostage(offer) {
  const status = offer?.postage;
  if (!["included", "extra"].includes(status)) return "unknown";
  const title = String(offer.item_name || "").normalize("NFKC").toLowerCase();
  const free = /送料無料|送料込/.test(title);
  const extra = /送料別|別途送料|送料都度見積|送料.{0,6}見積|着払い/.test(title);
  const conditional = /(?:以上|まとめ買い|同時購入).{0,12}(?:送料無料|送料込)/.test(title);
  if (conditional || (free && extra) || (status === "extra" && free) || (status === "included" && extra)) return "unknown";
  return status;
}

export function includedOffers(offers) {
  const shops = new Map();
  for (const o of Array.isArray(offers) ? offers : []) {
    if (!o?.shop_code || !Number.isFinite(Number(o.price)) || Number(o.price) <= 0 || effectivePostage(o) !== "included") continue;
    const previous = shops.get(o.shop_code);
    if (!previous || Number(o.price) < Number(previous.price)) shops.set(o.shop_code, o);
  }
  return [...shops.values()].sort((a, b) => Number(a.price) - Number(b.price));
}

export function canRankPriceOffers(offers) {
  return includedOffers(offers).length >= 2;
}

export function postageLabel(offer) {
  const status = effectivePostage(offer);
  return status === "included" ? "送料込み表示" : status === "extra" ? "別途送料" : "送料要確認";
}

export function applyShippingPolicy(product) {
  if (product.comparison_type !== "rakuten_shops") return product;
  const included = includedOffers(product.offers);
  const ready = included.length >= 2;
  const sameHistoryBasis = product.shipping_policy_version === shippingPolicyVersion;
  const historicalPrice = ready && sameHistoryBasis ? product.historical_price : null;
  const lowest = ready ? included[0] : [...(product.offers || [])].sort((a, b) => Number(a.price) - Number(b.price))[0];
  const historicalDiscount = historicalPrice > lowest?.price
    ? Math.floor((historicalPrice - lowest.price) / historicalPrice * 100) : null;
  const average = ready ? included.reduce((sum, o) => sum + Number(o.price), 0) / included.length : null;
  const discount = ready && average > lowest.price
    ? Math.floor((average - lowest.price) / average * 100) : 0;
  const score = ready ? Math.min(100, Math.round(30 + Math.min(40, discount * 2) +
    Math.min(10, historicalDiscount || 0) + Math.min(10, Math.log2(included.length + 1) * 2.5) +
    (lowest.review_average || 0) / 5 * 7 + Math.min(3, Math.log10((lowest.review_count || 0) + 1)))) : null;
  return {
    ...product, shipping_policy_version: shippingPolicyVersion,
    ...(lowest ? { price: Number(lowest.price), shop: lowest.shop_name, best_url: lowest.url,
      review_average: lowest.review_average || 0, review_count: lowest.review_count || 0 } : {}),
    market_price: ready ? Math.round(average) : product.market_price,
    shipping_offer_count: included.length,
    shipping_reference_count: (product.offers?.length || 0) - included.length,
    shipping_comparison: ready ? "included" : "price_only",
    discount_percent: ready ? discount : null, score,
    historical_price: historicalPrice, historical_discount_percent: historicalDiscount,
    deal_label: ready ? "送料込み表示の店を比較" : "送料確認が必要",
    reason: ready
      ? `送料込み表示の${included.length}ショップだけで比較しています。送料別・未確認の店は参考欄に掲載し、平均・スコアに含めません。配送先などの条件は各店で確認してください。楽天全体の最安値を保証するものではありません。`
      : `送料込み表示の店が2店に満たないため、各店の商品価格を参考として掲載しています。支払総額の順位ではありません。`
  };
}
