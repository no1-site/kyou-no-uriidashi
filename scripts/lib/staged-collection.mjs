import { copyFile, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { finalizeProducts, validatePublication } from "./publication.mjs";

// Shared by publication and dry-run. Every write is directed to the supplied
// staging directory; this module has no Git or live-file finalization capability.
export async function collectStagedProducts({ staging, historyPath, previous, environment, runStage }) {
  const stagedProducts = join(staging, "products.json");
  const stagedHistory = join(staging, "price-history.json");
  try {
    const history = JSON.parse(await readFile(historyPath, "utf8"));
    if (!history?.products || typeof history.products !== "object" || Array.isArray(history.products)) throw new Error("Invalid existing price history.");
    await copyFile(historyPath, stagedHistory);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const stagedEnvironment = { ...environment,
    RAKUTEN_OUTPUT_PATH: stagedProducts, RAKUTEN_HISTORY_PATH: stagedHistory,
    YAHOO_PRODUCTS_PATH: stagedProducts, KEEPA_PRODUCTS_PATH: stagedProducts };
  await runStage("rakuten", stagedEnvironment);
  const rakuten = JSON.parse(await readFile(stagedProducts, "utf8"));
  if (Object.values(rakuten[0]?.collection_summary?.errors || {}).some(count => count > 0)) {
    throw new Error("Rakuten collection contained API errors; publication stopped.");
  }
  if (environment.YAHOO_CLIENT_ID) await runStage("yahoo", stagedEnvironment);
  if (environment.KEEPA_API_KEY) await runStage("keepa", stagedEnvironment);
  const products = finalizeProducts(JSON.parse(await readFile(stagedProducts, "utf8")));
  validatePublication(products, previous);
  const productBytes = JSON.stringify(products, null, 2) + "\n";
  await writeFile(stagedProducts, productBytes);
  const historyBytes = await readFile(stagedHistory);
  return { products, productBytes, historyBytes, stagedProducts };
}
