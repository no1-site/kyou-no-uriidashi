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

const xURLPattern = /https?:\/\/[^\s]+/gu;

function xCodePointWeight(char) {
  const cp = char.codePointAt(0);
  return (
    (cp >= 0x0000 && cp <= 0x10ff) ||
    (cp >= 0x2000 && cp <= 0x200d) ||
    (cp >= 0x2010 && cp <= 0x201f) ||
    (cp >= 0x2032 && cp <= 0x2037)
  ) ? 1 : 2;
}

export function xWeightedLength(value) {
  const text = String(value ?? "");
  let length = 0;
  let lastIndex = 0;
  for (const match of text.matchAll(xURLPattern)) {
    const before = text.slice(lastIndex, match.index);
    for (const char of before) length += xCodePointWeight(char);
    length += 23;
    lastIndex = match.index + match[0].length;
  }
  for (const char of text.slice(lastIndex)) length += xCodePointWeight(char);
  return length;
}

function fitXPost(makeText, initialNameLimit, minimumNameLimit = 6) {
  for (let limit = initialNameLimit; limit >= minimumNameLimit; limit--) {
    const text = makeText(limit);
    if (xWeightedLength(text) <= 280) return text;
  }
  return makeText(minimumNameLimit);
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

export function currentComparisonCandidates(products) {
  return (Array.isArray(products) ? products : [])
    .filter(product => Boolean(
      productPath(product) &&
      cleanText(product?.name) &&
      positiveNumber(product?.price) &&
      comparableOfferCount(product) >= 2
    ))
    .sort((a, b) =>
      Number(b?.score || 0) - Number(a?.score || 0) ||
      Number(b?.review_count || 0) - Number(a?.review_count || 0) ||
      Number(a?.price || Infinity) - Number(b?.price || Infinity)
    );
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
  return fitXPost(nameLimit => [
    "【PR】📉 値下がりチェック",
    shorten(product.name, nameLimit),
    `現在 ${formatPrice(current)}`,
    `過去の記録価格 ${formatPrice(historical)}`,
    `記録価格より ${formatPrice(difference)} 低い（-${percent}%）`,
    "",
    "ショップ別価格はこちら👇",
    productURL(product, baseURL),
    "#価格比較 #節約 #今日の売り出し"
  ].join("\n"), 62);
}

function categoryPost(product, baseURL) {
  const current = positiveNumber(product.price);
  const historical = positiveNumber(product.historical_price);
  const difference = Math.round(historical - current);
  const percent = safePercent(product.historical_discount_percent);
  const category = cleanText(product.category) || "商品";
  return fitXPost(nameLimit => [
    `【PR】🛒 ${category}の価格チェック`,
    shorten(product.name, nameLimit),
    `現在 ${formatPrice(current)} / 記録価格より${formatPrice(difference)}低い（-${percent}%）`,
    "",
    "価格・送料は購入前に各ショップで確認👇",
    productURL(product, baseURL),
    "#今日の売り出し #価格比較"
  ].join("\n"), 58);
}

function roundupPost(list, baseURL) {
  const top = list.slice(0, 3);
  return fitXPost(nameLimit => {
    const lines = top.map((product, index) =>
      `${index + 1}位 ${shorten(product.name, nameLimit)} -${safePercent(product.historical_discount_percent)}%（${formatPrice(product.price)}）`
    );
    return [
      "【PR】📉 今日の値下がりTOP3",
      ...lines,
      "",
      "※過去の記録価格との比較です。価格・送料は購入前に確認👇",
      new URL("#priceDrops", baseURL).href,
      "#価格比較 #節約 #今日の売り出し"
    ].join("\n");
  }, 28);
}

function currentProductPost(product, baseURL) {
  const category = cleanText(product.category) || "商品";
  const count = comparableOfferCount(product);
  return fitXPost(nameLimit => [
    `【PR】🔎 今日の${category}価格チェック`,
    shorten(product.name, nameLimit),
    `掲載価格 ${formatPrice(product.price)}〜 / ${count}ショップを比較`,
    "",
    "送料・在庫など最新条件はこちら👇",
    productURL(product, baseURL),
    "#価格比較 #節約 #今日の売り出し"
  ].join("\n"), 62);
}

function currentRoundupPost(list, baseURL) {
  const top = list.slice(0, 3);
  return fitXPost(nameLimit => {
    const lines = top.map((product, index) =>
      `${index + 1}. ${shorten(product.name, nameLimit)}（${formatPrice(product.price)}〜）`
    );
    return [
      "【PR】🛒 今日の価格比較3選",
      ...lines,
      "",
      "同一商品として確認できたショップを比較しています👇",
      new URL("#today", baseURL).href,
      "#価格比較 #節約 #今日の売り出し"
    ].join("\n");
  }, 28);
}

function codePointLength(value) {
  return [...String(value)].length;
}

export function buildSocialPosts(products, { baseURL = siteBaseURL, generatedAt = new Date().toISOString() } = {}) {
  const candidates = priceDropCandidates(products);
  const posts = [];

  if (!candidates.length) {
    const current = currentComparisonCandidates(products);
    if (!current.length) {
      return {
        generated_at: generatedAt,
        source: "products.json",
        posts: [],
        reason: "SNS投稿に使える比較商品がありません。"
      };
    }

    if (current.length >= 2) {
      posts.push({
        type: "current_roundup",
        text: currentRoundupPost(current, baseURL),
        products: current.slice(0, 3).map(product => validJAN(product.product_code))
      });
    }

    posts.push({
      type: "current_product",
      text: currentProductPost(current[0], baseURL),
      products: [validJAN(current[0].product_code)]
    });

    const alternateCurrent = current.find(product => product.category !== current[0].category) || current[1];
    if (alternateCurrent) {
      posts.push({
        type: "current_category",
        text: currentProductPost(alternateCurrent, baseURL),
        products: [validJAN(alternateCurrent.product_code)]
      });
    }

    for (const post of posts) {
      post.length = codePointLength(post.text);
      post.x_weighted_length = xWeightedLength(post.text);
      post.ready = post.x_weighted_length <= 280;
    }

    return {
      generated_at: generatedAt,
      source: "products.json",
      candidate_count: current.length,
      history_ready: false,
      posts
    };
  }
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
    post.x_weighted_length = xWeightedLength(post.text);
    post.ready = post.x_weighted_length <= 280;
  }

  return {
    generated_at: generatedAt,
    source: "products.json",
    candidate_count: candidates.length,
    history_ready: true,
    posts
  };
}
