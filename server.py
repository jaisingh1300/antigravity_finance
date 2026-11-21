#!/usr/bin/env python3
"""
Backend server for Indian Mutual Funds & Index Funds Explorer.
- Serves cached tab data (stale until user clicks Refresh on a tab).
- Provides /api/refresh?tab=... to refresh the selected tab from live market data.
- Provides /api/fund/live?scheme_code=...&search_id=... for non-stale, real-time
  fund details and daily NAV history when a user expands any fund row.
"""

import json
import mimetypes
import os
import sys
import threading
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_FILE = os.path.join(BASE_DIR, "data", "funds_master.json")
PUBLIC_DIR = os.path.join(BASE_DIR, "public")

sys.path.insert(0, os.path.join(BASE_DIR, "scripts"))
import fetch_funds  # noqa: E402

TAB_ORDER = fetch_funds.TAB_ORDER

HEADERS = {
    "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
    "Accept": "application/json",
}

STATE_LOCK = threading.Lock()
STATE = {
    "fetched_at": None,
    "tab_refreshed": {},
    "funds_by_tab": {t: [] for t in TAB_ORDER},
    "total_funds": 0,
}


def load_master_data():
    if not os.path.exists(DATA_FILE):
        return
    with open(DATA_FILE, "r", encoding="utf-8") as f:
        data = json.load(f)
    fetched_at = data.get("fetched_at") or datetime.now(timezone.utc).isoformat()
    tab_refreshed = data.get("tab_refreshed") or {}
    grouped = {t: [] for t in TAB_ORDER}
    for fund in data.get("funds", []):
        t = fund.get("tab")
        if t not in grouped:
            grouped[t] = []
        grouped[t].append(fund)

    with STATE_LOCK:
        STATE["fetched_at"] = fetched_at
        STATE["funds_by_tab"] = grouped
        STATE["total_funds"] = sum(len(v) for v in grouped.values())
        for t in grouped:
            STATE["tab_refreshed"][t] = tab_refreshed.get(t, fetched_at)


def save_master_data():
    with STATE_LOCK:
        all_funds = []
        tab_counts = {}
        for t, items in STATE["funds_by_tab"].items():
            tab_counts[t] = len(items)
            all_funds.extend(items)
        payload = {
            "fetched_at": STATE["fetched_at"],
            "tab_refreshed": STATE["tab_refreshed"],
            "total_funds": len(all_funds),
            "tab_counts": tab_counts,
            "funds": all_funds,
        }
    os.makedirs(os.path.dirname(DATA_FILE), exist_ok=True)
    with open(DATA_FILE, "w", encoding="utf-8") as f:
        json.dump(payload, f)


def http_get_json(url, timeout=15):
    req = urllib.request.Request(url, headers=HEADERS)
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))


