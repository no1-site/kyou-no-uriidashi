// Virtual time exists only in this offline --import fixture; all network is mocked.
let fixtureTime = 0;
const realTimer = globalThis.setTimeout;
Object.defineProperty(globalThis, "performance", { value: { now: () => fixtureTime }, configurable: true });
globalThis.setTimeout = (callback, ms, ...args) => {
  fixtureTime += Math.max(0, Number(ms) || 0);
  return realTimer(callback, 0, ...args);
};
import "./mock-rakuten.mjs";

const rakutenFetch = globalThis.fetch;
let yahooRequests = 0;
globalThis.fetch = async input => {
  const url = new URL(input);
  if (url.hostname === "shopping.yahooapis.jp") {
    yahooRequests++;
    if (process.env.MOCK_UPDATE_FAILURE === "yahoo-429" && yahooRequests === 2) return new Response("", { status: 429, headers: { "Retry-After": "65" } });
    if (process.env.MOCK_UPDATE_FAILURE === "yahoo" && yahooRequests === 2) return new Response("", { status: 503 });
    if (process.env.MOCK_UPDATE_FAILURE === "yahoo-invalid") return new Response(JSON.stringify({ error: { message: "fixture" } }));
    const hit = {
      name: "テスト製品", janCode: url.searchParams.get("jan_code"), condition: "new", inStock: true,
      price: 700, code: "y1", seller: { sellerId: "y1", name: "Yahoo店" }, shipping: { code: 2 },
      url: "https://example.com/yahoo"
    };
    const hits = [hit];
    if (process.env.MOCK_YAHOO_REJECTIONS === "1") hits.push(
      { ...hit, price: 650 },
      { ...hit, name: "テスト製品 20個" },
      { ...hit, janCode: "not-a-jan" },
      { ...hit, condition: "used" }
    );
    return new Response(JSON.stringify({ hits }));
  }
  if (url.hostname === "api.keepa.com") {
    if (process.env.MOCK_UPDATE_FAILURE === "keepa-invalid") return new Response("{}");
    if (process.env.MOCK_UPDATE_FAILURE === "keepa") return new Response(JSON.stringify({ error: { type: "fixture_failure" } }), { status: 503 });
    return new Response(JSON.stringify({ products: [] }));
  }
  if (url.hostname === "openapi.rakuten.co.jp") return rakutenFetch(input);
  throw new Error("Unexpected fixture request");
};
