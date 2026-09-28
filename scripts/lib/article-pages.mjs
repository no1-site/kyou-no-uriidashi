import { validJAN, positiveNumber, httpsURL } from "./rakuten-comparison.mjs";

export const articleTopics = [
  {
    slug: "rakuten-yahoo-price-compare",
    category: "",
    title: "楽天市場とYahoo!ショッピング、どっちが安い？価格を比べるときの見方",
    description: "楽天市場とYahoo!ショッピングを同一商品で比較するときに、商品価格・送料表示・ポイントやクーポンをどう見ればよいかを、今日の比較データと一緒に整理します。",
    keywords: ["楽天", "Yahoo"],
    tips: [
      "同じ商品かどうかをJANコードや型番で確認してから比較する。",
      "送料込み表示の店と送料別の店を分け、商品価格だけで結論を出さない。",
      "ポイントやクーポンは条件が変わるため、最後は購入画面の支払額を確認する。"
    ]
  },
  {
    slug: "shipping-included-price-compare",
    category: "",
    title: "送料無料だけで選ばない。ネット通販の価格比較で見るべき3つのポイント",
    description: "ネット通販で安い店を探すときに、送料込み表示・商品価格・購入条件をどう比べるかを解説します。今日の売り出しの比較データも掲載します。",
    keywords: ["送料"],
    tips: [
      "送料込み表示が2店以上ある場合は、その店同士の価格をまず比較する。",
      "送料別や送料要確認の店は、配送先によって総額が変わる前提で参考にする。",
      "まとめ買い条件や会員条件がある送料無料表示は、適用条件まで確認する。"
    ]
  },
  {
    slug: "laundry-detergent-cheap",
    category: "日用品",
    title: "洗濯洗剤を安く買うには？楽天・Yahooなどの価格比較で見るポイント",
    description: "洗濯洗剤をネットで安く買うときの比較ポイントを、容量・詰め替え・送料表示の注意点と今日の価格データから整理します。",
    keywords: ["洗濯", "洗剤"],
    tips: [
      "本体と詰め替え、容量違いを混ぜずに同じ商品で比較する。",
      "大容量は1個あたりではなく、内容量あたりの差も意識する。",
      "日用品は送料条件の影響が大きいので、送料込み表示を優先して比べる。"
    ]
  },
  {
    slug: "toilet-paper-cheap",
    category: "日用品",
    title: "トイレットペーパーを安く買うには？通販の価格と送料を比べる方法",
    description: "トイレットペーパーを通販で買うときに、ロール数・長さ・送料をどう見ればよいかを、今日の比較データと一緒に解説します。",
    keywords: ["トイレットペーパー"],
    tips: [
      "ロール数だけでなく、1ロールの長さやダブル・シングルを揃えて比較する。",
      "かさばる商品なので、商品価格より送料条件で総額が変わりやすい。",
      "ケース販売と単品を同じランキングで比べない。"
    ]
  },
  {
    slug: "shampoo-cheap",
    category: "美容",
    title: "シャンプーを安く買うには？詰め替え・容量違いを避けた価格比較",
    description: "シャンプーをネットで安く買うために、詰め替え・本体・容量違いを区別しながら価格を比較する方法を紹介します。",
    keywords: ["シャンプー"],
    tips: [
      "本体・詰め替え・セット品を分けて、同じJANの商品だけで比べる。",
      "限定パッケージは容量が違うことがあるため、商品名だけで判断しない。",
      "送料込み表示とポイント還元は別に考え、支払額を最後に確認する。"
    ]
  },
  {
    slug: "serum-cheap",
    category: "美容",
    title: "美容液を安く買うには？容量と正規品表示を確認して価格比較",
    description: "美容液を価格だけで選ばず、容量・販売条件・送料表示を揃えて比較するためのポイントを、今日の掲載データと一緒にまとめます。",
    keywords: ["美容液"],
    tips: [
      "同じシリーズでも容量違いが多いため、JANや内容量を揃えて比較する。",
      "極端に価格差がある場合は、セット内容や販売条件の違いを確認する。",
      "ポイント還元より先に、送料を含む購入条件を確認する。"
    ]
  },
  {
    slug: "dog-food-cheap",
    category: "ペット",
    title: "ドッグフードを安く買うには？容量違いを避けて通販価格を比較",
    description: "ドッグフードを通販で比較するときに、容量・個数・送料条件を揃えて安い店を探す方法を、今日の価格データと一緒に紹介します。",
    keywords: ["ドッグフード"],
    tips: [
      "同じブランドでも容量が多いため、JANと内容量を揃えて比較する。",
      "複数袋セットは単品と分け、1袋あたりの条件も確認する。",
      "継続購入する商品ほど、送料込み条件の差を確認する。"
    ]
  },
  {
    slug: "cat-litter-cheap",
    category: "ペット",
    title: "猫砂を安く買うには？通販で送料まで比べるときのポイント",
    description: "猫砂は重さや送料で支払総額が変わりやすい商品です。容量・個数・送料条件を揃えて比較する方法を解説します。",
    keywords: ["猫砂"],
    tips: [
      "重量や袋数が違う商品を同じ価格として比べない。",
      "重量物は送料の影響が大きいため、送料込み表示を優先して確認する。",
      "定期便やまとめ買い価格は、通常購入とは分けて考える。"
    ]
  },
  {
    slug: "instant-coffee-cheap",
    category: "食品",
    title: "インスタントコーヒーを安く買うには？容量を揃えた通販価格比較",
    description: "インスタントコーヒーを安く買うときに、瓶・詰め替え・容量違いを分けて比較する方法を、今日の価格データと一緒にまとめます。",
    keywords: ["インスタントコーヒー", "コーヒー"],
    tips: [
      "瓶と詰め替え、容量違いを分けて比較する。",
      "セット販売は単品と別商品として考える。",
      "食品は賞味期限や配送条件も販売ページで確認する。"
    ]
  },
  {
    slug: "retort-curry-cheap",
    category: "食品",
    title: "レトルトカレーを安く買うには？セット数を揃えて通販価格を比較",
    description: "レトルトカレーはセット数の違いで価格差が大きく見えます。個数・内容量・送料を揃えて比較するコツを解説します。",
    keywords: ["レトルトカレー", "カレー"],
    tips: [
      "1食・複数食セットを混ぜず、個数を揃えて比較する。",
      "同じシリーズでも辛さや味違いを別商品として扱う。",
      "送料無料条件がまとめ買い限定かどうか確認する。"
    ]
  },
  {
    slug: "vacuum-cleaner-cheap",
    category: "家電",
    title: "掃除機を安く買うには？型番を揃えて楽天・Yahooなどを比較",
    description: "掃除機はシリーズ名が同じでも型番や付属品が違うことがあります。同一型番で通販価格を比較するポイントを紹介します。",
    keywords: ["掃除機"],
    tips: [
      "シリーズ名だけでなく型番まで一致している商品を比較する。",
      "付属品や限定セットの違いを確認する。",
      "家電は価格だけでなく、送料・在庫・保証条件も購入前に確認する。"
    ]
  },
  {
    slug: "game-software-cheap",
    category: "ホビー",
    title: "ゲームソフトを安く買うには？新品・機種違いを避けて価格比較",
    description: "ゲームソフトを通販で比較するときに、新品・中古・機種・限定版の違いを避けて価格を見る方法を、今日のデータと一緒に解説します。",
    keywords: ["ゲームソフト", "ゲーム"],
    tips: [
      "新品と中古、通常版と限定版を分けて比較する。",
      "同じタイトルでも対応機種が違うため、商品コードやJANを確認する。",
      "特典付き商品は通常版と価格条件が違うため、別商品として見る。"
    ]
  }
];

