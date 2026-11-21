(() => {
  const TAB_ORDER = [
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
  ];

  const state = {
    mode: "static", // "api" if local backend responds, "static" on GitHub Pages
    tabs: [],
    fundsByTab: {},
    tabRefreshed: {},
    activeTab: null,
    funds: [],
    lastRefreshed: null,
    searchQuery: "",
    sortBy: "aum_cr",
    sortDir: "desc",
    expandedKey: null,
  };

  const els = {
    tabsContainer: document.getElementById("tabsContainer"),
    totalFundsCount: document.getElementById("totalFundsCount"),
    totalTabsCount: document.getElementById("totalTabsCount"),
    activeTabTitle: document.getElementById("activeTabTitle"),
    activeTabCount: document.getElementById("activeTabCount"),
    lastRefreshedText: document.getElementById("lastRefreshedText"),
    searchInput: document.getElementById("searchInput"),
    sortSelect: document.getElementById("sortSelect"),
    sortDirBtn: document.getElementById("sortDirBtn"),
    sortDirLabel: document.getElementById("sortDirLabel"),
    sortDirIcon: document.getElementById("sortDirIcon"),
    refreshTabBtn: document.getElementById("refreshTabBtn"),
    refreshBtnLabel: document.getElementById("refreshBtnLabel"),
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

  function formatCagr(val) {
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

  function fundKey(f) {
    return `${f.scheme_code || ""}|${f.search_id || f.scheme_name}`;
  }

  // Parse MFAPI DD-MM-YYYY -> YYYY-MM-DD chronological array
  function parseMfapiHistory(mfapiJson) {
    const raw = (mfapiJson && mfapiJson.data) || [];
    const parsed = [];
    for (const pt of raw) {
      if (!pt.date || !pt.nav) continue;
      const parts = pt.date.split("-");
      if (parts.length !== 3) continue;
      const iso = `${parts[2]}-${parts[1]}-${parts[0]}`;
      const nav = parseFloat(pt.nav);
      if (!Number.isNaN(nav) && nav > 0) {
        parsed.push({ date: iso, nav: Math.round(nav * 10000) / 10000 });
      }
    }
    parsed.reverse(); // oldest -> newest
    return parsed;
  }

  function computeCagrFromHistory(history, years) {
    if (!history || history.length < 2) return null;
    const latest = history[history.length - 1];
    const latestMs = new Date(latest.date).getTime();
    const targetMs = latestMs - years * 365.25 * 86400000;
    // Find closest point at or before targetMs
    let match = null;
    for (let i = history.length - 2; i >= 0; i--) {
      const ms = new Date(history[i].date).getTime();
      if (ms <= targetMs) {
        match = history[i];
        break;
      }
    }
    if (!match || match.nav <= 0) return null;
    const actualYears = (latestMs - new Date(match.date).getTime()) / (365.25 * 86400000);
    if (actualYears < years * 0.85) return null;
    const cagr = (Math.pow(latest.nav / match.nav, 1 / actualYears) - 1) * 100;
    return Math.round(cagr * 100) / 100;
  }

  async function fetchLiveFromMfapi(fund) {
    if (!fund.scheme_code) {
      return {
        fetched_at: new Date().toISOString(),
        sources: ["Cached Snapshot"],
        live: {
          scheme_name: fund.scheme_name,
          fund_house: fund.fund_house,
          nav: fund.nav,
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
          groww_url: fund.search_id ? `https://groww.in/mutual-funds/${fund.search_id}` : "",
        },
        nav_history: [],
      };
    }

    const res = await fetch(`https://api.mfapi.in/mf/${encodeURIComponent(fund.scheme_code)}`, {
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`AMFI API returned ${res.status}`);
    const m = await res.json();
    const history = parseMfapiHistory(m);

    const latest = history.length >= 1 ? history[history.length - 1] : null;
    const prev = history.length >= 2 ? history[history.length - 2] : null;
    const change1d =
      latest && prev && prev.nav > 0
        ? Math.round(((latest.nav - prev.nav) / prev.nav) * 10000) / 100
        : null;

    const cagr1y = computeCagrFromHistory(history, 1);
    const cagr3y = computeCagrFromHistory(history, 3);
    const cagr5y = computeCagrFromHistory(history, 5);

    return {
      fetched_at: new Date().toISOString(),
      sources: ["AMFI / MFAPI Live"],
      live: {
        scheme_name: (m.meta && m.meta.scheme_name) || fund.scheme_name,
        fund_house: (m.meta && m.meta.fund_house) || fund.fund_house,
        category: (m.meta && m.meta.scheme_category) || fund.category,
        nav: latest ? latest.nav : fund.nav,
        nav_date: latest ? latest.date : "",
        change_1d_pct: change1d,
        aum_cr: fund.aum_cr,
        expense_ratio: fund.expense_ratio,
        exit_load: fund.exit_load,
        cagr_1y: cagr1y !== null ? cagr1y : fund.cagr_1y,
        cagr_3y: cagr3y !== null ? cagr3y : fund.cagr_3y,
        cagr_5y: cagr5y !== null ? cagr5y : fund.cagr_5y,
        risk: fund.risk,
        fund_manager: fund.fund_manager,
        min_sip: fund.min_sip,
        min_lumpsum: fund.min_lumpsum,
        stamp_duty: "0.005%",
        groww_url: fund.search_id ? `https://groww.in/mutual-funds/${fund.search_id}` : "",
        top_holdings: [],
      },
      nav_history: history,
    };
  }

  async function loadStaticMaster() {
    const res = await fetch(`./data/funds_master.json?t=${Date.now()}`, { cache: "no-store" });
    if (!res.ok) throw new Error("Failed to load funds_master.json");
    const data = await res.json();
    const fetchedAt = data.fetched_at || new Date().toISOString();
    const grouped = {};
    for (const t of TAB_ORDER) grouped[t] = [];
    for (const f of data.funds || []) {
      const t = f.tab || "Active - Equity Funds";
      if (!grouped[t]) grouped[t] = [];
      grouped[t].push(f);
    }
    state.fundsByTab = grouped;
    state.tabs = TAB_ORDER.map((t) => ({
      name: t,
      count: (grouped[t] || []).length,
      last_refreshed: (data.tab_refreshed && data.tab_refreshed[t]) || fetchedAt,
    }));
    for (const t of state.tabs) {
      state.tabRefreshed[t.name] = t.last_refreshed;
    }
    return data.total_funds || (data.funds || []).length;
  }

  async function init() {
    bindEvents();

    // Detect if local Python API backend is running; otherwise run in GitHub Pages static + Live AMFI mode
    let apiAvailable = false;
    try {
      const r = await fetch("/api/tabs", { cache: "no-store" });
      if (r.ok && (r.headers.get("content-type") || "").includes("application/json")) {
        const data = await r.json();
        if (Array.isArray(data.tabs) && data.tabs.length > 0) {
          apiAvailable = true;
          state.mode = "api";
          state.tabs = data.tabs;
          els.totalFundsCount.textContent = (data.total_funds || 0).toLocaleString("en-IN");
          els.totalTabsCount.textContent = String(state.tabs.length);
        }
      }
    } catch {
      apiAvailable = false;
    }

    if (!apiAvailable) {
      state.mode = "static";
      const total = await loadStaticMaster();
      els.totalFundsCount.textContent = total.toLocaleString("en-IN");
      els.totalTabsCount.textContent = String(state.tabs.length);
    }

    renderTabs();
    if (state.tabs.length > 0) {
      await selectTab(state.tabs[0].name);
    }
  }

  function bindEvents() {
    els.searchInput.addEventListener("input", (e) => {
      state.searchQuery = e.target.value.trim().toLowerCase();
      renderTable();
    });

    els.sortSelect.addEventListener("change", (e) => {
      state.sortBy = e.target.value;
      if (state.sortBy === "scheme_name" || state.sortBy === "expense_ratio") {
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

    document.querySelectorAll("th.sortable").forEach((th) => {
      th.addEventListener("click", () => {
        const col = th.dataset.sort;
        if (state.sortBy === col) {
          state.sortDir = state.sortDir === "desc" ? "asc" : "desc";
        } else {
          state.sortBy = col;
          state.sortDir = col === "scheme_name" || col === "expense_ratio" ? "asc" : "desc";
        }
        els.sortSelect.value = state.sortBy;
        updateSortUI();
        renderTable();
      });
    });

    els.refreshTabBtn.addEventListener("click", refreshCurrentTab);
  }

  function updateSortUI() {
    els.sortDirLabel.textContent = state.sortDir === "desc" ? "Desc" : "Asc";
    els.sortDirIcon.style.transform = state.sortDir === "asc" ? "rotate(180deg)" : "rotate(0deg)";

    document.querySelectorAll("th.sortable").forEach((th) => {
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
    els.tabsContainer.innerHTML = state.tabs
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

    if (state.mode === "api") {
      els.fundsTableBody.innerHTML = `<tr><td colspan="8" class="empty-state">Loading ${escapeHtml(tabName)}...</td></tr>`;
      const res = await fetch(`/api/funds?tab=${encodeURIComponent(tabName)}`, { cache: "no-store" });
      const data = await res.json();
      state.funds = data.funds || [];
      state.lastRefreshed = data.last_refreshed;
    } else {
      state.funds = state.fundsByTab[tabName] || [];
      state.lastRefreshed = state.tabRefreshed[tabName];
    }

    els.activeTabCount.textContent = `${state.funds.length} funds`;
    els.lastRefreshedText.textContent = `Last refreshed: ${formatTimestamp(state.lastRefreshed)}`;
    updateSortUI();
    renderTable();
  }

  async function refreshCurrentTab() {
    if (!state.activeTab) return;
    els.refreshTabBtn.disabled = true;
    els.refreshTabBtn.classList.add("spinning");
    els.refreshBtnLabel.textContent = "Refreshing...";

    try {
      if (state.mode === "api") {
        const res = await fetch(`/api/refresh?tab=${encodeURIComponent(state.activeTab)}`, {
          method: "POST",
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Refresh failed");
        state.funds = data.funds || [];
        state.lastRefreshed = data.last_refreshed;
      } else {
        // Static / GitHub Pages mode: reload latest master JSON + live-refresh NAVs & CAGRs from AMFI for this tab
        await loadStaticMaster();
        const items = state.fundsByTab[state.activeTab] || [];
        const visibleToRefresh = items.slice(0, 60); // Refresh up to top 60 funds live from AMFI in fast parallel batches
        let done = 0;
        const batchSize = 10;
        for (let i = 0; i < visibleToRefresh.length; i += batchSize) {
          const batch = visibleToRefresh.slice(i, i + batchSize);
          await Promise.all(
            batch.map(async (f) => {
              if (!f.scheme_code) return;
              try {
                const r = await fetch(`https://api.mfapi.in/mf/${encodeURIComponent(f.scheme_code)}`, {
                  cache: "no-store",
                });
                if (!r.ok) return;
                const m = await r.json();
                const hist = parseMfapiHistory(m);
                if (hist.length > 0) {
                  f.nav = Math.round(hist[hist.length - 1].nav * 100) / 100;
                  const c1 = computeCagrFromHistory(hist, 1);
                  const c3 = computeCagrFromHistory(hist, 3);
                  const c5 = computeCagrFromHistory(hist, 5);
                  if (c1 !== null) f.cagr_1y = c1;
                  if (c3 !== null) f.cagr_3y = c3;
                  if (c5 !== null) f.cagr_5y = c5;
                }
              } catch {
                // Keep snapshot value on individual network error
              } finally {
                done++;
                els.refreshBtnLabel.textContent = `Live ${done}/${visibleToRefresh.length}`;
              }
            })
          );
        }
        const nowIso = new Date().toISOString();
        state.fundsByTab[state.activeTab] = items;
        state.tabRefreshed[state.activeTab] = nowIso;
        state.funds = items;
        state.lastRefreshed = nowIso;
      }

      state.expandedKey = null;
      const tabObj = state.tabs.find((t) => t.name === state.activeTab);
      if (tabObj) tabObj.count = state.funds.length;
      renderTabs();

      els.activeTabCount.textContent = `${state.funds.length} funds`;
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

  function getFilteredAndSortedFunds() {
    let list = state.funds;
    if (state.searchQuery) {
      const q = state.searchQuery;
      list = list.filter(
        (f) =>
          (f.scheme_name || "").toLowerCase().includes(q) ||
          (f.fund_house || "").toLowerCase().includes(q) ||
          (f.sub_category || "").toLowerCase().includes(q)
      );
    }

    const col = state.sortBy;
    const mult = state.sortDir === "desc" ? -1 : 1;

    return [...list].sort((a, b) => {
      if (col === "scheme_name") {
        return (a.scheme_name || "").localeCompare(b.scheme_name || "") * mult;
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
    const rows = getFilteredAndSortedFunds();
    els.activeTabCount.textContent =
      state.searchQuery ? `${rows.length} of ${state.funds.length} funds` : `${rows.length} funds`;

    if (rows.length === 0) {
      els.fundsTableBody.innerHTML = `<tr><td colspan="8" class="empty-state">No funds match your filter.</td></tr>`;
      return;
    }

    const html = [];
    for (const f of rows) {
      const key = fundKey(f);
      const isExpanded = state.expandedKey === key;
      html.push(`
        <tr class="fund-row ${isExpanded ? "expanded" : ""}" data-key="${escapeHtml(key)}">
          <td>
            <div class="fund-cell">
              <svg class="chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="9 18 15 12 9 6"></polyline>
              </svg>
              <div>
                <div class="fund-name">${escapeHtml(f.scheme_name)}</div>
                <div class="fund-meta">
                  <span>${escapeHtml(f.fund_house)}</span>
                  ${f.sub_category ? `<span class="subcat-pill">${escapeHtml(f.sub_category)}</span>` : ""}
                </div>
              </div>
            </div>
          </td>
          <td class="col-num"><span class="num-val">${f.aum_cr != null ? "₹" + formatNumber(f.aum_cr, 2) : "—"}</span></td>
          <td class="col-num"><span class="num-val">${f.expense_ratio != null ? formatNumber(f.expense_ratio, 2) + "%" : "—"}</span></td>
          <td class="col-num">${formatCagr(f.cagr_1y)}</td>
          <td class="col-num">${formatCagr(f.cagr_3y)}</td>
          <td class="col-num">${formatCagr(f.cagr_5y)}</td>
          <td class="col-num"><span class="num-val">${f.nav != null ? "₹" + formatNumber(f.nav, 2) : "—"}</span></td>
          <td class="exit-load-cell">${escapeHtml(f.exit_load || "Nil")}</td>
        </tr>
      `);

      if (isExpanded) {
        html.push(`
          <tr class="detail-row">
            <td colspan="8">
              <div class="detail-panel" id="activeDetailPanel">
                <div class="detail-loading">
                  <div class="spinner"></div>
                  <span>Fetching live NAV, scheme details &amp; historical chart...</span>
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
        const fund = rows.find((x) => fundKey(x) === key);
        if (!fund) return;
        if (state.expandedKey === key) {
          state.expandedKey = null;
          renderTable();
        } else {
          state.expandedKey = key;
          renderTable();
          loadLiveFundDetail(fund);
        }
      });
    });
  }

  async function loadLiveFundDetail(fund) {
    const panel = document.getElementById("activeDetailPanel");
    if (!panel) return;
    const expectedKey = fundKey(fund);

    try {
      let data;
      if (state.mode === "api") {
        const url = `/api/fund/live?scheme_code=${encodeURIComponent(fund.scheme_code || "")}&search_id=${encodeURIComponent(fund.search_id || "")}`;
        const res = await fetch(url, { cache: "no-store" });
        data = await res.json();
        if (!res.ok) throw new Error(data.error || "Failed to fetch live details");
      } else {
        data = await fetchLiveFromMfapi(fund);
      }

      if (state.expandedKey !== expectedKey) return;
      renderLiveDetailPanel(panel, fund, data);
    } catch (err) {
      if (state.expandedKey !== expectedKey) return;
      panel.innerHTML = `<div class="empty-state">Unable to load live data: ${escapeHtml(err.message)}</div>`;
    }
  }

  function renderLiveDetailPanel(panel, cachedFund, payload) {
    const live = payload.live || {};
    const history = payload.nav_history || [];
    const navVal = live.nav != null ? live.nav : cachedFund.nav;
    const change1d = live.change_1d_pct;
    const change1dHtml =
      change1d != null
        ? `<span class="${change1d >= 0 ? "pos" : "neg"} mono">${change1d >= 0 ? "+" : ""}${Number(change1d).toFixed(2)}% (1D)</span>`
        : "";

    const aum = live.aum_cr != null ? live.aum_cr : cachedFund.aum_cr;
    const er = live.expense_ratio != null ? live.expense_ratio : cachedFund.expense_ratio;
    const exitLoad = live.exit_load || cachedFund.exit_load || "Nil";
    const r1y = live.cagr_1y != null ? live.cagr_1y : cachedFund.cagr_1y;
    const r3y = live.cagr_3y != null ? live.cagr_3y : cachedFund.cagr_3y;
    const r5y = live.cagr_5y != null ? live.cagr_5y : cachedFund.cagr_5y;
    const risk = live.risk || cachedFund.risk || "—";
    const manager = live.fund_manager || cachedFund.fund_manager || "—";
    const minSip = live.min_sip != null ? live.min_sip : cachedFund.min_sip;
    const minLump = live.min_lumpsum != null ? live.min_lumpsum : cachedFund.min_lumpsum;
    const holdings = live.top_holdings || [];

    panel.innerHTML = `
      <div class="detail-header">
        <div>
          <div class="live-badge">
            <span class="live-dot"></span>
            <span>LIVE DATA &middot; ${(payload.sources || ["Live"]).join(" + ")} &middot; ${formatTimestamp(payload.fetched_at)}</span>
          </div>
          <div class="detail-title">${escapeHtml(live.scheme_name || cachedFund.scheme_name)}</div>
          <div class="fund-meta" style="margin-top:4px;">
            <span>${escapeHtml(live.fund_house || cachedFund.fund_house)}</span>
            ${live.benchmark ? `<span>&middot; Benchmark: <strong>${escapeHtml(live.benchmark)}</strong></span>` : ""}
            ${cachedFund.scheme_code ? `<span>&middot; AMFI Code: <span class="mono">${escapeHtml(cachedFund.scheme_code)}</span></span>` : ""}
          </div>
        </div>
        <div class="detail-nav-block">
          <div class="detail-nav-value mono">${navVal != null ? "₹" + formatNumber(navVal, 4) : "—"}</div>
          <div class="detail-nav-sub">
            NAV as of ${escapeHtml(live.nav_date || "Latest")} ${change1dHtml ? "&middot; " + change1dHtml : ""}
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
          <div class="metrics-grid">
            <div class="metric-item">
              <div class="metric-label">AUM</div>
              <div class="metric-value mono">${aum != null ? "₹" + formatNumber(aum, 2) + " Cr" : "—"}</div>
            </div>
            <div class="metric-item">
              <div class="metric-label">Expense Ratio</div>
              <div class="metric-value mono">${er != null ? formatNumber(er, 2) + "%" : "—"}</div>
            </div>
            <div class="metric-item">
              <div class="metric-label">Live 1Y / 3Y / 5Y CAGR</div>
              <div class="metric-value mono">
                ${r1y != null ? Number(r1y).toFixed(1) + "%" : "—"} /
                ${r3y != null ? Number(r3y).toFixed(1) + "%" : "—"} /
                ${r5y != null ? Number(r5y).toFixed(1) + "%" : "—"}
              </div>
            </div>
            <div class="metric-item">
              <div class="metric-label">Riskometer</div>
              <div class="metric-value">${escapeHtml(risk)}</div>
            </div>
            <div class="metric-item">
              <div class="metric-label">Min SIP / Lumpsum</div>
              <div class="metric-value mono">
                ${minSip != null ? "₹" + formatNumber(minSip, 0) : "—"} /
                ${minLump != null ? "₹" + formatNumber(minLump, 0) : "—"}
              </div>
            </div>
            <div class="metric-item">
              <div class="metric-label">Fund Manager</div>
              <div class="metric-value">${escapeHtml(manager)}</div>
            </div>
          </div>

          <div class="exit-box">
            <strong>Exit Load &amp; Stamp Duty</strong>
            ${escapeHtml(exitLoad)} &middot; Stamp duty: ${escapeHtml(live.stamp_duty || "0.005%")}
          </div>

          ${
            holdings.length > 0
              ? `
            <div class="holdings-section">
              <div class="holdings-title">Top Portfolio Holdings</div>
              ${holdings
                .slice(0, 5)
                .map(
                  (h) => `
                <div class="holding-row">
                  <span class="holding-name">${escapeHtml(h.name)}</span>
                  <span class="holding-pct mono">${h.corpus_per != null ? Number(h.corpus_per).toFixed(2) + "%" : "—"}</span>
                </div>
              `
                )
                .join("")}
            </div>
          `
              : ""
          }

          ${
            live.groww_url
              ? `<a class="groww-link" href="${escapeHtml(live.groww_url)}" target="_blank" rel="noopener noreferrer">Open full scheme page on Groww &rarr;</a>`
              : ""
          }
        </div>
      </div>
    `;

    initNavChart(panel, history);
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

  function initNavChart(panel, fullHistory) {
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
        retPctEl.textContent = "No NAV history";
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
        ctx.fillText("Historical NAV chart unavailable for this scheme.", width / 2, height / 2);
        return;
      }

      const pad = { top: 18, right: 14, bottom: 28, left: 56 };
      const plotW = width - pad.left - pad.right;
      const plotH = height - pad.top - pad.bottom;

      const vals = currentPts.map((p) => p.nav);
      let minV = Math.min(...vals);
      let maxV = Math.max(...vals);
      if (minV === maxV) {
        minV *= 0.98;
        maxV *= 1.02;
      }
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
      coords.forEach((c, idx) => {
        if (idx === 0) ctx.moveTo(c.x, c.y);
        else ctx.lineTo(c.x, c.y);
      });
      ctx.strokeStyle = strokeColor;
      ctx.lineWidth = 2;
      ctx.lineJoin = "round";
      ctx.stroke();

      ctx.fillStyle = "#64748b";
      ctx.font = "11px JetBrains Mono, monospace";
      ctx.textBaseline = "top";
      const tickIdxs = [0, Math.floor(coords.length / 2), coords.length - 1];
      tickIdxs.forEach((idx, pos) => {
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
        if (d < bestDist) {
          bestDist = d;
          bestIdx = i;
        }
      }
      const c = coords[bestIdx];
      const baseNav = currentPts[0].nav;
      const chg = ((c.pt.nav - baseNav) / baseNav) * 100;
      tooltip.style.display = "block";
      tooltip.textContent = `${c.pt.date}  |  NAV: ₹${c.pt.nav.toFixed(4)}  (${chg >= 0 ? "+" : ""}${chg.toFixed(2)}%)`;
      const leftPos = Math.min(Math.max(10, c.x - 90), rect.width - 240);
      tooltip.style.left = `${leftPos}px`;
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
