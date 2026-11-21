#!/usr/bin/env python3
"""
Create a BRAND-NEW Google Sheet (never touching any existing sheet) containing
all Indian Mutual Funds & Index Funds across separate category tabs, with
formatting, frozen headers, and filter views for sorting on any column.
"""

import json
import os
import subprocess
import tempfile
from datetime import datetime, timezone

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_FILE = os.path.join(BASE_DIR, "data", "funds_master.json")

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
    "Passive - Gold, Silver & Intl",
]

COLUMNS = [
    "Scheme Name",
    "AMC / Fund House",
    "Sub-Category",
    "AUM (₹ Cr)",
    "Expense Ratio (%)",
    "1Y CAGR (%)",
    "3Y CAGR (%)",
    "5Y CAGR (%)",
    "Latest NAV (₹)",
    "Exit Load",
    "Risk",
    "Min SIP (₹)",
    "Scheme Code",
]


def run_gsheets(args):
    cmd = ["gsheets", "--json"] + args
    proc = subprocess.run(cmd, capture_output=True, text=True)
    if proc.returncode != 0:
        raise RuntimeError(f"gsheets failed ({' '.join(args)}):\n{proc.stderr or proc.stdout}")
    out = proc.stdout.strip()
    try:
        return json.loads(out)
    except Exception:
        return out


def val_or_blank(v):
    return "" if v is None else v


import re
import sys