def fetch_live_fund_details(scheme_code, search_id):
    """Fetch fresh, non-stale fund details (Groww) + daily NAV history (MFAPI / Groww)."""
    live_info = {}
    nav_history = []
    sources = []

    def get_groww_detail():
        if not search_id:
            return None
        url = f"https://groww.in/v1/api/data/mf/web/v4/scheme/search/{urllib.parse.quote(search_id)}"
        return http_get_json(url, timeout=12)

    def get_mfapi_history():
        if not scheme_code:
            return None
        url = f"https://api.mfapi.in/mf/{urllib.parse.quote(str(scheme_code))}"
        return http_get_json(url, timeout=15)

    with ThreadPoolExecutor(max_workers=2) as ex:
        f_groww = ex.submit(get_groww_detail)
        f_mfapi = ex.submit(get_mfapi_history)

        g_data = None
        m_data = None
        try:
            g_data = f_groww.result()
        except Exception:
            g_data = None
        try:
            m_data = f_mfapi.result()
        except Exception:
            m_data = None

    if g_data:
        sources.append("Groww Live")
        rs = g_data.get("return_stats") or []
        rs0 = rs[0] if isinstance(rs, list) and rs else {}
        holdings_raw = g_data.get("holdings") or []
        top_holdings = []
        for h in holdings_raw[:8]:
            if isinstance(h, dict):
                top_holdings.append(
                    {
                        "name": h.get("company_name") or h.get("instrument_name") or "",
                        "sector": h.get("sector_name") or "",
                        "corpus_per": h.get("corpus_per"),
                    }
                )

        live_info = {
            "scheme_name": g_data.get("scheme_name") or "",
            "fund_house": g_data.get("fund_house") or "",
            "category": g_data.get("category") or "",
            "sub_category": g_data.get("sub_category") or "",
            "nav": g_data.get("nav"),
            "nav_date": g_data.get("nav_date") or "",
            "aum_cr": g_data.get("aum"),
            "expense_ratio": g_data.get("expense_ratio"),
            "exit_load": g_data.get("exit_load") or "Nil",
            "cagr_1y": rs0.get("return1y") if rs0.get("return1y") is not None else g_data.get("return1y"),
            "cagr_3y": rs0.get("return3y") if rs0.get("return3y") is not None else g_data.get("return3y"),
            "cagr_5y": rs0.get("return5y") if rs0.get("return5y") is not None else g_data.get("return5y"),
            "return_since_launch": rs0.get("return_since_created"),
            "risk": g_data.get("nfo_risk") or g_data.get("risk") or "",
            "benchmark": g_data.get("benchmark_name") or g_data.get("benchmark") or "",
            "fund_manager": g_data.get("fund_manager") or "",
            "min_sip": g_data.get("min_sip_investment"),
            "min_lumpsum": g_data.get("min_investment_amount"),
            "launch_date": g_data.get("launch_date") or "",
            "stamp_duty": g_data.get("stamp_duty") or "0.005%",
            "groww_rating": g_data.get("groww_rating"),
            "top_holdings": top_holdings,
            "groww_url": f"https://groww.in/mutual-funds/{search_id}" if search_id else "",
        }

    if m_data and isinstance(m_data.get("data"), list) and len(m_data["data"]) > 0:
        sources.append("AMFI / MFAPI")
        # MFAPI returns newest first: [{"date": "20-11-2026", "nav": "56.57500"}, ...]
        parsed = []
        for pt in m_data["data"]:
            try:
                dt = datetime.strptime(pt["date"], "%d-%m-%Y").strftime("%Y-%m-%d")
                val = round(float(pt["nav"]), 4)
                parsed.append({"date": dt, "nav": val})
            except Exception:
                continue
        parsed.reverse()  # chronological oldest -> newest
        nav_history = parsed

        # Fill latest NAV & 1D change from AMFI if missing
        if len(parsed) >= 1:
            latest = parsed[-1]
            if live_info.get("nav") is None:
                live_info["nav"] = latest["nav"]
            if not live_info.get("nav_date"):
                live_info["nav_date"] = latest["date"]
        if len(parsed) >= 2 and parsed[-2]["nav"] > 0:
            prev = parsed[-2]["nav"]
            curr = parsed[-1]["nav"]
            live_info["change_1d_pct"] = round(((curr - prev) / prev) * 100, 2)
    elif scheme_code:
        # Fallback to Groww chart endpoint if MFAPI didn't return data
        try:
            gc = http_get_json(
                f"https://groww.in/v1/api/data/mf/web/v1/scheme/{urllib.parse.quote(str(scheme_code))}/graph?benchmark=false&months=60",
                timeout=12,
            )
            pts = (gc.get("folio") or {}).get("data") or []
            for ts, val in pts:
                dt = datetime.fromtimestamp(ts / 1000, tz=timezone.utc).strftime("%Y-%m-%d")
                nav_history.append({"date": dt, "nav": round(float(val), 4)})
            if nav_history:
                sources.append("Groww Graph")
        except Exception:
            pass

    return {
        "fetched_at": datetime.now(timezone.utc).isoformat(),
        "sources": sources,
        "live": live_info,
        "nav_history": nav_history,
    }


