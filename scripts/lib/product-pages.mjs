import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { validJAN, httpsURL, positiveNumber } from "./rakuten-comparison.mjs";

export const siteBaseURL = "https://no1-site.github.io/kyou-no-uriidashi/";
const googleAnalyticsMeasurementID = "G-DM19L1646S";
const valueCommercePid = "892713174";

function valueCommerceLinkSwitchTag() {
  return `  <!-- ValueCommerce LinkSwitch -->
  <script type="text/javascript" language="javascript">
    var vc_pid = "${valueCommercePid}";
  </script>
  <script type="text/javascript" src="//aml.valuecommerce.com/vcdal.js" async></script>`;
}

function googleAnalyticsTag() {
  return `  <!-- Google tag (gtag.js) -->
  <script async src="https://www.googletagmanager.com/gtag/js?id=${googleAnalyticsMeasurementID}"></script>
  <script>
    window.dataLayer = window.dataLayer || [];
    function gtag(){dataLayer.push(arguments);}
    gtag('js', new Date());
    gtag('config', '${googleAnalyticsMeasurementID}');
  </script>`;
}

const categorySlugs = new Map([
  ["家電", "kaden"],
  ["ホビー", "hobby"],
  ["美容", "beauty"],
  ["食品", "food"],
  ["ペット", "pet"],
  ["日用品", "daily"]
]);

function escapeHTML(value) {
  return String(value ?? "").replace(/[&<>"']/g, character => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
  })[character]);
}

function xmlEscape(value) {
  return String(value ?? "").replace(/[&<>"']/g, character => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;"
  })[character]);
}

function formatPrice(value) {
  const price = positiveNumber(value);
  return price ? `¥${Math.round(price).toLocaleString("ja-JP")}` : "価格未確認";
}

function dateOnly(value) {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return "";
  return new Date(timestamp).toISOString().slice(0, 10);
}

function marketplaceNamesForOffers(offers) {
  const names = [];
  const add = name => {
    if (name && !names.includes(name)) names.push(name);
  };
  for (const offer of Array.isArray(offers) ? offers : []) {
    if (offer.marketplace_code === "rakuten") add("楽天市場");
    else if (offer.marketplace_code === "yahoo") add("Yahoo!ショッピング");
    else if (offer.marketplace_code === "amazon") add("Amazon.co.jp");
    else if (offer.marketplace_code === "valuecommerce") {
      add(String(offer.shop_name || offer.shopName || "").includes("ヤマダ") ? "ヤマダモール" : "提携EC");
    }
    else add(String(offer.marketplace || "").trim());
  }
  return names;
}

function validOffers(product) {
  const shops = new Map();
  for (const offer of Array.isArray(product?.offers) ? product.offers : []) {
    const url = httpsURL(offer?.url);
    const price = positiveNumber(offer?.price);
    const shopCode = String(offer?.shop_code || "").trim();
    const shopName = String(offer?.shop_name || "").trim();
    if (!url || !price || !shopCode || !shopName) continue;
    const current = shops.get(shopCode);
    if (!current || price < current.price) shops.set(shopCode, { ...offer, url, price, shopName });
  }
  return [...shops.values()].sort((a, b) => a.price - b.price);
}

export function productPagePath(product) {
  const jan = validJAN(product?.product_code);
  return jan ? `products/${jan}.html` : "";
}

export function categoryPagePath(category) {
  const slug = categorySlugs.get(String(category || "").trim());
  return slug ? `categories/${slug}.html` : "";
}

function relatedLinks(products, current, limit = 6) {
  const currentJan = validJAN(current?.product_code);
  return (Array.isArray(products) ? products : [])
    .filter(product => product !== current && String(product?.category || "") === String(current?.category || ""))
    .filter(product => productPagePath(product) && validJAN(product?.product_code) !== currentJan)
    .sort((a, b) => Number(Boolean(b?.historical_discount_percent)) - Number(Boolean(a?.historical_discount_percent)) ||
      Number(a?.price || Infinity) - Number(b?.price || Infinity))
    .slice(0, limit);
}

