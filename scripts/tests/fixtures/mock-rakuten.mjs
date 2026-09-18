// Offline fixture: catalog prices are null as observed in the Windows logs.
const keywords = ["掃除機", "ドライヤー", "ゲームソフト", "フィギュア", "美容液", "化粧水", "コーヒー", "お米", "ドッグフード", "キャットフード", "洗濯洗剤", "トイレットペーパー"];
const unwanted = ["掃除機用 充電式リチウムイオン電池", "ドライヤー用交換ノズル", "非売品ゲームソフトガイドブック", "フィギア付 廻人 / Eve"];
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
    const candidates = [{
      productId: `p${index}`, productCode: jan(index), productName: `テスト製品${index}`,
      productUrlPC: `https://example.com/product/${index}`,
      averagePrice: null, usedExcludeSalesMinPrice: null, usedExcludeSalesItemCount: null, salesMinPrice: 800
    }];
    if (process.env.MOCK_SCENARIO === "selection" && index < 4) {
      candidates.unshift(...Array.from({ length: 9 }, (_, i) => ({ productId: `noise${index}-${i}`, productCode: jan(index + 100 + i), productName: unwanted[index] })));
    }
    return new Response(JSON.stringify({ count: candidates.length, Products: candidates }));
  }
  const isPopular = keywords.includes(keyword);
  const isMatch = !isPopular && process.env.MOCK_SCENARIO !== "unmatched";
  const items = ["one", "two", "one"].map((shop, i) => ({
    itemCode: `${shop}:${keyword}-${i}`, shopCode: shop, shopName: `${shop}店`, itemName: `テスト製品`,
    itemCaption: isMatch ? `JAN: ${keyword}` : "識別情報なし", itemPrice: [800, 1200, 900][i],
    taxFlag: 0, availability: 1, postageFlag: 0, itemUrl: `https://example.com/${shop}/${keyword}/${i}`
  }));
  // Fallback must not reintroduce accessories or related media rejected above.
  const index = keywords.indexOf(keyword);
  if (isPopular && index < 4) items.unshift({ ...items[0], itemName: unwanted[index], itemCode: "noise:1" });
  return new Response(JSON.stringify({ items }));
};
