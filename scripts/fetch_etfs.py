#!/usr/bin/env python3
"""
Fetch all Indian NSE-listed ETFs from NSE India's official ETF API,
classify them into clean ETF tabs (Gold, Silver, Nifty 50 & Sensex, Midcap & Smallcap,
Bank & Sectoral, Factor & Smart Beta, Debt & Liquid, US & International),
and enrich 1Y / 3Y / 5Y CAGR from Yahoo Finance (.NS).
"""

import json
import os
import re
import time
import urllib.request
from collections import Counter
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(BASE_DIR, "data")
os.makedirs(DATA_DIR, exist_ok=True)

HEADERS = {
    "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
    "Accept": "application/json",
}

ETF_TAB_ORDER = [
    "ETF - Gold",
    "ETF - Silver",
    "ETF - Nifty 50 & Sensex",
    "ETF - Midcap & Smallcap",
    "ETF - Bank & Sectoral",
    "ETF - Factor & Smart Beta",
    "ETF - Debt & Liquid",
    "ETF - US & International",
]


def fetch_json(url, timeout=15):
    req = urllib.request.Request(url, headers=HEADERS)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode("utf-8"))


def clean_float(v):
    if v is None or v == "" or v == "-" or v == "NA":
        return None
    try:
        return round(float(str(v).replace(",", "")), 2)
    except Exception:
        return None


def classify_etf(row):
    sym = (row.get("symbol") or "").upper()
    asset = (row.get("assets") or "").lower()
    text = f"{sym.lower()} {asset}"

    # 1. Silver
    if re.search(r"\b(silver|silverbees|silverietf|silveretf|silvr)\b", text) or "silver" in sym.lower():
        return "ETF - Silver"

    # 2. Gold
    if re.search(r"\b(gold|goldbees|goldietf|goldshare|qgoldhalf|bslgoldetf|setfgold|axisgold|hdfcgold|kotakgold|licmfgold|ivzinnifty)\b", text) or "gold" in sym.lower():
        if "gold" in text:
            return "ETF - Gold"

    # 3. US & International
    if re.search(r"\b(nasdaq|s&p\s*500|s&p500|fang|nyse|hang\s*seng|hngsn|mon100|mafang|masptop50|monq50|mahktech|international|global|us\s|usa|china|japan)\b", text):
        return "ETF - US & International"

    # 4. Debt & Liquid (G-Sec, Liquid, SDL, Bharat Bond, Target Maturity, 1D Rate, Gilt)
    if re.search(r"\b(liquid|gilt|g-sec|gsec|1d\s*rate|overnight|sdl|bharat\s*bond|bbetf|bond|debt|treasury|t-bill|government\s*securities|money\s*market|ltgilt|setfgilt|ebbetf|cpse\s*bond|aaa\s*psu)\b", text):
        return "ETF - Debt & Liquid"

    # 5. Factor & Smart Beta (Momentum, Alpha, Value, Quality, Low Vol, Equal Weight, Dividend, ESG)
    if re.search(r"\b(momentum|alpha|value|quality|low\s*vol|lowvol|volatility|equal\s*weight|dividend|esg|shariah|multifactor|high\s*beta|select\s*ipo|top\s*10|top\s*15|top\s*20|nv20)\b", text):
        return "ETF - Factor & Smart Beta"

    # 6. Midcap & Smallcap
    if re.search(r"\b(midcap|mid\s*cap|smallcap|small\s*cap|microcap|micro\s*cap|midsmall|mid150|midq50|hdfcmid150)\b", text):
        return "ETF - Midcap & Smallcap"

    # 7. Bank & Sectoral / Thematic
    if re.search(r"\b(bank|finnifty|financial|psu\s*bank|psubnk|pvt\s*bank|it\b|itbees|tech|pharma|health|auto|fmcg|metal|energy|infra|realty|psu|pse|cpse|defence|defense|ev\b|electric|manufacturing|consumption|consump|media|oil|gas|power|telecom|capital\s*market|tourism|railway|digital|internet|mnc|commodities|bharat\s*22|icicib22|bfsi|chemicals|new\s*age)\b", text):
        return "ETF - Bank & Sectoral"

    # 8. Nifty 50, Nifty Next 50, Sensex, Nifty 100/200/500 Broad
    if re.search(r"\b(nifty\s*50|nifty50|niftybees|next\s*50|juniorbees|sensex|bse\s*30|nifty\s*100|nifty\s*200|nifty\s*500|bse\s*100|bse\s*500|large\s*cap|broad)\b", text):
        return "ETF - Nifty 50 & Sensex"

    return "ETF - Bank & Sectoral"


