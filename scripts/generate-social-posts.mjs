import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildSocialPosts } from "./lib/social-posts.mjs";

const repositoryPath = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const productsPath = resolve(repositoryPath, "products.json");
const outputDirectory = resolve(repositoryPath, ".local");
const jsonPath = resolve(outputDirectory, "social-posts.json");
const textPath = resolve(outputDirectory, "social-posts.txt");

try {
  const products = JSON.parse(await readFile(productsPath, "utf8"));
  const result = buildSocialPosts(products);
  await mkdir(outputDirectory, { recursive: true });
  await writeFile(jsonPath, JSON.stringify(result, null, 2) + "\n", "utf8");
  const text = result.posts.length
    ? result.posts.map((post, index) => `--- 投稿候補 ${index + 1}（${post.type}） ---\n${post.text}\n`).join("\n")
    : result.reason + "\n";
  await writeFile(textPath, text, "utf8");

  console.log(`SNS投稿候補生成：${result.posts.length}件`);
  console.log(`${result.history_ready === false ? "価格比較候補商品" : "値下がり候補商品"}：${result.candidate_count || 0}件`);
  console.log("保存先：.local\\social-posts.txt");
  if (!result.posts.length) console.log(result.reason);
} catch {
  console.error("SNS投稿候補を生成できませんでした。products.jsonを確認してください。");
  process.exitCode = 1;
}