function escapeHTML(value) {
  return String(value ?? "").replace(/[&<>"']/g, character => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
  })[character]);
}

function formatPrice(value) {
  const price = positiveNumber(value);
  return price ? `¥${Math.round(price).toLocaleString("ja-JP")}` : "価格未確認";
}

function clean(value) {
  return String(value ?? "").normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();
}

function productOffers(product) {
  const shops = new Map();
  for (const offer of Array.isArray(product?.offers) ? product.offers : []) {
    if (!offer?.shop_code || !positiveNumber(offer?.price) || !httpsURL(offer?.url)) continue;
    const previous = shops.get(offer.shop_code);
    if (!previous || Number(offer.price) < Number(previous.price)) shops.set(offer.shop_code, offer);
  }
  return [...shops.values()].sort((a, b) => Number(a.price) - Number(b.price));
}

function marketplaceNames(offers) {
  const names = [];
  const add = value => { if (value && !names.includes(value)) names.push(value); };
  for (const offer of offers) {
    if (offer.marketplace_code === "rakuten") add("楽天市場");
    else if (offer.marketplace_code === "yahoo") add("Yahoo!ショッピング");
    else if (offer.marketplace_code === "amazon") add("Amazon.co.jp");
    else if (offer.marketplace_code === "valuecommerce") add(String(offer.shop_name || "").includes("ヤマダ") ? "ヤマダモール" : "提携EC");
    else add(String(offer.marketplace || "").trim());
  }
  return names;
}

