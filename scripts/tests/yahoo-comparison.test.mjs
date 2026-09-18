import test from "node:test";
import assert from "node:assert/strict";
import { yahooOffer, mergeYahooOffers } from "../lib/yahoo-comparison.mjs";

const jan = "4905524535815";

function hit(overrides = {}) {
  return {
    name: "テスト商品",
    url: "https://store.shopping.yahoo.co.jp/test/item.html",
    code: "test_item",
    condition: "new",
    inStock: true,
    janCode: jan,
    price: 9800,
    shipping: { code: 2, name: "送料無料" },
    seller: { sellerId: "teststore", name: "テストストア" },
    review: { rate: 4.5, count: 12 },
    image: { medium: "https://item-shopping.c.yimg.jp/i/g/test_item" },
    ...overrides
  };
}

test("Yahoo offer requires exact JAN", () => {
  assert.equal(yahooOffer(hit({ janCode: "4905524535816" }), jan), null);
  assert.equal(yahooOffer(hit(), jan)?.shop_code, "yahoo:teststore");
});

test("Yahoo shipping code 2 is included", () => {
  assert.equal(yahooOffer(hit(), jan)?.postage, "included");
  assert.equal(yahooOffer(hit({ shipping: { code: 3 } }), jan)?.postage, "unknown");
});

test("Yahoo offer is merged without replacing Rakuten offers", () => {
  const product = {
    product_code: jan,
    comparison_type: "rakuten_shops",
    shipping_policy_version: "postage-subset-v2",
    offers: [
      { shop_code: "r1", shop_name: "楽天1", item_name: "テスト商品", price: 10000, url: "https://example.com/1", postage: "included" },
      { shop_code: "r2", shop_name: "楽天2", item_name: "テスト商品", price: 11000, url: "https://example.com/2", postage: "included" }
    ],
    price: 10000,
    market_price: 10500,
    historical_price: null,
    historical_discount_percent: null
  };
  const result = mergeYahooOffers(product, [hit()]);
  assert.equal(result.added, 1);
  assert.equal(result.product.offers.length, 3);
  assert.equal(result.product.price, 9800);
  assert.deepEqual(result.product.marketplaces, ["楽天市場", "Yahoo!ショッピング"]);
});
