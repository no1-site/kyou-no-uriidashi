import { canRankPriceOffers, includedOffers, postageLabel, shippingPolicyVersion } from "./shipping-policy.mjs?v=shipping2";

const emoji = {
  "家電": "⚡",
  "ホビー": "🎮",
  "美容": "💄",
  "食品": "🍫",
  "ペット": "🐶",
  "日用品": "🧻"
};

let deals = [];

function escapeHTML(value) {
  return String(value ?? "").replace(
    /[&<>"']/g,
    character => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;"
    })[character]
  );
}

function safeURL(value) {
  if (typeof value !== "string" || !value.trim()) return "";
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.href : "";
  }
  catch {
    return "";
  }
}

function productDetailURL(item) {
  const jan = String(item?.product_code || "").trim();
  return /^(?:\d{8}|\d{13})$/.test(jan) ? `products/${encodeURIComponent(jan)}.html` : "";
}

function amazonSearchURL(item) {
  const query = String(item?.product_code || item?.model || item?.name || "").trim();
  if (!query) return "";
  const url = new URL("https://www.amazon.co.jp/s");
  url.searchParams.set("k", query);
  return url.href;
}

function formatPrice(value) {
  if (value === null || value === undefined || value === "") {
    return "価格未確認";
  }
  const price = Number(value);
  return Number.isFinite(price) && price > 0
    ? `¥${price.toLocaleString("ja-JP")}`
    : "価格未確認";
}

function validPositiveNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function hasPriceComparison(item) {
  const price = validPositiveNumber(item.price);
  const marketPrice = validPositiveNumber(item.market_price);
  return item.comparison_type === "rakuten_shops" &&
    !comparisonHoldReason(item) &&
    price !== null &&
    marketPrice !== null &&
    marketPrice >= price &&
    comparisonOffers(item).length >= 2;
}

function comparisonHoldReason(item) {
  if (item.comparison_type !== "rakuten_shops") return "";
  if (item.validation_version !== "quantity-v2") {
    return "販売数量を新しい条件で再確認するまで、価格差の判定を保留しています。";
  }
  const offers = comparisonOffers(item);
  const included = includedOffers(offers);
  const priceGroup = included.length >= 2 ? included : offers;
  if (priceGroup.length >= 2 && Number(priceGroup.at(-1).price) > Number(priceGroup[0].price) * 3) {
    return "ショップ間の価格差が大きいため、販売数量や条件を確認するまで価格差の判定を保留しています。";
  }
  return "";
}

function canScore(item) {
  return hasPriceComparison(item) && item.shipping_policy_version === shippingPolicyVersion &&
    canRankPriceOffers(comparisonOffers(item));
}

function scoreValue(item) {
  return canScore(item) && item.score !== null && item.score !== undefined && Number.isFinite(Number(item.score)) ? Number(item.score) : NaN;
}

function shippingMessage(item) {
  return canScore(item)
    ? "送料込み表示の店同士で比較しています。送料別・要確認の店は参考欄に掲載し、平均やスコアには含めません。配送先などの条件は各店で確認してください。"
    : "送料込み表示の店が2店に満たないため、安さの判定は保留しています。支払総額の順位ではありません。";
}

function comparisonOffers(item) {
  if (!Array.isArray(item.offers)) return [];
  const shops = new Map();
  for (const offer of item.offers) {
    if (!offer || !offer.shop_code || !offer.shop_name ||
        !validPositiveNumber(offer.price) || !safeURL(offer.url)) continue;
    const current = shops.get(offer.shop_code);
    if (!current || offer.price < current.price) shops.set(offer.shop_code, offer);
  }
  return [...shops.values()].sort((a, b) => Number(a.price) - Number(b.price));
}

function renderShopTable(item) {
  const offers = comparisonOffers(item);
  const included = includedOffers(offers);
  const keys = new Set(included.map(o => o.shop_code));
  const reference = offers.filter(o => !keys.has(o.shop_code));
  const groups = [
    { title: `送料込み表示の店（${included.length}店${included.length >= 2 ? "・比較対象" : ""}）`, offers: included },
    { title: `送料別・要確認の店（${reference.length}店・参考）`, offers: reference }
  ].filter(g => g.offers.length);
  return `<div class="shop-comparison">
    ${groups.map(group => `<p>${group.title}</p>
    <div class="offer-table-wrap"><table class="offer-table">
      <caption class="sr-only">${escapeHTML(item.name)}：${group.title}</caption>
      <thead><tr><th scope="col">ショップ</th><th scope="col">税込価格</th><th scope="col">送料表示</th></tr></thead>
      <tbody>${group.offers.map(offer => `<tr>
        <th scope="row"><a class="offer-link" href="${escapeHTML(safeURL(offer.url))}" target="_blank"
          rel="sponsored nofollow noopener noreferrer" data-product-name="${escapeHTML(item.name)}"
          data-product-category="${escapeHTML(item.category)}">${escapeHTML(offer.shop_name)}</a></th>
        <td>${formatPrice(offer.price)}</td>
        <td>${postageLabel(offer)}</td>
      </tr>`).join("")}</tbody>
    </table></div>`).join("")}
    <p class="offer-note">各欄は商品価格の低い順です。支払総額では参考欄の店の方が安い場合もあります。配送先などの条件は各店で確認してください。</p>
  </div>`;
}

