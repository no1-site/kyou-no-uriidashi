import { mkdir, mkdtemp, open, readFile, rename, rm } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { collectStagedProducts } from "./staged-collection.mjs";

const scriptDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export async function atomicWrite(path, contents) {
  const temporary = `${path}.${process.pid}.tmp`;
  let created = false;
  try {
    const handle = await open(temporary, "wx");
    created = true;
    try { await handle.writeFile(contents); } finally { await handle.close(); }
    await rename(temporary, path);
  } finally {
    if (created) await rm(temporary, { force: true });
  }
}

export function runFetchStage(name, environment) {
  return new Promise((done, reject) => {
    const child = spawn(process.execPath, ["--dns-result-order=ipv4first", join(scriptDirectory, `fetch-${name}.mjs`)], {
      env: environment, stdio: "inherit", windowsHide: true
    });
    child.once("error", () => reject(new Error(`Update stage failed: ${name}`)));
    child.once("exit", code => code === 0 ? done() : reject(new Error(`Update stage failed: ${name}`)));
  });
}

// publish must complete the remote publication before returning. No live data is
// replaced during fetch/validation/publication. finish updates local Git metadata.
export async function runUpdate({ repositoryPath, historyPath, environment = process.env,
  runStage = runFetchStage, publish, finish = async () => {} }) {
  if (typeof publish !== "function") throw new Error("A publication operation is required.");
  const localDirectory = resolve(repositoryPath, ".local");
  await mkdir(localDirectory, { recursive: true });
  const lockPath = join(localDirectory, "update.lock");
  const lock = await open(lockPath, "wx").catch(() => { throw new Error("Update already running or interrupted; inspect .local/update.lock."); });
  const productsPath = resolve(repositoryPath, "products.json");
  let staging;
  let published = false;
  let completed = false;
  try {
    staging = await mkdtemp(join(localDirectory, "update-"));
    await lock.writeFile(JSON.stringify({ staging, started_at: new Date().toISOString() }));
    const previousBytes = await readFile(productsPath).catch(error => {
      if (error.code === "ENOENT") return null;
      throw error;
    });
    const previous = previousBytes ? JSON.parse(previousBytes.toString("utf8")) : [];
    await mkdir(dirname(historyPath), { recursive: true });
    const { products, productBytes, historyBytes, stagedProducts } = await collectStagedProducts({
      staging, historyPath, previous, environment, runStage
    });
    // Detect another writer before publication; never overwrite their changes.
    const currentBytes = await readFile(productsPath).catch(error => {
      if (error.code === "ENOENT") return null;
      throw error;
    });
    if ((previousBytes === null) !== (currentBytes === null) || (previousBytes && !previousBytes.equals(currentBytes))) {
      throw new Error("Product data changed during update; publication stopped.");
    }
    await publish({ stagedProducts, staging });
    published = true;
    await atomicWrite(productsPath, productBytes);
    await finish();
    // This remains a Rakuten-only history. Merged prices are deliberately not
    // written into the old series; Yahoo/Keepa merges clear historical scores.
    await atomicWrite(historyPath, historyBytes);
    completed = true;
    return { count: products.length };
  } finally {
    await lock.close();
    // Keep the journal/data if the push outcome is uncertain or remote success
    // could not be reflected locally. A later run must not silently proceed.
    let uncertain = false;
    if (staging) {
      uncertain = await readFile(join(staging, "publication-pending.json")).then(() => true, error => {
        if (error.code === "ENOENT") return false;
        throw error;
      });
    }
    if (completed || (!published && !uncertain)) {
      if (staging && resolve(staging).startsWith(localDirectory + sep)) await rm(staging, { recursive: true, force: true });
      await rm(lockPath, { force: true });
    }
  }
}
