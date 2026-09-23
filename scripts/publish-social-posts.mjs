import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { publishSocialPosts } from "./lib/buffer-publisher.mjs";

const repositoryPath = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const socialPostsPath = resolve(repositoryPath, ".local", "social-posts.json");
const statePath = process.env.BUFFER_STATE_PATH || resolve(repositoryPath, ".local", "buffer-post-state.json");

try {
  const generated = JSON.parse(await readFile(socialPostsPath, "utf8"));
  const result = await publishSocialPosts({
    apiKey: process.env.BUFFER_API_KEY,
    posts: generated?.posts,
    statePath,
    channelName: process.env.BUFFER_CHANNEL_NAME || ""
  });

  console.log(`Buffer queue: ${result.queued.length} post(s) added for ${result.date}.`);
  for (const post of result.queued) {
    console.log(`- ${post.type}: ${post.due_at || "scheduled"}`);
  }
  if (result.reason) console.log(result.reason);
} catch (error) {
  console.error(`Buffer publication failed: ${error?.message || error}`);
  process.exitCode = 1;
}
