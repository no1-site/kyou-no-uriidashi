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
  } catch {
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

    deals = data.filter(item =>
      item && typeof item.name === "string"
    );

    const active = document.querySelector(".filter.active");
    render(active?.dataset.filter || "all");

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
  } catch {
    if (grid) {
      grid.innerHTML =
        "<p>商品データを読み込めませんでした。時間をおいて再読み込みしてください。</p>";
    }
    if (updated) updated.textContent = "商品データの取得に失敗";
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

  target.innerHTML = list.map(item => {
    const imageURL = safeURL(item.image_url);
    const productURL = safeURL(item.best_url);
    const isSample = item.name.startsWith("サンプル");

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
        >楽天市場で見る</a>`
      : "<span>実商品への切り替え準備中</span>";

    return `
      <article class="deal">
        <div class="deal-visual">
          ${visual}
        </div>
        <div class="deal-body">
          <div class="category">
            ${escapeHTML(item.category)} ・ ${escapeHTML(item.shop)}
          </div>

          <h3>${escapeHTML(item.name)}</h3>

          <div class="price-line">
            <span class="price">${formatPrice(item.price)}</span>
          </div>

          <div class="meta">
            <span class="badge">
              ${isSample ? "サンプル商品" : "楽天市場"}
            </span>
            <span class="badge">${escapeHTML(reviewText)}</span>
          </div>

          <p class="why">
            ${
              isSample
                ? "表示確認用のサンプルです。実際の商品情報ではありません。"
                : "取得時点の商品価格です。送料・ポイント・クーポンは反映していません。他店との価格比較は未実施です。最新の価格・在庫・購入条件は楽天市場でご確認ください。"
            }
          </p>

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

loadDeals();