def main():
    with open(DATA_FILE, "r", encoding="utf-8") as f:
        master = json.load(f)

    funds = master["funds"]
    by_tab = {t: [] for t in TAB_ORDER}
    for x in funds:
        by_tab.setdefault(x["tab"], []).append(x)

    today_str = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    title = f"Indian Mutual Funds & Index Funds Master ({today_str})"

    sheet_id = None
    if len(sys.argv) >= 3 and sys.argv[1] == "--spreadsheet-id":
        sheet_id = sys.argv[2]
        print(f"Populating newly created Google Sheet ID: {sheet_id}")
    else:
        print(f"Creating NEW Google Sheet: {title}")
        created = run_gsheets(["mutate", "create", "--title", title])
        if isinstance(created, dict):
            sheet_id = created.get("spreadsheetId") or created.get("spreadsheet_id") or created.get("id")
        elif isinstance(created, str):
            m = re.search(r"\(ID:\s*([A-Za-z0-9_-]+)\)", created)
            if m:
                sheet_id = m.group(1)
        if not sheet_id:
            raise RuntimeError(f"Could not parse spreadsheetId from: {created}")

    sheet_url = f"https://docs.google.com/spreadsheets/d/{sheet_id}/edit"
    print(f"Spreadsheet ID: {sheet_id}")
    print(f"URL: {sheet_url}")

    # Inspect existing sheets on this brand-new spreadsheet
    existing_raw = run_gsheets(["readonly", "list-sheets", sheet_id])
    existing_titles = {}
    if isinstance(existing_raw, list):
        for sh in existing_raw:
            t = sh.get("title") or (sh.get("properties") or {}).get("title")
            sid = sh.get("sheetId") if "sheetId" in sh else (sh.get("properties") or {}).get("sheetId")
            if t is not None and sid is not None:
                existing_titles[t] = sid
    elif isinstance(existing_raw, dict) and "sheets" in existing_raw:
        for sh in existing_raw["sheets"]:
            t = sh.get("title") or (sh.get("properties") or {}).get("title")
            sid = sh.get("sheetId") if "sheetId" in sh else (sh.get("properties") or {}).get("sheetId")
            if t is not None and sid is not None:
                existing_titles[t] = sid
    elif isinstance(existing_raw, str):
        for line in existing_raw.splitlines():
            m = re.search(r"^(.*?)\s*\(ID:\s*(\d+)\)", line.strip())
            if m:
                existing_titles[m.group(1).strip()] = int(m.group(2))

    # Rename default Sheet1 (sheetId 0) to Summary if not already renamed
    if "Summary" not in existing_titles:
        run_gsheets(["mutate", "rename-sheet", sheet_id, "--sheet-id", "0", "--title", "Summary"])

    # Create all 14 category tabs
    tab_sheet_ids = {}
    for tab in TAB_ORDER:
        if tab in existing_titles:
            tab_sheet_ids[tab] = existing_titles[tab]
            continue
        res = run_gsheets(["mutate", "add-sheet", sheet_id, "--title", tab])
        sid = None
        if isinstance(res, dict):
            sid = res.get("sheetId") or res.get("sheet_id") or (res.get("properties") or {}).get("sheetId")
        elif isinstance(res, str):
            m = re.search(r"ID:\s*(\d+)", res)
            if m:
                sid = int(m.group(1))
        tab_sheet_ids[tab] = sid
        print(f"  Added tab: {tab} (sheetId={sid})")

    # Re-fetch exact sheet IDs via readonly list-sheets to be 100% certain
    sheets_info = run_gsheets(["readonly", "list-sheets", sheet_id])
    if isinstance(sheets_info, list):
        for sh in sheets_info:
            t = sh.get("title") or (sh.get("properties") or {}).get("title")
            sid = sh.get("sheetId") if "sheetId" in sh else (sh.get("properties") or {}).get("sheetId")
            if t in tab_sheet_ids and sid is not None:
                tab_sheet_ids[t] = sid
    elif isinstance(sheets_info, dict) and "sheets" in sheets_info:
        for sh in sheets_info["sheets"]:
            t = sh.get("title") or (sh.get("properties") or {}).get("title")
            sid = sh.get("sheetId") if "sheetId" in sh else (sh.get("properties") or {}).get("sheetId")
            if t in tab_sheet_ids and sid is not None:
                tab_sheet_ids[t] = sid
    elif isinstance(sheets_info, str):
        for line in sheets_info.splitlines():
            m = re.search(r"^(.*?)\s*\(ID:\s*(\d+)\)", line.strip())
            if m and m.group(1).strip() in tab_sheet_ids:
                tab_sheet_ids[m.group(1).strip()] = int(m.group(2))

    # Prepare Summary rows
    summary_rows = [
        ["Indian Mutual Funds & Index Funds — Master Directory", "", "", ""],
        ["Data Source", "Groww Direct Plans + AMFI / MFAPI Verified", "Last Updated (UTC)", master.get("fetched_at", "")],
        ["Plan Type", "Direct – Growth", "Total Funds", len(funds)],
        ["", "", "", ""],
        ["Sheet / Category Tab", "Fund Count", "Total AUM (₹ Cr)", "Avg Expense Ratio (%)"],
    ]
    for tab in TAB_ORDER:
        items = by_tab[tab]
        total_aum = round(sum(x["aum_cr"] for x in items if x.get("aum_cr") is not None), 2)
        ers = [x["expense_ratio"] for x in items if x.get("expense_ratio") is not None]
        avg_er = round(sum(ers) / len(ers), 2) if ers else ""
        summary_rows.append([tab, len(items), total_aum, avg_er])

    # Write Summary + each tab via gsheets mutate batch
    batch_ops = [{"op": "write", "range": "'Summary'!A1", "data": summary_rows}]

    for tab in TAB_ORDER:
        rows = [COLUMNS]
        for x in by_tab[tab]:
            rows.append(
                [
                    x.get("scheme_name", ""),
                    x.get("fund_house", ""),
                    x.get("sub_category", ""),
                    val_or_blank(x.get("aum_cr")),
                    val_or_blank(x.get("expense_ratio")),
                    val_or_blank(x.get("cagr_1y")),
                    val_or_blank(x.get("cagr_3y")),
                    val_or_blank(x.get("cagr_5y")),
                    val_or_blank(x.get("nav")),
                    x.get("exit_load", ""),
                    x.get("risk", ""),
                    val_or_blank(x.get("min_sip")),
                    x.get("scheme_code", ""),
                ]
            )
        batch_ops.append({"op": "write", "range": f"'{tab}'!A1", "data": rows})

    with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as tf:
        json.dump(batch_ops, tf)
        batch_file = tf.name

    try:
        print("Writing all 1,706 funds across 9 tabs in batch...")
        run_gsheets(["mutate", "batch", sheet_id, "-f", batch_file])
    finally:
        os.unlink(batch_file)

    # Format headers, freeze top row, and enable basic filter (sortable on every column!) via raw-batch
    raw_requests = [
        # Format Summary header
        {
            "repeatCell": {
                "range": {"sheetId": 0, "startRowIndex": 0, "endRowIndex": 1, "startColumnIndex": 0, "endColumnIndex": 4},
                "cell": {
                    "userEnteredFormat": {
                        "backgroundColor": {"red": 0.06, "green": 0.23, "blue": 0.19},
                        "textFormat": {"bold": True, "fontSize": 13, "foregroundColor": {"red": 1, "green": 1, "blue": 1}},
                    }
                },
                "fields": "userEnteredFormat(backgroundColor,textFormat)",
            }
        },
        {
            "repeatCell": {
                "range": {"sheetId": 0, "startRowIndex": 4, "endRowIndex": 5, "startColumnIndex": 0, "endColumnIndex": 4},
                "cell": {
                    "userEnteredFormat": {
                        "backgroundColor": {"red": 0.91, "green": 0.96, "blue": 0.94},
                        "textFormat": {"bold": True},
                    }
                },
                "fields": "userEnteredFormat(backgroundColor,textFormat)",
            }
        },
        {
            "autoResizeDimensions": {
                "dimensions": {"sheetId": 0, "dimension": "COLUMNS", "startIndex": 0, "endIndex": 4}
            }
        },
    ]

    for tab in TAB_ORDER:
        sid = tab_sheet_ids.get(tab)
        if sid is None:
            continue
        row_count = len(by_tab[tab]) + 1
        raw_requests.extend(
            [
                # Freeze row 1 and column 1
                {
                    "updateSheetProperties": {
                        "properties": {
                            "sheetId": sid,
                            "gridProperties": {"frozenRowCount": 1, "frozenColumnCount": 1},
                        },
                        "fields": "gridProperties.frozenRowCount,gridProperties.frozenColumnCount",
                    }
                },
                # Style header row
                {
                    "repeatCell": {
                        "range": {
                            "sheetId": sid,
                            "startRowIndex": 0,
                            "endRowIndex": 1,
                            "startColumnIndex": 0,
                            "endColumnIndex": len(COLUMNS),
                        },
                        "cell": {
                            "userEnteredFormat": {
                                "backgroundColor": {"red": 0.07, "green": 0.28, "blue": 0.22},
                                "textFormat": {"bold": True, "foregroundColor": {"red": 1, "green": 1, "blue": 1}},
                                "horizontalAlignment": "CENTER",
                            }
                        },
                        "fields": "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)",
                    }
                },
                # Enable Basic Filter across entire table so user can sort/filter ANY column
                {
                    "setBasicFilter": {
                        "filter": {
                            "range": {
                                "sheetId": sid,
                                "startRowIndex": 0,
                                "endRowIndex": row_count,
                                "startColumnIndex": 0,
                                "endColumnIndex": len(COLUMNS),
                            }
                        }
                    }
                },
                # Auto-resize columns
                {
                    "autoResizeDimensions": {
                        "dimensions": {
                            "sheetId": sid,
                            "dimension": "COLUMNS",
                            "startIndex": 0,
                            "endIndex": len(COLUMNS),
                        }
                    }
                },
            ]
        )

    with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as tf:
        json.dump({"requests": raw_requests}, tf)
        raw_file = tf.name

    try:
        print("Applying header formatting, frozen panes, and sortable column filters...")
        run_gsheets(["mutate", "raw-batch", sheet_id, "-f", raw_file])
    finally:
        os.unlink(raw_file)

    meta = {"spreadsheet_id": sheet_id, "url": sheet_url, "title": title, "created_at": datetime.now(timezone.utc).isoformat()}
    with open(os.path.join(BASE_DIR, "data", "gsheet_meta.json"), "w") as f:
        json.dump(meta, f, indent=2)

    print(f"\nSUCCESS! Brand-new Google Sheet ready:\n{sheet_url}")


if __name__ == "__main__":
    main()
