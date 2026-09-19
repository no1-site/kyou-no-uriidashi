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

const soap = { name: "テスト社 洗剤 SOAP-500-W 500ml", model: "SOAP-500-W", product_code: jan };

test("Yahoo rejects capacity differences and missing capacity despite exact JAN", () => {
  for (const name of ["テスト社 洗剤 SOAP-500-W 1L", "テスト社 洗剤 SOAP-500-W"]) {
    assert.equal(yahooOffer(hit({ name }), jan, soap), null, name);
  }
  assert.ok(yahooOffer(hit({ name: "テスト社 洗剤 SOAP-500-W 0.5L" }), jan, soap));
  assert.equal(yahooOffer(hit({ name: soap.name, description: "内容量：1000ml" }), jan, soap), null);
});

test("Yahoo rejects quantity differences including single versus multiple retail units", () => {
  const pack = { name: "洗剤14個入", product_code: jan };
  for (const name of ["洗剤7個入", "洗剤1個", "洗剤"]) {
    assert.equal(yahooOffer(hit({ name }), jan, pack), null);
  }
  assert.ok(yahooOffer(hit({ name: "洗剤14個入" }), jan, pack));
  assert.equal(yahooOffer(hit({ name: soap.name, description: "入数：50" }), jan, soap), null);
});

test("Yahoo rejects bundles, choices and extra quantities in title or description", () => {
  for (const extra of ["2本セット", "×2", "まとめ買い", "おまけ", "選べる", "3本"]) {
    assert.equal(yahooOffer(hit({ name: `${soap.name} ${extra}` }), jan, soap), null, extra);
    assert.equal(yahooOffer(hit({ name: soap.name, description: extra }), jan, soap), null, extra);
  }
});

test("Yahoo requires the full source model and rejects missing/suffix variant models", () => {
  for (const name of ["テスト社 洗剤 SOAP-500-B 500ml", "テスト社 洗剤 SOAP-500-WX 500ml", "テスト社 洗剤 500ml"]) {
    assert.equal(yahooOffer(hit({ name }), jan, soap), null, name);
  }
  assert.ok(yahooOffer(hit({ name: soap.name }), jan, soap));
  assert.equal(yahooOffer(hit({ name: soap.name, description: "型番：SOAP-500-B" }), jan, soap), null);
});

test("Yahoo rejects used, unspecified condition, accessories and conflicting JAN evidence", () => {
  for (const overrides of [
    { condition: "used" }, { condition: undefined }, { inStock: false },
    { description: "中古 開封品" }, { description: "互換商品" },
    { description: "JAN 4901234567894" }, { price: 0 }, { price: -1 }
  ]) assert.equal(yahooOffer(hit({ name: soap.name, ...overrides }), jan, soap), null);
});
