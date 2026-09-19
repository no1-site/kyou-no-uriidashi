import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile, readdir, cp, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { runDryRun, formatDryRunReport } from "../lib/dry-run.mjs";

const scriptDirectory = fileURLToPath(new URL("..", import.meta.url));
const fixtureURL = new URL("./fixtures/mock-marketplaces.mjs", import.meta.url).href;
const originalProducts = '[{"id":"original"}]\n';
const originalHistory = '{"products":{},"updated_at":"original"}\n';

async function setup() {
  const repositoryPath = await mkdtemp(join(tmpdir(), "dry-run-test-"));
  const historyPath = join(repositoryPath, "production-history.json");
  await writeFile(join(repositoryPath, "products.json"), originalProducts);
  await writeFile(historyPath, originalHistory);
  await mkdir(join(repositoryPath, ".git"));
  await writeFile(join(repositoryPath, ".git", "HEAD"), "unchanged-head");
  await writeFile(join(repositoryPath, ".git", "index"), "unchanged-index");
  return { repositoryPath, historyPath };
}
function environment(overrides = {}) {
  return { ...process.env, RAKUTEN_APPLICATION_ID: "dry-fixture-app", RAKUTEN_ACCESS_KEY: "dry-fixture-key",
    YAHOO_CLIENT_ID: "dry-fixture-client", KEEPA_API_KEY: "",
    RAKUTEN_AFFILIATE_ID: "", YAHOO_AFFILIATE_ID: "", AMAZON_ASSOCIATE_TAG: "",
    RAKUTEN_REQUEST_INTERVAL_MS: "0", YAHOO_REQUEST_INTERVAL_MS: "2200",
    MOCK_SCENARIO: "", MOCK_UPDATE_FAILURE: "", MOCK_YAHOO_REJECTIONS: "1", ...overrides };
}
function fixtureStage(name, env) {
  const result = spawnSync(process.execPath, ["--import", fixtureURL, join(scriptDirectory, `fetch-${name}.mjs`)], { env, encoding: "utf8" });
  if (result.status !== 0) throw Object.assign(new Error("Fixture failed."), { dryRunCode: name });
}
async function assertUntouched(config) {
  assert.equal(await readFile(join(config.repositoryPath, "products.json"), "utf8"), originalProducts);
  assert.equal(await readFile(config.historyPath, "utf8"), originalHistory);
  assert.equal(await readFile(join(config.repositoryPath, ".git", "HEAD"), "utf8"), "unchanged-head");
  assert.equal(await readFile(join(config.repositoryPath, ".git", "index"), "utf8"), "unchanged-index");
}

test("dry-run collects and validates without publication, overrides output paths, and cleans temporary files", async () => {
  const config = await setup();
  const stages = [];
  const result = await runDryRun({ ...config,
    environment: environment({ RAKUTEN_OUTPUT_PATH: join(config.repositoryPath, "products.json"),
      RAKUTEN_HISTORY_PATH: config.historyPath, YAHOO_PRODUCTS_PATH: "must-not-use", KEEPA_PRODUCTS_PATH: "must-not-use" }),
    runStage: (name, env) => {
      stages.push(name);
      for (const key of ["RAKUTEN_OUTPUT_PATH", "RAKUTEN_HISTORY_PATH", "YAHOO_PRODUCTS_PATH", "KEEPA_PRODUCTS_PATH"]) {
        assert.ok(resolve(env[key]).startsWith(join(config.repositoryPath, ".local") + sep));
      }
      return fixtureStage(name, env);
    },
    publish: () => assert.fail("dry-run must never invoke publication"),
    finish: () => assert.fail("dry-run must never finalize history")
  });
  assert.equal(result.ok, true);
  assert.deepEqual(stages, ["rakuten", "yahoo"]);
  assert.equal(result.productCount, 12);
  assert.equal(result.comparedCount, 12);
  assert.equal(result.yahooProducts, 12);
  assert.equal(result.yahooOffers, 12);
  assert.deepEqual(result.yahooExcluded, { duplicate_shop: 12, quantity_mismatch: 12, jan_mismatch: 12, condition: 12 });
  assert.equal(result.heldCount, 0);
  assert.ok(result.elapsedSeconds > 0);
  await assertUntouched(config);
  assert.deepEqual(await readdir(join(config.repositoryPath, ".local")), []);
});

test("configured Keepa is forcibly skipped in dry-run", async () => {
  const config = await setup();
  const stages = [];
  const result = await runDryRun({ ...config, environment: environment({ KEEPA_API_KEY: "dry-fixture-keepa", MOCK_UPDATE_FAILURE: "keepa" }),
    runStage: (name, env) => { stages.push(name); return fixtureStage(name, env); } });
  assert.equal(result.ok, true);
  assert.deepEqual(stages, ["rakuten", "yahoo"]);
  await assertUntouched(config);
});

