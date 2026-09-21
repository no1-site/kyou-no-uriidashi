import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const config = JSON.parse(await readFile(new URL("../../config/tracking.json", import.meta.url), "utf8"));

test("production uses 100-product catalog mode", () => {
  assert.equal(config.productionMode, "catalog");
  assert.equal(config.productionTarget, 100);
});
