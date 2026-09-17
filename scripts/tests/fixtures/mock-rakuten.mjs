// Offline fixture: catalog prices are null as observed in the Windows logs.
const keywords = ["掃除機", "ドライヤー", "ゲームソフト", "フィギュア", "美容液", "化粧水", "コーヒー", "お米", "ドッグフード", "キャットフード", "洗濯洗剤", "トイレットペーパー"];
function jan(index) {
  const body = String(490000000000 + index);
  const sum = [...body].reduce((total, digit, i) => total + Number(digit) * (i % 2 ? 3 : 1), 0);
  return body + String((10 - sum % 10) % 10);
}
globalThis.fetch = async input => {
  const url = new URL(input);
  if (process.env.MOCK_SCENARIO === "denied") return new Response("", { status: 403 });
  const keyword = url.searchParams.get("keyword");
  if (url.pathname.includes("ichibaproduct")) {
    const index = keywords.indexOf(keyword);
    return new Response(JSON.stringify({ count: 1, Products: [{
      productId: `p${index}`, productCode: jan(index), productName: `テスト製品${index}`,
      productUrlPC: `https://example.com/product/${index}`,
      averagePrice: null, usedExcludeSalesMinPrice: null, usedExcludeSalesItemCount: null, salesMinPrice: 800
    }] }));
  }
  const isPopular = keywords.includes(keyword);
  const isMatch = !isPopular && process.env.MOCK_SCENARIO !== "unmatched";
  return new Response(JSON.stringify({ items: ["one", "two", "one"].map((shop, i) => ({
    itemCode: `${shop}:${keyword}-${i}`, shopCode: shop, shopName: `${shop}店`, itemName: `テスト製品`,
    itemCaption: isMatch ? `JAN: ${keyword}` : "識別情報なし", itemPrice: [800, 1200, 900][i],
    taxFlag: 0, availability: 1, postageFlag: 1, itemUrl: `https://example.com/${shop}/${keyword}/${i}`
  })) }));
};