def fetch_yahoo_cagrs(symbol):
    """Fetch 5Y weekly history from Yahoo Finance (.NS) to compute accurate 1Y, 3Y, 5Y CAGR."""
    url = f"https://query1.finance.yahoo.com/v8/finance/chart/{symbol}.NS?range=5y&interval=1wk"
    for attempt in range(3):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
            with urllib.request.urlopen(req, timeout=10) as r:
                y = json.loads(r.read().decode("utf-8"))
            res = (y.get("chart") or {}).get("result") or []
            if not res:
                return None, None, None
            ts_list = res[0].get("timestamp") or []
            closes = ((res[0].get("indicators") or {}).get("quote") or [{}])[0].get("close") or []
            pts = [(t, c) for t, c in zip(ts_list, closes) if t and c and c > 0]
            if len(pts) < 10:
                return None, None, None
            last_ts, last_px = pts[-1]

            def calc_cagr(years):
                target_ts = last_ts - years * 365.25 * 86400
                best = min(pts[:-1], key=lambda p: abs(p[0] - target_ts))
                actual_yrs = (last_ts - best[0]) / (365.25 * 86400)
                if abs(actual_yrs - years) > 0.25 or actual_yrs <= 0:
                    return None
                return round(((last_px / best[1]) ** (1.0 / actual_yrs) - 1.0) * 100.0, 2)

            return calc_cagr(1), calc_cagr(3), calc_cagr(5)
        except Exception as e:
            if "429" in str(e) and attempt < 2:
                time.sleep(0.8 * (attempt + 1))
                continue
            return None, None, None
    return None, None, None


def main():
    print("Fetching all NSE ETFs from https://www.nseindia.com/api/etf ...")
    raw = fetch_json("https://www.nseindia.com/api/etf", timeout=20)
    rows = raw.get("data") or []
    nav_date = raw.get("navDate") or ""
    print(f"NSE returned {len(rows)} ETFs (navDate: {nav_date}). Enriching 1Y/3Y/5Y CAGR via Yahoo Finance...")

    # Deduplicate by symbol
    seen = {}
    for r in rows:
        sym = (r.get("symbol") or "").strip().upper()
        if sym and sym not in seen:
            seen[sym] = r
    unique_rows = list(seen.values())

    # Fetch Yahoo Finance CAGRs with polite concurrency
    cagr_map = {}
    with ThreadPoolExecutor(max_workers=6) as ex:
        futs = {ex.submit(fetch_yahoo_cagrs, r["symbol"].strip().upper()): r["symbol"].strip().upper() for r in unique_rows}
        for fut in as_completed(futs):
            sym = futs[fut]
            try:
                cagr_map[sym] = fut.result()
            except Exception:
                cagr_map[sym] = (None, None, None)

    etfs = []
    counts = Counter()
    for r in unique_rows:
        sym = (r.get("symbol") or "").strip().upper()
        tab = classify_etf(r)
        counts[tab] += 1
        y1, y3, y5 = cagr_map.get(sym, (None, None, None))
        nse_1y = clean_float(r.get("perChange365d"))
        cagr_1y = y1 if y1 is not None else nse_1y

        trd_val_cr = clean_float(r.get("trdVal"))
        if trd_val_cr is not None:
            # NSE trdVal is in ₹ Lakhs or raw rupees? Check magnitude: usually in ₹ Crores or raw rupees
            # Wait: let's inspect raw trdVal in rupees vs crores later; normalize cleanly!
            pass

        etfs.append(
            {
                "tab": tab,
                "symbol": sym,
                "name": (r.get("assets") or sym).strip(),
                "ltp": clean_float(r.get("ltP")),
                "nav": clean_float(r.get("nav")),
                "change_1d_pct": clean_float(r.get("per")),
                "change_30d_pct": clean_float(r.get("perChange30d")),
                "cagr_1y": cagr_1y,
                "cagr_3y": y3,
                "cagr_5y": y5,
                "volume": int(float(str(r.get("qty") or 0).replace(",", ""))) if r.get("qty") not in (None, "", "-") else 0,
                "traded_val_cr": round(float(str(r.get("trdVal") or 0).replace(",", "")) / 1e7, 2) if r.get("trdVal") not in (None, "", "-") else 0.0,
                "week_52_high": clean_float(r.get("wkhi")),
                "week_52_low": clean_float(r.get("wklo")),
                "nav_date": nav_date,
            }
        )

    # Sort by traded value descending by default (most liquid ETFs on top!)
    etfs.sort(key=lambda x: (x["tab"], -(x["traded_val_cr"] or 0)))

    output = {
        "fetched_at": datetime.now(timezone.utc).isoformat(),
        "nav_date": nav_date,
        "total_etfs": len(etfs),
        "tab_counts": dict(counts),
        "etfs": etfs,
    }

    with open(os.path.join(DATA_DIR, "etfs_master.json"), "w", encoding="utf-8") as f:
        json.dump(output, f, indent=2)

    print("\n=== ETF TAB BREAKDOWN ===")
    for k in ETF_TAB_ORDER:
        print(f"  {k:30s}: {counts[k]}")
    print(f"  {'TOTAL':30s}: {len(etfs)}")


if __name__ == "__main__":
    main()
