import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, mkdir, chmod, access, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createGitPublisher } from "../lib/git-publication.mjs";
import { runUpdate } from "../lib/update-pipeline.mjs";

const execute = promisify(execFile);
async function findGit() {
  if (process.env.TEST_GIT_PATH) return process.env.TEST_GIT_PATH;
  if (process.platform === "win32" && process.env.LOCALAPPDATA) {
    const desktop = join(process.env.LOCALAPPDATA, "GitHubDesktop");
    const versions = (await readdir(desktop).catch(() => [])).filter(name => name.startsWith("app-")).sort().reverse();
    for (const version of versions) {
      const candidate = join(desktop, version, "resources", "app", "git", "cmd", "git.exe");
      if (await access(candidate).then(() => true, () => false)) return candidate;
    }
  }
  return "git";
}
const gitPath = await findGit();
async function git(cwd, ...args) {
  return (await execute(gitPath, ["-C", cwd, ...args], { windowsHide: true })).stdout.trim();
}
async function setup() {
  const root = await mkdtemp(join(tmpdir(), "publication-git-test-"));
  const repositoryPath = join(root, "checkout");
  const remote = join(root, "remote.git");
  await mkdir(repositoryPath);
  await git(root, "init", "--bare", remote);
  await git(repositoryPath, "init", "-b", "main");
  await git(repositoryPath, "config", "user.name", "Fixture");
  await git(repositoryPath, "config", "user.email", "fixture@example.invalid");
  await git(repositoryPath, "config", "core.autocrlf", "false");
  await writeFile(join(repositoryPath, ".gitignore"), ".local/\n");
  await writeFile(join(repositoryPath, "products.json"), "[]\n");
  await writeFile(join(repositoryPath, "sitemap.xml"), "<old-sitemap/>\n");
  await mkdir(join(repositoryPath, "products"));
  await writeFile(join(repositoryPath, "products", "12345678.html"), "stale page\n");
  await git(repositoryPath, "add", ".gitignore", "products.json", "sitemap.xml", "products/12345678.html");
  await git(repositoryPath, "commit", "-m", "Fixture initial data");
  await git(repositoryPath, "remote", "add", "origin", remote);
  await git(repositoryPath, "push", "-u", "origin", "main");
  const historyPath = join(root, "history.json");
  await writeFile(historyPath, '{"products":{}}\n');
  const publisher = createGitPublisher({ gitPath, repositoryPath });
  return { root, repositoryPath, remote, historyPath, publisher };
}
function options(config) {
  return { repositoryPath: config.repositoryPath, historyPath: config.historyPath,
    environment: { ...process.env, YAHOO_CLIENT_ID: "", KEEPA_API_KEY: "" },
    runStage: async (name, env) => {
      assert.equal(name, "rakuten");
      await writeFile(env.RAKUTEN_OUTPUT_PATH, JSON.stringify([{
        id: "reference", product_code: "4901111784185", name: "参考商品", category: "日用品", price: 1000,
        comparison_type: "review_only", offers: [], best_url: "https://example.com/item",
        checked_at: new Date().toISOString()
      }]));
      await writeFile(env.RAKUTEN_HISTORY_PATH, '{"products":{},"updated_at":"fixture"}\n');
    }, publish: config.publisher.publish, finish: config.publisher.finish };
}

test("real Git publication atomically sends products, SEO page and sitemap and removes stale pages", async () => {
  const config = await setup();
  const base = await git(config.repositoryPath, "rev-parse", "HEAD");
  await runUpdate(options(config));
  const head = await git(config.repositoryPath, "rev-parse", "HEAD");
  assert.notEqual(head, base);
  assert.equal(await git(config.remote, "rev-parse", "main"), head);
  assert.equal(await git(config.repositoryPath, "status", "--porcelain"), "");
  const changed = (await git(config.repositoryPath, "diff-tree", "--no-commit-id", "--name-only", "-r", head)).split(/\r?\n/).sort();
  assert.deepEqual(changed, [
    "products.json",
    "products/12345678.html",
    "products/4901111784185.html",
    "categories/kaden.html",
    "categories/hobby.html",
    "categories/beauty.html",
    "categories/food.html",
    "categories/pet.html",
    "categories/daily.html",
    "robots.txt",
    "sitemap.xml"
  ].sort());
  assert.equal(await readFile(join(config.repositoryPath, "products", "4901111784185.html"), "utf8").then(value => value.includes("参考商品")), true);
  await assert.rejects(access(join(config.repositoryPath, "products", "12345678.html")), { code: "ENOENT" });
  assert.match(await readFile(join(config.repositoryPath, "categories", "daily.html"), "utf8"), /日用品の価格比較/);
  assert.match(await readFile(join(config.repositoryPath, "robots.txt"), "utf8"), /Sitemap:/);
  assert.match(await readFile(join(config.repositoryPath, "sitemap.xml"), "utf8"), /4901111784185/);
  assert.equal(JSON.parse(await readFile(config.historyPath, "utf8")).updated_at, "fixture");
});

test("real rejected Git push preserves HEAD, index, products and history", async () => {
  const config = await setup();
  const hook = join(config.remote, "hooks", "pre-receive");
  await writeFile(hook, "#!/bin/sh\nexit 1\n");
  await chmod(hook, 0o755);
  const base = await git(config.repositoryPath, "rev-parse", "HEAD");
  await assert.rejects(runUpdate(options(config)), /Git publication failed: push/);
  assert.equal(await git(config.repositoryPath, "rev-parse", "HEAD"), base);
  assert.equal(await git(config.repositoryPath, "status", "--porcelain"), "");
  assert.equal(await readFile(join(config.repositoryPath, "products.json"), "utf8"), "[]\n");
  assert.equal(await readFile(config.historyPath, "utf8"), '{"products":{}}\n');
  await assert.rejects(access(join(config.repositoryPath, ".local", "update.lock")), { code: "ENOENT" });
});

test("publisher refuses user-staged changes and a feature branch", async () => {
  const config = await setup();
  await writeFile(join(config.repositoryPath, "user.txt"), "user work");
  await git(config.repositoryPath, "add", "user.txt");
  await assert.rejects(config.publisher.preflight(), /clean working tree/);
  assert.equal(await git(config.repositoryPath, "diff", "--cached", "--name-only"), "user.txt");
  await git(config.repositoryPath, "switch", "-c", "fixture-feature");
  await assert.rejects(config.publisher.preflight(), /configured branch/);
});
