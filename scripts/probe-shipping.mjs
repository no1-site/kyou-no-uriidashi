// Research only: extracts fee-table candidates, never calculates product totals.
import { pathToFileURL } from "node:url";

export function extractShippingCandidates(html) {
  const text = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<\/t[dh]>/gi, "\t").replace(/<\/(?:tr|p|div)>|<br\s*\/?>/gi, "\n")
    .replace(/<[^>]*>/g, " ").replace(/&nbsp;|&#160;/gi, " ").normalize("NFKC");
  const start = text.indexOf("配送について");
  if (start < 0) return { status: "shipping_section_unconfirmed", candidates: [], usable_for_totals: false };
  const section = text.slice(start).split(/キャンセル・返品/)[0];
  const candidates = [];
  for (const [, value] of section.matchAll(/全国一律料金\s*[:：]?\s*([\d,]+)\s*円/g)) {
    candidates.push({ type: "flat_rate_candidate", yen: Number(value.replaceAll(",", "")) });
  }
  // Parse cell boundaries before flattening: real tables contain newlines
  // and nested font tags inside each region's cell.
  for (const [, row] of html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = [...row.matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)]
      .map(m => m[1].replace(/<[^>]*>/g, " ").replace(/&nbsp;/gi, " ").normalize("NFKC").trim());
    if (cells[0] !== "送料") continue;
    const fees = [...cells.slice(1).join(" ").matchAll(/([\d,]+)\s*円/g)].map(m => Number(m[1].replaceAll(",", "")));
    if (fees.length) candidates.push({ type: "regional_row_candidate", fees_yen: fees });
  }
  const unique = [...new Map(candidates.map(c => [JSON.stringify(c), c])).values()];
  return { status: unique.length ? "fee_candidates_found" : "no_fee_candidates", candidates: unique,
    usable_for_totals: false,
    unverified: ["applicable_delivery_method", "product_exceptions", "destination_and_islands", "quantity_and_free_shipping_threshold"] };
}

async function main() {
  const sources = ["https://www.rakuten.co.jp/u-denki/info2.html", "https://www.rakuten.co.jp/sundrug/info2.html"];
  for (const url of sources) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(12000) });
      if (!response.ok) { console.log(JSON.stringify({ url, status: `HTTP_${response.status}`, usable_for_totals: false })); continue; }
      const bytes = await response.arrayBuffer();
      const prefix = new TextDecoder("latin1").decode(bytes.slice(0, 4096));
      const charset = response.headers.get("content-type")?.match(/charset=([^;\s]+)/i)?.[1] ||
        prefix.match(/charset\s*=\s*["']?([\w-]+)/i)?.[1] || "utf-8";
      const html = new TextDecoder(charset).decode(bytes);
      console.log(JSON.stringify({ url, checked_at: new Date().toISOString(), charset, ...extractShippingCandidates(html) }));
    } catch (error) {
      console.log(JSON.stringify({ url, status: error.name === "TimeoutError" ? "timeout" : "fetch_failed", usable_for_totals: false }));
    }
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
