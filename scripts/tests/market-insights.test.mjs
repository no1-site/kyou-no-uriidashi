import test from "node:test";
import assert from "node:assert/strict";
import { buildRakutenYahooInsights } from "../lib/market-insights.mjs";

const products = [
  {
    product_code: "4901111784185",
    name: "商品A",
    category: "日用品",
    offers: [
      { shop_code: "rakuten:a", marketplace_code: "rakuten", price: 900, postage: "included" },
      { shop_code: "rakuten:b", marketplace_code: "rakuten", price: 950, postage: "extra" },
      { shop_code: "yahoo:a", marketplace_code: "yahoo", price: 1000, postage: "included" }
    ]
  },
  {
    product_code: "4902530908763",
    name: "商品B",
    category: "家電",
    offers: [
      { shop_code: "rakuten:c", marketplace_code: "rakuten", price: 1200, postage: "included" },
      { shop_code: "yahoo:c", marketplace_code: "yahoo", price: 1000, postage: "included" }
    ]
  },
  {
    product_code: "4900000000009",
    name: "商品C",
    category: "家電",
    offers: [
      { shop_code: "rakuten:d", marketplace_code: "rakuten", price: 500, postage: "extra" },
      { shop_code: "yahoo:d", marketplace_code: "yahoo", price: 500, postage: "unknown" }
    ]
  },
  {
    product_code: "4900000000016",
    name: "楽天だけの商品",
    category: "食品",
    offers: [
      { shop_code: "rakuten:e", marketplace_code: "rakuten", price: 300, postage: "included" }
    ]
  }
];

test("Rakuten/Yahoo insights compare only products present on both marketplaces", () => {
  const result = buildRakutenYahooInsights(products);
  assert.equal(result.tracked_products, 4);
  assert.equal(result.listed.comparable, 3);
  assert.equal(result.listed.rakuten_wins, 1);
  assert.equal(result.listed.yahoo_wins, 1);
  assert.equal(result.listed.ties, 1);
  assert.equal(result.listed.average_gap_yen, 100);
  assert.equal(result.listed.max_gap_yen, 200);
  assert.equal(result.listed.max_gap.name, "商品B");
});

test("shipping-included insight uses only products with included offers on both marketplaces", () => {
  const result = buildRakutenYahooInsights(products);
  assert.equal(result.shipping_included.comparable, 2);
  assert.equal(result.shipping_included.rakuten_wins, 1);
  assert.equal(result.shipping_included.yahoo_wins, 1);
  assert.equal(result.shipping_included.ties, 0);
});

test("category summary keeps winner counts transparent", () => {
  const result = buildRakutenYahooInsights(products);
  const kaden = result.categories.find(row => row.category === "家電");
  assert.deepEqual(kaden, {
    category: "家電",
    comparable: 2,
    rakuten_wins: 0,
    yahoo_wins: 1,
    ties: 1
  });
});
