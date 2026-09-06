/* ExpenseTracker — statistics page ----------------------------------------
 * Donut of spending per quick-pick category + a 6-month total trend.
 * Data comes from the Google Sheet (POST { action:"summary" }); if that isn't
 * available it falls back to the entries logged on this device ("et_log").
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

  var PALETTE = [
    "#16a34a", "#38bdf8", "#f59e0b", "#a78bfa", "#ef4444",
    "#ec4899", "#2dd4bf", "#eab308", "#94a3b8"
  ];

  /* Quick-pick tag labels, longest first so "Bahn Fahrt" wins over "Bahn". */
  function tagLabels() {
    var d = CFG.DESCRIPTIONS || {};
    var list = Array.isArray(d) ? d
      : [].concat(d.parents || [], d["private"] || [], d.both || []);
    return list
      .map(function (x) { return typeof x === "string" ? x : x.label; })
      .filter(Boolean)
      .sort(function (a, b) { return b.length - a.length; });
  }

  /* Fold a free-text description onto its quick-pick tag:
     "Essen", "Essen Nobis", "Essen-Nobis" -> "Essen". No tag match -> the text. */
  function bucketFor(desc) {
    var s = String(desc == null ? "" : desc).trim();
    var low = s.toLowerCase();
    var tags = tagLabels();
    for (var i = 0; i < tags.length; i++) {
      var t = tags[i].toLowerCase();
      if (low === t) return tags[i];
      if (low.indexOf(t) === 0) {
        var next = low.charAt(t.length);
        if (!/[a-z0-9äöüß]/i.test(next)) return tags[i];   // tag followed by space/punctuation
      }
    }
    return s || "—";
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

    var byCat = {};
    rows.forEach(function (r) {
      var k = bucketFor(r.desc);
      byCat[k] = byCat[k] || { total: 0, count: 0 };
      byCat[k].total += r.amount;
      byCat[k].count += 1;
    });
    var items = Object.keys(byCat).map(function (k) {
      return { name: k, total: byCat[k].total, count: byCat[k].count };
    }).sort(function (a, b) { return b.total - a.total; });

    renderPie(items, total);
    renderMonths();
  }

  function renderPie(items, total) {
    var host = $("pie");
    host.innerHTML = "";
    if (!items.length || total <= 0) {
      host.innerHTML = '<div class="empty">No expenses in this period.</div>';
      return;
    }

    // cap at 8 slices, fold the tail into "Rest"
    var top = items.slice(0, 8);
    var tail = items.slice(8);
    if (tail.length) {
      top.push({
        name: "Rest (" + tail.length + ")",
        total: tail.reduce(function (s, x) { return s + x.total; }, 0),
        count: tail.reduce(function (s, x) { return s + x.count; }, 0)
      });
    }

    // donut: radius picked so the circumference ≈ 100 → dasharray = percent
    var R = 15.915, C = 21, cum = 0, segs = "";
    top.forEach(function (it, i) {
      var pct = it.total / total * 100;
      segs += '<circle cx="' + C + '" cy="' + C + '" r="' + R + '" fill="none" stroke="' +
        PALETTE[i % PALETTE.length] + '" stroke-width="6" stroke-linecap="butt" ' +
        'stroke-dasharray="' + pct.toFixed(3) + ' ' + (100 - pct).toFixed(3) + '" ' +
        'stroke-dashoffset="' + (25 - cum).toFixed(3) + '"></circle>';
      cum += pct;
    });

    var tStr = Math.round(total).toLocaleString("de-DE");
    var fs = tStr.length > 6 ? 3 : tStr.length > 4 ? 3.8 : 4.6;
    var inner = document.createElement("div");
    inner.className = "pie-inner";
    inner.innerHTML =
      '<svg viewBox="0 0 42 42" class="donut" role="img" aria-label="Spending by category">' +
        '<circle cx="' + C + '" cy="' + C + '" r="' + R + '" fill="none" stroke="var(--surface-2)" stroke-width="6"></circle>' +
        segs +
        '<text x="21" y="20.5" class="donut-total" dominant-baseline="central" style="font-size:' + fs + 'px">' + tStr + '</text>' +
        '<text x="21" y="25" class="donut-cap" dominant-baseline="central">' + SYM + ' total</text>' +
      '</svg>';

    var ul = document.createElement("ul");
    ul.className = "legend";
    top.forEach(function (it, i) {
      var pct = Math.round(it.total / total * 100);
      var li = document.createElement("li");
      var dot = document.createElement("span");
      dot.className = "dot";
      dot.style.background = PALETTE[i % PALETTE.length];
      var name = document.createElement("span");
      name.className = "lg-name";
      name.textContent = it.name;
      var val = document.createElement("span");
      val.className = "lg-val";
      val.textContent = fmt(it.total) + "  ·  " + pct + "%";
      li.appendChild(dot); li.appendChild(name); li.appendChild(val);
      ul.appendChild(li);
    });

    host.appendChild(inner);
    host.appendChild(ul);
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