export function renderProductPage(product, { baseURL = siteBaseURL, relatedProducts = [] } = {}) {
  const jan = validJAN(product?.product_code);
  if (!jan) throw new Error("Product page requires a valid JAN.");
  const name = String(product?.name || "").trim();
  if (!name) throw new Error("Product page requires a name.");
  const category = String(product?.category || "商品").trim();
  const brand = String(product?.brand || "").trim();
  const offers = validOffers(product);
  const canonical = new URL(productPagePath(product), baseURL).href;
  const categoryPath = categoryPagePath(category);
  const categoryURL = categoryPath ? new URL(categoryPath, baseURL).href : "";
  const image = httpsURL(product?.image_url);
  const checked = dateOnly(product?.checked_at);
  const currentPrice = positiveNumber(product?.price) || offers[0]?.price || null;
  const highestPrice = offers.at(-1)?.price || currentPrice;
  const includedCount = offers.filter(offer => offer.postage === "included").length;
  const historicalPrice = positiveNumber(product?.historical_price);
  const historicalDifference = historicalPrice && currentPrice && historicalPrice > currentPrice
    ? Math.round(historicalPrice - currentPrice) : null;
  const marketplaceNames = marketplaceNamesForOffers(offers);
  const scope = marketplaceNames.length ? marketplaceNames.join("・") : "掲載ショップ";
  const comparisonSummary = offers.length
    ? `${offers.length}ショップを掲載し、掲載価格は${formatPrice(currentPrice)}から${formatPrice(highestPrice)}です。${includedCount ? `送料込み表示は${includedCount}ショップです。` : ""}`
    : "現在、比較できるショップ情報はありません。";
  const description = `${name}の価格比較。${offers.length ? `${offers.length}ショップを掲載し、${formatPrice(currentPrice)}から比較できます。` : ""}送料表示も確認できます。購入前に各販売ページで最新条件をご確認ください。`.slice(0, 155);

  const rows = offers.length ? offers.map(offer => `
          <tr>
            <th scope="row"><a href="${escapeHTML(offer.url)}" target="_blank" rel="sponsored nofollow noopener noreferrer">${escapeHTML(offer.shopName)}</a></th>
            <td>${escapeHTML(formatPrice(offer.price))}</td>
            <td>${offer.postage === "included" ? "送料込み表示" : offer.postage === "extra" ? "送料別" : "送料要確認"}</td>
          </tr>`).join("") : `
          <tr><td colspan="3">現在、比較できるショップ情報がありません。</td></tr>`;

  const related = relatedLinks(relatedProducts, product);
  const relatedHTML = related.length ? `
    <section class="related-products">
      <div class="section-head"><div><span class="eyebrow">RELATED</span><h2>同じカテゴリの商品</h2></div></div>
      <div class="related-product-grid">
        ${related.map(item => `<a class="related-product-card" href="../${escapeHTML(productPagePath(item))}">
          <span>${escapeHTML(item.name)}</span>
          <strong>${escapeHTML(formatPrice(item.price))}</strong>
        </a>`).join("")}
      </div>
    </section>` : "";

  const structured = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Product",
        "@id": `${canonical}#product`,
        name,
        description,
        sku: jan,
        ...(brand ? { brand: { "@type": "Brand", name: brand } } : {}),
        ...(image ? { image: [image] } : {}),
        category,
        url: canonical,
        ...(offers.length ? {
          offers: {
            "@type": "AggregateOffer",
            priceCurrency: "JPY",
            lowPrice: Math.round(offers[0].price),
            highPrice: Math.round(offers.at(-1).price),
            offerCount: offers.length
          }
        } : {})
      },
      {
        "@type": "BreadcrumbList",
        "itemListElement": [
          { "@type": "ListItem", position: 1, name: "今日の売り出し", item: baseURL },
          ...(categoryURL ? [{ "@type": "ListItem", position: 2, name: category, item: categoryURL }] : []),
          { "@type": "ListItem", position: categoryURL ? 3 : 2, name }
        ]
      }
    ]
  };
  const structuredJSON = JSON.stringify(structured).replace(/</g, "\\u003c");

  return `<!doctype html>
<html lang="ja">
<head>
${googleAnalyticsTag()}
${valueCommerceLinkSwitchTag()}
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHTML(name)}の価格比較｜今日の売り出し</title>
  <meta name="description" content="${escapeHTML(description)}">
  <meta name="robots" content="index,follow,max-image-preview:large">
  <link rel="canonical" href="${escapeHTML(canonical)}">
  <meta property="og:type" content="product">
  <meta property="og:title" content="${escapeHTML(name)}の価格比較｜今日の売り出し">
  <meta property="og:description" content="${escapeHTML(description)}">
  <meta property="og:url" content="${escapeHTML(canonical)}">
  ${image ? `<meta property="og:image" content="${escapeHTML(image)}">` : ""}
  <link rel="stylesheet" href="../styles.css?v=product2">
  <script type="application/ld+json">${structuredJSON}</script>
</head>
<body>
  <div class="ad-disclosure">当サイトはアフィリエイト広告を利用しています。</div>
  <header class="site-header">
    <a class="brand" href="../">
      <span class="brand-mark">売</span>
      <span><strong>今日の売り出し</strong><small>物価高の毎日に、賢い買い物を。</small></span>
    </a>
    <nav>
      <a href="../#priceDrops">今日の値下がり</a>
      <a href="../#today">価格比較</a>
      <a href="../about.html">運営情報</a>
    </nav>
  </header>
  <main class="product-page">
    <nav class="breadcrumbs" aria-label="パンくず">
      <a href="../">トップ</a><span>›</span>
      ${categoryPath ? `<a href="../${escapeHTML(categoryPath)}">${escapeHTML(category)}</a><span>›</span>` : ""}
      <span>${escapeHTML(name)}</span>
    </nav>
    <article class="product-detail">
      <div class="product-detail-visual">
        ${image ? `<img src="${escapeHTML(image)}" alt="${escapeHTML(name)}" referrerpolicy="no-referrer">` : `<span>🛍️</span>`}
      </div>
      <div class="product-detail-main">
        <span class="eyebrow">${escapeHTML(category)}</span>
        <h1>${escapeHTML(name)}</h1>
        <p class="product-code">JAN：${escapeHTML(jan)}${brand ? ` ／ ブランド：${escapeHTML(brand)}` : ""}</p>
        <div class="product-current-price">
          <span>掲載ショップ内の現在価格</span>
          <strong>${escapeHTML(formatPrice(currentPrice))}</strong>
        </div>
        <p class="product-detail-note">${escapeHTML(scope)}の掲載情報を比較しています。送料・ポイント・クーポン・在庫等により実際の支払条件は変わる場合があります。</p>
        ${checked ? `<p class="product-checked">価格確認日：${escapeHTML(checked)}</p>` : ""}
      </div>
    </article>

    <section class="product-facts" aria-label="価格比較状況">
      <div><span>掲載ショップ</span><strong>${offers.length}店</strong></div>
      <div><span>掲載モール</span><strong>${escapeHTML(scope)}</strong></div>
      <div><span>掲載価格帯</span><strong>${escapeHTML(formatPrice(currentPrice))}〜${escapeHTML(formatPrice(highestPrice))}</strong></div>
      <div><span>送料込み表示</span><strong>${includedCount}店</strong></div>
      ${historicalDifference ? `<div><span>過去の記録価格との差</span><strong>${escapeHTML(formatPrice(historicalDifference))}低い</strong></div>` : ""}
    </section>
    <p class="product-comparison-summary">${escapeHTML(comparisonSummary)}${historicalDifference ? ` 過去の記録価格${formatPrice(historicalPrice)}より${formatPrice(historicalDifference)}低い状態です。` : ""}</p>

    <section class="product-offers">
      <div class="section-head"><div><span class="eyebrow">PRICE COMPARISON</span><h2>ショップ別価格</h2></div></div>
      <div class="offer-table-wrap product-offer-table-wrap">
        <table class="offer-table product-offer-table">
          <thead><tr><th scope="col">ショップ</th><th scope="col">税込価格</th><th scope="col">送料表示</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
      <p class="method-note product-method-note">掲載対象として同一商品と確認できたショップのみ表示しています。掲載価格は取得時点の情報です。購入前にリンク先で商品内容・価格・送料・在庫をご確認ください。</p>
    </section>

    ${relatedHTML}
    <p class="product-back"><a class="primary" href="../#today">ほかの商品を見る</a></p>
  </main>
  <footer>
    <div class="footer-brand">今日の売り出し</div>
    <div class="footer-links"><a href="../about.html">運営者情報</a><a href="../privacy.html">プライバシーポリシー</a></div>
    <p>当サイトはアフィリエイト広告を利用しています。掲載価格・在庫・ポイント等は変更される場合があります。</p>
    <small>© 2026 今日の売り出し</small>
  </footer>
</body>
</html>
`;
}

