import test from "node:test";
import assert from "node:assert/strict";
import { keepaAmazonOffer, mergeKeepaAmazon } from "../lib/keepa-comparison.mjs";

const jan = "4903320160354";

function keepa(overrides = {}) {
  return {
    asin: "B012345678",
    domainId: 5,
    productType: 0,
    title: "レック バルサン スティック掃除機対応 ふとん圧縮袋 L 2枚入 H00381",
    eanList: [jan],
    model: "H00381",
    stats: { current: Array.from({ length: 36 }, (_, i) => i === 18 ? 1280 : -1) },
    images: [{ m: "test.jpg" }],
    lastUpdate: 123456,
    ...overrides
  };
}

const source = {
  product_code: jan,
  model: "H00381",
  name: "バルサン スティック掃除機対応 ふとん圧縮袋 L(2枚入)",
  comparison_type: "rakuten_shops",
  shipping_policy_version: "postage-subset-v2",
  offers: [
    { shop_code: "r1", shop_name: "楽天1", item_name: "商品", price: 1500, url: "https://example.com/1", postage: "included" },
    { shop_code: "yahoo:y1", shop_name: "Yahoo!ショッピング｜店1", item_name: "商品", price: 1400, url: "https://example.com/2", postage: "included", marketplace: "Yahoo!ショッピング" }
  ],
  marketplaces: ["楽天市場", "Yahoo!ショッピング"],
  price: 1400,
  market_price: 1450
};

test("Keepa exact JAN and buy box shipping creates Amazon offer", () => {
  const offer = keepaAmazonOffer(source, [keepa()]);
  assert.equal(offer?.shop_name, "Amazon.co.jp");
  assert.equal(offer?.price, 1280);
  assert.equal(offer?.postage, "included");
  assert.equal(offer?.price_basis, "keepa_buy_box_shipping");
});

test("Keepa rejects a different EAN", () => {
  const offer = keepaAmazonOffer(source, [keepa({ eanList: ["4903320160361"] })]);
  assert.equal(offer, null);
});

test("Marketplace new fallback is reference-only when buy box is missing", () => {
  const current = Array(36).fill(-1);
  current[1] = 1200;
  const offer = keepaAmazonOffer(source, [keepa({ stats: { current } })]);
  assert.equal(offer?.price, 1200);
  assert.equal(offer?.postage, "unknown");
});

test("Amazon offer merges with Rakuten and Yahoo offers", () => {
  const result = mergeKeepaAmazon(source, [keepa()]);
  assert.equal(result.added, 1);
  assert.equal(result.product.offers.length, 3);
  assert.deepEqual(result.product.marketplaces, ["楽天市場", "Yahoo!ショッピング", "Amazon.co.jp"]);
  assert.equal(result.product.price, 1280);
});