function topicProducts(topic, products) {
  const source = (Array.isArray(products) ? products : []).filter(product => {
    if (!validJAN(product?.product_code) || !clean(product?.name) || !positiveNumber(product?.price)) return false;
    if (productOffers(product).length < 2) return false;
    if (topic.category && String(product?.category || "") !== topic.category) return false;
    return true;
  });
  const matched = source.filter(product => topic.keywords.some(keyword => clean(product.name).includes(clean(keyword))));
  const list = matched.length ? matched : source;
  return list.sort((a, b) =>
    Number(b?.score || 0) - Number(a?.score || 0) ||
    productOffers(b).length - productOffers(a).length ||
    Number(a?.price || Infinity) - Number(b?.price || Infinity)
  ).slice(0, 5);
}

function articlePath(topic) {
  return `articles/${topic.slug}.html`;
}

export function articlePaths() {
  return ["articles/index.html", ...articleTopics.map(articlePath)];
}

export function articleTopicForDate(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit"
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  const key = Number(`${values.year}${values.month}${values.day}`);
  return articleTopics[key % articleTopics.length];
}

function updatedLabel(products) {
  const dates = (Array.isArray(products) ? products : []).map(product => Date.parse(product?.checked_at)).filter(Number.isFinite);
  return dates.length ? new Date(Math.max(...dates)).toLocaleDateString("ja-JP", { timeZone: "Asia/Tokyo" }) : "";
}

