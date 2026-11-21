export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "no-store");

  const symbol = String(req.query.symbol || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9&-]/g, "");

  if (!symbol) {
    return res.status(400).json({ error: "Missing symbol parameter" });
  }

  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}.NS?range=5y&interval=1d`;
    const r = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0",
        Accept: "application/json",
      },
    });
    if (!r.ok) {
      return res.status(502).json({ error: `Yahoo Finance returned ${r.status}` });
    }
    const y = await r.json();
    const result = y?.chart?.result?.[0];
    if (!result) {
      return res.status(404).json({ error: "ETF chart data not found" });
    }

    const meta = result.meta || {};
    const timestamps = result.timestamp || [];
    const closes = result.indicators?.quote?.[0]?.close || [];

    const history = [];
    for (let i = 0; i < timestamps.length; i++) {
      const ts = timestamps[i];
      const cl = closes[i];
      if (ts && cl != null && !Number.isNaN(cl) && cl > 0) {
        const iso = new Date(ts * 1000).toISOString().slice(0, 10);
        history.push({ date: iso, nav: Math.round(cl * 10000) / 10000 });
      }
    }

    const last = history.length ? history[history.length - 1] : null;
    const prev = history.length >= 2 ? history[history.length - 2] : null;
    const livePrice = meta.regularMarketPrice ?? (last ? last.nav : null);
    const prevClose = prev ? prev.nav : null;
    const change1d =
      livePrice != null && prevClose != null && prevClose > 0
        ? Math.round(((livePrice - prevClose) / prevClose) * 10000) / 100
        : null;

    function calcCagr(years) {
      if (history.length < 2) return null;
      const latest = history[history.length - 1];
      const latestMs = new Date(latest.date).getTime();
      const targetMs = latestMs - years * 365.25 * 86400000;
      let best = history[0];
      let bestDiff = Math.abs(new Date(best.date).getTime() - targetMs);
      for (let i = 1; i < history.length - 1; i++) {
        const diff = Math.abs(new Date(history[i].date).getTime() - targetMs);
        if (diff < bestDiff) {
          bestDiff = diff;
          best = history[i];
        }
      }
      if (!best || best.nav <= 0) return null;
      const actualYrs = (latestMs - new Date(best.date).getTime()) / (365.25 * 86400000);
      if (Math.abs(actualYrs - years) > 0.25 || actualYrs <= 0) return null;
      return Math.round((Math.pow(latest.nav / best.nav, 1 / actualYrs) - 1) * 10000) / 100;
    }

    return res.status(200).json({
      fetched_at: new Date().toISOString(),
      sources: ["NSE / Yahoo Finance Live"],
      live: {
        symbol,
        name: meta.longName || meta.shortName || symbol,
        price: livePrice != null ? Math.round(livePrice * 100) / 100 : null,
        price_date: last ? last.date : "",
        change_1d_pct: change1d,
        week_52_high: meta.fiftyTwoWeekHigh != null ? Math.round(meta.fiftyTwoWeekHigh * 100) / 100 : null,
        week_52_low: meta.fiftyTwoWeekLow != null ? Math.round(meta.fiftyTwoWeekLow * 100) / 100 : null,
        volume: meta.regularMarketVolume ?? null,
        cagr_1y: calcCagr(1),
        cagr_3y: calcCagr(3),
        cagr_5y: calcCagr(5),
        nse_url: `https://www.nseindia.com/get-quotes/equity?symbol=${encodeURIComponent(symbol)}`,
      },
      nav_history: history,
    });
  } catch (err) {
    return res.status(500).json({ error: String(err?.message || err) });
  }
}
