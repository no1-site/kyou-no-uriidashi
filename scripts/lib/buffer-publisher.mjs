import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

const bufferEndpoint = "https://api.buffer.com";
const tokyoTimeZone = "Asia/Tokyo";

function cleanText(value) {
  return String(value ?? "").trim();
}

function textHash(value) {
  return createHash("sha256").update(String(value), "utf8").digest("hex");
}

export function tokyoDateKey(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tokyoTimeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function postingTargetForDate(date = new Date()) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: tokyoTimeZone,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  });
  const parts = Object.fromEntries(formatter.formatToParts(date).map(part => [part.type, part.value]));
  const minuteOfDay = Number(parts.hour) * 60 + Number(parts.minute);
  const weekend = parts.weekday === "Sat" || parts.weekday === "Sun";
  const slots = weekend ? [12 * 60, 19 * 60] : [10 * 60 + 30, 12 * 60, 19 * 60];
  return slots.filter(slot => slot > minuteOfDay).length;
}

async function readState(path, dateKey) {
  try {
    const state = JSON.parse(await readFile(path, "utf8"));
    if (state?.date === dateKey && Array.isArray(state?.posts)) return state;
  } catch {
    // Missing or invalid state is treated as a fresh day.
  }
  return { date: dateKey, posts: [] };
}

async function writeState(path, state) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(state, null, 2) + "\n", "utf8");
}

async function bufferGraphQL({ apiKey, query, variables, fetchImpl = fetch }) {
  const response = await fetchImpl(bufferEndpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json; charset=utf-8"
    },
    body: JSON.stringify({ query, variables })
  });

  if (!response.ok) {
    throw new Error(`Buffer API HTTP ${response.status}.`);
  }

  const payload = await response.json();
  if (Array.isArray(payload?.errors) && payload.errors.length) {
    throw new Error(`Buffer API error: ${payload.errors.map(error => error?.message || "unknown").join(" / ")}`);
  }
  return payload?.data;
}

export async function findTwitterChannel({ apiKey, channelName = "", fetchImpl = fetch }) {
  const accountData = await bufferGraphQL({
    apiKey,
    fetchImpl,
    query: `query { account { organizations { id name } } }`
  });
  const organizations = Array.isArray(accountData?.account?.organizations)
    ? accountData.account.organizations
    : [];
  if (!organizations.length) throw new Error("Buffer organization was not found.");

  const twitterChannels = [];
  for (const organization of organizations) {
    const channelsData = await bufferGraphQL({
      apiKey,
      fetchImpl,
      query: `query { channels(input: { organizationId: ${JSON.stringify(String(organization.id))} }) { id name service } }`
    });
    for (const channel of Array.isArray(channelsData?.channels) ? channelsData.channels : []) {
      if (String(channel?.service) === "twitter") {
        twitterChannels.push({ ...channel, organizationId: String(organization.id) });
      }
    }
  }

  if (channelName) {
    const match = twitterChannels.find(channel => String(channel?.name) === channelName);
    if (!match) throw new Error(`Buffer X channel '${channelName}' was not found.`);
    return match;
  }
  if (twitterChannels.length === 1) return twitterChannels[0];
  if (!twitterChannels.length) throw new Error("A Buffer X channel was not found.");
  throw new Error("Multiple Buffer X channels were found. Set BUFFER_CHANNEL_NAME.");
}

function isDuplicatePostError(message) {
  const text = String(message || "").toLowerCase();
  return text.includes("already got this one scheduled or posted") ||
    text.includes("same thing twice so close together");
}

export async function createQueuedPost({ apiKey, channelId, text, fetchImpl = fetch }) {
  const data = await bufferGraphQL({
    apiKey,
    fetchImpl,
    query: `mutation CreatePost($input: CreatePostInput!) {
      createPost(input: $input) {
        ... on PostActionSuccess { post { id text dueAt } }
        ... on MutationError { message }
      }
    }`,
    variables: {
      input: {
        text,
        channelId,
        schedulingType: "automatic",
        mode: "addToQueue"
      }
    }
  });

  const result = data?.createPost;
  if (result?.post?.id) return result.post;
  throw new Error(`Buffer could not create the post: ${result?.message || "unknown error"}`);
}

export async function publishSocialPosts({
  apiKey,
  posts,
  statePath,
  channelName = "",
  now = new Date(),
  fetchImpl = fetch
}) {
  if (!cleanText(apiKey)) throw new Error("BUFFER_API_KEY is required.");
  if (!cleanText(statePath)) throw new Error("BUFFER_STATE_PATH is required.");

  const date = tokyoDateKey(now);
  const target = postingTargetForDate(now);
  const candidates = (Array.isArray(posts) ? posts : [])
    .filter(post => post?.ready !== false && cleanText(post?.text))
    .slice(0, target);

  if (!candidates.length) {
    return { date, target, queued: [], skipped: 0, reason: "No ready social posts." };
  }

  const state = await readState(statePath, date);
  if (state.posts.length >= target) {
    return {
      date,
      target,
      queued: [],
      skipped: candidates.length,
      reason: "Today's Buffer slots are already filled by this automation."
    };
  }

  const completedHashes = new Set(state.posts.map(post => post?.text_hash).filter(Boolean));
  const pending = candidates.filter(post => !completedHashes.has(textHash(post.text)));
  const remainingSlots = Math.max(0, target - state.posts.length);
  const toQueue = pending.slice(0, remainingSlots);

  if (!toQueue.length) {
    return {
      date,
      target,
      queued: [],
      skipped: candidates.length,
      reason: "Today's generated posts were already queued."
    };
  }

  const channel = await findTwitterChannel({ apiKey, channelName, fetchImpl });
  const queued = [];
  for (const post of toQueue) {
    try {
      const created = await createQueuedPost({
        apiKey,
        channelId: String(channel.id),
        text: String(post.text),
        fetchImpl
      });
      const record = {
        type: String(post.type || "post"),
        text_hash: textHash(post.text),
        buffer_post_id: String(created.id),
        due_at: created.dueAt || null
      };
      state.posts.push(record);
      queued.push(record);
      await writeState(statePath, state);
    } catch (error) {
      if (!isDuplicatePostError(error?.message)) throw error;
      // Buffer confirms this exact post already occupies a nearby queue/post slot.
      // Persist that fact locally so a retry does not repeatedly abort the day.
      state.posts.push({
        type: String(post.type || "post"),
        text_hash: textHash(post.text),
        buffer_post_id: null,
        due_at: null,
        duplicate_confirmed: true
      });
      await writeState(statePath, state);
    }
  }

  return {
    date,
    target,
    queued,
    skipped: candidates.length - queued.length,
    channel: String(channel.name || "twitter")
  };
}