export function renderArticlePage(topic, products, { baseURL = "https://no1-site.github.io/kyou-no-uriidashi/" } = {}) {
  const selected = topicProducts(topic, products);
  const canonical = new URL(articlePath(topic), baseURL).href;
  const checked = updatedLabel(selected.length ? selected : products);
  const rows = selected.length ? selected.map(product => {
    const jan = validJAN(product.product_code);
    const offers = productOffers(product);
    const markets = marketplaceNames(offers).join("・") || "掲載ショップ";
    return `<tr>
      <th scope="row"><a href="../products/${escapeHTML(jan)}.html">${escapeHTML(product.name)}</a></th>
      <td>${escapeHTML(formatPrice(product.price))}</td>
      <td>${offers.length}店</td>
      <td>${escapeHTML(markets)}</td>
    </tr>`;
  }).join("") : `<tr><td colspan="4">現在、このテーマで比較条件を満たす商品を再確認中です。</td></tr>`;

  const faq = [
    {
      q: `${topic.title.replace(/？.*/, "")}で一番大事なことは？`,
      a: "同一商品であることを確認したうえで、商品価格だけでなく送料表示や販売条件まで揃えて比較することです。"
    },
    {
      q: "ポイントやクーポンは比較価格に入っていますか？",
      a: "当サイトの比較価格にはポイントやクーポンを含めていません。適用条件が変わるため、購入前に各ショップで最終金額をご確認ください。"
    },
    {
      q: "掲載されている価格が必ず最安ですか？",
      a: "掲載対象として同一商品を確認できたショップの中で比較しています。モール全体や未掲載ショップを含む最安値を保証するものではありません。"
    }
  ];
  const faqJson = JSON.stringify({
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faq.map(item => ({
      "@type": "Question",
      name: item.q,
      acceptedAnswer: { "@type": "Answer", text: item.a }
    }))
  }).replace(/</g, "\\u003c");
  const articleJson = JSON.stringify({
    "@context": "https://schema.org",
    "@type": "Article",
    headline: topic.title,
    description: topic.description,
    mainEntityOfPage: canonical,
    dateModified: checked || undefined,
    author: { "@type": "Organization", name: "今日の売り出しAI便" }
  }).replace(/</g, "\\u003c");

  return `<!doctype html>
<html lang="ja">
<head>
  <script async src="https://www.googletagmanager.com/gtag/js?id=G-DM19L1646S"></script>
  <script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','G-DM19L1646S');</script>
  <script type="text/javascript" language="javascript">var vc_pid = "892713174";</script>
  <script type="text/javascript" src="//aml.valuecommerce.com/vcdal.js" async></script>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${escapeHTML(topic.title)}｜今日の売り出し</title>
  <meta name="description" content="${escapeHTML(topic.description)}">
  <meta name="robots" content="index,follow,max-image-preview:large">
  <link rel="canonical" href="${escapeHTML(canonical)}">
  <meta property="og:type" content="article">
  <meta property="og:title" content="${escapeHTML(topic.title)}">
  <meta property="og:description" content="${escapeHTML(topic.description)}">
  <meta property="og:url" content="${escapeHTML(canonical)}">
  <link rel="stylesheet" href="../styles.css?v=articles1">
  <script type="application/ld+json">${articleJson}</script>
  <script type="application/ld+json">${faqJson}</script>
</head>
<body>
  <div class="ad-disclosure">当サイトはアフィリエイト広告を利用しています。</div>
  <header class="site-header">
    <a class="brand" href="../"><span class="brand-mark">売</span><span><strong>今日の売り出し</strong><small>物価高の毎日に、賢い買い物を。</small></span></a>
    <nav><a href="../#today">価格比較</a><a href="./index.html">お買い物ガイド</a><a href="../about.html">運営情報</a></nav>
  </header>
  <main class="page article-page">
    <nav class="breadcrumbs" aria-label="パンくず"><a href="../">トップ</a><span>›</span><a href="./index.html">お買い物ガイド</a><span>›</span><span>この記事</span></nav>
    <span class="eyebrow">SHOPPING GUIDE</span>
    <h1>${escapeHTML(topic.title)}</h1>
    <p class="article-lead">${escapeHTML(topic.description)}</p>
    ${checked ? `<p class="article-updated">価格データ更新：${escapeHTML(checked)}</p>` : ""}

    <section>
      <h2>今日の比較データ</h2>
      <p>「今日の売り出し」では、JANコードや型番などから同一商品と確認できたショップを比較しています。下記は現在掲載している商品の一例です。</p>
      <div class="offer-table-wrap article-table-wrap">
        <table class="offer-table article-table">
          <thead><tr><th scope="col">商品</th><th scope="col">掲載価格</th><th scope="col">掲載店</th><th scope="col">掲載モール</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
      <p class="article-note">価格・在庫・送料・ポイント・クーポンは変わる場合があります。購入前にリンク先で最新条件をご確認ください。</p>
    </section>

    <section>
      <h2>安く買うための3つのポイント</h2>
      <ol class="article-tips">
        ${topic.tips.map(tip => `<li>${escapeHTML(tip)}</li>`).join("")}
      </ol>
    </section>

    <section>
      <h2>価格比較で間違えやすいところ</h2>
      <p>ネット通販では、商品名が似ていても容量・個数・型番・限定セットなどが違う場合があります。安く見える商品が別条件だった、ということを避けるため、当サイトでは同一商品として確認できる情報を使って比較しています。</p>
      <p>また、送料込み表示の店が複数ある場合は、その店同士を優先して比較します。送料別・送料要確認の店も参考として掲載しますが、配送先などによって支払総額が変わるため、最終判断は販売ページで行ってください。</p>
    </section>

    <section>
      <h2>よくある質問</h2>
      ${faq.map(item => `<details class="article-faq"><summary>${escapeHTML(item.q)}</summary><p>${escapeHTML(item.a)}</p></details>`).join("")}
    </section>

    <p class="article-cta"><a class="primary" href="../#today">今日の価格比較を見る</a></p>
  </main>
  <footer>
    <div class="footer-brand">今日の売り出し</div>
    <div class="footer-links"><a href="./index.html">お買い物ガイド</a><a href="../about.html">運営者情報</a><a href="../privacy.html">プライバシーポリシー</a></div>
    <p>当サイトはアフィリエイト広告を利用しています。掲載価格・在庫・ポイント等は変更される場合があります。</p>
    <small>© 2026 今日の売り出し</small>
  </footer>
</body>
</html>`;
}

