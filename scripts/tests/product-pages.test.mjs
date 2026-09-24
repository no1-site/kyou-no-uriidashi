import test from "node:test";
import assert from "node:assert/strict";
import { buildProductSiteAssets, categoryPagePath, productPagePath, renderCategoryPage, renderProductPage, renderRobots, renderSitemap } from "../lib/product-pages.mjs";

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
  assert.match(html, /AggregateOffer/);
  assert.match(html, /BreadcrumbList/);
  assert.match(html, /掲載ショップ/);
  assert.match(html, /G-DM19L1646S/);
  assert.match(html, /googletagmanager\.com\/gtag\/js/);
  assert.doesNotMatch(html, /価格.com/);

  const malicious = renderProductPage({ ...product, name: '<script>alert("x")</script>' });
  assert.doesNotMatch(malicious, /<script>alert/);
  assert.match(malicious, /&lt;script&gt;/);
  assert.match(malicious, /\\u003cscript/);
});

test("category pages use stable slugs and contain crawlable product links", () => {
  assert.equal(categoryPagePath("食品"), "categories/food.html");
  const html = renderCategoryPage("食品", [product]);
  assert.match(html, /食品の価格比較/);
  assert.match(html, /\.\.\/products\/4901111784185\.html/);
  assert.match(html, /rel="canonical"/);
  assert.match(html, /G-DM19L1646S/);
  assert.match(html, /googletagmanager\.com\/gtag\/js/);
});

test("robots advertises the absolute sitemap URL", () => {
  const text = renderRobots();
  assert.match(text, /User-agent: \*/);
  assert.match(text, /Allow: \//);
  assert.match(text, /Sitemap: https:\/\/no1-site\.github\.io\/kyou-no-uriidashi\/sitemap\.xml/);
});

test("sitemap contains category pages and every valid product page with lastmod", () => {
  const xml = renderSitemap([product, { ...product, product_code: "bad" }]);
  assert.match(xml, /https:\/\/no1-site\.github\.io\/kyou-no-uriidashi\//);
  assert.match(xml, /categories\/food\.html/);
  assert.match(xml, /categories\/kaden\.html/);
  assert.match(xml, /products\/4901111784185\.html/);
  assert.match(xml, /<lastmod>2026-09-21<\/lastmod>/);
  assert.equal((xml.match(/products\//g) || []).length, 1);
});

test("site asset builder emits product, six categories, sitemap and robots", () => {
  const assets = buildProductSiteAssets([product]);
  const paths = assets.map(asset => asset.path);
  assert.equal(paths.length, 9);
  assert.ok(paths.includes("products/4901111784185.html"));
  assert.ok(paths.includes("categories/food.html"));
  assert.ok(paths.includes("categories/kaden.html"));
  assert.ok(paths.includes("sitemap.xml"));
  assert.ok(paths.includes("robots.txt"));
  assert.ok(assets.every(asset => typeof asset.content === "string" && asset.content.length > 20));
});
