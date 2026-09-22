import { validJAN, positiveNumber } from "./rakuten-comparison.mjs";

export const siteBaseURL = "https://no1-site.github.io/kyou-no-uriidashi/";

function formatPrice(value) {
  const price = positiveNumber(value);
  return price ? `¥${Math.round(price).toLocaleString("ja-JP")}` : "価格未確認";
}

function safePercent(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.round(number) : null;
}

function cleanText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function shorten(value, max = 46) {
  const text = cleanText(value);
  const chars = [...text];
  return chars.length <= max ? text : chars.slice(0, Math.max(1, max - 1)).join("") + "…";
}

function productPath(product) {
  const jan = validJAN(product?.product_code);
  return jan ? `products/${jan}.html` : "";
}

function productURL(product, baseURL = siteBaseURL) {
  const path = productPath(product);
  return path ? new URL(path, baseURL).href : "";
}

function comparableOfferCount(product) {
  const offers = Array.isArray(product?.offers) ? product.offers : [];
  const shops = new Set();
  for (const offer of offers) {
    const code = cleanText(offer?.shop_code);
    if (!code || !positiveNumber(offer?.price)) continue;
    shops.add(code);
  }
  return shops.size;
}

export function priceDropCandidates(products) {
  return (Array.isArray(products) ? products : [])
    .filter(product => {
      const current = positiveNumber(product?.price);
      const historical = positiveNumber(product?.historical_price);
      const discount = safePercent(product?.historical_discount_percent);
      return Boolean(
        productPath(product) &&
        cleanText(product?.name) &&
        current &&
        historical &&
        historical > current &&
        discount &&
        comparableOfferCount(product) >= 2
      );
    })
    .sort((a, b) =>
      Number(b.historical_discount_percent || 0) - Number(a.historical_discount_percent || 0) ||
      Number(a.price || Infinity) - Number(b.price || Infinity)
    );
}

function productDropPost(product, baseURL) {
  const current = positiveNumber(product.price);
  const historical = positiveNumber(product.historical_price);
  const difference = Math.round(historical - current);
  const percent = safePercent(product.historical_discount_percent);
  return [
    "【PR】📉 値下がりチェック",
    shorten(product.name, 62),
    `現在 ${formatPrice(current)}`,
    `過去の記録価格 ${formatPrice(historical)}`,
    `記録価格より ${formatPrice(difference)} 低い（-${percent}%）`,
    "",
    "ショップ別価格はこちら👇",
    productURL(product, baseURL),
    "#価格比較 #節約 #今日の売り出し"
  ].join("\n");
}

function categoryPost(product, baseURL) {
  const current = positiveNumber(product.price);
  const historical = positiveNumber(product.historical_price);
  const difference = Math.round(historical - current);
  const percent = safePercent(product.historical_discount_percent);
  const category = cleanText(product.category) || "商品";
  return [
    `【PR】🛒 ${category}の価格チェック`,
    shorten(product.name, 58),
    `現在 ${formatPrice(current)} / 記録価格より${formatPrice(difference)}低い（-${percent}%）`,
    "",
    "価格・送料は購入前に各ショップで確認👇",
    productURL(product, baseURL),
    "#今日の売り出し #価格比較"
  ].join("\n");
}

function roundupPost(list, baseURL) {
  const top = list.slice(0, 3);
  const lines = top.map((product, index) =>
    `${index + 1}位 ${shorten(product.name, 28)} -${safePercent(product.historical_discount_percent)}%（${formatPrice(product.price)}）`
  );
  return [
    "【PR】📉 今日の値下がりTOP3",
    ...lines,
    "",
    "※過去の記録価格との比較です。価格・送料は購入前に確認👇",
    new URL("#priceDrops", baseURL).href,
    "#価格比較 #節約 #今日の売り出し"
  ].join("\n");
}

function codePointLength(value) {
  return [...String(value)].length;
}

export function buildSocialPosts(products, { baseURL = siteBaseURL, generatedAt = new Date().toISOString() } = {}) {
  const candidates = priceDropCandidates(products);
  if (!candidates.length) {
    return {
      generated_at: generatedAt,
      source: "products.json",
      posts: [],
      reason: "価格履歴が十分な値下がり商品がありません。"
    };
  }

  const posts = [];
  if (candidates.length >= 2) {
    posts.push({
      type: "roundup",
      text: roundupPost(candidates, baseURL),
      products: candidates.slice(0, 3).map(product => validJAN(product.product_code))
    });
  }
  posts.push({
    type: "product",
    text: productDropPost(candidates[0], baseURL),
    products: [validJAN(candidates[0].product_code)]
  });

  const alternate = candidates.find(product => product.category !== candidates[0].category) || candidates[1];
  if (alternate) {
    posts.push({
      type: "category",
      text: categoryPost(alternate, baseURL),
      products: [validJAN(alternate.product_code)]
    });
  }

  for (const post of posts) {
    post.length = codePointLength(post.text);
    post.ready = post.length <= 260;
  }

  return {
    generated_at: generatedAt,
    source: "products.json",
    candidate_count: candidates.length,
    posts
  };
}
