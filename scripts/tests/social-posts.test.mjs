import test from "node:test";
import assert from "node:assert/strict";
import { buildSocialPosts, priceDropCandidates } from "../lib/social-posts.mjs";

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

test("social generator returns no posts when history is not ready", () => {
  const result = buildSocialPosts([{ ...products[0], historical_price: null }]);
  assert.deepEqual(result.posts, []);
  assert.match(result.reason, /価格履歴/);
});
