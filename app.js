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
  const discount = validPositiveNumber(item.discount_percent);

  return item.comparison_type === "rakuten_product" &&
    price !== null &&
    marketPrice !== null &&
    marketPrice > price &&
    discount !== null;
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
      ? "楽天内で価格差が大きい商品"
      : "楽天の人気商品（価格比較待ち）";
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
  labelElement.textContent = top.deal_label || "価格比較候補";

  if (hasPriceComparison(top)) {
    const offerCount = Math.max(0, Math.trunc(Number(top.offer_count) || 0));
    const discount = Math.round(Number(top.discount_percent));
    textElement.textContent =
      `楽天市場内の販売中${offerCount}商品を比較。楽天APIの平均価格より${discount}%安い候補です。`;
  }
  else {
    textElement.textContent =
      "価格比較データを取得できなかったため、レビュー情報を表示しています。";
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

    const offerCount = Math.max(0, Math.trunc(Number(item.offer_count) || 0));
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
      : "価格比較待ち";

    const visual = imageURL
      ? `<img
          src="${escapeHTML(imageURL)}"
          alt="${escapeHTML(item.name)}"
          loading="lazy"
          referrerpolicy="no-referrer"
          style="width:100%;height:180px;object-fit:contain;display:block;background:#fff;"
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
        >${compared ? "楽天市場で価格を比較" : "楽天市場で見る"}</a>`
      : "<span>実商品への切り替え準備中</span>";

    const comparisonBadges = compared
      ? `
          <span class="badge hot">平均より${discount}%安い</span>
          <span class="badge">販売中 ${offerCount}商品</span>
        `
      : `<span class="badge">人気商品</span>`;

    const historyBadge = historicalDiscount
      ? `<span class="badge">過去価格より${Math.round(historicalDiscount)}%安い</span>`
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
            <span class="price">${formatPrice(item.price)}</span>
            ${
              compared
                ? `<span class="market">楽天内平均 ${formatPrice(item.market_price)}</span>`
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
            送料・ポイント・クーポンは未反映です。
          </p>

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
  const link = event.target.closest?.("a.shop-link");
  if (!link || typeof window.gtag !== "function") return;

  window.gtag("event", "affiliate_click", {
    item_name: link.dataset.productName || "",
    item_category: link.dataset.productCategory || "",
    link_url: link.href
  });
});

loadDeals();
