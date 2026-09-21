import { remainingStageMilliseconds } from "./api-budget.mjs";
import { mkdir, mkdtemp, open, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { collectStagedProducts } from "./staged-collection.mjs";

const scriptDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const yahooExclusionLabels = {
  invalid_item: "不正な商品情報", jan_mismatch: "JAN不一致・未確認",
  condition: "新品未確認・中古等", unavailable: "在庫なし・未確認",
  missing_name: "商品名なし", variant_or_bundle: "セット・選択式",
  accessory_or_variant: "関連部品・互換品", quantity_mismatch: "容量・個数不一致",
  quantity_unconfirmed: "容量・個数未確認", model_unconfirmed: "型番不一致・未確認",
  model_mismatch: "説明の型番不一致", conflicting_jan: "複数・矛盾するJAN",
  identity_unconfirmed: "同一商品未確認", missing_price: "価格不正・未確認",
  missing_shop_or_link: "店舗・リンク未確認", duplicate_shop: "同一ショップ重複"
};

const failureLabels = {
  credentials: "保存済みの楽天・Yahoo認証情報を確認してください",
  busy: "別の更新が実行中、または中断済みです",
  rakuten: "楽天の取得に失敗しました", yahoo: "Yahooの取得に失敗しました",
  valuecommerce: "提携ECの取得に失敗しました", keepa: "Keepaの取得に失敗しました", validation: "公開前検証に失敗しました",
  changed: "実行中に本番データが別の処理で変更されました",
  failed: "ドライランを完了できませんでした"
};

export function runQuietFetchStage(name, environment) {
  if (!["rakuten", "yahoo", "valuecommerce", "keepa"].includes(name)) throw new Error("Invalid dry-run stage.");
  return new Promise((done, reject) => {
    // Never pipe API progress/errors to the console or a log file. In particular,
    // Node exceptions/debug output cannot reveal a request URL or credentials.
    const childEnvironment = { ...environment };
    delete childEnvironment.NODE_OPTIONS;
    delete childEnvironment.NODE_DEBUG;
    const child = spawn(process.execPath, ["--dns-result-order=ipv4first", join(scriptDirectory, `fetch-${name}.mjs`)], {
      env: childEnvironment, cwd: dirname(environment.RAKUTEN_OUTPUT_PATH),
      stdio: "ignore", windowsHide: true, timeout: remainingStageMilliseconds(environment)
    });
    const fail = () => reject(Object.assign(new Error("Dry-run stage failed."), { dryRunCode: name }));
    child.once("error", fail);
    child.once("exit", code => code === 0 ? done() : fail());
  });
}

async function optionalRead(path) {
  return readFile(path).catch(error => { if (error.code === "ENOENT") return null; throw error; });
}
function sameBytes(a, b) { return a === null ? b === null : b !== null && a.equals(b); }

export async function runDryRun({ repositoryPath, historyPath, environment = process.env, runStage = runQuietFetchStage }) {
  const started = performance.now();
  const localDirectory = resolve(repositoryPath, ".local");
  const lockPath = join(localDirectory, "update.lock");
  let lock;
  let staging;
  let result;
  let metrics;
  let yahooTiming;
  try {
    if (!environment.RAKUTEN_APPLICATION_ID || !environment.RAKUTEN_ACCESS_KEY || !environment.YAHOO_CLIENT_ID) {
      throw Object.assign(new Error("Missing credentials."), { dryRunCode: "credentials" });
    }
    await mkdir(localDirectory, { recursive: true });
    lock = await open(lockPath, "wx").catch(error => {
      if (error.code === "EEXIST") throw Object.assign(new Error("Update locked."), { dryRunCode: "busy" });
      throw error;
    });
    staging = await mkdtemp(join(localDirectory, "dry-run-"));
    await lock.writeFile(JSON.stringify({ mode: "dry-run", staging, started_at: new Date().toISOString() }));
    const productsPath = resolve(repositoryPath, "products.json");
    const previousBytes = await optionalRead(productsPath);
    const historyBytes = await optionalRead(historyPath);
    const previous = previousBytes ? JSON.parse(previousBytes.toString("utf8")) : [];
    const { products, productBytes, historyBytes: collectedHistory } = await collectStagedProducts({ staging, historyPath, previous,
      environment: { ...environment, KEEPA_API_KEY: "", RAKUTEN_AFFILIATE_ID: "", YAHOO_AFFILIATE_ID: "", AMAZON_ASSOCIATE_TAG: "" }, runStage });
    if (!sameBytes(previousBytes, await optionalRead(productsPath)) || !sameBytes(historyBytes, await optionalRead(historyPath))) {
      throw Object.assign(new Error("Live input changed."), { dryRunCode: "changed" });
    }
    const summary = products[0].collection_summary;
    result = { ok: true, productCount: products.length, comparedCount: summary.compared,
      yahooProducts: summary.yahoo?.matched_products || 0, yahooOffers: summary.yahoo?.added_offers || 0,
      yahooExcluded: summary.yahoo?.excluded || {},
      valueCommerceProducts: summary.valuecommerce?.matched_products || 0,
      valueCommerceOffers: summary.valuecommerce?.added_offers || 0,
      valueCommerceMerchants: summary.valuecommerce?.merchants || [],
      heldCount: summary.comparison_held,
      ...(summary.target ? { target: summary.target,
        shippingCompared: summary.shipping_included_compared, productBytes: Buffer.byteLength(productBytes),
        categories: summary.categories } : {}) };
    if (result.target) {
      // A reviewable identity-only proposal; never a price/history publication.
      await writeFile(join(localDirectory, `catalog-proposal-${result.target}.json`),
        JSON.stringify(JSON.parse(collectedHistory).confirmed_catalog, null, 2) + "\n");
    }
  } catch (error) {
    const code = Object.hasOwn(failureLabels, error.dryRunCode) ? error.dryRunCode
      : error.message?.startsWith("Publication validation:") ? "validation"
      : error.message === "Rakuten collection contained API errors; publication stopped." ? "rakuten" : "failed";
    result = { ok: false, errorCode: code };
  } finally {
    // Only the directory created by this invocation is removed. No real data,
    // credentials, log, Git files, or production history is ever written here.
    try {
      if (staging) yahooTiming = await readFile(join(staging, "yahoo-metrics.json"), "utf8").then(JSON.parse).catch(() => undefined);
      if (staging) metrics = await readFile(join(staging, "metrics.json"), "utf8").then(JSON.parse).catch(() => undefined);
      if (staging && resolve(staging).startsWith(localDirectory + sep)) await rm(staging, { recursive: true, force: true });
    } catch { result = { ok: false, errorCode: "failed" }; }
    if (lock) {
      await lock.close();
      await rm(lockPath, { force: true });
    }
  }
  return { ...result, ...(yahooTiming ? { yahooTiming } : {}), ...(metrics ? { metrics, target: result.target || metrics.target || Number(environment.TARGET_PRODUCT_COUNT) } : {}), elapsedSeconds: (performance.now() - started) / 1000 };
}

export function formatDryRunReport(result) {
  const count = value => Number.isSafeInteger(value) && value >= 0 ? `${value}件` : "未完了";
  const reasons = Object.entries(yahooExclusionLabels)
    .filter(([key]) => Number.isSafeInteger(result.yahooExcluded?.[key]) && result.yahooExcluded[key] > 0)
    .map(([key, label]) => `${label} ${count(result.yahooExcluded[key])}`);
  const lines = [
    `取得商品数：${result.ok ? count(result.productCount) : `未完了（${failureLabels[result.errorCode] || failureLabels.failed}）`}`,
    `比較成立商品数：${count(result.comparedCount)}`,
    `Yahoo追加商品数：${count(result.yahooProducts)}`,
    `Yahoo追加出品数：${count(result.yahooOffers)}`,
    `Yahoo除外理由ごとの件数：${result.ok ? reasons.join("、") || "なし（0件）" : "未完了"}`,
    `保留商品数：${count(result.heldCount)}`,
    `実行時間：${Number.isFinite(result.elapsedSeconds) && result.elapsedSeconds >= 0 ? result.elapsedSeconds.toFixed(1) : "0.0"}秒`
  ];
  if (result.target) lines.push(
    `目標商品数：${count(result.target)}`,
    `楽天APIリクエスト数：${count(result.metrics?.rakuten)}`,
    `Yahoo APIリクエスト数：${count(result.metrics?.yahoo)}`,
    `Yahoo 429件数：${count(result.yahooTiming?.rateLimited)}`,
    `Yahoo実効平均間隔：${Number.isFinite(result.yahooTiming?.averageIntervalMs) ? result.yahooTiming.averageIntervalMs.toFixed(1) + "ms" : "未計測"}`,
    `Yahoo実行時間：${Number.isFinite(result.yahooTiming?.elapsedSeconds) ? result.yahooTiming.elapsedSeconds.toFixed(1) + "秒" : "未計測"}`,
    `Yahoo Retry-After：${Number.isFinite(result.yahooTiming?.retryAfterSeconds) ? result.yahooTiming.retryAfterSeconds + "秒（記録のみ）" : "有効な指定なし"}`,
    `提携EC追加商品数：${count(result.valueCommerceProducts)}`,
    `提携EC追加出品数：${count(result.valueCommerceOffers)}`,
    `提携ECショップ：${Array.isArray(result.valueCommerceMerchants) && result.valueCommerceMerchants.length ? result.valueCommerceMerchants.join("、") : "なし"}`,
    `比較を試みた商品数：${count(result.metrics?.attempted)}`,
    `送料込み比較可能商品数：${count(result.shippingCompared)}`,
    `APIエラー数：${count(result.metrics?.apiErrors)}`,
    `利用制限（429）：${count(result.metrics?.rateLimited)}`,
    `取得予算超過：${result.metrics?.budgetExceeded ? "あり（停止）" : "なし"}`,
    `products.jsonサイズ：${Number.isSafeInteger(result.productBytes) ? result.productBytes + "バイト" : "未完了"}`
  );
  return lines.join("\n");
}
