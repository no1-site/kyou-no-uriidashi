import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("../publish-product-pages.mjs", import.meta.url));

test("SEO-only publisher has valid Node syntax and does not invoke marketplace fetchers", async () => {
  const checked = spawnSync(process.execPath, ["--check", script], { encoding: "utf8" });
  assert.equal(checked.status, 0, checked.stderr);
  const source = await readFile(script, "utf8");
  assert.doesNotMatch(source, /fetch-(?:rakuten|yahoo|valuecommerce|keepa)/);
  assert.doesNotMatch(source, /RAKUTEN_|YAHOO_|VALUECOMMERCE_|KEEPA_/);
  assert.match(source, /writeProductSiteAssets/);
  assert.match(source, /createGitPublisher/);
});
