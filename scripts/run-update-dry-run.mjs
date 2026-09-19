import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runDryRun, formatDryRunReport } from "./lib/dry-run.mjs";

const started = performance.now();
try {
  const repositoryPath = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const historyPath = process.env.DRY_RUN_HISTORY_PATH || (process.env.LOCALAPPDATA
    ? resolve(process.env.LOCALAPPDATA, "KyouNoUriidashi", "price-history.json")
    : resolve(repositoryPath, ".local", "price-history.json"));
  const result = await runDryRun({ repositoryPath, historyPath });
  console.log(formatDryRunReport(result));
  process.exitCode = result.ok ? 0 : 1;
} catch {
  console.log(formatDryRunReport({ ok: false, errorCode: "failed", elapsedSeconds: (performance.now() - started) / 1000 }));
  process.exitCode = 1;
}