test("dry-run with no production history does not create its file or parent directory", async () => {
  const config = await setup();
  const absentHistory = join(config.repositoryPath, "absent-production-directory", "history.json");
  const result = await runDryRun({ ...config, historyPath: absentHistory, environment: environment(), runStage: fixtureStage });
  assert.equal(result.ok, true);
  await assert.rejects(access(join(config.repositoryPath, "absent-production-directory")), { code: "ENOENT" });
  await assertUntouched(config);
});

for (const failure of ["rakuten", "yahoo", "validation"]) {
  test(`dry-run ${failure} failure never changes live files and removes staging`, async () => {
    const config = await setup();
    const result = await runDryRun({ ...config,
      environment: environment({ KEEPA_API_KEY: "dry-fixture-keepa", MOCK_UPDATE_FAILURE: failure,
        MOCK_SCENARIO: failure === "rakuten" ? "denied" : "" }),
      runStage: async (name, env) => {
        fixtureStage(name, env);
        if (failure === "validation" && name === "yahoo") {
          const products = JSON.parse(await readFile(env.KEEPA_PRODUCTS_PATH, "utf8"));
          products[0].offers[0].price = 0;
          await writeFile(env.KEEPA_PRODUCTS_PATH, JSON.stringify(products));
        }
      } });
    assert.equal(result.ok, false);
    assert.equal(result.errorCode, failure);
    await assertUntouched(config);
    assert.deepEqual(await readdir(join(config.repositoryPath, ".local")), []);
  });
}

test("dry-run preserves an existing update lock and requires both saved integrations", async () => {
  const config = await setup();
  await mkdir(join(config.repositoryPath, ".local"));
  await writeFile(join(config.repositoryPath, ".local", "update.lock"), "existing");
  const result = await runDryRun({ ...config, environment: environment(), runStage: () => assert.fail("locked") });
  assert.equal(result.errorCode, "busy");
  assert.equal(await readFile(join(config.repositoryPath, ".local", "update.lock"), "utf8"), "existing");
  const missing = await runDryRun({ ...config, environment: environment({ YAHOO_CLIENT_ID: "" }), runStage: () => assert.fail("missing credentials") });
  assert.equal(missing.errorCode, "credentials");
  await assertUntouched(config);
});

test("dry-run report contains only seven Japanese fields and allowlisted reasons", () => {
  const text = formatDryRunReport({ ok: true, productCount: 12, comparedCount: 10, yahooProducts: 8, yahooOffers: 42,
    yahooExcluded: { quantity_mismatch: 5, "must-not-print-secret": 99 }, heldCount: 2, elapsedSeconds: 1.25 });
  assert.equal(text.split("\n").length, 7);
  assert.match(text, /容量・個数不一致 5件/);
  assert.doesNotMatch(text, /must-not-print-secret/);
  const failed = formatDryRunReport({ ok: false, errorCode: "secret-raw-error", elapsedSeconds: 1 });
  assert.equal(failed.split("\n").length, 7);
  assert.doesNotMatch(failed, /secret-raw-error/);
});

async function prepareCLI(config) {
  const scripts = join(config.repositoryPath, "scripts");
  await mkdir(scripts);
  await cp(join(scriptDirectory, "lib"), join(scripts, "lib"), { recursive: true });
  await cp(join(scriptDirectory, "..", "shipping-policy.mjs"), join(config.repositoryPath, "shipping-policy.mjs"));
  for (const file of ["run-update-dry-run.mjs", "update-dry-run.ps1", "run-update-dry-run.cmd"]) {
    await cp(join(scriptDirectory, file), join(scripts, file));
  }
  for (const name of ["rakuten", "yahoo", "keepa"]) {
    const actual = new URL(`../fetch-${name}.mjs`, import.meta.url).href;
    await writeFile(join(scripts, `fetch-${name}.mjs`), `
      import ${JSON.stringify(fixtureURL)};
      console.log(process.env.RAKUTEN_ACCESS_KEY);
      console.error(process.env.YAHOO_CLIENT_ID);
      await import(${JSON.stringify(actual)});
    `);
  }
  return scripts;
}

