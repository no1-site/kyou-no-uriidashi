import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { validJAN, httpsURL, positiveNumber } from "./rakuten-comparison.mjs";

export const siteBaseURL = "https://no1-site.github.io/kyou-no-uriidashi/";

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

export function renderProductPage(product, { baseURL = siteBaseURL } = {}) {
  const jan = validJAN(product?.product_code);
  if (!jan) throw new Error("Product page requires a valid JAN.");
  const name = String(product?.name || "").trim();
  if (!name) throw new Error("Product page requires a name.");
  const category = String(product?.category || "商品").trim();
  const brand = String(product?.brand || "").trim();
  const offers = validOffers(product);
  const canonical = new URL(productPagePath(product), baseURL).href;
  const image = httpsURL(product?.image_url);
  const checked = dateOnly(product?.checked_at);
  const currentPrice = positiveNumber(product?.price);
  const marketplaceNames = [...new Set(offers.map(offer => String(offer.marketplace || "").trim()).filter(Boolean))];
  const scope = marketplaceNames.length ? marketplaceNames.join("・") : "掲載ショップ";
  const description = `${name}の価格比較ページ。掲載ショップの税込価格と送料表示を比較し、${currentPrice ? `掲載価格は${formatPrice(currentPrice)}から。` : ""}購入前に各販売ページで最新条件をご確認ください。`.slice(0, 155);
  const rows = offers.length ? offers.map(offer => `
          <tr>
            <th scope="row"><a href="${escapeHTML(offer.url)}" target="_blank" rel="sponsored nofollow noopener noreferrer">${escapeHTML(offer.shopName)}</a></th>
            <td>${escapeHTML(formatPrice(offer.price))}</td>
            <td>${offer.postage === "included" ? "送料込み表示" : offer.postage === "extra" ? "送料別" : "送料要確認"}</td>
          </tr>`).join("") : `
          <tr><td colspan="3">現在、比較できるショップ情報がありません。</td></tr>`;

  const structured = {
    "@context": "https://schema.org",
    "@type": "Product",
    name,
    sku: jan,
    ...(brand ? { brand: { "@type": "Brand", name: brand } } : {}),
    ...(image ? { image: [image] } : {}),
    category,
    url: canonical,
    ...(offers.length ? {
      offers: offers.map(offer => ({
        "@type": "Offer",
        url: offer.url,
        priceCurrency: "JPY",
        price: Math.round(offer.price),
        seller: { "@type": "Organization", name: offer.shopName }
      }))
    } : {})
  };
  const structuredJSON = JSON.stringify(structured).replace(/</g, "\\u003c");

  return `<!doctype html>
<html lang="ja">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHTML(name)}の価格比較｜今日の売り出し</title>
  <meta name="description" content="${escapeHTML(description)}">
  <meta name="robots" content="index,follow">
  <link rel="canonical" href="${escapeHTML(canonical)}">
  <meta property="og:type" content="product">
  <meta property="og:title" content="${escapeHTML(name)}の価格比較｜今日の売り出し">
  <meta property="og:description" content="${escapeHTML(description)}">
  <meta property="og:url" content="${escapeHTML(canonical)}">
  ${image ? `<meta property="og:image" content="${escapeHTML(image)}">` : ""}
  <link rel="stylesheet" href="../styles.css?v=product1">
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
      <a href="../">トップ</a><span>›</span><span>${escapeHTML(category)}</span>
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

export function renderSitemap(products, { baseURL = siteBaseURL } = {}) {
  const staticURLs = ["", "about.html", "privacy.html"];
  const entries = staticURLs.map(path => ({ loc: new URL(path, baseURL).href, lastmod: "" }));
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
  const assets = [];
  for (const product of Array.isArray(products) ? products : []) {
    const path = productPagePath(product);
    if (!path) continue;
    assets.push({ path, content: renderProductPage(product, options) });
  }
  assets.push({ path: "sitemap.xml", content: renderSitemap(products, options) });
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
