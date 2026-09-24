import test from "node:test";
import assert from "node:assert/strict";
import { buildSocialPosts, currentComparisonCandidates, priceDropCandidates, xWeightedLength } from "../lib/social-posts.mjs";

const products = [
  {
    product_code: "4901111784185",
    name: "テスト商品A",
    category: "食品",
    price: 800,
    historical_price: 1000,
    historical_discount_percent: 20,
    offers: [
      { shop_code: "a", price: 800 },
      { shop_code: "b", price: 900 }
    ]
  },
  {
    product_code: "4902530908763",
    name: "テスト商品B",
    category: "家電",
    price: 900,
    historical_price: 1000,
    historical_discount_percent: 10,
    offers: [
      { shop_code: "c", price: 900 },
      { shop_code: "d", price: 950 }
    ]
  }
];

test("price drop candidates require JAN, history and multiple shops", () => {
  const list = priceDropCandidates([
    ...products,
    { ...products[0], product_code: "bad" },
    { ...products[0], historical_price: 700 },
    { ...products[0], offers: [{ shop_code: "a", price: 800 }] }
  ]);
  assert.equal(list.length, 2);
  assert.equal(list[0].product_code, "4901111784185");
});

test("social generator creates safe site-link posts without claiming yesterday price", () => {
  const result = buildSocialPosts(products, {
    generatedAt: "2026-09-22T04:00:00.000Z"
  });
  assert.equal(result.posts.length, 3);
  assert.equal(result.posts[0].type, "roundup");
  assert.ok(result.posts.every(post => post.ready));
  assert.ok(result.posts.every(post => post.text.includes("no1-site.github.io/kyou-no-uriidashi")));
  assert.ok(result.posts.every(post => !post.text.includes("昨日")));
  assert.match(result.posts[1].text, /過去の記録価格/);
  assert.match(result.posts[1].text, /【PR】/);
});

test("current comparison candidates do not require price history", () => {
  const list = currentComparisonCandidates(products.map(product => ({
    ...product,
    historical_price: null,
    historical_discount_percent: null
  })));
  assert.equal(list.length, 2);
});

test("social generator falls back to current-price posts when history is not ready", () => {
  const input = products.map(product => ({
    ...product,
    historical_price: null,
    historical_discount_percent: null
  }));
  const result = buildSocialPosts(input);
  assert.equal(result.history_ready, false);
  assert.equal(result.posts.length, 3);
  assert.equal(result.posts[0].type, "current_roundup");
  assert.ok(result.posts.every(post => !post.text.includes("値下がり")));
  assert.ok(result.posts.every(post => post.text.includes("no1-site.github.io/kyou-no-uriidashi")));
  assert.match(result.posts[1].text, /掲載価格/);
});


test("X weighted length counts Japanese more heavily and URLs as transformed links", () => {
  assert.equal(xWeightedLength("abc"), 3);
  assert.equal(xWeightedLength("価格"), 4);
  assert.equal(xWeightedLength("https://example.com/very/long/path"), 23);
});

test("long Japanese product names are shortened to X's 280 weighted-character limit", () => {
  const longName = "超長い日本語の商品名".repeat(18);
  const input = products.map((product, index) => ({
    ...product,
    name: longName + index
  }));
  const result = buildSocialPosts(input);
  assert.equal(result.posts.length, 3);
  assert.ok(result.posts.every(post => post.ready));
  assert.ok(result.posts.every(post => post.x_weighted_length <= 280));
});