export function renderCategoryPage(category, products, { baseURL = siteBaseURL } = {}) {
  const path = categoryPagePath(category);
  if (!path) throw new Error("Unsupported category.");
  const list = (Array.isArray(products) ? products : [])
    .filter(product => String(product?.category || "") === category && productPagePath(product))
    .sort((a, b) => Number(Boolean(b?.historical_discount_percent)) - Number(Boolean(a?.historical_discount_percent)) ||
      Number(a?.price || Infinity) - Number(b?.price || Infinity));
  const canonical = new URL(path, baseURL).href;
  const description = `${category}の商品をショップ別に価格比較。現在${list.length}商品を掲載し、税込価格と送料表示を確認できます。毎日の価格確認で「安い」を探す時間を減らします。`;
  const checkedDates = list.map(item => dateOnly(item.checked_at)).filter(Boolean).sort();
  const latest = checkedDates.at(-1) || "";
  const cards = list.map(item => {
    const image = httpsURL(item.image_url);
    const itemOffers = validOffers(item);
    const offerCount = itemOffers.length;
    const itemMarketplaces = marketplaceNamesForOffers(itemOffers);
    const marketplaceText = itemMarketplaces.length ? itemMarketplaces.join("・") : "掲載ショップ";
    return `<article class="category-product-card">
      <a class="category-product-visual" href="../${escapeHTML(productPagePath(item))}">
        ${image ? `<img src="${escapeHTML(image)}" alt="${escapeHTML(item.name)}" loading="lazy" referrerpolicy="no-referrer">` : "<span>🛍️</span>"}
      </a>
      <div>
        <h2><a href="../${escapeHTML(productPagePath(item))}">${escapeHTML(item.name)}</a></h2>
        <strong>${escapeHTML(formatPrice(item.price))}</strong>
        <p>${offerCount ? `${offerCount}ショップの価格を掲載 ／ 掲載モール：${escapeHTML(marketplaceText)}` : "参考価格を掲載"}${item.historical_discount_percent ? ` ／ 過去の記録価格より${Math.round(Number(item.historical_discount_percent))}%低い` : ""}</p>
      </div>
    </article>`;
  }).join("");

  const breadcrumbJSON = JSON.stringify({
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "今日の売り出し", item: baseURL },
      { "@type": "ListItem", position: 2, name: category }
    ]
  }).replace(/</g, "\\u003c");

  return `<!doctype html>
<html lang="ja">
<head>
${googleAnalyticsTag()}
${valueCommerceLinkSwitchTag()}
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHTML(category)}の価格比較・値下がり商品｜今日の売り出し</title>
  <meta name="description" content="${escapeHTML(description)}">
  <meta name="robots" content="index,follow,max-image-preview:large">
  <link rel="canonical" href="${escapeHTML(canonical)}">
  <meta property="og:type" content="website">
  <meta property="og:title" content="${escapeHTML(category)}の価格比較・値下がり商品｜今日の売り出し">
  <meta property="og:description" content="${escapeHTML(description)}">
  <meta property="og:url" content="${escapeHTML(canonical)}">
  <link rel="stylesheet" href="../styles.css?v=category1">
  <script type="application/ld+json">${breadcrumbJSON}</script>
</head>
<body>
  <div class="ad-disclosure">当サイトはアフィリエイト広告を利用しています。</div>
  <header class="site-header">
    <a class="brand" href="../"><span class="brand-mark">売</span><span><strong>今日の売り出し</strong><small>物価高の毎日に、賢い買い物を。</small></span></a>
    <nav><a href="../#priceDrops">今日の値下がり</a><a href="../#today">価格比較</a><a href="../about.html">運営情報</a></nav>
  </header>
  <main class="category-page">
    <nav class="breadcrumbs" aria-label="パンくず"><a href="../">トップ</a><span>›</span><span>${escapeHTML(category)}</span></nav>
    <section class="category-hero">
      <span class="eyebrow">CATEGORY</span>
      <h1>${escapeHTML(category)}の価格比較</h1>
      <p>${escapeHTML(description)}</p>
      ${latest ? `<small>最終価格確認：${escapeHTML(latest)}</small>` : ""}
    </section>
    <div class="category-product-grid">${cards || "<p>現在、掲載商品はありません。</p>"}</div>
  </main>
  <footer>
    <div class="footer-brand">今日の売り出し</div>
    <div class="footer-links"><a href="../about.html">運営者情報</a><a href="../privacy.html">プライバシーポリシー</a></div>
    <small>© 2026 今日の売り出し</small>
  </footer>
</body>
</html>
`;
}

