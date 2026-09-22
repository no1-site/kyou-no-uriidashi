import { mkdir, mkdtemp, open, readFile, readdir, rm } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { createGitPublisher } from "./lib/git-publication.mjs";
import { writeProductSiteAssets } from "./lib/product-pages.mjs";
import { atomicWrite } from "./lib/update-pipeline.mjs";

const repositoryPath = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const localDirectory = resolve(repositoryPath, ".local");
const lockPath = join(localDirectory, "update.lock");

let lock;
let staging;
let published = false;
let completed = false;

try {
  if (!process.env.UPDATE_GIT_PATH) throw new Error("SEO publication runtime path is missing.");
  await mkdir(localDirectory, { recursive: true });
  lock = await open(lockPath, "wx").catch(() => {
    throw new Error("Another update is running or was interrupted.");
  });

  staging = await mkdtemp(join(localDirectory, "seo-pages-"));
  await lock.writeFile(JSON.stringify({ mode: "seo-pages-only", staging, started_at: new Date().toISOString() }));

  const productsPath = resolve(repositoryPath, "products.json");
  const originalBytes = await readFile(productsPath);
  const products = JSON.parse(originalBytes.toString("utf8"));
  if (!Array.isArray(products) || !products.length) throw new Error("Current product data is empty.");

  const stagedSiteAssets = await writeProductSiteAssets(products, staging);
  const productPageCount = stagedSiteAssets.filter(asset => /^products\/\d{8,13}\.html$/.test(asset.path)).length;
  if (!productPageCount) throw new Error("No product pages could be generated.");

  const currentBytes = await readFile(productsPath);
  if (!originalBytes.equals(currentBytes)) throw new Error("Product data changed during SEO generation.");

  const publisher = createGitPublisher({
    gitPath: process.env.UPDATE_GIT_PATH,
    repositoryPath
  });
  await publisher.preflight();
  await publisher.publish({ stagedProducts: productsPath, staging, stagedSiteAssets });
  published = true;

  const desiredProductPages = new Set();
  for (const asset of stagedSiteAssets) {
    const destination = resolve(repositoryPath, asset.path);
    if (!destination.startsWith(resolve(repositoryPath) + sep)) throw new Error("Generated site path escaped repository.");
    await mkdir(dirname(destination), { recursive: true });
    await atomicWrite(destination, await readFile(asset.stagedPath));
    if (/^products\/\d{8,13}\.html$/.test(asset.path)) {
      desiredProductPages.add(asset.path.replace(/^products\//, ""));
    }
  }

  const productDirectory = resolve(repositoryPath, "products");
  for (const name of await readdir(productDirectory).catch(error => {
    if (error.code === "ENOENT") return [];
    throw error;
  })) {
    if (/^\d{8,13}\.html$/.test(name) && !desiredProductPages.has(name)) {
      await rm(join(productDirectory, name), { force: true });
    }
  }

  await publisher.finish();
  completed = true;
  console.log(`SEO商品ページ公開完了：${productPageCount}件`);
} catch {
  console.error("SEO商品ページの公開を完了できませんでした。本番商品データは変更していません。");
  process.exitCode = 1;
} finally {
  if (lock) await lock.close();
  let uncertain = false;
  if (staging) {
    uncertain = await readFile(join(staging, "publication-pending.json")).then(() => true, error => {
      if (error.code === "ENOENT") return false;
      throw error;
    }).catch(() => true);
  }
  if (completed || (!published && !uncertain)) {
    if (staging && resolve(staging).startsWith(localDirectory + sep)) {
      await rm(staging, { recursive: true, force: true });
    }
    await rm(lockPath, { force: true });
  }
}
