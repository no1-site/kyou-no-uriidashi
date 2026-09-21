import { normalizeText } from "./rakuten-comparison.mjs";

export const selectionVersion = "main-products-v3";

// Discovery guards keep unrelated products from consuming fixed-category slots.
// Refill detergent, pet food and other consumables remain eligible.
// Inspect product identity/title fields, never shop boilerplate or a search hit alone.
export function selectionExclusion(name, category, jan = "") {
  const title = normalizeText(name);
  if (!title) return "missing_name";
  const code = String(jan ?? "").normalize("NFKC").trim();
  // The current site categories do not include books. ISBN-13 uses the 978/979
  // prefix, so exclude those identities before they consume discovery slots.
  if (/^(?:978|979)\d{10}$/.test(code)) return "book_isbn";
  // Guard against keyword collisions such as "パスタ" matching "洗顔パスタ".
  if (category === "食品") {
    if (/洗顔|化粧水|美容液|シャンプー|トリートメント|クレンジング/.test(title)) {
      return "category_mismatch";
    }
    // Food search terms can also match utensils such as coffee spoons or
    // spaghetti strainers. Keep the food category to edible/drinkable goods.
    const utensils = /(?:コーヒー|珈琲).*(?:スプーン|ドリッパー|フィルタ[ー]?|ミル|サーバー)|(?:スパゲティ|パスタ).*(?:揚|てぼ|トング|フォーク|サーバー|ストレーナ|ざる|ザル)/;
    if (utensils.test(title)) return "food_utensil";
  }
  if (category === "家電") {
    const parts = /交換用|交換部品|補修|修理用|パーツ|部品|リチウムイオン電池|充電池|バッテリー|acアダプタ|電源アダプタ|充電器|充電台|フィルタ[ー]?|紙パック(?!式)|ダストバッグ|集じん袋|ノズル|ホース|ブラシ|ヘッド|アタッチメント|スタンド|収納ケース|収納袋/;
    // "ヘアドライヤー" and "紙パック式掃除機" are main products;
    // accessories advertised separately are not our discovery target.
    if (parts.test(title)) return "appliance_accessory";
    if (/掃除機.*(?:いらない|不要).*(?:圧縮パック|圧縮袋)/.test(title)) return "not_appliance";
  }
  if (category === "ホビー") {
    const media = /攻略本|攻略ガイド|ガイドブック|公式ガイド|設定資料集|原画集|画集|楽譜|写真集|コミック|漫画|マンガ|小説|雑誌|書籍|主題歌|サウンドトラック|サントラ|アルバム|フィギュ?ア付|\b(?:cd|dvd|blu-ray|soundtrack|guidebook)\b/;
    if (media.test(title)) return "related_media";
    if (/フィギュ[アァ].*(?:ケース|スタンド|台座|収納)|(?:ケース|スタンド|台座|収納).*フィギュ[アァ]/.test(title)) {
      return "figure_accessory";
    }
  }
  return "";
}
