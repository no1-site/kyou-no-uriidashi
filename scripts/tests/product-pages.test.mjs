import test from "node:test";
import assert from "node:assert/strict";
import { buildProductSiteAssets, productPagePath, renderProductPage, renderSitemap } from "../lib/product-pages.mjs";

const product = {
  id: "rakuten_shops:jan:4901111784185",
  product_code: "4901111784185",
  name: "AGF ブレンディ インスタントコーヒー 袋 詰め替え(200g)",
  category: "食品",
  brand: "ブレンディ",
  price: 980,
  image_url: "https://example.com/item.jpg",
  checked_at: "2026-09-21T01:10:00.000Z",
  offers: [
    { shop_code: "rakuten:a", shop_name: "楽天A", price: 980, url: "https://example.com/a", postage: "included", marketplace: "楽天市場" },
    { shop_code: "yahoo:b", shop_name: "Yahoo!ショッピング｜B店", price: 1000, url: "https://example.com/b", postage: "unknown", marketplace: "Yahoo!ショッピング" }
  ]
};

test("product page path is a stable JAN URL", () => {
  assert.equal(productPagePath(product), "products/4901111784185.html");
  assert.equal(productPagePath({ product_code: "not-a-jan" }), "");
});

test("product page renders static SEO metadata, shop links and safe markup", () => {
  const html = renderProductPage(product);
  assert.match(html, /<title>AGF ブレンディ/);
  assert.match(html, /rel="canonical" href="https:\/\/no1-site\.github\.io\/kyou-no-uriidashi\/products\/4901111784185\.html"/);
  assert.match(html, /楽天A/);
  assert.match(html, /Yahoo!ショッピング｜B店/);
  assert.match(html, /掲載ショップ内の現在価格/);
  assert.match(html, /application\/ld\+json/);
  assert.doesNotMatch(html, /価格.com/);

  const malicious = renderProductPage({ ...product, name: '<script>alert("x")</script>' });
  assert.doesNotMatch(malicious, /<script>alert/);
  assert.match(malicious, /&lt;script&gt;/);
  assert.match(malicious, /\\u003cscript/);
});

test("sitemap contains static pages and every valid product page with lastmod", () => {
  const xml = renderSitemap([product, { ...product, product_code: "bad" }]);
  assert.match(xml, /https:\/\/no1-site\.github\.io\/kyou-no-uriidashi\//);
  assert.match(xml, /products\/4901111784185\.html/);
  assert.match(xml, /<lastmod>2026-09-21<\/lastmod>/);
  assert.equal((xml.match(/products\//g) || []).length, 1);
});

test("site asset builder emits one page per JAN plus sitemap", () => {
  const assets = buildProductSiteAssets([product]);
  assert.deepEqual(assets.map(asset => asset.path), ["products/4901111784185.html", "sitemap.xml"]);
  assert.ok(assets.every(asset => typeof asset.content === "string" && asset.content.length > 100));
});
