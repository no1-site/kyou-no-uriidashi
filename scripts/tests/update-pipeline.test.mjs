import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, access, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { runUpdate } from "../lib/update-pipeline.mjs";

const fixture = new URL("./fixtures/mock-marketplaces.mjs", import.meta.url).href;
const originalProducts = '[{"id":"old-data"}]\n';
const originalHistory = '{"products":{},"updated_at":"old"}\n';

async function setup() {
  const repositoryPath = await mkdtemp(join(tmpdir(), "safe-update-test-"));
  const historyPath = join(repositoryPath, "history.json");
  await writeFile(join(repositoryPath, "products.json"), originalProducts);
  await writeFile(historyPath, originalHistory);
  return { repositoryPath, historyPath };
}

function environment(overrides = {}) {
  return { ...process.env, RAKUTEN_APPLICATION_ID: "fixture-app", RAKUTEN_ACCESS_KEY: "fixture-key",
    RAKUTEN_AFFILIATE_ID: "", RAKUTEN_REQUEST_INTERVAL_MS: "0", YAHOO_REQUEST_INTERVAL_MS: "2200",
    YAHOO_CLIENT_ID: "fixture-yahoo", YAHOO_AFFILIATE_ID: "", KEEPA_API_KEY: "fixture-keepa", AMAZON_ASSOCIATE_TAG: "",
    MOCK_SCENARIO: "", MOCK_UPDATE_FAILURE: "", ...overrides };
}

function runStage(name, env) {
  const script = fileURLToPath(new URL(`../fetch-${name}.mjs`, import.meta.url));
  const result = spawnSync(process.execPath, ["--import", fixture, script], { env, encoding: "utf8" });
  assert.ok(!result.stdout?.includes("fixture-key"));
  if (result.status !== 0) throw new Error(`Fixture stage failed: ${name}`);
}

async function assertUnchanged(config) {
  assert.equal(await readFile(join(config.repositoryPath, "products.json"), "utf8"), originalProducts);
  assert.equal(await readFile(config.historyPath, "utf8"), originalHistory);
}

test("Yahoo API failure on the second product preserves the input file byte-for-byte", async () => {
  const config = await setup();
  const staged = join(config.repositoryPath, "fixture-products.json");
  const env = environment({ RAKUTEN_OUTPUT_PATH: staged, RAKUTEN_HISTORY_PATH: join(config.repositoryPath, "fixture-history.json") });
  runStage("rakuten", env);
  const before = await readFile(staged, "utf8");
  assert.throws(() => runStage("yahoo", { ...env, YAHOO_PRODUCTS_PATH: staged, MOCK_UPDATE_FAILURE: "yahoo" }), /yahoo/);
  assert.equal(await readFile(staged, "utf8"), before);
  await assertUnchanged(config);
});

for (const failure of ["rakuten", "yahoo", "yahoo-429", "yahoo-invalid", "keepa", "keepa-invalid"]) {
  test(`${failure} failure leaves live products and history unchanged and never publishes`, async () => {
    const config = await setup();
    let published = false;
    await assert.rejects(runUpdate({ ...config, runStage,
      environment: environment({ MOCK_UPDATE_FAILURE: failure, MOCK_SCENARIO: failure === "rakuten" ? "denied" : "" }),
      publish: async () => { published = true; }
    }), new RegExp(`Fixture stage failed: ${failure.split("-")[0]}`));
    assert.equal(published, false);
    await assertUnchanged(config);
    await assert.rejects(access(join(config.repositoryPath, ".local", "update.lock")), { code: "ENOENT" });
  });
}

test("publication failure preserves both live files, and a retry can succeed", async () => {
  const config = await setup();
  await assert.rejects(runUpdate({ ...config, runStage, environment: environment(), publish: async () => {
    await assertUnchanged(config);
    throw new Error("offline publication failure");
  } }), /offline publication failure/);
  await assertUnchanged(config);
  await runUpdate({ ...config, runStage, environment: environment(), publish: async () => {} });
  assert.equal(JSON.parse(await readFile(join(config.repositoryPath, "products.json"), "utf8")).length, 12);
});

