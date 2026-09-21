export const yahooItemSearchEndpoint = "https://shopping.yahooapis.jp/ShoppingWebService/V3/itemSearch";

export function normalizeYahooAffiliateId(value) {
  const input = String(value || "").trim();
  if (!input) return "";
  let decoded = input;
  try {
    if (/%[0-9A-Fa-f]{2}/.test(input)) decoded = decodeURIComponent(input);
  } catch {
    throw new Error("Yahoo affiliate ID is invalid.");
  }
  if (!/^https?:\/\/ck\.jp\.ap\.valuecommerce\.com\/servlet\/referral\?/.test(decoded)) {
    throw new Error("Yahoo affiliate ID is invalid.");
  }
  if (!/[?&]sid=[^&]+/.test(decoded) || !/[?&]pid=[^&]+/.test(decoded)) {
    throw new Error("Yahoo affiliate ID is invalid.");
  }
  return /[?&]vc_url=/.test(decoded) ? decoded : decoded + "&vc_url=";
}

export function buildYahooItemSearchURL({ clientId, affiliateId = "", jan }) {
  const appid = String(clientId || "").trim();
  const code = String(jan || "").trim();
  if (!appid) throw new Error("Yahoo Client ID is missing.");
  if (!/^\d{8}$|^\d{13}$/.test(code)) throw new Error("Yahoo JAN is invalid.");

  const url = new URL(yahooItemSearchEndpoint);
  url.searchParams.set("appid", appid);
  url.searchParams.set("jan_code", code);
  url.searchParams.set("results", "50");
  url.searchParams.set("in_stock", "true");
  url.searchParams.set("condition", "new");
  url.searchParams.set("sort", "+price");
  url.searchParams.set("image_size", "300");

  const affiliate = normalizeYahooAffiliateId(affiliateId);
  if (affiliate) {
    url.searchParams.set("affiliate_type", "vc");
    url.searchParams.set("affiliate_id", affiliate);
  }
  return url;
}
