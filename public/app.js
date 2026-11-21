(() => {
  const FUND_TAB_ORDER = [
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
  ];

  const ETF_TAB_ORDER = [
    "ETF - Gold",
    "ETF - Silver",
    "ETF - Nifty 50 & Sensex",
    "ETF - Midcap & Smallcap",
    "ETF - Bank & Sectoral",
    "ETF - Factor & Smart Beta",
    "ETF - Debt & Liquid",
    "ETF - US & International",
  ];

  const FUND_SORT_OPTIONS = [
    { value: "aum_cr", label: "AUM (₹ Cr)" },
    { value: "cagr_1y", label: "1Y CAGR (%)" },
    { value: "cagr_3y", label: "3Y CAGR (%)" },
    { value: "cagr_5y", label: "5Y CAGR (%)" },
    { value: "expense_ratio", label: "Expense Ratio (%)" },
    { value: "nav", label: "Latest NAV (₹)" },
    { value: "scheme_name", label: "Fund Name (A–Z)" },
  ];

  const ETF_SORT_OPTIONS = [
    { value: "traded_val_cr", label: "Traded Value (₹ Cr)" },
    { value: "cagr_1y", label: "1Y CAGR (%)" },
    { value: "cagr_3y", label: "3Y CAGR (%)" },
    { value: "cagr_5y", label: "5Y CAGR (%)" },
    { value: "change_1d_pct", label: "1D Change (%)" },
    { value: "ltp", label: "Price / LTP (₹)" },
    { value: "symbol", label: "Symbol (A–Z)" },
  ];

  const state = {
    assetClass: "funds", // "funds" | "etf" | "equity"
    // Mutual Funds data
    fundTabs: [],
    fundsByTab: {},
    fundTabRefreshed: {},
    totalFunds: 0,
    // ETFs data
    etfTabs: [],
    etfsByTab: {},
    etfTabRefreshed: {},
    totalEtfs: 0,
    // Active view state
    activeTab: null,
    items: [],
    lastRefreshed: null,
    searchQuery: "",
    sortBy: "aum_cr",
    sortDir: "desc",
    expandedKey: null,
  };

  const els = {
    assetClassSelect: document.getElementById("assetClassSelect"),
    tabsShell: document.getElementById("tabsShell"),
    tabsContainer: document.getElementById("tabsContainer"),
    toolbarSection: document.getElementById("toolbarSection"),
    tableCard: document.getElementById("tableCard"),
    equityEmptyCard: document.getElementById("equityEmptyCard"),
    totalItemsLabel: document.getElementById("totalItemsLabel"),
    totalFundsCount: document.getElementById("totalFundsCount"),
    totalTabsCount: document.getElementById("totalTabsCount"),
    activeTabTitle: document.getElementById("activeTabTitle"),
    activeTabCount: document.getElementById("activeTabCount"),
    lastRefreshedText: document.getElementById("lastRefreshedText"),
    freshnessHint: document.getElementById("freshnessHint"),
    searchInput: document.getElementById("searchInput"),
    sortSelect: document.getElementById("sortSelect"),
    sortDirBtn: document.getElementById("sortDirBtn"),
    sortDirLabel: document.getElementById("sortDirLabel"),
    sortDirIcon: document.getElementById("sortDirIcon"),
    refreshTabBtn: document.getElementById("refreshTabBtn"),
    refreshBtnLabel: document.getElementById("refreshBtnLabel"),
    fundsTableHead: document.getElementById("fundsTableHead"),
    fundsTableBody: document.getElementById("fundsTableBody"),
    toast: document.getElementById("toast"),
  };

  let toastTimer = null;
  function showToast(msg) {
    els.toast.textContent = msg;
    els.toast.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => els.toast.classList.remove("show"), 3500);
  }

  function escapeHtml(str) {
    if (str == null) return "";
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function formatNumber(val, decimals = 2) {
    if (val === null || val === undefined || val === "" || Number.isNaN(Number(val))) return "—";
    return Number(val).toLocaleString("en-IN", {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
  }

  function formatPct(val) {
    if (val === null || val === undefined || Number.isNaN(Number(val))) {
      return '<span class="num-val muted-val">—</span>';
    }
    const n = Number(val);
    const cls = n > 0 ? "pos" : n < 0 ? "neg" : "";
    const sign = n > 0 ? "+" : "";
    return `<span class="num-val ${cls}">${sign}${n.toFixed(2)}%</span>`;
  }

  function formatTimestamp(iso) {
    if (!iso) return "Unknown";
    try {
      const d = new Date(iso);
      return d.toLocaleString("en-IN", {
        day: "2-digit",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });
    } catch {
      return iso;
    }
  }

  function itemKey(item) {
    if (state.assetClass === "etf") return `etf|${item.symbol}`;
    return `mf|${item.kuvera_code || item.scheme_code || ""}|${item.search_id || item.scheme_name}`;
  }

  // ---- DATA LOADERS ----
  async function loadFundsMaster() {
    let data = null;
    try {
      const res = await fetch(`./data/funds_master.json?t=${Date.now()}`, { cache: "no-store" });
      if (res.ok) data = await res.json();
    } catch {}
    if (!data && window.__INITIAL_FUNDS_MASTER__) data = window.__INITIAL_FUNDS_MASTER__;
    if (!data) throw new Error("Failed to load funds_master.json");

    const fetchedAt = data.fetched_at || new Date().toISOString();
    const grouped = {};
    for (const t of FUND_TAB_ORDER) grouped[t] = [];
    for (const f of data.funds || []) {
      const t = f.tab || "Active - Equity Funds";
      if (!grouped[t]) grouped[t] = [];
      grouped[t].push(f);
    }
    state.fundsByTab = grouped;
    state.fundTabs = FUND_TAB_ORDER.map((t) => ({
      name: t,
      count: (grouped[t] || []).length,
    }));
    for (const t of FUND_TAB_ORDER) {
      if (!state.fundTabRefreshed[t]) state.fundTabRefreshed[t] = fetchedAt;
    }
    state.totalFunds = data.total_funds || (data.funds || []).length;
  }

  async function loadEtfsMaster() {
    let data = null;
    try {
      const res = await fetch(`./data/etfs_master.json?t=${Date.now()}`, { cache: "no-store" });
      if (res.ok) data = await res.json();
    } catch {}
    if (!data && window.__INITIAL_ETFS_MASTER__) data = window.__INITIAL_ETFS_MASTER__;
    if (!data) throw new Error("Failed to load etfs_master.json");

    const fetchedAt = data.fetched_at || new Date().toISOString();
    const grouped = {};
    for (const t of ETF_TAB_ORDER) grouped[t] = [];
    for (const e of data.etfs || []) {
      const t = e.tab || "ETF - Bank & Sectoral";
      if (!grouped[t]) grouped[t] = [];
      grouped[t].push(e);
    }
    state.etfsByTab = grouped;
    state.etfTabs = ETF_TAB_ORDER.map((t) => ({
      name: t,
      count: (grouped[t] || []).length,
    }));
    for (const t of ETF_TAB_ORDER) {
      if (!state.etfTabRefreshed[t]) state.etfTabRefreshed[t] = fetchedAt;
    }
    state.totalEtfs = data.total_etfs || (data.etfs || []).length;
  }

  // ---- LIVE EXPAND FETCHERS ----
  function parseKuveraNavHistory(rawNavs) {
    if (!Array.isArray(rawNavs)) return [];
    const parsed = [];
    for (const pair of rawNavs) {
      if (!Array.isArray(pair) || pair.length < 2) continue;
      const ts = Number(pair[0]);
      const nav = Number(pair[1]);
      if (Number.isNaN(ts) || Number.isNaN(nav) || nav <= 0) continue;
      parsed.push({ date: new Date(ts * 1000).toISOString().slice(0, 10), nav: Math.round(nav * 10000) / 10000 });
    }
    parsed.sort((a, b) => a.date.localeCompare(b.date));
    return parsed;
  }

  async function fetchLiveFund(fund) {
    const kcode = fund.kuvera_code;
    if (!kcode) {
      return {
        fetched_at: new Date().toISOString(),
        sources: ["Daily Snapshot"],
        live: {
          title: fund.scheme_name,
          subtitle: fund.fund_house,
          nav: fund.nav,
          nav_date: "Latest",
          aum_cr: fund.aum_cr,
          expense_ratio: fund.expense_ratio,
          exit_load: fund.exit_load,
          cagr_1y: fund.cagr_1y,
          cagr_3y: fund.cagr_3y,
          cagr_5y: fund.cagr_5y,
          risk: fund.risk,
          fund_manager: fund.fund_manager,
          min_sip: fund.min_sip,
          min_lumpsum: fund.min_lumpsum,
          external_url: fund.search_id ? `https://groww.in/mutual-funds/${fund.search_id}` : "",
          external_label: "Open full scheme page on Groww →",
        },
        nav_history: [],
      };
    }

    const [schemeRes, navRes] = await Promise.all([
      fetch(`https://api.kuvera.in/mf/api/v5/fund_schemes/${encodeURIComponent(kcode)}.json`, { cache: "no-store" }),
      fetch(`https://api.kuvera.in/mf/api/v5/fund_navs/${encodeURIComponent(kcode)}.json`, { cache: "no-store" }),
    ]);
    if (!schemeRes.ok) throw new Error(`Kuvera API returned ${schemeRes.status}`);
    const schemeArr = await schemeRes.json();
    const k = Array.isArray(schemeArr) ? schemeArr[0] || {} : schemeArr || {};
    const navRaw = navRes.ok ? await navRes.json() : [];
    const history = parseKuveraNavHistory(navRaw);

    const navObj = k.nav || {};
    const lastNavObj = k.last_nav || {};
    const liveNav = navObj.nav != null ? Number(navObj.nav) : (history.length ? history[history.length - 1].nav : fund.nav);
    const prevNav = lastNavObj.nav != null ? Number(lastNavObj.nav) : (history.length >= 2 ? history[history.length - 2].nav : null);
    const change1d = liveNav && prevNav && prevNav > 0 ? Math.round(((liveNav - prevNav) / prevNav) * 10000) / 100 : null;
    const rets = k.returns || {};

    return {
      fetched_at: new Date().toISOString(),
      sources: ["Kuvera Live"],
      live: {
        title: k.name || fund.scheme_name,
        subtitle: k.fund_house || fund.fund_house,
        code_label: fund.scheme_code ? `AMFI: ${fund.scheme_code}` : `Kuvera: ${kcode}`,
        nav: liveNav,
        nav_date: navObj.date || (history.length ? history[history.length - 1].date : ""),
        change_1d_pct: change1d,
        aum_cr: k.aum != null ? Math.round((Number(k.aum) / 10) * 100) / 100 : fund.aum_cr,
        expense_ratio: k.expense_ratio != null ? Number(k.expense_ratio) : fund.expense_ratio,
        exit_load: fund.exit_load || "Nil",
        cagr_1y: rets.year_1 != null ? Math.round(Number(rets.year_1) * 100) / 100 : fund.cagr_1y,
        cagr_3y: rets.year_3 != null ? Math.round(Number(rets.year_3) * 100) / 100 : fund.cagr_3y,
        cagr_5y: rets.year_5 != null ? Math.round(Number(rets.year_5) * 100) / 100 : fund.cagr_5y,
        risk: fund.risk || "—",
        fund_manager: k.fund_manager || fund.fund_manager || "—",
        min_sip: k.sip_min != null ? Number(k.sip_min) : fund.min_sip,
        min_lumpsum: k.lump_min != null ? Number(k.lump_min) : fund.min_lumpsum,
        external_url: fund.search_id ? `https://groww.in/mutual-funds/${fund.search_id}` : "",
        external_label: "Open full scheme page on Groww →",
      },
      nav_history: history,
    };
  }

  async function fetchLiveEtf(etf) {
    const res = await fetch(`/api/etf-live?symbol=${encodeURIComponent(etf.symbol)}`, { cache: "no-store" });
    if (!res.ok) throw new Error(`Live ETF API returned ${res.status}`);
    const payload = await res.json();
    const lv = payload.live || {};
    return {
      fetched_at: payload.fetched_at || new Date().toISOString(),
      sources: payload.sources || ["NSE / Yahoo Finance Live"],
      is_etf: true,
      live: {
        title: `${etf.symbol} — ${etf.name}`,
        subtitle: lv.name || etf.name,
        code_label: `NSE: ${etf.symbol}`,
        nav: lv.price != null ? lv.price : etf.ltp,
        inav: etf.nav,
        nav_date: lv.price_date || etf.nav_date || "Latest",
        change_1d_pct: lv.change_1d_pct != null ? lv.change_1d_pct : etf.change_1d_pct,
        cagr_1y: lv.cagr_1y != null ? lv.cagr_1y : etf.cagr_1y,
        cagr_3y: lv.cagr_3y != null ? lv.cagr_3y : etf.cagr_3y,
        cagr_5y: lv.cagr_5y != null ? lv.cagr_5y : etf.cagr_5y,
        week_52_high: lv.week_52_high != null ? lv.week_52_high : etf.week_52_high,
        week_52_low: lv.week_52_low != null ? lv.week_52_low : etf.week_52_low,
        volume: lv.volume != null ? lv.volume : etf.volume,
        traded_val_cr: etf.traded_val_cr,
        external_url: lv.nse_url || `https://www.nseindia.com/get-quotes/equity?symbol=${encodeURIComponent(etf.symbol)}`,
        external_label: "Open live quote on NSE India →",
      },
      nav_history: payload.nav_history || [],
    };
  }

  // ---- INIT & ASSET CLASS SWITCHING ----
  async function init() {
    bindEvents();
    await Promise.all([
      loadFundsMaster().catch((e) => console.error(e)),
      loadEtfsMaster().catch((e) => console.error(e)),
    ]);
    await switchAssetClass("funds");
  }

  function bindEvents() {
    els.assetClassSelect.addEventListener("change", (e) => switchAssetClass(e.target.value));

    els.searchInput.addEventListener("input", (e) => {
      state.searchQuery = e.target.value.trim().toLowerCase();
      renderTable();
    });

    els.sortSelect.addEventListener("change", (e) => {
      state.sortBy = e.target.value;
      if (state.sortBy === "scheme_name" || state.sortBy === "symbol" || state.sortBy === "expense_ratio") {
        state.sortDir = "asc";
      } else {
        state.sortDir = "desc";
      }
      updateSortUI();
      renderTable();
    });

    els.sortDirBtn.addEventListener("click", () => {
      state.sortDir = state.sortDir === "desc" ? "asc" : "desc";
      updateSortUI();
      renderTable();
    });

    els.refreshTabBtn.addEventListener("click", refreshCurrentTab);
  }

  async function switchAssetClass(cls) {
    state.assetClass = cls;
    state.expandedKey = null;
    state.searchQuery = "";
    els.searchInput.value = "";

    if (cls === "equity") {
      els.totalItemsLabel.textContent = "Equities";
      els.totalFundsCount.textContent = "0";
      els.totalTabsCount.textContent = "0";
      els.tabsShell.style.display = "none";
      els.toolbarSection.style.display = "none";
      els.tableCard.style.display = "none";
      els.equityEmptyCard.style.display = "block";
      return;
    }

    els.tabsShell.style.display = "";
    els.toolbarSection.style.display = "";
    els.tableCard.style.display = "";
    els.equityEmptyCard.style.display = "none";

    if (cls === "funds") {
      els.totalItemsLabel.textContent = "Total Funds";
      els.totalFundsCount.textContent = state.totalFunds.toLocaleString("en-IN");
      els.totalTabsCount.textContent = String(state.fundTabs.length);
      els.searchInput.placeholder = "Search fund, AMC, or sub-category...";
      els.freshnessHint.textContent = "· Expand any fund for live NAV & chart";
      populateSortOptions(FUND_SORT_OPTIONS, "aum_cr");
      renderTableHeader();
      renderTabs();
      if (state.fundTabs.length) await selectTab(state.fundTabs[0].name);
    } else if (cls === "etf") {
      els.totalItemsLabel.textContent = "Total ETFs";
      els.totalFundsCount.textContent = state.totalEtfs.toLocaleString("en-IN");
      els.totalTabsCount.textContent = String(state.etfTabs.length);
      els.searchInput.placeholder = "Search ETF symbol or underlying index...";
      els.freshnessHint.textContent = "· Expand any ETF for live price & chart";
      populateSortOptions(ETF_SORT_OPTIONS, "traded_val_cr");
      renderTableHeader();
      renderTabs();
      if (state.etfTabs.length) await selectTab(state.etfTabs[0].name);
    }
  }

  function populateSortOptions(opts, defaultVal) {
    els.sortSelect.innerHTML = opts
      .map((o) => `<option value="${escapeHtml(o.value)}">${escapeHtml(o.label)}</option>`)
      .join("");
    state.sortBy = defaultVal;
    state.sortDir = "desc";
    els.sortSelect.value = defaultVal;
  }

  function renderTableHeader() {
    if (state.assetClass === "funds") {
      els.fundsTableHead.innerHTML = `
        <tr>
          <th class="col-fund sortable" data-sort="scheme_name"><span>Fund Name &amp; AMC</span><span class="th-arrow"></span></th>
          <th class="col-num sortable" data-sort="aum_cr"><span>AUM (₹ Cr)</span><span class="th-arrow"></span></th>
          <th class="col-num sortable" data-sort="expense_ratio"><span>Expense Ratio</span><span class="th-arrow"></span></th>
          <th class="col-num sortable" data-sort="cagr_1y"><span>1Y CAGR</span><span class="th-arrow"></span></th>
          <th class="col-num sortable" data-sort="cagr_3y"><span>3Y CAGR</span><span class="th-arrow"></span></th>
          <th class="col-num sortable" data-sort="cagr_5y"><span>5Y CAGR</span><span class="th-arrow"></span></th>
          <th class="col-num sortable" data-sort="nav"><span>NAV (₹)</span><span class="th-arrow"></span></th>
          <th class="col-exit"><span>Exit Load</span></th>
        </tr>
      `;
    } else {
      els.fundsTableHead.innerHTML = `
        <tr>
          <th class="col-fund sortable" data-sort="symbol"><span>ETF Symbol &amp; Underlying</span><span class="th-arrow"></span></th>
          <th class="col-num sortable" data-sort="ltp"><span>LTP (₹)</span><span class="th-arrow"></span></th>
          <th class="col-num sortable" data-sort="nav"><span>iNAV (₹)</span><span class="th-arrow"></span></th>
          <th class="col-num sortable" data-sort="change_1d_pct"><span>1D Change</span><span class="th-arrow"></span></th>
          <th class="col-num sortable" data-sort="cagr_1y"><span>1Y CAGR</span><span class="th-arrow"></span></th>
          <th class="col-num sortable" data-sort="cagr_3y"><span>3Y CAGR</span><span class="th-arrow"></span></th>
          <th class="col-num sortable" data-sort="cagr_5y"><span>5Y CAGR</span><span class="th-arrow"></span></th>
          <th class="col-num sortable" data-sort="traded_val_cr"><span>Traded Val (₹ Cr)</span><span class="th-arrow"></span></th>
        </tr>
      `;
    }

    els.fundsTableHead.querySelectorAll("th.sortable").forEach((th) => {
      th.addEventListener("click", () => {
        const col = th.dataset.sort;
        if (state.sortBy === col) {
          state.sortDir = state.sortDir === "desc" ? "asc" : "desc";
        } else {
          state.sortBy = col;
          state.sortDir = col === "scheme_name" || col === "symbol" || col === "expense_ratio" ? "asc" : "desc";
        }
        if ([...els.sortSelect.options].some((o) => o.value === col)) {
          els.sortSelect.value = col;
        }
        updateSortUI();
        renderTable();
      });
    });
  }

  function updateSortUI() {
    els.sortDirLabel.textContent = state.sortDir === "desc" ? "Desc" : "Asc";
    els.sortDirIcon.style.transform = state.sortDir === "asc" ? "rotate(180deg)" : "rotate(0deg)";

    els.fundsTableHead.querySelectorAll("th.sortable").forEach((th) => {
      const arrow = th.querySelector(".th-arrow");
      if (th.dataset.sort === state.sortBy) {
        th.classList.add("sorted");
        arrow.textContent = state.sortDir === "desc" ? "▼" : "▲";
      } else {
        th.classList.remove("sorted");
        arrow.textContent = "";
      }
    });
  }

  function renderTabs() {
    const tabs = state.assetClass === "funds" ? state.fundTabs : state.etfTabs;
    els.tabsContainer.innerHTML = tabs
      .map((t) => {
        const active = t.name === state.activeTab ? "active" : "";
        return `
          <button type="button" class="tab-btn ${active}" role="tab" aria-selected="${active ? "true" : "false"}" data-tab="${escapeHtml(t.name)}">
            <span>${escapeHtml(t.name)}</span>
            <span class="tab-count mono">${t.count}</span>
          </button>
        `;
      })
      .join("");

    els.tabsContainer.querySelectorAll(".tab-btn").forEach((btn) => {
      btn.addEventListener("click", () => selectTab(btn.dataset.tab));
    });
  }

  async function selectTab(tabName) {
    state.activeTab = tabName;
    state.expandedKey = null;
    state.searchQuery = "";
    els.searchInput.value = "";
    renderTabs();

    els.activeTabTitle.textContent = tabName;
    if (state.assetClass === "funds") {
      state.items = state.fundsByTab[tabName] || [];
      state.lastRefreshed = state.fundTabRefreshed[tabName];
    } else {
      state.items = state.etfsByTab[tabName] || [];
      state.lastRefreshed = state.etfTabRefreshed[tabName];
    }

    const unit = state.assetClass === "funds" ? "funds" : "ETFs";
    els.activeTabCount.textContent = `${state.items.length} ${unit}`;
    els.lastRefreshedText.textContent = `Last refreshed: ${formatTimestamp(state.lastRefreshed)}`;
    updateSortUI();
    renderTable();
  }

  async function refreshCurrentTab() {
    if (!state.activeTab) return;
    els.refreshTabBtn.disabled = true;
    els.refreshTabBtn.classList.add("spinning");
    els.refreshBtnLabel.textContent = "Fetching live...";

    try {
      if (state.assetClass === "funds") {
        try { await loadFundsMaster(); } catch {}
        const items = state.fundsByTab[state.activeTab] || [];
        const kRes = await fetch("https://api.kuvera.in/mf/api/v4/fund_schemes/list.json", { cache: "no-store" });
        if (kRes.ok) {
          const kl = await kRes.json();
          const byCode = {};
          for (const subs of Object.values(kl || {})) {
            if (!subs || typeof subs !== "object") continue;
            for (const amcs of Object.values(subs)) {
              if (!amcs || typeof amcs !== "object") continue;
              for (const schemes of Object.values(amcs)) {
                if (!Array.isArray(schemes)) continue;
                for (const sc of schemes) {
                  if (sc && sc.c && sc.r) byCode[sc.c] = sc.r;
                }
              }
            }
          }
          for (const f of items) {
            const r = f.kuvera_code && byCode[f.kuvera_code];
            if (r) {
              if (r["1"] != null) f.cagr_1y = Math.round(Number(r["1"]) * 100) / 100;
              if (r["3"] != null) f.cagr_3y = Math.round(Number(r["3"]) * 100) / 100;
              if (r["5"] != null) f.cagr_5y = Math.round(Number(r["5"]) * 100) / 100;
            }
          }
        }
        const nowIso = new Date().toISOString();
        state.fundsByTab[state.activeTab] = items;
        state.fundTabRefreshed[state.activeTab] = nowIso;
        state.items = items;
        state.lastRefreshed = nowIso;
      } else if (state.assetClass === "etf") {
        try { await loadEtfsMaster(); } catch {}
        const items = state.etfsByTab[state.activeTab] || [];
        const r = await fetch("/api/etf-refresh", { cache: "no-store" });
        if (!r.ok) throw new Error(`ETF refresh returned ${r.status}`);
        const liveData = await r.json();
        const bySym = liveData.by_symbol || {};
        for (const e of items) {
          const lv = bySym[e.symbol];
          if (lv) {
            if (lv.ltp != null) e.ltp = lv.ltp;
            if (lv.nav != null) e.nav = lv.nav;
            if (lv.change_1d_pct != null) e.change_1d_pct = lv.change_1d_pct;
            if (lv.volume != null) e.volume = lv.volume;
            if (lv.traded_val_cr != null) e.traded_val_cr = lv.traded_val_cr;
            if (lv.week_52_high != null) e.week_52_high = lv.week_52_high;
            if (lv.week_52_low != null) e.week_52_low = lv.week_52_low;
          }
        }
        const nowIso = new Date().toISOString();
        state.etfsByTab[state.activeTab] = items;
        state.etfTabRefreshed[state.activeTab] = nowIso;
        state.items = items;
        state.lastRefreshed = nowIso;
      }

      state.expandedKey = null;
      els.lastRefreshedText.textContent = `Last refreshed: ${formatTimestamp(state.lastRefreshed)}`;
      renderTable();
      showToast(`Refreshed ${state.activeTab} with live market data`);
    } catch (err) {
      showToast(`Refresh failed: ${err.message}`);
    } finally {
      els.refreshTabBtn.disabled = false;
      els.refreshTabBtn.classList.remove("spinning");
      els.refreshBtnLabel.textContent = "Refresh Tab";
    }
  }

  function getFilteredAndSortedItems() {
    let list = state.items;
    if (state.searchQuery) {
      const q = state.searchQuery;
      if (state.assetClass === "funds") {
        list = list.filter(
          (f) =>
            (f.scheme_name || "").toLowerCase().includes(q) ||
            (f.fund_house || "").toLowerCase().includes(q) ||
            (f.sub_category || "").toLowerCase().includes(q)
        );
      } else {
        list = list.filter(
          (e) =>
            (e.symbol || "").toLowerCase().includes(q) ||
            (e.name || "").toLowerCase().includes(q)
        );
      }
    }

    const col = state.sortBy;
    const mult = state.sortDir === "desc" ? -1 : 1;

    return [...list].sort((a, b) => {
      if (col === "scheme_name" || col === "symbol") {
        return String(a[col] || "").localeCompare(String(b[col] || "")) * mult;
      }
      const va = a[col];
      const vb = b[col];
      const aNull = va === null || va === undefined || Number.isNaN(Number(va));
      const bNull = vb === null || vb === undefined || Number.isNaN(Number(vb));
      if (aNull && bNull) return 0;
      if (aNull) return 1;
      if (bNull) return -1;
      return (Number(va) - Number(vb)) * mult;
    });
  }

  function renderTable() {
    const rows = getFilteredAndSortedItems();
    const unit = state.assetClass === "funds" ? "funds" : "ETFs";
    els.activeTabCount.textContent =
      state.searchQuery ? `${rows.length} of ${state.items.length} ${unit}` : `${rows.length} ${unit}`;

    if (rows.length === 0) {
      els.fundsTableBody.innerHTML = `<tr><td colspan="8" class="empty-state">No ${unit} match your filter.</td></tr>`;
      return;
    }

    const html = [];
    for (const item of rows) {
      const key = itemKey(item);
      const isExpanded = state.expandedKey === key;

      if (state.assetClass === "funds") {
        html.push(`
          <tr class="fund-row ${isExpanded ? "expanded" : ""}" data-key="${escapeHtml(key)}">
            <td>
              <div class="fund-cell">
                <svg class="chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>
                <div>
                  <div class="fund-name">${escapeHtml(item.scheme_name)}</div>
                  <div class="fund-meta">
                    <span>${escapeHtml(item.fund_house)}</span>
                    ${item.sub_category ? `<span class="subcat-pill">${escapeHtml(item.sub_category)}</span>` : ""}
                  </div>
                </div>
              </div>
            </td>
            <td class="col-num"><span class="num-val">${item.aum_cr != null ? "₹" + formatNumber(item.aum_cr, 2) : "—"}</span></td>
            <td class="col-num"><span class="num-val">${item.expense_ratio != null ? formatNumber(item.expense_ratio, 2) + "%" : "—"}</span></td>
            <td class="col-num">${formatPct(item.cagr_1y)}</td>
            <td class="col-num">${formatPct(item.cagr_3y)}</td>
            <td class="col-num">${formatPct(item.cagr_5y)}</td>
            <td class="col-num"><span class="num-val">${item.nav != null ? "₹" + formatNumber(item.nav, 2) : "—"}</span></td>
            <td class="exit-load-cell">${escapeHtml(item.exit_load || "Nil")}</td>
          </tr>
        `);
      } else {
        html.push(`
          <tr class="fund-row ${isExpanded ? "expanded" : ""}" data-key="${escapeHtml(key)}">
            <td>
              <div class="fund-cell">
                <svg class="chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>
                <div>
                  <div class="fund-name">
                    <span class="etf-symbol-badge">${escapeHtml(item.symbol)}</span>
                    <span>${escapeHtml(item.name)}</span>
                  </div>
                  <div class="fund-meta">
                    <span>NSE ETF</span>
                    ${item.week_52_low != null && item.week_52_high != null ? `<span>&middot; 52W: ₹${formatNumber(item.week_52_low, 2)} – ₹${formatNumber(item.week_52_high, 2)}</span>` : ""}
                  </div>
                </div>
              </div>
            </td>
            <td class="col-num"><span class="num-val">${item.ltp != null ? "₹" + formatNumber(item.ltp, 2) : "—"}</span></td>
            <td class="col-num"><span class="num-val">${item.nav != null ? "₹" + formatNumber(item.nav, 2) : "—"}</span></td>
            <td class="col-num">${formatPct(item.change_1d_pct)}</td>
            <td class="col-num">${formatPct(item.cagr_1y)}</td>
            <td class="col-num">${formatPct(item.cagr_3y)}</td>
            <td class="col-num">${formatPct(item.cagr_5y)}</td>
            <td class="col-num"><span class="num-val">${item.traded_val_cr != null ? "₹" + formatNumber(item.traded_val_cr, 2) : "—"}</span></td>
          </tr>
        `);
      }

      if (isExpanded) {
        html.push(`
          <tr class="detail-row">
            <td colspan="8">
              <div class="detail-panel" id="activeDetailPanel">
                <div class="detail-loading">
                  <div class="spinner"></div>
                  <span>Fetching live ${state.assetClass === "funds" ? "NAV & details" : "NSE price & historical chart"}...</span>
                </div>
              </div>
            </td>
          </tr>
        `);
      }
    }

    els.fundsTableBody.innerHTML = html.join("");

    els.fundsTableBody.querySelectorAll(".fund-row").forEach((tr) => {
      tr.addEventListener("click", () => {
        const key = tr.dataset.key;
        const item = rows.find((x) => itemKey(x) === key);
        if (!item) return;
        if (state.expandedKey === key) {
          state.expandedKey = null;
          renderTable();
        } else {
          state.expandedKey = key;
          renderTable();
          loadLiveDetail(item);
        }
      });
    });
  }

  async function loadLiveDetail(item) {
    const panel = document.getElementById("activeDetailPanel");
    if (!panel) return;
    const expectedKey = itemKey(item);
    try {
      const payload = state.assetClass === "funds" ? await fetchLiveFund(item) : await fetchLiveEtf(item);
      if (state.expandedKey !== expectedKey) return;
      renderLiveDetailPanel(panel, payload);
    } catch (err) {
      if (state.expandedKey !== expectedKey) return;
      panel.innerHTML = `<div class="empty-state">Unable to load live data: ${escapeHtml(err.message)}</div>`;
    }
  }

  function renderLiveDetailPanel(panel, payload) {
    const live = payload.live || {};
    const history = payload.nav_history || [];
    const change1d = live.change_1d_pct;
    const change1dHtml =
      change1d != null
        ? `<span class="${change1d >= 0 ? "pos" : "neg"} mono">${change1d >= 0 ? "+" : ""}${Number(change1d).toFixed(2)}% (1D)</span>`
        : "";

    const metricsHtml = payload.is_etf
      ? `
        <div class="metrics-grid">
          <div class="metric-item"><div class="metric-label">Live LTP</div><div class="metric-value mono">${live.nav != null ? "₹" + formatNumber(live.nav, 2) : "—"}</div></div>
          <div class="metric-item"><div class="metric-label">iNAV (NSE)</div><div class="metric-value mono">${live.inav != null ? "₹" + formatNumber(live.inav, 2) : "—"}</div></div>
          <div class="metric-item"><div class="metric-label">Live 1Y / 3Y / 5Y CAGR</div><div class="metric-value mono">${live.cagr_1y != null ? live.cagr_1y.toFixed(1) + "%" : "—"} / ${live.cagr_3y != null ? live.cagr_3y.toFixed(1) + "%" : "—"} / ${live.cagr_5y != null ? live.cagr_5y.toFixed(1) + "%" : "—"}</div></div>
          <div class="metric-item"><div class="metric-label">52-Week Range</div><div class="metric-value mono">${live.week_52_low != null ? "₹" + formatNumber(live.week_52_low, 2) : "—"} – ${live.week_52_high != null ? "₹" + formatNumber(live.week_52_high, 2) : "—"}</div></div>
          <div class="metric-item"><div class="metric-label">Volume</div><div class="metric-value mono">${live.volume != null ? Number(live.volume).toLocaleString("en-IN") : "—"}</div></div>
          <div class="metric-item"><div class="metric-label">Traded Value</div><div class="metric-value mono">${live.traded_val_cr != null ? "₹" + formatNumber(live.traded_val_cr, 2) + " Cr" : "—"}</div></div>
        </div>
      `
      : `
        <div class="metrics-grid">
          <div class="metric-item"><div class="metric-label">Live AUM</div><div class="metric-value mono">${live.aum_cr != null ? "₹" + formatNumber(live.aum_cr, 2) + " Cr" : "—"}</div></div>
          <div class="metric-item"><div class="metric-label">Expense Ratio</div><div class="metric-value mono">${live.expense_ratio != null ? formatNumber(live.expense_ratio, 2) + "%" : "—"}</div></div>
          <div class="metric-item"><div class="metric-label">Live 1Y / 3Y / 5Y CAGR</div><div class="metric-value mono">${live.cagr_1y != null ? live.cagr_1y.toFixed(1) + "%" : "—"} / ${live.cagr_3y != null ? live.cagr_3y.toFixed(1) + "%" : "—"} / ${live.cagr_5y != null ? live.cagr_5y.toFixed(1) + "%" : "—"}</div></div>
          <div class="metric-item"><div class="metric-label">Riskometer</div><div class="metric-value">${escapeHtml(live.risk || "—")}</div></div>
          <div class="metric-item"><div class="metric-label">Min SIP / Lumpsum</div><div class="metric-value mono">${live.min_sip != null ? "₹" + formatNumber(live.min_sip, 0) : "—"} / ${live.min_lumpsum != null ? "₹" + formatNumber(live.min_lumpsum, 0) : "—"}</div></div>
          <div class="metric-item"><div class="metric-label">Fund Manager</div><div class="metric-value">${escapeHtml(live.fund_manager || "—")}</div></div>
        </div>
        <div class="exit-box">
          <strong>Exit Load &amp; Stamp Duty</strong>
          ${escapeHtml(live.exit_load || "Nil")} &middot; Stamp duty: 0.005%
        </div>
      `;

    panel.innerHTML = `
      <div class="detail-header">
        <div>
          <div class="live-badge">
            <span class="live-dot"></span>
            <span>LIVE DATA &middot; ${(payload.sources || ["Live"]).join(" + ")} &middot; ${formatTimestamp(payload.fetched_at)}</span>
          </div>
          <div class="detail-title">${escapeHtml(live.title)}</div>
          <div class="fund-meta" style="margin-top:4px;">
            <span>${escapeHtml(live.subtitle)}</span>
            ${live.code_label ? `<span>&middot; <span class="mono">${escapeHtml(live.code_label)}</span></span>` : ""}
          </div>
        </div>
        <div class="detail-nav-block">
          <div class="detail-nav-value mono">${live.nav != null ? "₹" + formatNumber(live.nav, payload.is_etf ? 2 : 4) : "—"}</div>
          <div class="detail-nav-sub">
            ${payload.is_etf ? "LTP" : "NAV"} as of ${escapeHtml(live.nav_date || "Latest")} ${change1dHtml ? "&middot; " + change1dHtml : ""}
          </div>
        </div>
      </div>

      <div class="detail-grid">
        <div class="chart-card">
          <div class="chart-top">
            <div class="chart-return-box">
              <span class="chart-return-pct mono" id="chartReturnPct">--</span>
              <span class="chart-return-label" id="chartReturnLabel">Selected period</span>
            </div>
            <div class="range-pills" id="rangePills">
              <button type="button" class="range-btn" data-range="1M">1M</button>
              <button type="button" class="range-btn" data-range="6M">6M</button>
              <button type="button" class="range-btn" data-range="1Y">1Y</button>
              <button type="button" class="range-btn active" data-range="3Y">3Y</button>
              <button type="button" class="range-btn" data-range="5Y">5Y</button>
              <button type="button" class="range-btn" data-range="ALL">ALL</button>
            </div>
          </div>
          <div class="canvas-wrap">
            <canvas id="navChartCanvas" class="nav-canvas"></canvas>
            <div id="chartTooltip" class="chart-tooltip mono"></div>
          </div>
        </div>

        <div class="info-card">
          ${metricsHtml}
          ${live.external_url ? `<a class="groww-link" href="${escapeHtml(live.external_url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(live.external_label)}</a>` : ""}
        </div>
      </div>
    `;

    initNavChart(panel, history, payload.is_etf ? "Price" : "NAV");
  }

  function filterHistoryByRange(history, rangeKey) {
    if (!history || history.length === 0) return [];
    if (rangeKey === "ALL") return history;
    const latest = new Date(history[history.length - 1].date);
    const cutoff = new Date(latest);
    if (rangeKey === "1M") cutoff.setMonth(cutoff.getMonth() - 1);
    else if (rangeKey === "6M") cutoff.setMonth(cutoff.getMonth() - 6);
    else if (rangeKey === "1Y") cutoff.setFullYear(cutoff.getFullYear() - 1);
    else if (rangeKey === "3Y") cutoff.setFullYear(cutoff.getFullYear() - 3);
    else if (rangeKey === "5Y") cutoff.setFullYear(cutoff.getFullYear() - 5);
    const filtered = history.filter((pt) => new Date(pt.date) >= cutoff);
    return filtered.length >= 2 ? filtered : history;
  }

  function initNavChart(panel, fullHistory, valueLabel) {
    const canvas = panel.querySelector("#navChartCanvas");
    const tooltip = panel.querySelector("#chartTooltip");
    const retPctEl = panel.querySelector("#chartReturnPct");
    const retLabelEl = panel.querySelector("#chartReturnLabel");
    const pills = panel.querySelectorAll(".range-btn");

    let currentRange = "3Y";
    if (fullHistory.length < 250) currentRange = "ALL";
    else if (fullHistory.length < 700) currentRange = "1Y";
    pills.forEach((b) => b.classList.toggle("active", b.dataset.range === currentRange));

    let currentPts = [];
    let coords = [];

    function renderRange(rangeKey) {
      currentRange = rangeKey;
      currentPts = filterHistoryByRange(fullHistory, rangeKey);
      if (currentPts.length < 2) {
        retPctEl.textContent = "No history";
        retPctEl.className = "chart-return-pct mono muted-val";
        retLabelEl.textContent = "";
        drawChart(null);
        return;
      }

      const first = currentPts[0];
      const last = currentPts[currentPts.length - 1];
      const absRet = ((last.nav - first.nav) / first.nav) * 100;
      const days = Math.max(1, (new Date(last.date) - new Date(first.date)) / 86400000);
      const years = days / 365.25;

      let displayVal = absRet;
      let suffix = `${rangeKey} return`;
      if (years >= 1.05 && rangeKey !== "1M" && rangeKey !== "6M") {
        displayVal = (Math.pow(last.nav / first.nav, 1 / years) - 1) * 100;
        suffix = `${rangeKey} CAGR (${absRet >= 0 ? "+" : ""}${absRet.toFixed(1)}% abs)`;
      }

      retPctEl.textContent = `${displayVal >= 0 ? "+" : ""}${displayVal.toFixed(2)}%`;
      retPctEl.className = `chart-return-pct mono ${displayVal >= 0 ? "pos" : "neg"}`;
      retLabelEl.textContent = `${suffix} · ${first.date} to ${last.date}`;
      drawChart(null);
    }

    function drawChart(hoverIdx) {
      const rect = canvas.parentElement.getBoundingClientRect();
      const width = Math.max(300, rect.width);
      const height = Math.max(200, rect.height);
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      const ctx = canvas.getContext("2d");
      ctx.scale(dpr, dpr);
      ctx.clearRect(0, 0, width, height);

      if (currentPts.length < 2) {
        ctx.fillStyle = "#64748b";
        ctx.font = "13px Plus Jakarta Sans, sans-serif";
        ctx.textAlign = "center";
        ctx.fillText("Historical chart unavailable for this item.", width / 2, height / 2);
        return;
      }

      const pad = { top: 18, right: 14, bottom: 28, left: 56 };
      const plotW = width - pad.left - pad.right;
      const plotH = height - pad.top - pad.bottom;

      const vals = currentPts.map((p) => p.nav);
      let minV = Math.min(...vals);
      let maxV = Math.max(...vals);
      if (minV === maxV) { minV *= 0.98; maxV *= 1.02; }
      const span = maxV - minV;
      minV -= span * 0.06;
      maxV += span * 0.06;

      const isUp = currentPts[currentPts.length - 1].nav >= currentPts[0].nav;
      const strokeColor = isUp ? "#00a878" : "#dc2626";
      const fillTop = isUp ? "rgba(0, 168, 120, 0.22)" : "rgba(220, 38, 38, 0.18)";
      const fillBottom = isUp ? "rgba(0, 168, 120, 0.01)" : "rgba(220, 38, 38, 0.01)";

      ctx.strokeStyle = "#edf2f7";
      ctx.lineWidth = 1;
      ctx.fillStyle = "#64748b";
      ctx.font = "11px JetBrains Mono, monospace";
      ctx.textAlign = "right";
      ctx.textBaseline = "middle";
      const gridSteps = 4;
      for (let i = 0; i <= gridSteps; i++) {
        const y = pad.top + (plotH * i) / gridSteps;
        const val = maxV - ((maxV - minV) * i) / gridSteps;
        ctx.beginPath();
        ctx.moveTo(pad.left, y);
        ctx.lineTo(width - pad.right, y);
        ctx.stroke();
        ctx.fillText("₹" + val.toFixed(val >= 100 ? 0 : 2), pad.left - 8, y);
      }

      coords = currentPts.map((p, i) => ({
        x: pad.left + (plotW * i) / (currentPts.length - 1),
        y: pad.top + plotH - ((p.nav - minV) / (maxV - minV)) * plotH,
        pt: p,
      }));

      const grad = ctx.createLinearGradient(0, pad.top, 0, pad.top + plotH);
      grad.addColorStop(0, fillTop);
      grad.addColorStop(1, fillBottom);

      ctx.beginPath();
      ctx.moveTo(coords[0].x, pad.top + plotH);
      for (const c of coords) ctx.lineTo(c.x, c.y);
      ctx.lineTo(coords[coords.length - 1].x, pad.top + plotH);
      ctx.closePath();
      ctx.fillStyle = grad;
      ctx.fill();

      ctx.beginPath();
      coords.forEach((c, idx) => (idx === 0 ? ctx.moveTo(c.x, c.y) : ctx.lineTo(c.x, c.y)));
      ctx.strokeStyle = strokeColor;
      ctx.lineWidth = 2;
      ctx.lineJoin = "round";
      ctx.stroke();

      ctx.fillStyle = "#64748b";
      ctx.font = "11px JetBrains Mono, monospace";
      ctx.textBaseline = "top";
      [0, Math.floor(coords.length / 2), coords.length - 1].forEach((idx, pos) => {
        const c = coords[idx];
        ctx.textAlign = pos === 0 ? "left" : pos === 2 ? "right" : "center";
        ctx.fillText(c.pt.date, c.x, pad.top + plotH + 8);
      });

      if (hoverIdx != null && coords[hoverIdx]) {
        const hc = coords[hoverIdx];
        ctx.save();
        ctx.strokeStyle = "#94a3b8";
        ctx.setLineDash([4, 4]);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(hc.x, pad.top);
        ctx.lineTo(hc.x, pad.top + plotH);
        ctx.stroke();
        ctx.restore();

        ctx.beginPath();
        ctx.arc(hc.x, hc.y, 4.5, 0, Math.PI * 2);
        ctx.fillStyle = strokeColor;
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = "#ffffff";
        ctx.stroke();
      }
    }

    canvas.addEventListener("mousemove", (e) => {
      if (coords.length < 2) return;
      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      let bestIdx = 0;
      let bestDist = Infinity;
      for (let i = 0; i < coords.length; i++) {
        const d = Math.abs(coords[i].x - mx);
        if (d < bestDist) { bestDist = d; bestIdx = i; }
      }
      const c = coords[bestIdx];
      const baseNav = currentPts[0].nav;
      const chg = ((c.pt.nav - baseNav) / baseNav) * 100;
      tooltip.style.display = "block";
      tooltip.textContent = `${c.pt.date}  |  ${valueLabel}: ₹${c.pt.nav.toFixed(2)}  (${chg >= 0 ? "+" : ""}${chg.toFixed(2)}%)`;
      tooltip.style.left = `${Math.min(Math.max(10, c.x - 90), rect.width - 240)}px`;
      drawChart(bestIdx);
    });

    canvas.addEventListener("mouseleave", () => {
      tooltip.style.display = "none";
      drawChart(null);
    });

    pills.forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        pills.forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        renderRange(btn.dataset.range);
      });
    });

    renderRange(currentRange);
  }

  init();
})();