test("production dry-run CLI suppresses child stdout/stderr and prints only the safe summary", async () => {
  const config = await setup();
  const scripts = await prepareCLI(config);
  for (const failure of ["", "yahoo"]) {
    const result = spawnSync(process.execPath, [join(scripts, "run-update-dry-run.mjs")], {
      env: environment({ DRY_RUN_HISTORY_PATH: config.historyPath, MOCK_UPDATE_FAILURE: failure }), encoding: "utf8" });
    assert.equal(result.status, failure ? 1 : 0);
    assert.equal(result.stderr, "");
    assert.equal(result.stdout.trim().split(/\r?\n/).length, 7);
    assert.doesNotMatch(result.stdout, /dry-fixture|https?:|\[YAHOO|\[SHOP|Error:/);
    await assertUntouched(config);
    assert.deepEqual(await readdir(join(config.repositoryPath, ".local")), []);
  }
});

test("Windows launcher decrypts saved credentials, ignores inherited Keepa, and leaves credential files unchanged", {
  skip: process.platform !== "win32"
}, async () => {
  const config = await setup();
  const scripts = await prepareCLI(config);
  const localAppData = join(config.repositoryPath, "fixture-localappdata");
  const credentials = join(localAppData, "KyouNoUriidashi");
  await mkdir(credentials, { recursive: true });
  const env = environment({ LOCALAPPDATA: localAppData, KEEPA_API_KEY: "inherited-must-be-cleared", MOCK_UPDATE_FAILURE: "keepa",
    PSModulePath: join(process.env.SystemRoot, "System32", "WindowsPowerShell", "v1.0", "Modules") });
  const powershell = join(process.env.SystemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
  const creation = spawnSync(powershell, ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", `
    $ErrorActionPreference = 'Stop'
    $dir = Join-Path $env:LOCALAPPDATA 'KyouNoUriidashi'
    [pscustomobject]@{ApplicationId=(ConvertTo-SecureString $env:RAKUTEN_APPLICATION_ID -AsPlainText -Force); AccessKey=(ConvertTo-SecureString $env:RAKUTEN_ACCESS_KEY -AsPlainText -Force)} | Export-Clixml (Join-Path $dir 'rakuten-credentials.xml')
    [pscustomobject]@{ClientId=(ConvertTo-SecureString $env:YAHOO_CLIENT_ID -AsPlainText -Force)} | Export-Clixml (Join-Path $dir 'yahoo-credentials.xml')
  `], { env, encoding: "utf8" });
  assert.equal(creation.status, 0, creation.stderr);
  await writeFile(join(credentials, "price-history.json"), originalHistory);
  const snapshots = await Promise.all(["rakuten-credentials.xml", "yahoo-credentials.xml", "price-history.json"].map(name => readFile(join(credentials, name))));
  const result = spawnSync(process.env.ComSpec || "cmd.exe", ["/d", "/c", join(scripts, "run-update-dry-run.cmd")], {
    env, encoding: "utf8", input: "\r\n", timeout: 30000 });
  assert.equal(result.status, 0);
  assert.equal(result.stderr, "");
  assert.equal(result.stdout.trim().split(/\r?\n/).length, 7);
  assert.match(result.stdout, /取得商品数：12件/);
  assert.doesNotMatch(result.stdout, /dry-fixture|inherited-must-be-cleared/);
  for (const [i, name] of ["rakuten-credentials.xml", "yahoo-credentials.xml", "price-history.json"].entries()) {
    assert.deepEqual(await readFile(join(credentials, name)), snapshots[i]);
  }
  await assert.rejects(access(join(credentials, "update.log")), { code: "ENOENT" });
  await assertUntouched(config);
});

test('dry-run rejects too-fast Yahoo settings before either API stage', async () => {
  for (const target of ['', '20']) {
    const config = await setup();
    const result = await runDryRun({ ...config,
      environment: environment({ TARGET_PRODUCT_COUNT: target, YAHOO_REQUEST_INTERVAL_MS: '1100' }),
      runStage: () => assert.fail('invalid rate must be rejected before network access') });
    assert.equal(result.ok, false);
    await assertUntouched(config);
  }
});

test('Yahoo 429 stops dry-run without retry/publication and retains only safe timing metrics', async () => {
  const config = await setup();
  const stages = [];
  const result = await runDryRun({ ...config, environment: environment({ MOCK_UPDATE_FAILURE: 'yahoo-429' }),
    runStage: (name, env) => { stages.push(name); return fixtureStage(name, env); } });
  assert.equal(result.ok, false);
  assert.deepEqual(stages, ['rakuten', 'yahoo']);
  assert.equal(result.yahooTiming.requests, 2);
  assert.equal(result.yahooTiming.rateLimited, 1);
  assert.equal(result.yahooTiming.averageIntervalMs, 2200);
  assert.equal(result.yahooTiming.retryAfterSeconds, 65);
  assert.doesNotMatch(JSON.stringify(result), /https?:|dry-fixture|appid/);
  await assertUntouched(config);
  assert.deepEqual(await readdir(join(config.repositoryPath, '.local')), []);
});
