import test from "node:test";
import assert from "node:assert/strict";
import { readFile, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import vm from "node:vm";
import { productIdentity, validJAN, matchOffer, buildComparison } from "../lib/rakuten-comparison.mjs";

const catalog = {
  productId: "soap", productCode: "4901234567894", productName: "テスト社 洗剤 500ml",
  productNo: "SOAP-500-W", brandName: "テスト社", productUrlPC: "https://example.com/product",
  averagePrice: null, usedExcludeSalesMinPrice: null, usedExcludeSalesItemCount: null, salesMinPrice: 500
};
const identity = productIdentity(catalog, "日用品");
function item(shop = "one", price = 1000, overrides = {}) {
  return {
    itemCode: `${shop}:soap`, shopCode: shop, shopName: `${shop}店`,
    itemName: "テスト社 洗剤 500ml", itemCaption: "JANコード：4901234567894",
    itemPrice: price, availability: 1, taxFlag: 0, postageFlag: 1,
    itemUrl: `https://example.com/${shop}`, reviewAverage: 4.2, reviewCount: 100,
    ...overrides
  };
}

test("catalog null prices do not prevent a comparison from real shop listings", () => {
  const { product } = buildComparison(identity, [item("one", 800), item("two", 1000), item("three", 1200)]);
  assert.equal(product.price, 800);
  assert.equal(product.market_price, 1000);
  assert.equal(product.discount_percent, 20);
  assert.equal(product.offer_count, 3);
  assert.equal(product.comparison_type, "rakuten_shops");
  assert.equal(product.best_url, "https://example.com/one");
});

test("JAN checksums and full-width digits; a keyword search hit alone is not proof", () => {
  assert.equal(validJAN("４９０１２３４５６７８９４"), "4901234567894");
  assert.equal(validJAN("4901234567895"), "");
  assert.equal(validJAN("0000000000000"), "");
  assert.equal(matchOffer(identity, item("one", 1000, { itemCaption: "人気の洗剤です" })).reason, "identity_unconfirmed");
  assert.ok(matchOffer(identity, item("one", 1000, { itemCaption: "JAN：４９０１２３４５６７８９４" })).offer);
});

test("same shop cannot count twice or skew the average", () => {
  const { product } = buildComparison(identity, [item("one", 800), item("one", 5000), item("two", 1200)]);
  assert.equal(product.offer_count, 2);
  assert.equal(product.market_price, 1000);
  assert.equal(buildComparison(identity, [item("one", 800), item("one", 1000)]).product, null);
});

test("packs, capacity changes, choices, condition and accessory alternatives are excluded", () => {
  for (const title of ["テスト社 洗剤 500ml 2本セット", "テスト社 洗剤 500ml×2", "テスト社 洗剤 500ml×12 送料無料", "テスト社 洗剤 1L", "テスト社 洗剤 500ml 3個", "テスト社 洗剤 選べる500ml", "中古 テスト社 洗剤500ml", "お試し テスト社 洗剤500ml", "テスト社 洗剤500ml用 専用カバー"]) {
    assert.ok(!matchOffer(identity, item("one", 800, { itemName: title })).offer, title);
  }
  assert.ok(matchOffer(identity, item("one", 800, { itemName: "テスト社 洗剤 0.5L" })).offer);
  assert.equal(matchOffer(identity, item("one", 800, { itemCaption: "JAN 4901234567894 / 4901234567887" })).reason, "conflicting_jan");
  assert.equal(matchOffer(identity, item("one", 800, { itemCaption: "JAN 4901234567894 内容量：500ml×10本" })).reason, "variant_or_bundle");
  assert.equal(matchOffer(identity, item("one", 800, { itemCaption: "JAN 4901234567894 販売単位：2本" })).reason, "quantity_mismatch");
});

test("stock, tax, time-limited offers and variable SKU prices are checked", () => {
  for (const overrides of [
    { availability: 0 }, { taxFlag: 1 }, { taxFlag: null },
    { itemPriceMin3: 800, itemPriceMax3: 1800 },
    { itemPriceMin1: 700, itemPriceMax1: 800 },
    { itemPrice: 0 }, { itemUrl: "javascript:alert(1)" },
    { startTime: "2099-01-01 00:00" }, { endTime: "2001-01-01 00:00" }
  ]) assert.ok(!matchOffer(identity, item("one", 800, overrides)).offer, JSON.stringify(overrides));
});

test("model matching keeps brand, full suffix and capacity significant", () => {
  const base = item("one", 800, { itemCaption: "", itemName: "テスト社 SOAP-500-W 洗剤 500ml" });
  assert.equal(matchOffer(identity, base).offer.match_method, "model_brand");
  for (const title of ["別メーカー SOAP-500-W 500ml", "テスト社 SOAP-500-B 500ml", "テスト社 SOAP-500-WX 500ml", "テスト社 SOAP-500-W", "テスト社 SOAP-500-W 1000ml"]) {
    assert.ok(!matchOffer(identity, { ...base, itemName: title }).offer, title);
  }
});

test("equal prices are still a completed comparison; postage stays separate", () => {
  const { product } = buildComparison(identity, [item("one", 1000, { postageFlag: 0 }), item("two", 1000)]);
  assert.equal(product.discount_percent, 0);
  assert.equal(product.deal_label, "ショップ比較済み");
  assert.deepEqual(product.offers.map(o => o.postage), ["included", "extra"]);
});

test("history excludes today and stale records and requires two distinct prior days", () => {
  const history = { products: { [identity.id]: [
    { date: "2026-09-16", price: 1100, checked_at: "2026-09-16T00:00:00Z" },
    { date: "2026-09-15", price: 1300, checked_at: "2026-09-15T00:00:00Z" },
    { date: "2026-09-17", price: 5000, checked_at: "2026-09-17T00:00:00Z" },
    { date: "2025-01-01", price: 99999, checked_at: "2025-01-01T00:00:00Z" }
  ] } };
  const { product } = buildComparison(identity, [item("one", 800), item("two", 1000)], { history, checkedAt: "2026-09-17T01:00:00Z" });
  assert.equal(product.historical_price, 1200);
});

test("pipeline produces 12 comparisons with null catalog averages and publishes only safe diagnostic counts", async () => {
  const directory = await mkdtemp(join(tmpdir(), "shop-compare-test-"));
  const output = join(directory, "products.json");
  const result = spawnSync(process.execPath, ["--import", fileURLToPath(new URL("./fixtures/mock-rakuten.mjs", import.meta.url)), fileURLToPath(new URL("../fetch-rakuten.mjs", import.meta.url))], {
    encoding: "utf8", env: { ...process.env, RAKUTEN_APPLICATION_ID: "private-test-app", RAKUTEN_ACCESS_KEY: "private-test-key", RAKUTEN_REQUEST_INTERVAL_MS: "0", RAKUTEN_OUTPUT_PATH: output, RAKUTEN_HISTORY_PATH: join(directory, "history.json") }
  });
  assert.equal(result.status, 0, result.stderr);
  const content = await readFile(output, "utf8");
  const products = JSON.parse(content);
  assert.equal(products.length, 12);
  assert.equal(products.filter(p => p.comparison_type === "rakuten_shops").length, 12);
  assert.equal(new Set(products.map(p => p.id)).size, 12);
  assert.ok(products.every(p => p.offers.length === 2 && p.market_price === 1000));
  assert.equal(products[0].collection_summary.version, "shop-comparison-v1");
  assert.ok(!content.includes("private-test"));
  assert.ok(!result.stdout.includes("private-test"));
});

test("pipeline preserves the previous file on authentication failure, and distinguishes a reference-only run", async () => {
  const directory = await mkdtemp(join(tmpdir(), "shop-failure-test-"));
  const output = join(directory, "products.json");
  const env = { ...process.env, RAKUTEN_APPLICATION_ID: "test", RAKUTEN_ACCESS_KEY: "test", RAKUTEN_REQUEST_INTERVAL_MS: "0", RAKUTEN_OUTPUT_PATH: output, RAKUTEN_HISTORY_PATH: join(directory, "history.json") };
  const args = ["--import", fileURLToPath(new URL("./fixtures/mock-rakuten.mjs", import.meta.url)), fileURLToPath(new URL("../fetch-rakuten.mjs", import.meta.url))];
  await writeFile(output, "previous data");
  const denied = spawnSync(process.execPath, args, { encoding: "utf8", env: { ...env, MOCK_SCENARIO: "denied" } });
  assert.notEqual(denied.status, 0);
  assert.equal(await readFile(output, "utf8"), "previous data");
  const reference = spawnSync(process.execPath, args, { encoding: "utf8", env: { ...env, MOCK_SCENARIO: "unmatched" } });
  assert.equal(reference.status, 0, reference.stderr);
  const products = JSON.parse(await readFile(output, "utf8"));
  assert.equal(products[0].collection_summary.compared, 0);
  assert.ok(products.every(p => p.score === null && p.offers.length === 0));
  assert.match(reference.stdout, /no shop comparison was confirmed/);
});

test("UI shows shop links at equal prices, escapes labels and marks legacy data unconfirmed", async () => {
  const nodes = new Map(["#dealGrid", "#signalScore", "#signalLabel", "#signalText", "#dealHeading", "#updated"].map(id => [id, { textContent: "", innerHTML: "", addEventListener() {} }]));
  const context = vm.createContext({ URL, console, document: {
    querySelector: id => nodes.get(id), querySelectorAll: () => []
  }, window: {} });
  const source = (await readFile(new URL("../../app.js", import.meta.url), "utf8")).replace(/loadDeals\(\);\s*$/, "");
  vm.runInContext(source, context);
  const product = buildComparison(identity, [item("one", 1000, { shopName: "<img src=x onerror=alert(1)>" }), item("two", 1000)]).product;
  context.testProduct = product;
  vm.runInContext("deals = [testProduct]; render('all'); updateSignal();", context);
  assert.match(nodes.get("#dealGrid").innerHTML, /offer-table/);
  assert.match(nodes.get("#dealGrid").innerHTML, /https:\/\/example.com\/one/);
  assert.match(nodes.get("#dealGrid").innerHTML, /&lt;img/);
  assert.doesNotMatch(nodes.get("#dealGrid").innerHTML, /0%低い/);
  assert.match(nodes.get("#dealHeading").textContent, /ショップ別/);
  vm.runInContext("deals = [{ name: 'legacy', price: 123, score: 99 }]; render('all'); updateSignal();", context);
  assert.equal(nodes.get("#signalScore").textContent, "--");
  assert.match(nodes.get("#dealHeading").textContent, /比較条件未確認/);
});
