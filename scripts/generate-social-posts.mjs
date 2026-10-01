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
  const rotationPath = process.env.SOCIAL_ROTATION_PATH || "";
  let rotation = { days: [] };
  if (rotationPath) {
    try {
      const parsed = JSON.parse(await readFile(rotationPath, "utf8"));
      if (Array.isArray(parsed?.days)) rotation = parsed;
    } catch {
      // Missing/invalid rotation history starts fresh.
    }
  }

  const dateParts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit"
  }).formatToParts(new Date());
  const dateValues = Object.fromEntries(dateParts.map(part => [part.type, part.value]));
  const today = `${dateValues.year}-${dateValues.month}-${dateValues.day}`;
  const recentFamilies = rotation.days
    .filter(day => day?.date && day.date !== today)
    .slice(-3)
    .flatMap(day => Array.isArray(day?.families) ? day.families : []);

  const result = buildSocialPosts(products, { recentFamilies });

  if (rotationPath) {
    const nextDays = rotation.days.filter(day => day?.date !== today);
    nextDays.push({ date: today, families: result.selected_families || [] });
    await mkdir(dirname(rotationPath), { recursive: true });
    await writeFile(rotationPath, JSON.stringify({ days: nextDays.slice(-7) }, null, 2) + "\n", "utf8");
  }
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
