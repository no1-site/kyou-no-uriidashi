import { writeFile } from "node:fs/promises";

const applicationId = process.env.RAKUTEN_APPLICATION_ID;
const accessKey = process.env.RAKUTEN_ACCESS_KEY;
const affiliateId = process.env.RAKUTEN_AFFILIATE_ID;

if (!applicationId || !accessKey) {
  throw new Error("楽天APIのApplication IDまたはAccess keyが設定されていません。");
}

const searches = [
  { category: "家電", keyword: "家電" },
  { category: "ホビー", keyword: "おもちゃ" },
  { category: "美容", keyword: "コスメ" },
  { category: "食品", keyword: "食品" },
  { category: "ペット", keyword: "ペット用品" },
  { category: "日用品", keyword: "日用品" }
];

const endpoint =
  "https://openapi.rakuten.co.jp/ichibams/api/IchibaItem/Search/20260701";

const products = [];

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function getImage(item) {
  const images =
    item.mediumImageUrls ||
    item.imageUrls ||
    item.smallImageUrls ||
    [];

  const first = Array.isArray(images) ? images[0] : null;

  if (typeof first === "string") return first;
  return first?.imageUrl || "";
}

function calculateScore(reviewAverage, reviewCount) {
  const averageScore = Math.max(0, Math.min(70, (reviewAverage / 5) * 70));
  const countScore = Math.min(30, Math.log10(reviewCount + 1) * 8);
  return Math.round(averageScore + countScore);
}

for (const search of searches) {
  const url = new URL(endpoint);

  url.searchParams.set("applicationId", applicationId);
  url.searchParams.set("keyword", search.keyword);
  url.searchParams.set("hits", "2");
  url.searchParams.set("sort", "-reviewCount");
  url.searchParams.set("format", "json");

  if (affiliateId) {
    url.searchParams.set("affiliateId", affiliateId);
  }

  const response = await fetch(url, {
    headers: {
      accessKey,
      Referer: "https://no1-site.github.io/kyou-no-uriidashi/"
    }
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(
      `${search.category}の取得に失敗しました: ${response.status} ${message}`
    );
  }

  const data = await response.json();
  const results = data.items || data.Items || [];

  for (const result of results.slice(0, 2)) {
    const item = result.item || result.Item || result;
    const reviewAverage = Number(item.reviewAverage || 0);
    const reviewCount = Number(item.reviewCount || 0);

    products.push({
      name: item.itemName,
      category: search.category,
      shop: item.shopName || "楽天市場",
      price: Number(item.itemPrice || 0),
      market_price: null,
      discount_percent: null,
      score: calculateScore(reviewAverage, reviewCount),
      label: `レビュー ${reviewAverage.toFixed(1)}／${reviewCount.toLocaleString()}件`,
      reason: "楽天市場のレビュー評価と件数を基に掲載しています。価格比較機能は今後追加予定です。",
      best_url: item.affiliateUrl || item.itemUrl,
      compare_url: item.itemUrl,
      image_url: getImage(item),
      review_average: reviewAverage,
      review_count: reviewCount,
      checked_at: new Date().toISOString()
    });
  }

  await sleep(1200);
}

if (products.length === 0) {
  throw new Error("楽天の商品を取得できませんでした。");
}

await writeFile(
  "products.json",
  JSON.stringify(products, null, 2) + "\n",
  "utf8"
);

console.log(`${products.length}件の商品をproducts.jsonへ保存しました。`);