test("successful full update publishes validated final data before live files/history change", async () => {
  const config = await setup();
  const stages = [];
  const result = await runUpdate({ ...config, environment: environment(),
    runStage: (name, env) => { stages.push(name); return runStage(name, env); },
    publish: async ({ stagedProducts }) => {
      await assertUnchanged(config);
      const products = JSON.parse(await readFile(stagedProducts, "utf8"));
      assert.equal(products[0].offer_count, 3);
      assert.equal(products[0].shipping_offer_count, 3);
      assert.equal(products[0].collection_summary.shipping_included_compared, 12);
      assert.equal(products[0].historical_price, null);
    }
  });
  assert.deepEqual(stages, ["rakuten", "yahoo", "keepa"]);
  assert.equal(result.count, 12);
  const history = JSON.parse(await readFile(config.historyPath, "utf8"));
  assert.equal(Object.keys(history.products).length, 12);
  // Yahoo 700-yen offers must not contaminate Rakuten's 800-yen history.
  assert.ok(Object.values(history.products).flat().every(entry => entry.price === 800));
});

test("unconfigured Yahoo/Keepa stages are skipped, keeping Rakuten updates supported", async () => {
  const config = await setup();
  const stages = [];
  await runUpdate({ ...config, environment: environment({ YAHOO_CLIENT_ID: "", KEEPA_API_KEY: "" }),
    runStage: (name, env) => { stages.push(name); return runStage(name, env); }, publish: async () => {} });
  assert.deepEqual(stages, ["rakuten"]);
});

test("publication validation failure retains live data", async () => {
  const config = await setup();
  await assert.rejects(runUpdate({ ...config, environment: environment(),
    runStage: async (name, env) => {
      runStage(name, env);
      if (name === "keepa") {
        const products = JSON.parse(await readFile(env.KEEPA_PRODUCTS_PATH, "utf8"));
        products[0].offers[0].price = 0;
        await writeFile(env.KEEPA_PRODUCTS_PATH, JSON.stringify(products));
      }
    }, publish: async () => { assert.fail("must not publish invalid data"); }
  }), /invalid_offer/);
  await assertUnchanged(config);
});

test("nonfatal Rakuten API errors also stop publication", async () => {
  const config = await setup();
  await assert.rejects(runUpdate({ ...config, environment: environment(),
    runStage: async (name, env) => {
      runStage(name, env);
      const products = JSON.parse(await readFile(env.RAKUTEN_OUTPUT_PATH, "utf8"));
      products[0].collection_summary.errors = { network_or_timeout: 1 };
      await writeFile(env.RAKUTEN_OUTPUT_PATH, JSON.stringify(products));
    }, publish: async () => { assert.fail("must not publish partial API result"); }
  }), /contained API errors/);
  await assertUnchanged(config);
});

test("existing update lock prevents concurrent work", async () => {
  const config = await setup();
  await mkdir(join(config.repositoryPath, ".local"));
  await writeFile(join(config.repositoryPath, ".local", "update.lock"), "existing lock");
  await assert.rejects(runUpdate({ ...config, environment: environment(), runStage,
    publish: async () => {} }), /already running/);
  await assertUnchanged(config);
  assert.equal(await readFile(join(config.repositoryPath, ".local", "update.lock"), "utf8"), "existing lock");
});

test("post-publication local failure keeps old history and recovery files, blocking blind retries", async () => {
  const config = await setup();
  await assert.rejects(runUpdate({ ...config, environment: environment(), runStage, publish: async () => {},
    finish: async () => { throw new Error("fixture local finalization failure"); }
  }), /local finalization/);
  assert.equal(await readFile(config.historyPath, "utf8"), originalHistory);
  const lock = JSON.parse(await readFile(join(config.repositoryPath, ".local", "update.lock"), "utf8"));
  assert.equal(JSON.parse(await readFile(join(lock.staging, "price-history.json"), "utf8")).updated_at.length > 0, true);
  await assert.rejects(runUpdate({ ...config, environment: environment(), runStage, publish: async () => {} }), /already running/);
});
