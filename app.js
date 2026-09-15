const emoji = { "家電":"⚡", "ホビー":"🎮", "美容":"💄", "食品":"🍫", "ペット":"🐶", "日用品":"🧻" };
let deals = [];

async function loadDeals(){
  try{
    const res = await fetch("products.json", {cache:"no-store"});
    deals = await res.json();
    render("all");
    const latest = deals.reduce((a,b)=> new Date(a.checked_at)>new Date(b.checked_at)?a:b);
    document.querySelector("#updated").textContent =
      "価格確認 " + new Date(latest.checked_at).toLocaleString("ja-JP",{month:"numeric",day:"numeric",hour:"2-digit",minute:"2-digit"});
  }catch(e){
    document.querySelector("#dealGrid").innerHTML = "<p>商品データを読み込めませんでした。</p>";
  }
}

function render(filter){
  const target = document.querySelector("#dealGrid");
  const list = deals.filter(d => filter==="all" || d.category===filter).sort((a,b)=>b.score-a.score);
  target.innerHTML = list.map((d,i)=>`
    <article class="deal">
      <div class="deal-visual"><span class="rank">#${i+1}</span>${emoji[d.category]||"🔥"}</div>
      <div class="deal-body">
        <div class="category">${escapeHTML(d.category)} ・ ${escapeHTML(d.shop)}</div>
        <h3>${escapeHTML(d.name)}</h3>
        <div class="price-line">
          <span class="price">¥${Number(d.price).toLocaleString()}</span>
          <span class="market">相場 ¥${Number(d.market_price).toLocaleString()}</span>
        </div>
        <div class="meta">
          <span class="badge hot">${d.discount_percent}%安い</span>
          <span class="badge">${escapeHTML(d.label)}</span>
        </div>
        <p class="why">${escapeHTML(d.reason)}</p>
        <div class="score-row"><span>AIお買い得度</span><strong>${d.score} / 100</strong></div>
        <div class="shop-row">
          <a class="shop-link best" href="${safeURL(d.best_url)}" target="_blank" rel="sponsored nofollow noopener">最安店で見る</a>
          <a class="shop-link" href="${safeURL(d.compare_url)}" target="_blank" rel="sponsored nofollow noopener">比較する</a>
        </div>
      </div>
    </article>`).join("");
}
function escapeHTML(v){return String(v).replace(/[&<>"']/g,s=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[s]));}
function safeURL(v){ try{const u=new URL(v,location.href); return ["http:","https:"].includes(u.protocol)?u.href:"#";}catch(e){return "#";} }

document.querySelectorAll(".filter").forEach(btn=>{
  btn.addEventListener("click",()=>{
    document.querySelectorAll(".filter").forEach(x=>x.classList.remove("active"));
    btn.classList.add("active");
    render(btn.dataset.filter);
  });
});
loadDeals();