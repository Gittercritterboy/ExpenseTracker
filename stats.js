/* ExpenseTracker — statistics page ----------------------------------------
 * Shows totals by item and a 6-month trend. Data comes from the Google Sheet
 * (via a POST { action:"summary" }); if that isn't available it falls back to
 * the entries logged on this device (localStorage "et_log").
 * ---------------------------------------------------------------------- */
(function () {
  "use strict";

  var CFG = window.CONFIG || {};
  var $ = function (id) { return document.getElementById(id); };
  var SYM = CFG.CURRENCY || "€";
  var LS_LOG = "et_log";
  var LS_CACHE = "et_statscache";

  var state = {
    period: safeGet("et_stats_period", "month"),
    klass: safeGet("et_stats_klass", "all"),
    rows: [],            // [{ date:'YYYY-MM-DD', desc, amount, klass }]
    source: "local"
  };

  /* ---------- small helpers ---------- */
  function safeGet(k, d) { try { return localStorage.getItem(k) || d; } catch (e) { return d; } }
  function safeSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  function load(k, d) { try { var v = JSON.parse(localStorage.getItem(k)); return v == null ? d : v; } catch (e) { return d; } }
  function iso(d) {
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") +
           "-" + String(d.getDate()).padStart(2, "0");
  }
  function fmt(n) {
    return SYM + " " + (Math.round(n * 100) / 100)
      .toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  var toastTimer;
  function toast(msg, err) {
    var t = $("toast");
    t.textContent = msg; t.classList.toggle("err", !!err); t.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove("show"); }, 2600);
  }

  /* ---------- data sources ---------- */
  function fromLocalLog() {
    return load(LS_LOG, []).map(function (e) {
      return { date: e.date, desc: e.desc || "—", amount: +e.amount || 0, klass: e.klass || "parents" };
    });
  }

  function normalizeSheet(rowsByTab) {
    var privTab = (CFG.TABS && CFG.TABS.private) || "Private";
    var out = [];
    Object.keys(rowsByTab || {}).forEach(function (tab) {
      var klass = tab === privTab ? "private" : "parents";
      (rowsByTab[tab] || []).forEach(function (r) {
        var date = String(r[0] || "").slice(0, 10);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
        out.push({ date: date, desc: String(r[1] || "—"), amount: +r[2] || 0, klass: klass });
      });
    });
    return out;
  }

  function fetchSheet() {
    if (!CFG.ENDPOINT || /PASTE_YOUR/.test(CFG.ENDPOINT)) return Promise.reject(new Error("NOENDPOINT"));
    return fetch(CFG.ENDPOINT, {
      method: "POST",
      body: JSON.stringify({ action: "summary", token: CFG.TOKEN })
    }).then(function (res) { return res.text(); }).then(function (t) {
      var data;
      try { data = JSON.parse(t); } catch (e) { throw new Error("NET"); }
      if (data && data.ok && data.rows) return normalizeSheet(data.rows);
      throw new Error("STALE"); // reachable, but this deployment has no summary action
    });
  }

  /* ---------- period windows ---------- */
  function periodRange(p) {
    var now = new Date(), y = now.getFullYear(), m = now.getMonth();
    if (p === "month") return [iso(new Date(y, m, 1)), iso(new Date(y, m + 1, 0))];
    if (p === "lastmonth") return [iso(new Date(y, m - 1, 1)), iso(new Date(y, m, 0))];
    if (p === "3mo") return [iso(new Date(y, m - 2, 1)), iso(new Date(y, m + 1, 0))];
    if (p === "year") return [iso(new Date(y, 0, 1)), iso(new Date(y, 11, 31))];
    return ["0000-01-01", "9999-12-31"];
  }

  /* ---------- render ---------- */
  function render() {
    var rng = periodRange(state.period);
    var rows = state.rows.filter(function (r) {
      return r.date >= rng[0] && r.date <= rng[1] &&
             (state.klass === "all" || r.klass === state.klass);
    });
    var total = rows.reduce(function (s, r) { return s + r.amount; }, 0);

    $("total").textContent = fmt(total);
    $("totalSub").textContent = rows.length
      ? rows.length + (rows.length === 1 ? " entry" : " entries") + " · ø " + fmt(total / rows.length) + " each"
      : "Nothing in this period";

    var byItem = {};
    rows.forEach(function (r) {
      var k = (r.desc || "—").trim() || "—";
      byItem[k] = byItem[k] || { total: 0, count: 0 };
      byItem[k].total += r.amount;
      byItem[k].count += 1;
    });
    var items = Object.keys(byItem).map(function (k) {
      return { name: k, total: byItem[k].total, count: byItem[k].count };
    }).sort(function (a, b) { return b.total - a.total; });

    var host = $("byItem");
    host.innerHTML = "";
    if (!items.length) {
      host.innerHTML = '<div class="empty">No expenses in this period.</div>';
    } else {
      var max = items[0].total || 1;
      items.forEach(function (it) {
        var pct = total ? Math.round(it.total / total * 100) : 0;
        var row = document.createElement("div");
        row.className = "bar-row";
        row.innerHTML =
          '<span class="b-name"></span><span class="b-val"></span>' +
          '<span class="b-sub"></span>' +
          '<div class="b-track"><div class="b-fill"></div></div>';
        row.querySelector(".b-name").textContent = it.name;
        row.querySelector(".b-val").textContent = fmt(it.total);
        row.querySelector(".b-sub").textContent =
          it.count + (it.count === 1 ? " entry" : " entries") + " · " + pct + "% · ø " + fmt(it.total / it.count);
        row.querySelector(".b-fill").style.width = Math.max(2, Math.round(it.total / max * 100)) + "%";
        host.appendChild(row);
      });
    }

    renderMonths();
  }

  function renderMonths() {
    var now = new Date();
    var months = [];
    for (var i = 5; i >= 0; i--) {
      var d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      months.push({ key: iso(d).slice(0, 7), label: d.toLocaleDateString(undefined, { month: "short" }) });
    }
    var sums = {};
    state.rows.forEach(function (r) {
      if (state.klass !== "all" && r.klass !== state.klass) return;
      var mk = String(r.date).slice(0, 7);
      sums[mk] = (sums[mk] || 0) + r.amount;
    });
    var max = Math.max.apply(null, months.map(function (m) { return sums[m.key] || 0; }).concat([1]));

    var host = $("byMonth");
    host.innerHTML = "";
    months.forEach(function (m) {
      var v = sums[m.key] || 0;
      var col = document.createElement("div");
      col.className = "m" + (v === 0 ? " dim" : "");
      col.innerHTML =
        '<span class="m-val">' + (v ? fmt(v).replace(SYM + " ", "") : "") + '</span>' +
        '<div class="m-bar" style="height:' + (v ? Math.max(3, Math.round(v / max * 100)) : 1) + '%"></div>' +
        '<span class="m-label">' + m.label + '</span>';
      host.appendChild(col);
    });
  }

  /* ---------- filter chips ---------- */
  function wireChips(wrapId, key, onChange) {
    var wrap = $(wrapId);
    [].forEach.call(wrap.children, function (btn) {
      btn.classList.toggle("is-active", btn.dataset[key] === state[key]);
      btn.addEventListener("click", function () {
        state[key] = btn.dataset[key];
        safeSet("et_stats_" + key, state[key]);
        [].forEach.call(wrap.children, function (b) { b.classList.toggle("is-active", b === btn); });
        onChange();
      });
    });
  }

  function updateSource(at) {
    var label = { sheet: "Google Sheet", cache: "Google Sheet (cached)", local: "this device only" }[state.source];
    var when = at ? " · " + new Date(at).toLocaleString(undefined,
      { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "";
    $("source").textContent = "Source: " + label + when;
  }

  /* ---------- boot ---------- */
  wireChips("periodChips", "period", render);
  wireChips("klassChips", "klass", render);

  var cached = load(LS_CACHE, null);
  if (cached && cached.rows && cached.rows.length) {
    state.rows = cached.rows; state.source = "cache";
  } else {
    state.rows = fromLocalLog(); state.source = "local";
  }
  render();
  updateSource(cached && cached.at);

  fetchSheet().then(function (rows) {
    state.rows = rows;
    state.source = "sheet";
    safeSet(LS_CACHE, JSON.stringify({ rows: rows, at: Date.now() }));
    render();
    updateSource(Date.now());
    $("hint").textContent = "";
  }).catch(function (err) {
    if (state.source !== "cache") { state.rows = fromLocalLog(); state.source = "local"; render(); }
    updateSource(cached && cached.at);
    $("hint").textContent = (err && err.message === "STALE")
      ? "Full sheet history isn’t available yet — update apps-script/Code.gs to the latest version and redeploy it (Deploy ▸ Manage deployments ▸ edit ▸ New version). Until then this shows expenses logged on this device."
      : "Couldn’t reach the sheet — showing expenses logged on this device.";
  });
})();