def refresh_tab_data(tab_name):
    """Fetch fresh data from Groww and update the specified tab in memory + disk."""
    raw = fetch_funds.fetch_all_groww_schemes()
    now_iso = datetime.now(timezone.utc).isoformat()
    refreshed_items = []
    for s in raw:
        t = fetch_funds.classify_fund(s)
        if t != tab_name:
            continue
        refreshed_items.append(
            {
                "tab": t,
                "scheme_code": str(s.get("scheme_code") or ""),
                "search_id": s.get("search_id") or "",
                "scheme_name": s.get("scheme_name") or s.get("fund_name") or "",
                "fund_house": s.get("fund_house") or s.get("amc") or "",
                "category": s.get("category") or "",
                "sub_category": s.get("sub_category") or "",
                "is_index": bool(s.get("index")),
                "plan_type": s.get("plan_type") or "Direct",
                "aum_cr": fetch_funds.clean_float(s.get("aum")),
                "expense_ratio": fetch_funds.clean_float(s.get("expense_ratio")),
                "cagr_1y": fetch_funds.clean_float(s.get("return1y")),
                "cagr_3y": fetch_funds.clean_float(s.get("return3y")),
                "cagr_5y": fetch_funds.clean_float(s.get("return5y")),
                "nav": fetch_funds.clean_float(s.get("nav")),
                "exit_load": (s.get("exit_load") or "").strip() or "Nil / Not Specified",
                "risk": s.get("risk") or "",
                "groww_rating": s.get("groww_rating"),
                "min_sip": fetch_funds.clean_float(s.get("min_sip_investment")),
                "min_lumpsum": fetch_funds.clean_float(s.get("min_investment_amount")),
                "fund_manager": s.get("fund_manager") or "",
                "logo_url": s.get("logo_url") or "",
            }
        )

    refreshed_items.sort(key=lambda x: -(x["aum_cr"] if x["aum_cr"] is not None else -1))

    with STATE_LOCK:
        STATE["funds_by_tab"][tab_name] = refreshed_items
        STATE["tab_refreshed"][tab_name] = now_iso
        STATE["total_funds"] = sum(len(v) for v in STATE["funds_by_tab"].values())

    save_master_data()
    return {
        "tab": tab_name,
        "count": len(refreshed_items),
        "last_refreshed": now_iso,
        "funds": refreshed_items,
    }


class AppHandler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        pass  # Keep logs quiet and clean

    def send_json(self, obj, status=200):
        body = json.dumps(obj).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        qs = urllib.parse.parse_qs(parsed.query)

        if path == "/api/tabs":
            with STATE_LOCK:
                tabs = []
                for t in TAB_ORDER:
                    items = STATE["funds_by_tab"].get(t, [])
                    tabs.append(
                        {
                            "name": t,
                            "count": len(items),
                            "last_refreshed": STATE["tab_refreshed"].get(t, STATE["fetched_at"]),
                        }
                    )
                total = STATE["total_funds"]
            self.send_json({"tabs": tabs, "total_funds": total})
            return

        if path == "/api/funds":
            tab = (qs.get("tab") or [TAB_ORDER[0]])[0]
            with STATE_LOCK:
                items = STATE["funds_by_tab"].get(tab, [])
                last_ref = STATE["tab_refreshed"].get(tab, STATE["fetched_at"])
            self.send_json({"tab": tab, "count": len(items), "last_refreshed": last_ref, "funds": items})
            return

        if path == "/api/fund/live":
            scheme_code = (qs.get("scheme_code") or [""])[0]
            search_id = (qs.get("search_id") or [""])[0]
            try:
                result = fetch_live_fund_details(scheme_code, search_id)
                self.send_json(result)
            except Exception as e:
                self.send_json({"error": str(e)}, status=500)
            return

        # Serve static files from public/
        if path == "/":
            rel = "index.html"
        else:
            rel = path.lstrip("/")
        safe_path = os.path.normpath(os.path.join(PUBLIC_DIR, rel))
        if not safe_path.startswith(PUBLIC_DIR) or not os.path.isfile(safe_path):
            self.send_error(404, "Not Found")
            return

        mime, _ = mimetypes.guess_type(safe_path)
        with open(safe_path, "rb") as f:
            content = f.read()
        self.send_response(200)
        self.send_header("Content-Type", mime or "application/octet-stream")
        self.send_header("Content-Length", str(len(content)))
        self.end_headers()
        self.wfile.write(content)

    def do_POST(self):
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path == "/api/refresh":
            qs = urllib.parse.parse_qs(parsed.query)
            tab = (qs.get("tab") or [TAB_ORDER[0]])[0]
            try:
                result = refresh_tab_data(tab)
                self.send_json(result)
            except Exception as e:
                self.send_json({"error": str(e)}, status=500)
            return
        self.send_error(404, "Not Found")


def main():
    load_master_data()
    port = int(os.environ.get("PORT", "8000"))
    server = ThreadingHTTPServer(("0.0.0.0", port), AppHandler)
    print(f"Indian MF Explorer server running on http://localhost:{port} ({STATE['total_funds']} funds loaded)")
    server.serve_forever()


if __name__ == "__main__":
    main()
