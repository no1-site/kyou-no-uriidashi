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
    price !== null &&
    marketPrice !== null &&
    marketPrice >= price &&
    comparisonOffers(item).length >= 2;
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
  return `<div class="shop-comparison">
    <p>確認した${offers.length}ショップの商品価格</p>
    <div class="offer-table-wrap"><table class="offer-table">
      <caption class="sr-only">${escapeHTML(item.name)}のショップ別税込価格と送料表示</caption>
      <thead><tr><th scope="col">ショップ</th><th scope="col">税込価格</th><th scope="col">送料表示</th></tr></thead>
      <tbody>${offers.map(offer => `<tr>
        <th scope="row"><a class="offer-link" href="${escapeHTML(safeURL(offer.url))}" target="_blank"
          rel="sponsored nofollow noopener noreferrer" data-product-name="${escapeHTML(item.name)}"
          data-product-category="${escapeHTML(item.category)}">${escapeHTML(offer.shop_name)}</a></th>
        <td>${formatPrice(offer.price)}</td>
        <td>${offer.postage === "included" ? "送料込み" : offer.postage === "extra" ? "送料別" : "未確認"}</td>
      </tr>`).join("")}</tbody>
    </table></div>
    <p class="offer-note">送料込みの表示も配送先などで条件が変わる場合があります。</p>
  </div>`;
}

function updateSignal() {
  const scoreElement = document.querySelector("#signalScore");
  const labelElement = document.querySelector("#signalLabel");
  const textElement = document.querySelector("#signalText");
  const headingElement = document.querySelector("#dealHeading");
  if (!scoreElement || !labelElement || !textElement) return;

  const comparedDeals = deals.filter(hasPriceComparison);
  const top = comparedDeals[0] || deals[0];

  if (headingElement) {
    headingElement.textContent = comparedDeals.length
      ? "楽天のショップ別価格比較"
      : "楽天の参考商品（比較条件未確認）";
  }

  if (!top) {
    scoreElement.textContent = "--";
    labelElement.textContent = "商品なし";
    textElement.textContent = "次回の価格確認をお待ちください。";
    return;
  }

  const score = hasPriceComparison(top) ? Number(top.score) : NaN;
  scoreElement.textContent = Number.isFinite(score)
    ? String(Math.round(score))
    : "--";
  labelElement.textContent = hasPriceComparison(top) ? top.deal_label || "ショップ比較済み" : "比較条件未確認";

  if (hasPriceComparison(top)) {
    const offerCount = comparisonOffers(top).length;
    const discount = Math.max(0, Math.floor(Number(top.discount_percent) || 0));
    textElement.textContent =
      discount > 0
        ? `確認した${offerCount}ショップの商品価格を比較。比較店の平均より${discount}%低い価格です。`
        : `確認した${offerCount}ショップの商品価格を比較しています。`;
  }
  else {
    textElement.textContent =
      "同一商品として比較できる2ショップ以上を確認できていないため、参考商品を表示しています。";
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
        Number(b.score || 0) - Number(a.score || 0) ||
        Number(b.review_count || 0) - Number(a.review_count || 0)
      );

    const active = document.querySelector(".filter.active");
    render(active?.dataset.filter || "all");
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

function render(filter) {
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

  target.innerHTML = list.map((item, index) => {
    const imageURL = safeURL(item.image_url);
    const productURL = safeURL(item.best_url);
    const isSample = item.name.startsWith("サンプル");
    const compared = hasPriceComparison(item);

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
    const discount = compared
      ? Math.round(Number(item.discount_percent))
      : null;
    const historicalDiscount = validPositiveNumber(
      item.historical_discount_percent
    );
    const score = compared ? Number(item.score) : NaN;
    const scoreText = Number.isFinite(score)
      ? `${Math.round(score)}/100`
      : "—";
    const scoreLabel = compared
      ? item.deal_label || "お買い得スコア"
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
        >${compared ? "比較店の最安商品を見る" : "楽天市場で見る"}</a>`
      : "<span>実商品への切り替え準備中</span>";

    const comparisonBadges = compared
      ? `
          ${discount > 0 ? `<span class="badge hot">比較店平均より${discount}%低い</span>` : `<span class="badge">商品価格の差は小さめ</span>`}
          <span class="badge">${offerCount}ショップ比較</span>
        `
      : `<span class="badge">参考商品・比較条件未確認</span>`;

    const historyBadge = historicalDiscount
      ? `<span class="badge">過去の記録価格より${Math.round(historicalDiscount)}%低い</span>`
      : "";

    const reason = typeof item.reason === "string" && item.reason.trim()
      ? item.reason
      : "取得時点の商品情報を掲載しています。";

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

          <h3>${escapeHTML(item.name)}</h3>

          <div class="price-line">
            ${compared ? `<span class="price-caption">確認したショップ内の最安商品価格（税込）</span>` : ""}
            <span class="price">${formatPrice(item.price)}</span>
            ${
              compared
                ? `<span class="market">比較${offerCount}店の平均 ${formatPrice(item.market_price)}</span>`
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
            送料の加算・ポイント・クーポンは比較価格に未反映です。
          </p>

          ${compared ? renderShopTable(item) : ""}

          <div class="score-row">
            <span>${escapeHTML(scoreLabel)}</span>
            <strong>${escapeHTML(scoreText)}</strong>
          </div>

          <div class="shop-row">
            ${purchaseLink}
          </div>
        </div>
      </article>
    `;
  }).join("");
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

  window.gtag("event", "affiliate_click", {
    item_name: link.dataset.productName || "",
    item_category: link.dataset.productCategory || "",
    link_url: link.href
  });
});

loadDeals();
