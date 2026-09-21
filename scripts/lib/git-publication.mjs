import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join } from "node:path";
import { rm, writeFile } from "node:fs/promises";

const execute = promisify(execFile);

export function createGitPublisher({ gitPath, repositoryPath, branch = "main", environment = process.env }) {
  let receipt;
  async function git(args, extra = {}) {
    try {
      const result = await execute(gitPath, ["-C", repositoryPath, ...args], {
        env: { ...environment, ...extra }, windowsHide: true, maxBuffer: 1024 * 1024
      });
      return result.stdout.trim();
    } catch {
      // Git/network diagnostics can include credential-bearing URLs. Do not echo.
      throw new Error(`Git publication failed: ${args[0]}`);
    }
  }
  async function preflight() {
    if (await git(["branch", "--show-current"]) !== branch) throw new Error("Publication requires the configured branch.");
    if (await git(["status", "--porcelain"])) throw new Error("Publication requires a clean working tree and index.");
    return git(["rev-parse", "HEAD"]);
  }
  return {
    preflight,
    async publish({ stagedProducts, staging, stagedSiteAssets = [] }) {
      const base = await preflight();
      const indexEnvironment = { GIT_INDEX_FILE: join(staging, "publication.index") };
      await git(["read-tree", base], indexEnvironment);
      const blob = await git(["hash-object", "-w", "--", stagedProducts]);
      await git(["update-index", "--add", "--cacheinfo", `100644,${blob},products.json`], indexEnvironment);

      const desiredProductPages = new Set(
        stagedSiteAssets.map(asset => asset.path).filter(path => /^products\/\d{8,13}\.html$/.test(path))
      );
      const existingProductPages = (await git(["ls-tree", "-r", "--name-only", base, "--", "products"]))
        .split(/\r?\n/).filter(path => /^products\/\d{8,13}\.html$/.test(path));
      for (const path of existingProductPages) {
        if (!desiredProductPages.has(path)) {
          await git(["update-index", "--force-remove", "--", path], indexEnvironment);
        }
      }
      for (const asset of stagedSiteAssets) {
        if (!/^(?:sitemap\.xml|products\/\d{8,13}\.html)$/.test(asset.path)) {
          throw new Error("Git publication failed: invalid-site-asset");
        }
        const assetBlob = await git(["hash-object", "-w", "--", asset.stagedPath]);
        await git(["update-index", "--add", "--cacheinfo", `100644,${assetBlob},${asset.path}`], indexEnvironment);
      }
      const tree = await git(["write-tree"], indexEnvironment);
      const commit = await git(["-c", "user.name=no1-site", "-c", "user.email=no1-site@users.noreply.github.com",
        "commit-tree", tree, "-p", base, "-m", `Update market products ${new Date().toISOString()}`]);
      if (await preflight() !== base) throw new Error("Branch changed during publication.");
      const journal = join(staging, "publication-pending.json");
      receipt = { base, commit, blob, branch };
      await writeFile(journal, JSON.stringify(receipt, null, 2) + "\n");
      try {
        // No force push; a concurrent upstream change rejects publication.
        await git(["push", "origin", `${commit}:refs/heads/${branch}`]);
      } catch (error) {
        // A lost response can occur after the remote accepted the commit.
        let remote;
        try { remote = (await git(["ls-remote", "origin", `refs/heads/${branch}`])).split(/\s/)[0]; }
        catch { throw new Error("Push outcome unknown; staged data and update lock retained for recovery."); }
        if (remote !== commit) {
          if (remote === base) await rm(journal);
          // If the remote advanced unexpectedly, keep evidence for inspection.
          throw error;
        }
      }
    },
    async finish() {
      if (!receipt) throw new Error("Missing publication receipt.");
      const { base, commit, blob, branch: publishedBranch } = receipt;
      await git(["update-ref", `refs/heads/${publishedBranch}`, commit, base]);
      await git(["read-tree", commit]);
    }
  };
}