export function renderArticleIndex(products, { baseURL = "https://no1-site.github.io/kyou-no-uriidashi/" } = {}) {
  const canonical = new URL("articles/index.html", baseURL).href;
  const cards = articleTopics.map(topic => `<article class="article-card">
    <span class="eyebrow">${escapeHTML(topic.category || "価格比較")}</span>
    <h2><a href="./${escapeHTML(topic.slug)}.html">${escapeHTML(topic.title)}</a></h2>
    <p>${escapeHTML(topic.description)}</p>
  </article>`).join("");
  return `<!doctype html>
<html lang="ja">
<head>
  <script async src="https://www.googletagmanager.com/gtag/js?id=G-DM19L1646S"></script>
  <script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','G-DM19L1646S');</script>
  <script type="text/javascript" language="javascript">var vc_pid = "892713174";</script>
  <script type="text/javascript" src="//aml.valuecommerce.com/vcdal.js" async></script>
  <meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
  <title>安く買うためのお買い物ガイド｜今日の売り出し</title>
  <meta name="description" content="楽天市場・Yahoo!ショッピングなどを比べながら、日用品・食品・美容・家電・ペット用品を安く買うための価格比較ガイドをまとめています。">
  <link rel="canonical" href="${escapeHTML(canonical)}">
  <link rel="stylesheet" href="../styles.css?v=articles1">
</head>
<body>
  <div class="ad-disclosure">当サイトはアフィリエイト広告を利用しています。</div>
  <header class="site-header"><a class="brand" href="../"><span class="brand-mark">売</span><span><strong>今日の売り出し</strong><small>物価高の毎日に、賢い買い物を。</small></span></a><nav><a href="../#today">価格比較</a><a href="./index.html">お買い物ガイド</a><a href="../about.html">運営情報</a></nav></header>
  <main class="page article-index">
    <span class="eyebrow">SHOPPING GUIDE</span>
    <h1>安く買うためのお買い物ガイド</h1>
    <p>商品価格だけでなく、送料・容量・型番・セット数まで揃えて比較するための実用ガイドです。記事内の価格例は、毎日の商品更新に合わせて更新されます。</p>
    <div class="article-grid">${cards}</div>
  </main>
  <footer><div class="footer-brand">今日の売り出し</div><div class="footer-links"><a href="../about.html">運営者情報</a><a href="../privacy.html">プライバシーポリシー</a></div><small>© 2026 今日の売り出し</small></footer>
</body>
</html>`;
}

export function buildArticleSiteAssets(products, options = {}) {
  return [
    { path: "articles/index.html", content: renderArticleIndex(products, options) },
    ...articleTopics.map(topic => ({ path: articlePath(topic), content: renderArticlePage(topic, products, options) }))
  ];
}
