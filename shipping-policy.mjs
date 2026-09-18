// Shared by the updater and the browser. No shipping amount is inferred.
export const shippingPolicyVersion = "postage-v1";

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

export function canRankPriceOffers(offers) {
  return Array.isArray(offers) && offers.length >= 2 &&
    new Set(offers.map(o => o?.shop_code)).size === offers.length &&
    offers.every(o => o?.shop_code && Number.isFinite(Number(o.price)) && Number(o.price) > 0 && effectivePostage(o) === "included");
}

export function postageLabel(offer) {
  const status = effectivePostage(offer);
  return status === "included" ? "送料込み表示" : status === "extra" ? "別途送料" : "送料要確認";
}

export function applyShippingPolicy(product) {
  if (product.comparison_type !== "rakuten_shops") return product;
  const ready = canRankPriceOffers(product.offers);
  const sameHistoryBasis = product.shipping_policy_version === shippingPolicyVersion;
  const historicalPrice = ready && sameHistoryBasis ? product.historical_price : null;
  const historicalDiscount = ready && sameHistoryBasis ? product.historical_discount_percent : null;
  const average = ready ? product.offers.reduce((sum, o) => sum + Number(o.price), 0) / product.offers.length : null;
  const discount = ready && average > product.price
    ? Math.floor((average - product.price) / average * 100) : 0;
  const lowest = product.offers?.[0];
  const score = ready ? Math.min(100, Math.round(30 + Math.min(40, discount * 2) +
    Math.min(10, historicalDiscount || 0) + Math.min(10, Math.log2(product.offers.length + 1) * 2.5) +
    (lowest.review_average || 0) / 5 * 7 + Math.min(3, Math.log10((lowest.review_count || 0) + 1)))) : null;
  return {
    ...product, shipping_policy_version: shippingPolicyVersion,
    shipping_comparison: ready ? "included" : "price_only",
    discount_percent: ready ? discount : null, score,
    historical_price: historicalPrice, historical_discount_percent: historicalDiscount,
    deal_label: ready ? "送料込み表示の店を比較" : "送料確認が必要",
    reason: ready
      ? `送料込み表示の${product.offers.length}ショップの商品価格を比較しています。配送先などの適用条件は各店で確認してください。楽天全体の最安値・平均価格を保証するものではありません。`
      : `確認した${product.offers?.length || 0}ショップの商品価格を掲載しています。送料別・送料未確認の出品があるため、安さの判定は保留しています。支払総額の順位ではありません。`
  };
}
