import test from "node:test";
import assert from "node:assert/strict";
import { readFile, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import vm from "node:vm";
import { productIdentity, validJAN, matchOffer, buildComparison, validationVersion } from "../lib/rakuten-comparison.mjs";
import { selectionExclusion, selectionVersion } from "../lib/product-selection.mjs";
import { effectivePostage, includedOffers, canRankPriceOffers, postageLabel, applyShippingPolicy, shippingPolicyVersion } from "../../shipping-policy.mjs";
import { extractShippingCandidates } from "../probe-shipping.mjs";

const catalog = {
  productId: "soap", productCode: "4901234567894", productName: "テスト社 洗剤 500ml",
  productNo: "SOAP-500-W", brandName: "テスト社", productUrlPC: "https://example.com/product",
  averagePrice: null, usedExcludeSalesMinPrice: null, usedExcludeSalesItemCount: null, salesMinPrice: 500
};
const identity = productIdentity(catalog, "日用品");
test("discovery excludes observed appliance parts and game media, retaining main products and refills", () => {
  for (const name of ["ホームテック Panasonic 掃除機 充電式リチウムイオン電池 AVV97V-QQ", "E-Value 丸毛ブラシ 掃除機専用", "ドライヤー用交換ノズル", "掃除機用紙パック", "掃除機用充電スタンド"]) {
    assert.equal(selectionExclusion(name, "家電"), "appliance_accessory", name);
  }
  for (const name of ["非売品ゲームソフトガイドブック", "フィギア付 廻人 / Eve", "PS2用ゲームソフト ドラゴンボールZ 主題歌 CD", "フィギュア写真集"]) {
    assert.equal(selectionExclusion(name, "ホビー"), "related_media", name);
  }
  assert.equal(selectionExclusion("フィギュア用ディスプレイケース", "ホビー"), "figure_accessory");
  for (const [name, category] of [
    ["日立 業務・店舗用掃除機 CV-G1200", "家電"], ["充電式コードレス掃除機", "家電"],
    ["パナソニック 紙パック式掃除機", "家電"], ["ヘアドライヤー", "家電"],
    ["Game Soft Nintendo Switch / スイカゲーム Special Edition 日本版", "ホビー"],
    ["ねんどろいど フィギュア", "ホビー"], ["ファイナルファンタジーVII リバース", "ホビー"],
    ["さらさ 洗濯洗剤 詰め替え(1260g)", "日用品"], ["ドッグフード(100g)", "ペット"]
  ]) assert.equal(selectionExclusion(name, category), "", name);
});
function item(shop = "one", price = 1000, overrides = {}) {
  return {
    itemCode: `${shop}:soap`, shopCode: shop, shopName: `${shop}店`,
    itemName: "テスト社 洗剤 500ml", itemCaption: "JANコード：4901234567894",
    itemPrice: price, availability: 1, taxFlag: 0, postageFlag: 0,
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

test("unitless quantities, HTML cells and meal counts cannot silently pass a JAN match", () => {
  for (const caption of [
    "入数：50", "入数／50", "入り数 50 備考：常温保存", "販売数量：20",
    "<table><tr><th>入数</th><td>50</td></tr></table>",
    "内容量／500ml ●50●JAN 4901234567894"
  ]) {
    assert.equal(matchOffer(identity, item("one", 800, { itemCaption: `JAN 4901234567894 ${caption}` })).reason, "quantity_unconfirmed", caption);
  }
  for (const caption of ["入数／50食", "内容量／500ml 20袋", "販売単位：2個", "内容量：500ml×50"]) {
    assert.ok(!matchOffer(identity, item("one", 800, { itemCaption: `JAN 4901234567894 ${caption}` })).offer, caption);
  }
  for (const caption of ["内容量／500ml", "入数：1", "入数／1本", "内容量：0.5L ●保存期間7年 ●JAN 4901234567894"]) {
    assert.ok(matchOffer(identity, item("one", 800, { itemCaption: `JAN 4901234567894 ${caption}` })).offer, caption);
  }
  const pack = productIdentity({ ...catalog, productName: "洗剤14個入" }, "日用品");
  assert.ok(matchOffer(pack, item("one", 800, { itemName: "洗剤14個入", itemCaption: "JAN 4901234567894 入数：14個" })).offer);
});

test("the observed rice listing with an unlabelled 50 is excluded before averaging", () => {
  const rice = productIdentity({ productName: "ななこめっつ 青菜ご飯(70g)", productCode: "4531717311036" }, "食品");
  const riceItem = (shop, price, caption = "JAN 4531717311036") => item(shop, price, {
    itemName: "ななこめっつ 青菜ご飯70g", itemCaption: caption
  });
  const result = buildComparison(rice, [riceItem("one", 419), riceItem("two", 628),
    riceItem("bulk", 23286, "賞味期限／製造後7年●50●JAN 4531717311036")]);
  assert.equal(result.product.offer_count, 2);
  assert.equal(result.product.market_price, 524);
  assert.equal(result.product.discount_percent, 19);
  assert.equal(result.rejected.quantity_unconfirmed, 1);
  assert.equal(result.product.validation_version, validationVersion);
});

test("a price spread over threefold holds the entire comparison, including low outliers", () => {
  for (const prices of [[419, 628, 23286], [100, 1000, 1100], [100, 301]]) {
    const result = buildComparison(identity, prices.map((price, i) => item(`shop${i}`, price)));
    assert.equal(result.product, null);
    assert.equal(result.rejected.price_spread_unconfirmed, 1);
  }
  assert.ok(buildComparison(identity, [item("one", 100), item("two", 300)]).product);
});

test("model matching keeps brand, full suffix and capacity significant", () => {
  const base = item("one", 800, { itemCaption: "", itemName: "テスト社 SOAP-500-W 洗剤 500ml" });
  assert.equal(matchOffer(identity, base).offer.match_method, "model_brand");
  for (const title of ["別メーカー SOAP-500-W 500ml", "テスト社 SOAP-500-B 500ml", "テスト社 SOAP-500-WX 500ml", "テスト社 SOAP-500-W", "テスト社 SOAP-500-W 1000ml"]) {
    assert.ok(!matchOffer(identity, { ...base, itemName: title }).offer, title);
  }
});

test("equal prices are still a completed comparison; postage stays separate", () => {
  const { product } = buildComparison(identity, [item("one", 1000, { postageFlag: 0 }), item("two", 1000, { postageFlag: 1 })]);
  assert.equal(product.discount_percent, null);
  assert.equal(product.score, null);
  assert.equal(product.deal_label, "送料確認が必要");
  assert.deepEqual(product.offers.map(o => o.postage), ["included", "extra"]);
});

test("shipping flag mapping follows output definitions; conflicts and conditions stay unknown", () => {
  for (const [flag, expected] of [[0, "included"], ["0", "included"], [1, "extra"], ["1", "extra"], [null, "unknown"], [undefined, "unknown"], [true, "unknown"]]) {
    assert.equal(matchOffer(identity, item("one", 1000, { postageFlag: flag })).offer.postage, expected);
  }
  for (const offer of [
    { postage: "extra", item_name: "送料無料 洗剤" },
    { postage: "included", item_name: "洗剤 送料都度見積" },
    { postage: "included", item_name: "洗剤 3980円以上で送料無料" },
    { postage: "included", item_name: "送料無料 北海道は別途送料" }
  ]) assert.equal(effectivePostage(offer), "unknown");
  assert.equal(postageLabel({ postage: "included" }), "送料込み表示");
});

test("unknown or extra postage never produces a price advantage or history score", () => {
  for (const flag of [1, null]) {
    const p = buildComparison(identity, [item("one", 419, { postageFlag: flag }), item("two", 628)]).product;
    assert.equal(p.offers.length, 2);
    assert.equal(p.score, null);
    assert.equal(p.discount_percent, null);
    assert.equal(p.shipping_comparison, "price_only");
    assert.equal(p.historical_price, null);
  }
  const p = buildComparison(identity, [item("one", 800), item("two", 1000)]).product;
  assert.ok(canRankPriceOffers(p.offers));
  assert.ok(p.score > 0);
  assert.equal(p.shipping_comparison, "included");
  const legacy = { ...p, shipping_policy_version: undefined, historical_price: 9999, historical_discount_percent: 90 };
  assert.equal(applyShippingPolicy(legacy).historical_price, null);
});

test("included subset controls price, average, link and history; extra shops stay visible", () => {
  const p = buildComparison(identity, [item("cheap", 100, { postageFlag: 1 }), item("one", 800), item("two", 1200), item("high", 9000, { postageFlag: 1 })]).product;
  assert.ok(p);
  assert.equal(p.price, 800);
  assert.equal(p.market_price, 1000);
  assert.equal(p.discount_percent, 20);
  assert.equal(p.best_url, "https://example.com/one");
  assert.equal(p.shop, "one店");
  assert.equal(p.shipping_offer_count, 2);
  assert.equal(p.shipping_reference_count, 2);
  assert.equal(p.offers.length, 4);
  assert.equal(p.offer_count, 4);
  assert.equal(includedOffers([p.offers[1], p.offers[1]]).length, 1);
  assert.equal(canRankPriceOffers([p.offers[1], p.offers[1]]), false);
  const historical = applyShippingPolicy({ ...p, historical_price: 1600, historical_discount_percent: 99 });
  assert.equal(historical.historical_discount_percent, 50);
});

test("shipping probe finds candidate amounts without mistaking them for a product quote", () => {
  const r = extractShippingCandidates('<p>代引手数料 全国一律料金：220円</p><h2>配送について</h2><p>全国一律料金：660円</p><table><tr><td>送料</td><td>600円</td><td>1,210円</td></tr></table>');
  assert.equal(r.status, "fee_candidates_found");
  assert.equal(r.usable_for_totals, false);
  assert.deepEqual(r.candidates, [{type:"flat_rate_candidate",yen:660},{type:"regional_row_candidate",fees_yen:[600,1210]}]);
  assert.equal(extractShippingCandidates("no delivery info").status, "shipping_section_unconfirmed");
});

test("history excludes today and stale records and requires two distinct prior days", () => {
  const history = { products: { [identity.id]: [
    { date: "2026-09-16", price: 1100, checked_at: "2026-09-16T00:00:00Z" },
    { date: "2026-09-15", price: 1300, checked_at: "2026-09-15T00:00:00Z" },
    { date: "2026-09-17", price: 5000, checked_at: "2026-09-17T00:00:00Z" },
    { date: "2025-01-01", price: 99999, checked_at: "2025-01-01T00:00:00Z" }
  ] } };
  for (const entry of history.products[identity.id]) {
    entry.validation_version = validationVersion;
    entry.shipping_policy_version = shippingPolicyVersion;
  }
  const { product } = buildComparison(identity, [item("one", 800), item("two", 1000)], { history, checkedAt: "2026-09-17T01:00:00Z" });
  assert.equal(product.historical_price, 1200);
  for (const entry of history.products[identity.id]) delete entry.shipping_policy_version;
  assert.equal(buildComparison(identity, [item("one", 800), item("two", 1000)], { history, checkedAt: "2026-09-17T01:00:00Z" }).product.historical_price, null);
  for (const entry of history.products[identity.id]) delete entry.validation_version;
  assert.equal(buildComparison(identity, [item("one", 800), item("two", 1000)], { history, checkedAt: "2026-09-17T01:00:00Z" }).product.historical_price, null);
});

test("pipeline produces 12 comparisons with null catalog averages and publishes only safe diagnostic counts", async () => {
  const directory = await mkdtemp(join(tmpdir(), "shop-compare-test-"));
  const output = join(directory, "products.json");
  const result = spawnSync(process.execPath, ["--import", new URL("./fixtures/mock-rakuten.mjs", import.meta.url).href, fileURLToPath(new URL("../fetch-rakuten.mjs", import.meta.url))], {
    encoding: "utf8", env: { ...process.env, RAKUTEN_APPLICATION_ID: "private-test-app", RAKUTEN_ACCESS_KEY: "private-test-key", RAKUTEN_REQUEST_INTERVAL_MS: "0", RAKUTEN_OUTPUT_PATH: output, RAKUTEN_HISTORY_PATH: join(directory, "history.json") }
  });
  assert.equal(result.status, 0, result.stderr);
  const content = await readFile(output, "utf8");
  const products = JSON.parse(content);
  assert.equal(products.length, 12);
  assert.equal(products.filter(p => p.comparison_type === "rakuten_shops").length, 12);
  assert.equal(new Set(products.map(p => p.id)).size, 12);
  assert.ok(products.every(p => p.offers.length === 2 && p.market_price === 1000));
  assert.equal(products[0].collection_summary.version, "shop-comparison-v2");
  assert.ok(products.every(p => p.validation_version === validationVersion));
  const history = JSON.parse(await readFile(join(directory, "history.json"), "utf8"));
  assert.ok(Object.values(history.products).flat().every(entry => entry.validation_version === validationVersion));
  assert.ok(Object.values(history.products).flat().every(entry => entry.shipping_policy_version === shippingPolicyVersion));
  assert.ok(!content.includes("private-test"));
  assert.ok(!result.stdout.includes("private-test"));
});

test("pipeline preserves the previous file on authentication failure, and distinguishes a reference-only run", async () => {
  const directory = await mkdtemp(join(tmpdir(), "shop-failure-test-"));
  const output = join(directory, "products.json");
  const env = { ...process.env, RAKUTEN_APPLICATION_ID: "test", RAKUTEN_ACCESS_KEY: "test", RAKUTEN_REQUEST_INTERVAL_MS: "0", RAKUTEN_OUTPUT_PATH: output, RAKUTEN_HISTORY_PATH: join(directory, "history.json") };
  const args = ["--import", new URL("./fixtures/mock-rakuten.mjs", import.meta.url).href, fileURLToPath(new URL("../fetch-rakuten.mjs", import.meta.url))];
  await writeFile(output, "previous data");
  const denied = spawnSync(process.execPath, args, { encoding: "utf8", env: { ...env, MOCK_SCENARIO: "denied" } });
  assert.notEqual(denied.status, 0);
  assert.equal(await readFile(output, "utf8"), "previous data");
  const reference = spawnSync(process.execPath, args, { encoding: "utf8", env: { ...env, MOCK_SCENARIO: "unmatched" } });
  assert.equal(reference.status, 0, reference.stderr);
  const products = JSON.parse(await readFile(output, "utf8"));
  assert.equal(products[0].collection_summary.compared, 0);
  assert.ok(products.every(p => p.score === null && p.offers.length === 0));
  assert.ok(products.every(p => !selectionExclusion(p.name, p.category)));
  assert.ok(products[0].collection_summary.categories.find(c => c.category === "家電").selection_excluded.appliance_accessory > 0);
  assert.match(reference.stdout, /no shop comparison was confirmed/);
});

test("irrelevant catalog results do not consume the eight comparison candidate slots", async () => {
  const directory = await mkdtemp(join(tmpdir(), "selection-test-"));
  const output = join(directory, "products.json");
  const result = spawnSync(process.execPath, ["--import", new URL("./fixtures/mock-rakuten.mjs", import.meta.url).href, fileURLToPath(new URL("../fetch-rakuten.mjs", import.meta.url))], {
    encoding: "utf8", env: { ...process.env, MOCK_SCENARIO: "selection", RAKUTEN_APPLICATION_ID: "test", RAKUTEN_ACCESS_KEY: "test", RAKUTEN_REQUEST_INTERVAL_MS: "0", RAKUTEN_OUTPUT_PATH: output, RAKUTEN_HISTORY_PATH: join(directory, "history.json") }
  });
  assert.equal(result.status, 0, result.stderr);
  const products = JSON.parse(await readFile(output, "utf8"));
  assert.equal(products.length, 12);
  assert.ok(products.every(p => p.comparison_type === "rakuten_shops" && !selectionExclusion(p.name, p.category)));
  const summary = products[0].collection_summary;
  assert.equal(summary.selection_version, selectionVersion);
  assert.equal(summary.categories.find(c => c.category === "家電").selection_excluded.appliance_accessory, 18);
  assert.equal(summary.categories.find(c => c.category === "ホビー").selection_excluded.related_media, 18);
});

test("UI shows shop links at equal prices, escapes labels and marks legacy data unconfirmed", async () => {
  const nodes = new Map(["#dealGrid", "#signalScore", "#signalLabel", "#signalText", "#dealHeading", "#updated"].map(id => [id, { textContent: "", innerHTML: "", addEventListener() {} }]));
  const context = vm.createContext({ URL, console, canRankPriceOffers, includedOffers, postageLabel, shippingPolicyVersion, document: {
    querySelector: id => nodes.get(id), querySelectorAll: () => []
  }, window: {} });
  const source = (await readFile(new URL("../../app.js", import.meta.url), "utf8"))
    .replace(/^import .*shipping-policy.*;\s*\n/m, "")
    .replace(/loadDeals\(\);\s*$/, "");
  vm.runInContext(source, context);
  const product = buildComparison(identity, [item("one", 1000, { shopName: "<img src=x onerror=alert(1)>" }), item("two", 1000)]).product;
  context.testProduct = product;
  vm.runInContext("deals = [testProduct]; render('all'); updateSignal();", context);
  assert.match(nodes.get("#dealGrid").innerHTML, /offer-table/);
  assert.match(nodes.get("#dealGrid").innerHTML, /https:\/\/example.com\/one/);
  assert.match(nodes.get("#dealGrid").innerHTML, /&lt;img/);
  assert.doesNotMatch(nodes.get("#dealGrid").innerHTML, /0%低い/);
  assert.match(nodes.get("#dealGrid").innerHTML, /Amazonで価格を確認/);
  assert.match(nodes.get("#dealGrid").innerHTML, /amazon\.co\.jp\/s\?k=/);
  assert.match(nodes.get("#dealGrid").innerHTML, /Amazonの価格は現在の比較・スコアには含めていません/);
  assert.match(nodes.get("#dealHeading").textContent, /ショップ別/);
  const mixed = buildComparison(identity, [item("cheap", 100, { postageFlag: 1 }), item("one", 800), item("two", 1200)]).product;
  context.mixedProduct = mixed;
  vm.runInContext("deals = [mixedProduct]; render('all'); updateSignal();", context);
  const mixedHTML = nodes.get("#dealGrid").innerHTML;
  assert.match(mixedHTML, /送料込み表示の店（2店・比較対象）/);
  assert.match(mixedHTML, /送料別・要確認の店（1店・参考）/);
  assert.match(mixedHTML, /送料込み表示2店の平均/);
  assert.match(mixedHTML, /class="price">¥800/);
  assert.ok(!mixedHTML.includes('class="price">¥100'));
  assert.match(mixedHTML, /https:\/\/example.com\/cheap/);
  product.offers[0].postage = "extra";
  product.discount_percent = 80;
  product.historical_discount_percent = 99;
  vm.runInContext("deals = [testProduct]; render('all'); updateSignal();", context);
  assert.equal(nodes.get("#signalScore").textContent, "--");
  assert.match(nodes.get("#dealGrid").innerHTML, /送料確認が必要/);
  assert.match(nodes.get("#dealGrid").innerHTML, /別途送料/);
  assert.match(nodes.get("#dealGrid").innerHTML, /offer-table/);
  assert.doesNotMatch(nodes.get("#dealGrid").innerHTML, /80%|99%|比較2店の平均|最安商品/);
  product.offers[0].postage = "included";
  product.market_price = 8111;
  product.discount_percent = 94;
  product.historical_discount_percent = 99;
  product.offers[1].price = 23286;
  vm.runInContext("deals = [testProduct]; render('all'); updateSignal();", context);
  assert.equal(nodes.get("#signalScore").textContent, "--");
  assert.match(nodes.get("#dealGrid").innerHTML, /判定を保留/);
  assert.doesNotMatch(nodes.get("#dealGrid").innerHTML, /94%|99%|比較2店の平均|offer-table|最安商品/);
  product.offers[1].price = 1000;
  delete product.validation_version;
  vm.runInContext("deals = [testProduct]; render('all'); updateSignal();", context);
  assert.equal(nodes.get("#signalScore").textContent, "--");
  assert.match(nodes.get("#dealGrid").innerHTML, /販売数量を新しい条件で再確認/);
  vm.runInContext("deals = [{ name: 'legacy', price: 123, score: 99 }]; render('all'); updateSignal();", context);
  assert.equal(nodes.get("#signalScore").textContent, "--");
  assert.match(nodes.get("#dealHeading").textContent, /比較条件未確認/);
});
