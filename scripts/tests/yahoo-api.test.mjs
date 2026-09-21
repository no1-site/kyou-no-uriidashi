import test from "node:test";
import assert from "node:assert/strict";
import { buildYahooItemSearchURL, normalizeYahooAffiliateId } from "../lib/yahoo-api.mjs";

test("Yahoo request omits affiliate parameters when no affiliate ID is configured", () => {
  const url = buildYahooItemSearchURL({ clientId: "client", jan: "4901111784185" });
  assert.equal(url.searchParams.get("appid"), "client");
  assert.equal(url.searchParams.get("jan_code"), "4901111784185");
  assert.equal(url.searchParams.has("affiliate_type"), false);
  assert.equal(url.searchParams.has("affiliate_id"), false);
});

test("Yahoo request includes a once-encoded ValueCommerce affiliate URL when configured", () => {
  const encoded = "http%3A%2F%2Fck.jp.ap.valuecommerce.com%2Fservlet%2Freferral%3Fsid%3D123%26pid%3D456%26vc_url%3D";
  const raw = "http://ck.jp.ap.valuecommerce.com/servlet/referral?sid=123&pid=456&vc_url=";
  assert.equal(normalizeYahooAffiliateId(encoded), raw);
  const url = buildYahooItemSearchURL({ clientId: "client", affiliateId: encoded, jan: "4901111784185" });
  assert.equal(url.searchParams.get("affiliate_type"), "vc");
  assert.equal(url.searchParams.get("affiliate_id"), raw);
  assert.match(url.href, /affiliate_id=http%3A%2F%2Fck\.jp\.ap\.valuecommerce\.com/);
  assert.doesNotMatch(url.href, /http%253A/);
  assert.equal(url.searchParams.get("condition"), "new");
  assert.equal(url.searchParams.get("in_stock"), "true");
});

test("Yahoo request rejects an invalid JAN", () => {
  assert.throws(() => buildYahooItemSearchURL({ clientId: "client", jan: "abc" }), /JAN is invalid/);
});


test("Yahoo affiliate normalization appends vc_url and rejects unrelated URLs", () => {
  assert.equal(
    normalizeYahooAffiliateId("https://ck.jp.ap.valuecommerce.com/servlet/referral?sid=123&pid=456"),
    "https://ck.jp.ap.valuecommerce.com/servlet/referral?sid=123&pid=456&vc_url="
  );
  assert.throws(() => normalizeYahooAffiliateId("https://example.com/?sid=123&pid=456"), /affiliate ID is invalid/);
});