export function renderRobots({ baseURL = siteBaseURL } = {}) {
  return `User-agent: *
Allow: /

Sitemap: ${new URL("sitemap.xml", baseURL).href}
`;
}

export function renderSitemap(products, { baseURL = siteBaseURL } = {}) {
  const staticURLs = ["", "about.html", "privacy.html"];
  const entries = staticURLs.map(path => ({ loc: new URL(path, baseURL).href, lastmod: "" }));
  for (const category of categorySlugs.keys()) {
    entries.push({ loc: new URL(categoryPagePath(category), baseURL).href, lastmod: "" });
  }
  for (const product of Array.isArray(products) ? products : []) {
    const path = productPagePath(product);
    if (!path) continue;
    entries.push({ loc: new URL(path, baseURL).href, lastmod: dateOnly(product.checked_at) });
  }
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${entries.map(entry => `  <url>
    <loc>${xmlEscape(entry.loc)}</loc>${entry.lastmod ? `
    <lastmod>${entry.lastmod}</lastmod>` : ""}
  </url>`).join("\n")}
</urlset>
`;
}

export function buildProductSiteAssets(products, options = {}) {
  const source = Array.isArray(products) ? products : [];
  const assets = [];
  for (const product of source) {
    const path = productPagePath(product);
    if (!path) continue;
    assets.push({ path, content: renderProductPage(product, { ...options, relatedProducts: source }) });
  }
  for (const category of categorySlugs.keys()) {
    assets.push({ path: categoryPagePath(category), content: renderCategoryPage(category, source, options) });
  }
  assets.push({ path: "sitemap.xml", content: renderSitemap(source, options) });
  assets.push({ path: "robots.txt", content: renderRobots(options) });
  return assets;
}

export async function writeProductSiteAssets(products, staging, options = {}) {
  const assets = buildProductSiteAssets(products, options);
  const output = [];
  for (const asset of assets) {
    const stagedPath = join(staging, "site-assets", ...asset.path.split("/"));
    await mkdir(dirname(stagedPath), { recursive: true });
    await writeFile(stagedPath, asset.content, "utf8");
    output.push({ path: asset.path, stagedPath });
  }
  return output;
}