function priceDropDeals() {
  return deals
    .filter(item => canScore(item) && Number(item.historical_discount_percent) > 0 && validPositiveNumber(item.historical_price))
    .sort((a, b) =>
      Number(b.historical_discount_percent || 0) - Number(a.historical_discount_percent || 0) ||
      Number(a.price || Infinity) - Number(b.price || Infinity)
    )
    .slice(0, 10);
}

function renderPriceDrops() {
  const target = document.querySelector("#priceDropGrid");
  if (!target) return;
  const list = priceDropDeals();
  if (!list.length) {
    target.innerHTML = '<p class="price-drop-empty">まだ十分な価格履歴がありません。毎日の更新で比較できる商品が増えていきます。</p>';
    return;
  }
  target.innerHTML = list.map((item, index) => {
    const imageURL = safeURL(item.image_url);
    const productURL = safeURL(item.best_url);
    const previous = validPositiveNumber(item.historical_price);
    const current = validPositiveNumber(item.price);
    const discount = Math.max(0, Math.round(Number(item.historical_discount_percent) || 0));
    const difference = previous && current ? Math.max(0, Math.round(previous - current)) : null;
    const visual = imageURL
      ? `<img src="${escapeHTML(imageURL)}" alt="${escapeHTML(item.name)}" loading="lazy" referrerpolicy="no-referrer">`
      : `<span class="price-drop-emoji">${emoji[item.category] || "🛍️"}</span>`;
    const link = productURL
      ? `<a class="price-drop-link shop-link best" href="${escapeHTML(productURL)}" target="_blank"
          rel="sponsored nofollow noopener noreferrer" data-product-name="${escapeHTML(item.name)}"
          data-product-category="${escapeHTML(item.category)}">価格を確認</a>`
      : "";
    return `
      <article class="price-drop-card">
        <div class="price-drop-rank">#${index + 1}</div>
        <div class="price-drop-visual">${visual}</div>
        <div class="price-drop-body">
          <span class="price-drop-category">${escapeHTML(item.category)}</span>
          <h3>${escapeHTML(item.name)}</h3>
          <div class="price-drop-percent">-${discount}%</div>
          <div class="price-drop-prices">
            <span>現在 ${formatPrice(current)}</span>
            <span>過去の記録価格 ${formatPrice(previous)}</span>
          </div>
          ${difference ? `<p class="price-drop-difference">記録価格より ${formatPrice(difference)} 低い</p>` : ""}
          ${link}
        </div>
      </article>`;
  }).join("");
}

function updateSignal() {
  const scoreElement = document.querySelector("#signalScore");
  const labelElement = document.querySelector("#signalLabel");
  const textElement = document.querySelector("#signalText");
  const headingElement = document.querySelector("#dealHeading");
  if (!scoreElement || !labelElement || !textElement) return;

  const comparedDeals = deals.filter(hasPriceComparison);
  const top = comparedDeals.find(canScore) || comparedDeals[0] || deals[0];

  if (headingElement) {
    const yahooActive = deals.some(item =>
      Number(item?.collection_summary?.yahoo?.added_offers || 0) > 0 ||
      item?.offers?.some?.(offer => offer?.marketplace_code === "yahoo")
    );
    const amazonActive = deals.some(item =>
      Number(item?.collection_summary?.keepa?.added_offers || 0) > 0 ||
      item?.offers?.some?.(offer => offer?.marketplace_code === "amazon")
    );
    const valueCommerceActive = deals.some(item =>
      Number(item?.collection_summary?.valuecommerce?.added_offers || 0) > 0 ||
      item?.offers?.some?.(offer => offer?.marketplace_code === "valuecommerce")
    );
    const marketplaces = [
      "楽天市場",
      ...(yahooActive ? ["Yahoo!ショッピング"] : []),
      ...(amazonActive ? ["Amazon.co.jp"] : []),
      ...(valueCommerceActive ? ["提携EC"] : [])
    ];
    headingElement.textContent = comparedDeals.length
      ? marketplaces.length === 1
        ? `${marketplaces[0]}のショップ別価格比較`
        : `${marketplaces.join("・")}の価格比較`
      : "参考商品（比較条件未確認）";
  }

  if (!top) {
    scoreElement.textContent = "--";
    labelElement.textContent = "商品なし";
    textElement.textContent = "次回の価格確認をお待ちください。";
    return;
  }

  const score = scoreValue(top);
  scoreElement.textContent = Number.isFinite(score)
    ? String(Math.round(score))
    : "--";
  labelElement.textContent = hasPriceComparison(top) ? canScore(top) ? "送料込み表示の店を比較" : "送料確認が必要" : "比較条件未確認";

  if (hasPriceComparison(top)) {
    const offerCount = includedOffers(comparisonOffers(top)).length;
    const discount = Math.max(0, Math.floor(Number(top.discount_percent) || 0));
    textElement.textContent =
      canScore(top) && discount > 0
        ? `送料込み表示の${offerCount}ショップの平均より${discount}%低い商品価格です。配送先などの条件は各店で確認してください。`
        : shippingMessage(top);
  }
  else {
    textElement.textContent =
      comparisonHoldReason(top) || "同一商品として比較できる2ショップ以上を確認できていないため、参考商品を表示しています。";
  }
}

