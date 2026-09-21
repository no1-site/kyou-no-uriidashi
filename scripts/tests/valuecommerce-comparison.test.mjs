import test from "node:test";
import assert from "node:assert/strict";
import { evaluateValueCommerceOffer, mergeValueCommerceOffers } from "../lib/valuecommerce-comparison.mjs";

const jan = "4901111784185";
const product = {
  product_code: jan,
  name: "AGF ブレンディ インスタントコーヒー 袋 詰め替え(200g)",
  brand: "ブレンディ",
  model: "",
  offers: [{
    shop_code: "rakuten:one", shop_name: "楽天店", item_code: "one",
    item_name: "AGF ブレンディ インスタントコーヒー 袋 詰め替え(200g)",
    price: 1000, url: "https://example.com/r", postage: "included"
  }],
  marketplaces: ["楽天市場"]
};

function item(overrides = {}) {
  return {
    title: "AGF ブレンディ インスタントコーヒー 袋 詰め替え(200g)",
    description: "200g",
    link: "https://ck.jp.ap.valuecommerce.com/example",
    merchantName: "ヤマダウェブコム",
    ecCode: "YD001",
    janCode: jan,
    productCode: "abc",
    price: 980,
    product_category: "新品",
    stock: "在庫有り",
    postage: "なし",
    ...overrides
  };
}

test("ValueCommerce accepts exact-JAN allowed merchant and maps shipping", () => {
  const { offer } = evaluateValueCommerceOffer(item(), jan, product, ["YD001"]);
  assert.equal(offer.shop_code, "valuecommerce:YD001");
  assert.equal(offer.price, 980);
  assert.equal(offer.postage, "included");
  assert.equal(offer.marketplace_code, "valuecommerce");
});

test("ValueCommerce rejects wrong JAN, used goods and unapproved merchants", () => {
  assert.equal(evaluateValueCommerceOffer(item({ janCode: "4901111776807" }), jan, product, ["YD001"]).reason, "jan_mismatch");
  assert.equal(evaluateValueCommerceOffer(item({ product_category: "中古" }), jan, product, ["YD001"]).reason, "condition");
  assert.equal(evaluateValueCommerceOffer(item({ ecCode: "OTHER" }), jan, product, ["YD001"]).reason, "merchant_not_allowed");
});

test("ValueCommerce merge adds one offer per merchant and keeps cheapest result", () => {
  const result = mergeValueCommerceOffers(product, [item({ price: 990 }), item({ price: 970 })], ["YD001"]);
  assert.equal(result.added, 1);
  const vc = result.product.offers.find(offer => offer.marketplace_code === "valuecommerce");
  assert.equal(vc.price, 970);
  assert.equal(result.rejected.duplicate_shop, 1);
});
