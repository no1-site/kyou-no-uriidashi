import test from "node:test";
import assert from "node:assert/strict";
import { buildComparison, productIdentity } from "../lib/rakuten-comparison.mjs";
import { mergeYahooOffers } from "../lib/yahoo-comparison.mjs";
import { finalizeProducts, validatePublication, maximumPublicationPrice } from "../lib/publication.mjs";

export function sampleProduct() {
  const identity = productIdentity({ productName: "テスト洗剤500ml", productCode: "4901234567894" }, "日用品");
  return buildComparison(identity, [800, 1000].map((price, index) => ({
    itemName: "テスト洗剤500ml", itemCaption: "JAN 4901234567894", itemPrice: price,
    shopCode: `r${index}`, shopName: `楽天${index}`, itemCode: `r${index}:one`,
    itemUrl: `https://example.com/r${index}`, availability: 1, taxFlag: 0, postageFlag: 0
  }))).product;
}

test("final shipping counts, marketplaces and collection summary come from merged offers", () => {
  const original = sampleProduct();
  original.offers[1].postage = "extra";
  original.collection_summary = { shipping_included_compared: 0, categories: [{ category: "日用品", compared: 99 }] };
  const merged = mergeYahooOffers(original, [
    { name: original.name, janCode: original.product_code, condition: "new", inStock: true, price: 900,
      url: "https://example.com/y", seller: { sellerId: "y", name: "Y店" }, shipping: { code: 2 } },
    { name: original.name, janCode: original.product_code, condition: "new", inStock: true, price: 700,
      url: "https://example.com/z", seller: { sellerId: "z", name: "Z店" }, shipping: { code: 3 } }
  ]).product;
  const [product] = finalizeProducts([merged]);
  assert.equal(product.offer_count, 4);
  assert.equal(product.shipping_offer_count, 2);
  assert.equal(product.shipping_reference_count, 2);
  assert.equal(product.price, 800);
  assert.equal(product.market_price, 850);
  assert.deepEqual(product.marketplaces, ["楽天市場", "Yahoo!ショッピング"]);
  assert.equal(product.comparison_scope, "楽天市場・Yahoo!ショッピング");
  assert.equal(product.collection_summary.shipping_included_compared, 1);
  assert.equal(product.collection_summary.categories[0].compared, 1);
  assert.equal(validatePublication([product]), true);
});

test("finalizer holds the entire excessive-spread comparison without cherry-picking", () => {
  const product = sampleProduct();
  product.offers[1].price = 3000;
  const finalized = finalizeProducts([product]);
  assert.equal(finalized[0].comparison_hold_reason, "price_spread_unconfirmed");
  assert.equal(finalized[0].score, null);
  assert.equal(finalized[0].market_price, null);
  assert.equal(finalized[0].offers.length, 2);
  assert.equal(finalized[0].collection_summary.comparison_held, 1);
  assert.equal(finalized[0].collection_summary.shipping_included_compared, 0);
  assert.equal(validatePublication(finalized), true);
});

test("publication rejects duplicate shops/products and mismatched or missing JAN evidence", () => {
  for (const mutate of [
    p => p.offers.push({ ...p.offers[0] }),
    p => { p.offers[0].matched_jan = "4905524535815"; },
    p => { delete p.offers[0].matched_jan; }
  ]) {
    const product = sampleProduct();
    mutate(product);
    assert.throws(() => finalizeProducts([product]), /Publication validation/);
  }
  assert.throws(() => finalizeProducts([sampleProduct(), sampleProduct()]), /duplicate/);
});

test("publication rejects invalid and operationally abnormal prices before recalculation", () => {
  for (const price of [0, -1, Infinity, NaN, 1.5, "800", maximumPublicationPrice + 1]) {
    const product = sampleProduct();
    product.offers[0].price = price;
    assert.throws(() => finalizeProducts([product]), /invalid_offer/);
  }
});

test("publication rejects count collapse and tampered shipping aggregates", () => {
  const products = finalizeProducts([sampleProduct()]);
  assert.throws(() => validatePublication(products, Array(11).fill(sampleProduct())), /product_count_drop/);
  products[0].shipping_offer_count = 99;
  assert.throws(() => validatePublication(products), /inconsistent_shipping_offer_count/);
});

test("conditional shipping stays reference-only and cannot be promoted by counts", () => {
  const product = sampleProduct();
  product.offers[0].item_name += " 3980円以上で送料無料";
  const products = finalizeProducts([product]);
  assert.equal(products[0].offers[0].postage, "unknown");
  assert.equal(products[0].shipping_offer_count, 1);
  assert.equal(products[0].shipping_reference_count, 1);
  assert.equal(products[0].score, null);
  assert.equal(validatePublication(products), true);
});