async function loadDeals() {
  const grid = document.querySelector("#dealGrid");
  const updated = document.querySelector("#updated");

  try {
    const response = await fetch("products.json", {
      cache: "no-store"
    });

    if (!response.ok) {
      throw new Error("商品データを取得できませんでした。");
    }

    const data = await response.json();

    if (!Array.isArray(data)) {
      throw new Error("商品データの形式が正しくありません。");
    }

    deals = data
      .filter(item => item && typeof item.name === "string")
      .sort((a, b) =>
        Number(hasPriceComparison(b)) - Number(hasPriceComparison(a)) ||
        Number(canScore(b)) - Number(canScore(a)) ||
        (scoreValue(b) || 0) - (scoreValue(a) || 0) ||
        Number(b.review_count || 0) - Number(a.review_count || 0)
      );

    const active = document.querySelector(".filter.active");
    render(active?.dataset.filter || "all");
    renderPriceDrops();
    updateSignal();

    const dates = deals
      .map(item => Date.parse(item.checked_at))
      .filter(Number.isFinite);

    if (updated) {
      updated.textContent = dates.length
        ? "価格確認 " + new Date(Math.max(...dates))
            .toLocaleString("ja-JP", {
              timeZone: "Asia/Tokyo",
              month: "numeric",
              day: "numeric",
              hour: "2-digit",
              minute: "2-digit"
            }) + "（日本時間）"
        : "価格確認日時は未取得";
    }
  }
  catch {
    if (grid) {
      grid.innerHTML =
        "<p>商品データを読み込めませんでした。時間をおいて再読み込みしてください。</p>";
    }
    if (updated) updated.textContent = "商品データの取得に失敗";
    updateSignal();
  }
}

