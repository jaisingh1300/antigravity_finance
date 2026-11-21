export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "no-store");

  try {
    const r = await fetch("https://www.nseindia.com/api/etf", {
      headers: {
        "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/126.0.0.0 Safari/537.36",
        Accept: "application/json",
      },
    });
    if (!r.ok) {
      return res.status(502).json({ error: `NSE API returned ${r.status}` });
    }
    const raw = await r.json();
    const rows = raw?.data || [];
    const bySymbol = {};
    for (const row of rows) {
      const sym = String(row.symbol || "").trim().toUpperCase();
      if (!sym) continue;
      const toNum = (v) => {
        if (v == null || v === "" || v === "-") return null;
        const n = Number(String(v).replace(/,/g, ""));
        return Number.isNaN(n) ? null : Math.round(n * 100) / 100;
      };
      bySymbol[sym] = {
        ltp: toNum(row.ltP),
        nav: toNum(row.nav),
        change_1d_pct: toNum(row.per),
        change_30d_pct: toNum(row.perChange30d),
        nse_1y: toNum(row.perChange365d),
        volume: row.qty && row.qty !== "-" ? Number(String(row.qty).replace(/,/g, "")) : 0,
        traded_val_cr:
          row.trdVal && row.trdVal !== "-"
            ? Math.round((Number(String(row.trdVal).replace(/,/g, "")) / 1e7) * 100) / 100
            : 0,
        week_52_high: toNum(row.wkhi),
        week_52_low: toNum(row.wklo),
      };
    }

    return res.status(200).json({
      fetched_at: new Date().toISOString(),
      nav_date: raw?.navDate || "",
      count: Object.keys(bySymbol).length,
      by_symbol: bySymbol,
    });
  } catch (err) {
    return res.status(500).json({ error: String(err?.message || err) });
  }
}
