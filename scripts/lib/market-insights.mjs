import { validJAN, positiveNumber } from "./rakuten-comparison.mjs";

function marketCode(offer) {
  const explicit = String(offer?.marketplace_code || "").toLowerCase();
  if (explicit) return explicit;
  const shopCode = String(offer?.shop_code || "").toLowerCase();
  if (shopCode.startsWith("yahoo:")) return "yahoo";
  if (shopCode.startsWith("rakuten:")) return "rakuten";
  const marketplace = String(offer?.marketplace || "");
  if (marketplace.includes("Yahoo")) return "yahoo";
  if (marketplace.includes("楽天")) return "rakuten";
  return "";
}

function cheapestOffer(product, market, includedOnly = false) {
  return (Array.isArray(product?.offers) ? product.offers : [])
    .filter(offer =>
      marketCode(offer) === market &&
      positiveNumber(offer?.price) &&
      (!includedOnly || offer?.postage === "included")
    )
    .sort((a, b) => Number(a.price) - Number(b.price))[0] || null;
}

function winnerFor(rakutenPrice, yahooPrice) {
  if (rakutenPrice < yahooPrice) return "rakuten";
  if (yahooPrice < rakutenPrice) return "yahoo";
  return "tie";
}

function summarize(rows) {
  const result = {
    comparable: rows.length,
    rakuten_wins: 0,
    yahoo_wins: 0,
    ties: 0,
    average_gap_yen: 0,
    max_gap_yen: 0,
    max_gap: null
  };
  if (!rows.length) return result;

  let gapTotal = 0;
  for (const row of rows) {
    result[row.winner === "rakuten" ? "rakuten_wins" : row.winner === "yahoo" ? "yahoo_wins" : "ties"]++;
    gapTotal += row.gap_yen;
    if (row.gap_yen > result.max_gap_yen) {
      result.max_gap_yen = row.gap_yen;
      result.max_gap = row;
    }
  }
  result.average_gap_yen = Math.round(gapTotal / rows.length);
  return result;
}

export function buildRakutenYahooInsights(products) {
  const listedRows = [];
  const shippingRows = [];

  for (const product of Array.isArray(products) ? products : []) {
    const jan = validJAN(product?.product_code);
    if (!jan) continue;

    const rakuten = cheapestOffer(product, "rakuten");
    const yahoo = cheapestOffer(product, "yahoo");
    if (rakuten && yahoo) {
      const winner = winnerFor(Number(rakuten.price), Number(yahoo.price));
      listedRows.push({
        jan,
        name: String(product?.name || ""),
        category: String(product?.category || "その他"),
        rakuten_price: Number(rakuten.price),
        yahoo_price: Number(yahoo.price),
        gap_yen: Math.abs(Number(rakuten.price) - Number(yahoo.price)),
        winner
      });
    }

    const rakutenIncluded = cheapestOffer(product, "rakuten", true);
    const yahooIncluded = cheapestOffer(product, "yahoo", true);
    if (rakutenIncluded && yahooIncluded) {
      shippingRows.push({
        jan,
        name: String(product?.name || ""),
        category: String(product?.category || "その他"),
        rakuten_price: Number(rakutenIncluded.price),
        yahoo_price: Number(yahooIncluded.price),
        gap_yen: Math.abs(Number(rakutenIncluded.price) - Number(yahooIncluded.price)),
        winner: winnerFor(Number(rakutenIncluded.price), Number(yahooIncluded.price))
      });
    }
  }

  listedRows.sort((a, b) => b.gap_yen - a.gap_yen || a.name.localeCompare(b.name, "ja"));
  shippingRows.sort((a, b) => b.gap_yen - a.gap_yen || a.name.localeCompare(b.name, "ja"));

  const categories = new Map();
  for (const row of listedRows) {
    const current = categories.get(row.category) || { category: row.category, comparable: 0, rakuten_wins: 0, yahoo_wins: 0, ties: 0 };
    current.comparable++;
    if (row.winner === "rakuten") current.rakuten_wins++;
    else if (row.winner === "yahoo") current.yahoo_wins++;
    else current.ties++;
    categories.set(row.category, current);
  }

  return {
    tracked_products: Array.isArray(products) ? products.length : 0,
    listed: { ...summarize(listedRows), rows: listedRows },
    shipping_included: { ...summarize(shippingRows), rows: shippingRows },
    categories: [...categories.values()].sort((a, b) => b.comparable - a.comparable || a.category.localeCompare(b.category, "ja"))
  };
}
