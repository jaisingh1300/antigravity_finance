#!/usr/bin/env python3
"""
Fetch and verify all Indian Mutual Funds & Index Funds from Groww + AMFI/MFAPI.
Outputs structured, categorized data for both Google Sheets export and the interactive UI.
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


def fetch_json(url, retries=3, timeout=20):
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, headers=HEADERS)
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except Exception as e:
            if attempt == retries - 1:
                raise e
            time.sleep(0.5 * (attempt + 1))


def fetch_all_groww_schemes():
    """Paginate through all schemes on Groww Direct Mutual Funds."""
    page_size = 100
    first = fetch_json(
        f"https://groww.in/v1/api/search/v1/derived/scheme?doc_type=scheme&page=0&plan_type=Direct&q=&size={page_size}&sort_by=3"
    )
    total = first.get("total_results", 0)
    schemes = list(first.get("content", []))
    total_pages = (total + page_size - 1) // page_size
    print(f"Groww reports {total} Direct schemes across {total_pages} pages...")

    def get_page(p):
        url = (
            f"https://groww.in/v1/api/search/v1/derived/scheme"
            f"?doc_type=scheme&page={p}&plan_type=Direct&q=&size={page_size}&sort_by=3"
        )
        return fetch_json(url).get("content", [])

    with ThreadPoolExecutor(max_workers=8) as ex:
        futs = {ex.submit(get_page, p): p for p in range(1, total_pages)}
        for fut in as_completed(futs):
            schemes.extend(fut.result())

    # Deduplicate by search_id / scheme_code
    seen = {}
    for s in schemes:
        key = s.get("search_id") or s.get("scheme_code") or s.get("id")
        if key and key not in seen:
            seen[key] = s

    result = list(seen.values())
    print(f"Fetched {len(result)} unique Direct schemes from Groww.")
    return result


TAB_ORDER = [
    "Active - Equity Funds",
    "Active - Debt Funds",
    "Active - Hybrid & FoFs",
    "Index - Nifty 50",
    "Index - Nifty Next 50",
    "Index - Sensex & BSE",
    "Index - Nifty 100-500 & Broad",
    "Index - Midcap",
    "Index - Smallcap & Microcap",
    "Index - Bank & Finance",
    "Index - Sectoral & Thematic",
    "Index - Factor & Smart Beta",
    "Index - Debt & Target Maturity",
    "Passive - Gold & Silver",
    "US & International Funds",
]


def classify_fund(s):
    """Classify each fund into one of 15 distinct tabs covering all Active, Index, Passive, and US/International funds."""
    name = (s.get("scheme_name") or s.get("fund_name") or "").lower()
    cat_l = (s.get("category") or "").strip().lower()
    sub_l = (s.get("sub_category") or "").strip().lower()
    is_index_flag = bool(s.get("index"))
    is_index_name = bool(
        re.search(
            r"\b(index|nifty|sensex|bse\s*\d+|crisil|target maturity|bharat bond|ftse|msci|s&p\s*500|nasdaq|hang seng|nyse|fang|dow jones|russell)\b",
            name,
        )
    )
    is_fof = bool(re.search(r"\b(fof|fund of fund|fund of funds|feeder)\b", name)) or "fof" in sub_l
    is_etf_fof = bool(re.search(r"\betf\b", name)) and is_fof
    is_active_fof = is_fof and ("active" in name or not (is_index_flag or is_index_name or is_etf_fof))

    # Commodities (Gold / Silver)
    if cat_l == "commodities" or (
        re.search(r"\b(gold|silver|commodit)\b", name)
        and not re.search(r"\b(golden|goldman)\b", name)
        and (is_fof or "etf" in name or "gold" in sub_l or "silver" in sub_l)
    ):
        return "Passive - Gold & Silver"

    # US & International Funds (US, Nasdaq, S&P 500, FANG+, Global, Overseas)
    if (
        re.search(
            r"\b(us |u\.s\.|usa|nasdaq|s&p\s*500|nyse|fang|global|international|world|europe|china|japan|asia|brazil|asean|taiwan|hang seng|overseas|emerging market|developed world|msci|ftse)\b",
            name,
        )
        or "international" in sub_l
    ) and (is_index_flag or is_index_name or is_fof or "international" in sub_l or "global" in name or "us " in name or "nasdaq" in name):
        return "US & International Funds"

    # Index & Passive ETF FoFs
    if is_index_flag or "index" in sub_l or is_index_name or is_etf_fof:
        # 1. Debt & Target Maturity Index
        if cat_l == "debt" or re.search(
            r"\b(gilt|sdl|psu bond|bond|crisil|ibx|target maturity|g-sec|gsec|treasury|t-bill|liquid|overnight|money market|corporate bond|constant maturity|202[5-9]|203[0-9]|204[0-9])\b",
            name,
        ):
            return "Index - Debt & Target Maturity"
        # 2. Factor & Smart Beta (before Nifty 50/100/200/500 so Equal Weight / Momentum / Value land here)
        if re.search(
            r"\b(momentum|value|alpha|quality|low vol|volatility|equal weight|dividend|esg|shariah|multifactor|high beta|growth sectors|top 10|top 15|top 20|top 30|select)\b",
            name,
        ):
            return "Index - Factor & Smart Beta"
        # 3. Bank & Financial Services (Nifty Bank, FinNifty, PSU Bank, Private Bank, Capital Markets)
        if re.search(r"\b(bank|financial|finnifty|fin\s*nifty|capital market|psu bank|private bank)\b", name):
            return "Index - Bank & Finance"
        # 4. Sectoral & Thematic
        if re.search(
            r"\b(it\b|pharma|health|auto|fmcg|metal|energy|infra|realty|psu|pse|defence|defense|ev\b|electric|manufacturing|consumption|services|media|oil|gas|power|telecom|tourism|railway|digital|internet|rural|mobility|housing|healthcare|chemicals|commodities|mnc|india corporate|cpse|bharat 22|multicap|multi cap|india new age|india internet|india tourism|india consumption)\b",
            name,
        ):
            return "Index - Sectoral & Thematic"
        # 5. Nifty Next 50
        if re.search(r"\b(next\s*50|next50)\b", name):
            return "Index - Nifty Next 50"
        # 6. Nifty 50 (pure Nifty 50 / Nifty Index)
        if re.search(r"\b(nifty\s*50\b|nifty50\b|nifty\s*index)\b", name) and not re.search(
            r"\b(midcap|smallcap|microcap|100|200|500)\b", name
        ):
            return "Index - Nifty 50"
        # 7. Sensex & BSE Broad
        if re.search(r"\b(sensex|bse\s*30|bse\s*100|bse\s*200|bse\s*500)\b", name):
            return "Index - Sensex & BSE"
        # 8. Midcap
        if re.search(r"\b(midcap|mid cap|mid-cap|largemidcap|large & mid|large mid)\b", name) and not re.search(
            r"\b(smallcap|small cap|midsmall)\b", name
        ):
            return "Index - Midcap"
        # 9. Smallcap & Microcap
        if re.search(r"\b(smallcap|small cap|small-cap|microcap|micro cap|midsmall)\b", name):
            return "Index - Smallcap & Microcap"
        # 10. Nifty 100 / 200 / 500 / Total Market / LargeCap
        if re.search(r"\b(nifty\s*100|nifty\s*200|nifty\s*500|total market|large\s*cap|largecap|nifty\s*large|500)\b", name):
            return "Index - Nifty 100-500 & Broad"
        return "Index - Sectoral & Thematic"

    # Active FoFs & Hybrid
    if is_active_fof:
        return "Active - Hybrid & FoFs"
    if cat_l == "debt":
        return "Active - Debt Funds"
    if cat_l in ("hybrid", "solution oriented", "other") or any(
        k in sub_l for k in ("hybrid", "arbitrage", "balanced", "multi asset", "retirement", "children")
    ):
        return "Active - Hybrid & FoFs"
    return "Active - Equity Funds"


def clean_float(v):
    if v is None or v == "" or v == "NA":
        return None
    try:
        return round(float(v), 2)
    except Exception:
        return None


def norm_name(s):
    s = (s or "").lower()
    s = re.sub(r"\b(direct|plan|growth|fund|mutual|option|scheme|regular|idcw|dividend|the|and)\b", " ", s)
    s = s.replace("&", " ")
    for a, b in [
        ("mid cap", "midcap"),
        ("small cap", "smallcap"),
        ("large cap", "largecap"),
        ("flexi cap", "flexicap"),
        ("multi cap", "multicap"),
        ("micro cap", "microcap"),
        ("nifty 50", "nifty50"),
        ("next 50", "next50"),
    ]:
        s = s.replace(a, b)
    return re.sub(r"[^a-z0-9]+", " ", s).strip()


def fetch_kuvera_mapping():
    """Fetch Kuvera Direct Growth scheme codes for CORS-enabled live browser lookups."""
    try:
        kl = fetch_json("https://api.kuvera.in/mf/api/v4/fund_schemes/list.json", timeout=25)
    except Exception as e:
        print(f"Warning: could not fetch Kuvera list: {e}")
        return {}, []
    k_exact = {}
    k_tokens = []
    for _cat, subs in kl.items():
        if not isinstance(subs, dict):
            continue
        for _sub, amcs in subs.items():
            if not isinstance(amcs, dict):
                continue
            for _amc, schemes in amcs.items():
                if not isinstance(schemes, list):
                    continue
                for sc in schemes:
                    n = sc.get("n", "")
                    if "direct" in n.lower() and "growth" in n.lower():
                        nk = norm_name(n)
                        c = sc.get("c")
                        if nk and c:
                            k_exact[nk] = c
                            k_tokens.append((set(nk.split()), c))
    print(f"Loaded {len(k_exact)} Kuvera Direct Growth codes for live CORS mapping.")
    return k_exact, k_tokens


def match_kuvera_code(scheme_name, k_exact, k_tokens):
    nf = norm_name(scheme_name)
    if nf in k_exact:
        return k_exact[nf]
    ft = set(nf.split())
    if not ft:
        return ""
    best_score = 0.0
    best_c = ""
    for kt, c in k_tokens:
        if not kt:
            continue
        score = len(ft & kt) / len(ft | kt)
        if score > best_score:
            best_score = score
            best_c = c
    return best_c if best_score >= 0.72 else ""


def fetch_kuvera_us_international_funds(existing_kcodes, existing_norm_names):
    """Fetch all Indian Direct Growth US / Nasdaq / S&P 500 / Global funds from Kuvera v4 + v5."""
    try:
        kl = fetch_json("https://api.kuvera.in/mf/api/v4/fund_schemes/list.json", timeout=25)
    except Exception:
        return []

    candidates = []
    for _cat, subs in kl.items():
        if not isinstance(subs, dict):
            continue
        for sub, amcs in subs.items():
            if not isinstance(amcs, dict):
                continue
            for _amc, schemes in amcs.items():
                if not isinstance(schemes, list):
                    continue
                for sc in schemes:
                    n = sc.get("n", "")
                    nl = n.lower()
                    c = sc.get("c", "")
                    if not c or "direct" not in nl or "growth" not in nl:
                        continue
                    is_us_intl = "international" in sub.lower() or bool(
                        re.search(
                            r"\b(us |u\.s\.|usa|nasdaq|s&p\s*500|nyse|fang|global|international|overseas|world|europe|china|japan|asia|brazil|asean|taiwan|hang seng|msci|ftse|us equity|us bluechip|us tech|us opportunities|us treasury)\b",
                            nl,
                        )
                    )
                    if not is_us_intl:
                        continue
                    if c in existing_kcodes or norm_name(n) in existing_norm_names:
                        continue
                    candidates.append((c, n, sub, sc.get("r") or {}))

    print(f"Fetching live details for {len(candidates)} additional US & International funds from Kuvera...")

    def fetch_one(item):
        c, n, sub, r_short = item
        try:
            arr = fetch_json(f"https://api.kuvera.in/mf/api/v5/fund_schemes/{c}.json", timeout=12)
            k = arr[0] if isinstance(arr, list) and arr else (arr if isinstance(arr, dict) else {})
        except Exception:
            k = {}
        rets = k.get("returns") or {}
        nav_obj = k.get("nav") or {}
        aum_val = k.get("aum")
        aum_cr = round(float(aum_val) / 10.0, 2) if aum_val not in (None, "") else None
        return {
            "tab": "US & International Funds",
            "scheme_code": "",
            "kuvera_code": c,
            "search_id": k.get("slug") or "",
            "scheme_name": k.get("name") or n,
            "fund_house": k.get("fund_house") or "",
            "category": k.get("category") or "Equity",
            "sub_category": k.get("fund_category") or sub or "International",
            "is_index": "index" in n.lower() or "nasdaq" in n.lower() or "s&p" in n.lower(),
            "plan_type": "Direct",
            "aum_cr": aum_cr,
            "expense_ratio": clean_float(k.get("expense_ratio")),
            "cagr_1y": clean_float(rets.get("year_1") if rets.get("year_1") is not None else r_short.get("1")),
            "cagr_3y": clean_float(rets.get("year_3") if rets.get("year_3") is not None else r_short.get("3")),
            "cagr_5y": clean_float(rets.get("year_5") if rets.get("year_5") is not None else r_short.get("5")),
            "nav": clean_float(nav_obj.get("nav")),
            "exit_load": "Check scheme document (Overseas FoF / Index)",
            "risk": "Very High",
            "groww_rating": k.get("fund_rating"),
            "min_sip": clean_float(k.get("sip_min")),
            "min_lumpsum": clean_float(k.get("lump_min")),
            "fund_manager": k.get("fund_manager") or "",
            "logo_url": "",
        }

    added = []
    with ThreadPoolExecutor(max_workers=12) as ex:
        for res in ex.map(fetch_one, candidates):
            if res:
                added.append(res)
    return added


def main():
    raw = fetch_all_groww_schemes()
    k_exact, k_tokens = fetch_kuvera_mapping()

    # Save raw snapshot
    with open(os.path.join(DATA_DIR, "groww_raw.json"), "w") as f:
        json.dump(raw, f)

    counts = Counter()
    missing_stats = Counter()
    kuvera_matched = 0
    cleaned = []
    existing_kcodes = set()
    existing_norm_names = set()

    for s in raw:
        tab = classify_fund(s)
        counts[tab] += 1

        exp = clean_float(s.get("expense_ratio"))
        aum = clean_float(s.get("aum"))
        nav = clean_float(s.get("nav"))
        r1y = clean_float(s.get("return1y"))
        r3y = clean_float(s.get("return3y"))
        r5y = clean_float(s.get("return5y"))
        exit_load = (s.get("exit_load") or "").strip() or "Nil / Not Specified"
        sname = s.get("scheme_name") or s.get("fund_name") or ""
        kcode = match_kuvera_code(sname, k_exact, k_tokens)
        if kcode:
            kuvera_matched += 1
            existing_kcodes.add(kcode)
        existing_norm_names.add(norm_name(sname))

        if exp is None:
            missing_stats["expense_ratio"] += 1
        if aum is None:
            missing_stats["aum"] += 1
        if nav is None:
            missing_stats["nav"] += 1
        if r1y is None:
            missing_stats["return1y"] += 1

        cleaned.append(
            {
                "tab": tab,
                "scheme_code": str(s.get("scheme_code") or ""),
                "kuvera_code": kcode,
                "search_id": s.get("search_id") or "",
                "scheme_name": sname,
                "fund_house": s.get("fund_house") or s.get("amc") or "",
                "category": s.get("category") or "",
                "sub_category": s.get("sub_category") or "",
                "is_index": bool(s.get("index")),
                "plan_type": s.get("plan_type") or "Direct",
                "aum_cr": aum,
                "expense_ratio": exp,
                "cagr_1y": r1y,
                "cagr_3y": r3y,
                "cagr_5y": r5y,
                "nav": nav,
                "exit_load": exit_load,
                "risk": s.get("risk") or "",
                "groww_rating": s.get("groww_rating"),
                "min_sip": clean_float(s.get("min_sip_investment")),
                "min_lumpsum": clean_float(s.get("min_investment_amount")),
                "fund_manager": s.get("fund_manager") or "",
                "logo_url": s.get("logo_url") or "",
            }
        )

    # Add all US & International Direct Growth funds from Kuvera not already in Groww
    us_added = fetch_kuvera_us_international_funds(existing_kcodes, existing_norm_names)
    for item in us_added:
        cleaned.append(item)
        counts[item["tab"]] += 1
        kuvera_matched += 1

    # Sort each tab by AUM descending by default
    cleaned.sort(key=lambda x: (x["tab"], -(x["aum_cr"] if x["aum_cr"] is not None else -1)))

    output = {
        "fetched_at": datetime.now(timezone.utc).isoformat(),
        "total_funds": len(cleaned),
        "tab_counts": dict(counts),
        "funds": cleaned,
    }

    with open(os.path.join(DATA_DIR, "funds_master.json"), "w") as f:
        json.dump(output, f, indent=2)

    print(f"\nKuvera live CORS code matched: {kuvera_matched}/{len(cleaned)} ({kuvera_matched/len(cleaned)*100:.1f}%)")
    print("\n=== TAB BREAKDOWN ===")
    for k in TAB_ORDER:
        print(f"  {k:35s}: {counts[k]}")
    print(f"  {'TOTAL':35s}: {len(cleaned)}")
    print("\nMissing stats:", dict(missing_stats))


if __name__ == "__main__":
    main()