function render(filter, visibleCount = 20) {
  const target = document.querySelector("#dealGrid");
  if (!target) return;

  const list = deals.filter(item =>
    filter === "all" || item.category === filter
  );

  if (!list.length) {
    target.innerHTML =
      "<p>このカテゴリーの商品はまだありません。</p>";
    return;
  }

  target.innerHTML = list.slice(0, visibleCount).map((item, index) => {
    const imageURL = safeURL(item.image_url);
    const productURL = safeURL(item.best_url);
    const isSample = item.name.startsWith("サンプル");
    const compared = hasPriceComparison(item);
    const scored = canScore(item);

    const average = Number(item.review_average);
    const count = Number(item.review_count);
    const hasReviews =
      Number.isFinite(average) &&
      average > 0 &&
      average <= 5 &&
      Number.isInteger(count) &&
      count > 0;
    const reviewText = hasReviews
      ? `★ ${average.toFixed(1)} / 5（${count.toLocaleString("ja-JP")}件）`
      : "レビュー情報なし";

    const offerCount = comparisonOffers(item).length;
    const included = includedOffers(comparisonOffers(item));
    const comparisonCount = included.length;
    const discount = scored
      ? Math.round(Number(item.discount_percent))
      : null;
    const historicalDiscount = validPositiveNumber(
      item.historical_discount_percent
    );
    const score = scoreValue(item);
    const scoreText = Number.isFinite(score)
      ? `${Math.round(score)}/100`
      : "—";
    const scoreLabel = compared
      ? scored ? "送料込み表示の店を比較" : "送料確認が必要"
      : "比較条件未確認";

    const visual = imageURL
      ? `<img
          src="${escapeHTML(imageURL)}"
          alt="${escapeHTML(item.name)}"
          loading="lazy"
          referrerpolicy="no-referrer"
          style="width:100%;height:100%;object-fit:contain;display:block;background:#fff;"
        >`
      : `<span>${emoji[item.category] || "🛍️"}</span>`;

    const purchaseLink = !isSample && productURL
      ? `<a
          class="shop-link best"
          href="${escapeHTML(productURL)}"
          target="_blank"
          rel="sponsored nofollow noopener noreferrer"
          data-product-name="${escapeHTML(item.name)}"
          data-product-category="${escapeHTML(item.category)}"
        >${compared ? "ショップで送料・条件を確認" : "楽天市場で見る"}</a>`
      : "<span>実商品への切り替え準備中</span>";

    const hasAmazonOffer = comparisonOffers(item).some(offer => offer.marketplace_code === "amazon");
    const amazonURL = !isSample && !hasAmazonOffer ? amazonSearchURL(item) : "";
    const amazonSearchLink = amazonURL
      ? `<a
          class="shop-link amazon-search-link"
          href="${escapeHTML(amazonURL)}"
          target="_blank"
          rel="nofollow noopener noreferrer"
          data-product-name="${escapeHTML(item.name)}"
          data-product-category="${escapeHTML(item.category)}"
        >Amazonで価格を確認</a>`
      : "";

    const comparisonBadges = compared
      ? `
          ${!scored ? `<span class="badge">送料確認が必要</span>` : discount > 0 ? `<span class="badge hot">送料込み表示の店の平均より${discount}%低い</span>` : `<span class="badge">商品価格の差は小さめ</span>`}
          <span class="badge">${scored ? `送料込み表示${comparisonCount}店で比較` : `${offerCount}店の価格を掲載`}</span>
        `
      : `<span class="badge">参考商品・比較条件未確認</span>`;

    const historyBadge = scored && historicalDiscount
      ? `<span class="badge">過去の記録価格より${Math.round(historicalDiscount)}%低い</span>`
      : "";

    const reason = comparisonHoldReason(item) || (compared ? shippingMessage(item) : typeof item.reason === "string" && item.reason.trim()
      ? item.reason
      : "取得時点の商品情報を掲載しています。");

    return `
      <article class="deal">
        <div class="deal-visual">
          <span class="rank">#${index + 1}</span>
          ${visual}
        </div>
        <div class="deal-body">
          <div class="category">
            ${escapeHTML(item.category)} ・ ${escapeHTML(item.shop)}
          </div>

          <h3>${productDetailURL(item)
            ? `<a class="product-title-link" href="${escapeHTML(productDetailURL(item))}">${escapeHTML(item.name)}</a>`
            : escapeHTML(item.name)}</h3>

          <div class="price-line">
            ${compared ? `<span class="price-caption">${scored ? "送料込み表示の店の中で最安（税込）" : `掲載店の商品価格の最小値（税込・${postageLabel(comparisonOffers(item)[0])}）`}</span>` : ""}
            <span class="price">${formatPrice(item.price)}</span>
            ${
              scored
                ? `<span class="market">送料込み表示${comparisonCount}店の平均 ${formatPrice(item.market_price)}</span>`
                : ""
            }
          </div>

          <div class="meta">
            ${comparisonBadges}
            ${historyBadge}
            <span class="badge">${escapeHTML(reviewText)}</span>
          </div>

          <p class="why">
            ${escapeHTML(reason)}<br>
            ポイント・クーポン等は比較価格に未反映です。配送先や会員条件などで支払額が変わる場合があります。
          </p>

          ${compared ? renderShopTable(item) : ""}

          <div class="score-row">
            <span>${escapeHTML(scoreLabel)}</span>
            <strong>${escapeHTML(scoreText)}</strong>
          </div>

          <div class="shop-row">
            ${purchaseLink}
            ${amazonSearchLink}
          </div>
          ${amazonSearchLink ? '<p class="amazon-reference-note">Amazonの価格は現在の比較・スコアには含めていません。リンク先で最新価格をご確認ください。</p>' : ""}
        </div>
      </article>
    `;
  }).join("");
  if (list.length > visibleCount) {
    target.innerHTML += '<button type="button" class="load-more">もっと見る（残り' + (list.length - visibleCount) + '商品）</button>';
    document.querySelector(".load-more")?.addEventListener("click", () => render(filter, visibleCount + 20));
  }
}

document.querySelectorAll(".filter").forEach(button => {
  button.addEventListener("click", () => {
    document.querySelectorAll(".filter").forEach(item => {
      item.classList.remove("active");
    });

    button.classList.add("active");
    render(button.dataset.filter || "all");
  });
});

document.querySelector("#dealGrid")?.addEventListener("click", event => {
  const link = event.target.closest?.("a.shop-link, a.offer-link");
  if (!link || typeof window.gtag !== "function") return;

  window.gtag(link.classList?.contains("amazon-search-link") ? "amazon_search_click" : "affiliate_click", {
    item_name: link.dataset.productName || "",
    item_category: link.dataset.productCategory || "",
    link_url: link.href
  });
});

loadDeals();
