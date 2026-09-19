import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runUpdate } from "./lib/update-pipeline.mjs";
import { createGitPublisher } from "./lib/git-publication.mjs";

const repositoryPath = resolve(dirname(fileURLToPath(import.meta.url)), "..");
try {
  if (!process.env.UPDATE_GIT_PATH || !process.env.RAKUTEN_HISTORY_PATH) throw new Error("Update runtime paths are missing.");
  const publisher = createGitPublisher({ gitPath: process.env.UPDATE_GIT_PATH, repositoryPath });
  await publisher.preflight();
  const result = await runUpdate({ repositoryPath, historyPath: process.env.RAKUTEN_HISTORY_PATH,
    publish: publisher.publish, finish: publisher.finish });
  console.log(`[PUBLICATION RESULT] published=${result.count} history=confirmed`);
} catch (error) {
  // Do not emit arbitrary exception messages/paths or subprocess diagnostics.
  const safe = /^(Publication validation: [a-z_]+|Update stage failed: (rakuten|yahoo|keepa)|Git publication failed: [a-z-]+)$/.test(error.message);
  console.error(safe ? error.message : "Update stopped. Live data was not replaced before remote success. Check .local/update.lock for interrupted publication.");
  process.exitCode = 1;
}
