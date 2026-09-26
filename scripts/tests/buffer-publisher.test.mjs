import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  findTwitterChannel,
  postingTargetForDate,
  publishSocialPosts,
  tokyoDateKey
} from "../lib/buffer-publisher.mjs";

function jsonResponse(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() { return payload; }
  };
}

function mockBuffer({ channels = [{ id: "x1", name: "uriidashi_ai0922", service: "twitter" }] } = {}) {
  const created = [];
  const fetchImpl = async (_url, options) => {
    const body = JSON.parse(options.body);
    if (body.query.includes("account { organizations")) {
      return jsonResponse({ data: { account: { organizations: [{ id: "org1", name: "My organization" }] } } });
    }
    if (body.query.includes("channels(input:")) {
      return jsonResponse({ data: { channels } });
    }
    if (body.query.includes("mutation CreatePost")) {
      created.push(body.variables.input);
      return jsonResponse({
        data: {
          createPost: {
            post: {
              id: `p${created.length}`,
              text: body.variables.input.text,
              dueAt: `2026-09-23T0${created.length + 1}:00:00.000Z`
            }
          }
        }
      });
    }
    throw new Error("Unexpected Buffer request");
  };
  return { fetchImpl, created };
}

const samplePosts = [1, 2, 3].map(number => ({
  type: `post${number}`,
  text: `【PR】テスト投稿${number}`,
  ready: true
}));

test("Tokyo posting target counts only remaining slots for the local day", () => {
  assert.equal(tokyoDateKey(new Date("2026-09-23T01:00:00Z")), "2026-09-23");
  assert.equal(postingTargetForDate(new Date("2026-09-23T01:00:00Z")), 3); // 10:00 JST
  assert.equal(postingTargetForDate(new Date("2026-09-23T01:36:00Z")), 2); // 10:36 JST
  assert.equal(postingTargetForDate(new Date("2026-09-23T03:01:00Z")), 1); // 12:01 JST
  assert.equal(postingTargetForDate(new Date("2026-09-23T10:01:00Z")), 0); // 19:01 JST
  assert.equal(postingTargetForDate(new Date("2026-09-26T01:00:00Z")), 2); // Sat 10:00 JST
  assert.equal(postingTargetForDate(new Date("2026-09-26T03:01:00Z")), 1); // Sat 12:01 JST
});

test("publisher queues three weekday posts once and persists idempotency state", async () => {
  const dir = await mkdtemp(join(tmpdir(), "buffer-publisher-"));
  const statePath = join(dir, "state.json");
  const mock = mockBuffer();
  const now = new Date("2026-09-23T01:10:00Z");

  const first = await publishSocialPosts({
    apiKey: "secret",
    posts: samplePosts,
    statePath,
    now,
    fetchImpl: mock.fetchImpl
  });
  assert.equal(first.queued.length, 3);
  assert.deepEqual(mock.created.map(item => item.text), samplePosts.map(post => post.text));

  const second = await publishSocialPosts({
    apiKey: "secret",
    posts: samplePosts,
    statePath,
    now,
    fetchImpl: async () => { throw new Error("network should not be used on rerun"); }
  });
  assert.equal(second.queued.length, 0);

  const state = JSON.parse(await readFile(statePath, "utf8"));
  assert.equal(state.date, "2026-09-23");
  assert.equal(state.posts.length, 3);
});

test("publisher limits weekend queueing to two posts", async () => {
  const dir = await mkdtemp(join(tmpdir(), "buffer-weekend-"));
  const mock = mockBuffer();
  const result = await publishSocialPosts({
    apiKey: "secret",
    posts: samplePosts,
    statePath: join(dir, "state.json"),
    now: new Date("2026-09-26T01:10:00Z"),
    fetchImpl: mock.fetchImpl
  });
  assert.equal(result.queued.length, 2);
  assert.equal(mock.created.length, 2);
});

test("channel selection refuses ambiguity unless a name is configured", async () => {
  const mock = mockBuffer({
    channels: [
      { id: "x1", name: "one", service: "twitter" },
      { id: "x2", name: "two", service: "twitter" }
    ]
  });
  await assert.rejects(
    findTwitterChannel({ apiKey: "secret", fetchImpl: mock.fetchImpl }),
    /Multiple Buffer X channels/
  );
  const selected = await findTwitterChannel({
    apiKey: "secret",
    channelName: "two",
    fetchImpl: mock.fetchImpl
  });
  assert.equal(selected.id, "x2");
});


test("confirmed Buffer duplicate does not abort the rest of the queue", async () => {
  const dir = await mkdtemp(join(tmpdir(), "buffer-duplicate-"));
  let createCount = 0;
  const fetchImpl = async (_url, options) => {
    const body = JSON.parse(options.body);
    if (body.query.includes("account { organizations")) {
      return jsonResponse({ data: { account: { organizations: [{ id: "org1", name: "My organization" }] } } });
    }
    if (body.query.includes("channels(input:")) {
      return jsonResponse({ data: { channels: [{ id: "x1", name: "uriidashi_ai0922", service: "twitter" }] } });
    }
    if (body.query.includes("mutation CreatePost")) {
      createCount++;
      if (createCount === 1) {
        return jsonResponse({ data: { createPost: { message: "Whoops, it looks like you've already got this one scheduled or posted around the same time. We're not able to post the same thing twice so close together." } } });
      }
      return jsonResponse({ data: { createPost: { post: { id: "p2", text: body.variables.input.text, dueAt: "2026-09-26T10:00:00.000Z" } } } });
    }
    throw new Error("Unexpected Buffer request");
  };

  const result = await publishSocialPosts({
    apiKey: "secret",
    posts: samplePosts,
    statePath: join(dir, "state.json"),
    now: new Date("2026-09-26T01:10:00Z"),
    fetchImpl
  });
  assert.equal(result.queued.length, 1);
  assert.equal(createCount, 2);
  const state = JSON.parse(await readFile(join(dir, "state.json"), "utf8"));
  assert.equal(state.posts.length, 2);
  assert.equal(state.posts[0].duplicate_confirmed, true);
});
