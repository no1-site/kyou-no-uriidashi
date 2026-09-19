import { runDryRunSequence } from "./lib/dry-run-sequence.mjs";
import { writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runDryRun, formatDryRunReport } from "./lib/dry-run.mjs";

const started = performance.now();
try {
  const repositoryPath = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const historyPath = process.env.DRY_RUN_HISTORY_PATH || (process.env.LOCALAPPDATA
    ? resolve(process.env.LOCALAPPDATA, "KyouNoUriidashi", "price-history.json")
    : resolve(repositoryPath, ".local", "price-history.json"));
  const execute = async target => {
    const result = await runDryRun({ repositoryPath, historyPath,
      environment: { ...process.env, ...(target ? { TARGET_PRODUCT_COUNT: String(target) } : {}) } });
    if ([20, 50, 100].includes(result.target)) await writeFile(resolve(repositoryPath, ".local", `dry-run-result-${result.target}.json`), JSON.stringify(result, null, 2) + "\n");
    return result;
  };
  if (process.argv.includes("--sequence")) {
    const sequence = await runDryRunSequence({ run: execute, report: async (result, target) => {
      console.log(`目標${target}商品のドライラン結果`);
      console.log(formatDryRunReport(result));
      if (result.ok && result.metrics?.apiErrors === 0 && result.metrics?.rateLimited === 0 && target !== 100) console.log("次の段階まで65秒以上待機します。");
    } });
    await writeFile(resolve(repositoryPath, ".local", "dry-run-sequence-result.json"), JSON.stringify(sequence, null, 2) + "\n");
    process.exitCode = sequence.ok ? 0 : 1;
  } else {
    const result = await execute();
    console.log(formatDryRunReport(result));
    process.exitCode = result.ok ? 0 : 1;
  }
} catch {
  console.log(formatDryRunReport({ ok: false, errorCode: "failed", elapsedSeconds: (performance.now() - started) / 1000 }));
  process.exitCode = 1;
}
