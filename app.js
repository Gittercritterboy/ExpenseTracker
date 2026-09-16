/* ExpenseTracker — fast entry + Google Sheets sync ------------------------- */
(function () {
  "use strict";

  var CFG = window.CONFIG || {};
  var UNDO_MS = (CFG.UNDO_SECONDS || 5) * 1000;
  var LS = {
    outbox: "et_outbox",
    recent: "et_recent",
    hist: "et_deschistory",
    log: "et_log"          // full local history, used by the stats page offline
  };

  var $ = function (id) { return document.getElementById(id); };
  var form = $("form"), descChips = $("descChips"), descInput = $("desc"),
      amountInput = $("amount"), dateInput = $("date"), dateDisplay = $("dateDisplay"),
      dateChips = $("dateChips"), recentEl = $("recent"), recentWrap = $("recentWrap"),
      submitBtn = $("submit"), toastEl = $("toast");

  var state = {
    date: null,          // "YYYY-MM-DD"
    outbox: load(LS.outbox, []),   // committed, waiting for the network
    recent: load(LS.recent, []),   // last ~12 shown in the list
    hist: load(LS.hist, [])        // description autocomplete
  };
  var pending = {};       // id -> { entry, timer }

  /* ---------- storage helpers ---------- */
  function load(k, dflt) {
    try { var v = JSON.parse(localStorage.getItem(k)); return v == null ? dflt : v; }
    catch (e) { return dflt; }
  }
  function save(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }

  /* ---------- dates ---------- */
  function iso(d) {
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") +
           "-" + String(d.getDate()).padStart(2, "0");
  }
  function todayISO() { return iso(new Date()); }
  function isValidDate(s) { return /^\d{4}-\d{2}-\d{2}$/.test(String(s || "")); }
  function setDate(isoStr) {
    state.date = isoStr;
    dateInput.value = isoStr;
    var d = new Date(isoStr + "T00:00:00");
    var diff = Math.round((new Date(todayISO() + "T00:00:00") - d) / 86400000);
    var label;
    if (diff === 0) label = "Today";
    else if (diff === 1) label = "Yesterday";
    else label = d.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
    dateDisplay.textContent = label;
    [].forEach.call(dateChips.querySelectorAll(".chip[data-days]"), function (c) {
      var cd = iso(offsetDays(+c.dataset.days));
      c.classList.toggle("is-active", cd === isoStr);
    });
  }
  function offsetDays(n) { var d = new Date(); d.setDate(d.getDate() + n); return d; }

  /* ---------- description chips ---------- */
  function currentKlass() {
    var r = form.querySelector('input[name="klass"]:checked');
    return r ? r.value : "parents";
  }
  function descListFor(klass) {
    var d = CFG.DESCRIPTIONS || {};
    if (Array.isArray(d)) {                       // backwards-compatible flat list
      return d.map(function (x) { return typeof x === "string" ? { label: x } : x; });
    }
    return [].concat(d[klass] || [], d.both || []).map(function (x) {
      return typeof x === "string" ? { label: x } : x;
    });
  }
  function buildDescChips() {
    descChips.innerHTML = "";
    descListFor(currentKlass()).forEach(function (item) {
      var value = item.text || item.label;        // what goes into the field / the sheet
      var b = document.createElement("button");
      b.type = "button";
      b.className = "chip";
      b.dataset.label = value;
      b.textContent = (item.emoji ? item.emoji + " " : "") + item.label;
      b.addEventListener("click", function () {
        descInput.value = value;
        markActiveChip(value);
        amountInput.focus();
      });
      descChips.appendChild(b);
    });
    markActiveChip(descInput.value.trim());
  }
  function markActiveChip(label) {
    [].forEach.call(descChips.children, function (c) {
      c.classList.toggle("is-active", !!label && c.dataset.label === label);
    });
  }
  function refreshHistDatalist() {
    var dl = $("descHistory");
    dl.innerHTML = "";
    state.hist.slice(0, 20).forEach(function (h) {
      var o = document.createElement("option"); o.value = h; dl.appendChild(o);
    });
  }
  function rememberDesc(text) {
    text = text.trim();
    if (!text) return;
    state.hist = [text].concat(state.hist.filter(function (h) {
      return h.toLowerCase() !== text.toLowerCase();
    })).slice(0, 30);
    save(LS.hist, state.hist);
    refreshHistDatalist();
  }

  /* ---------- amount ---------- */
  function parseAmount(raw) {
    if (!raw) return NaN;
    var s = String(raw).trim().replace(/\s/g, "");
    // German style "1.234,56" -> drop . thousands, , is the decimal mark
    if (s.indexOf(",") > -1) s = s.replace(/\./g, "").replace(",", ".");
    if (!/^[0-9]*\.?[0-9]+$/.test(s) && !/^[0-9]+\.?[0-9]*$/.test(s)) return NaN;
    var n = parseFloat(s);
    return isFinite(n) ? Math.round(n * 100) / 100 : NaN;
  }
  function money(n) {
    return (CFG.CURRENCY || "€") + " " + n.toFixed(2).replace(".", ",");
  }

  /* ---------- toast ---------- */
  var toastTimer;
  function toast(msg, isErr) {
    toastEl.textContent = msg;
    toastEl.classList.toggle("err", !!isErr);
    toastEl.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.classList.remove("show"); }, 2600);
  }

  /* ---------- sync indicator: the Add-expense button doubles as the status ---------- */
  function updateSync() {
    var btn = submitBtn, txt = $("syncText");
    btn.classList.remove("is-ok", "is-wait", "is-off");
    var waiting = state.outbox.length + Object.keys(pending).length;
    var label;
    if (!navigator.onLine && state.outbox.length) {
      btn.classList.add("is-off");
      label = "Offline, " + state.outbox.length + " queued";
    } else if (waiting) {
      btn.classList.add("is-wait");
      label = waiting + " syncing";
    } else {
      btn.classList.add("is-ok");
      label = "All synced";
    }
    txt.textContent = label;
    btn.title = label;
  }

  /* ---------- recent list ---------- */
  function pushRecent(entry) {
    state.recent.unshift(entry);
    state.recent = state.recent.slice(0, 12);
    save(LS.recent, state.recent);
    renderRecent();
  }
  function updateRecent(id, patch) {
    var e = state.recent.find(function (x) { return x.id === id; });
    if (e) { Object.assign(e, patch); save(LS.recent, state.recent); renderRecent(); }
  }
  function renderRecent() {
    recentWrap.hidden = state.recent.length === 0;
    recentEl.innerHTML = "";
    state.recent.forEach(function (e) {
      var li = document.createElement("li");
      li.className = e.status === "pending" ? "is-pending"
                   : e.status === "error" ? "is-error" : "is-sent";
      var main = document.createElement("div");
      main.className = "r-main";
      var meta = e.date === todayISO() ? "Today" :
                 new Date(e.date + "T00:00:00").toLocaleDateString(undefined, { day: "numeric", month: "short" });
      main.innerHTML = '<div class="r-desc"></div><div class="r-meta"></div>';
      main.querySelector(".r-desc").textContent = e.desc;
      main.querySelector(".r-meta").textContent = meta +
        (e.status === "pending" ? " · sending in " + e.left + "s"
         : e.status === "error" ? " · will retry" : " · saved");

      var tag = document.createElement("span");
      tag.className = "r-tag";
      tag.textContent = e.klass === "private" ? "Priv" : "Par";

      var amt = document.createElement("span");
      amt.className = "r-amt";
      amt.textContent = money(e.amount);

      li.appendChild(main); li.appendChild(tag); li.appendChild(amt);

      if (e.status === "pending") {
        var undo = document.createElement("button");
        undo.className = "r-undo";
        undo.textContent = "Undo";
        undo.addEventListener("click", function () { cancelPending(e.id); });
        li.appendChild(undo);
      } else if (e.status === "error") {
        var retry = document.createElement("button");
        retry.className = "r-undo";
        retry.textContent = "Retry";
        retry.addEventListener("click", function () { retryEntry(e.id); });
        li.appendChild(retry);
      }
      recentEl.appendChild(li);
    });
  }

  /* ---------- submit / commit / send ---------- */
  form.addEventListener("submit", function (ev) {
    ev.preventDefault();
    var desc = descInput.value.trim();
    var amount = parseAmount(amountInput.value);
    var klass = form.querySelector('input[name="klass"]:checked').value;

    if (!desc) { toast("Add a description", true); descInput.focus(); return; }
    if (!(amount > 0)) { toast("Enter a valid amount", true); amountInput.focus(); return; }

    var entry = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      date: state.date, desc: desc, amount: amount, klass: klass,
      status: "pending", left: Math.round(UNDO_MS / 1000)
    };

    rememberDesc(desc);
    pushRecent(entry);

    var timer = setInterval(function () {
      entry.left -= 1;
      if (entry.left <= 0) { clearInterval(timer); commit(entry.id); }
      else { save(LS.recent, state.recent); renderRecent(); }
    }, 1000);
    pending[entry.id] = { entry: entry, timer: timer };

    // reset for the next entry as fast as possible
    descInput.value = "";
    amountInput.value = "";
    markActiveChip("");
    submitBtn.classList.add("flash");
    setTimeout(function () { submitBtn.classList.remove("flash"); }, 400);
    if (navigator.vibrate) navigator.vibrate(15);
    toast("Saved · undo for " + Math.round(UNDO_MS / 1000) + "s");
    amountInput.focus();
    updateSync();
  });

  function cancelPending(id) {
    var p = pending[id];
    if (!p) return;
    clearInterval(p.timer);
    delete pending[id];
    state.recent = state.recent.filter(function (x) { return x.id !== id; });
    save(LS.recent, state.recent);
    renderRecent(); updateSync();
    toast("Entry removed");
  }

  // Re-queue a "will retry" entry that's no longer actually in the outbox
  // (e.g. one lost to a background sendBeacon before this fix) and push it now.
  function retryEntry(id) {
    var e = state.recent.find(function (x) { return x.id === id; });
    if (!e) return;
    if (!isValidDate(e.date)) {
      toast("This entry lost its date and can't be retried safely — please re-enter it", true);
      return;
    }
    if (!state.outbox.some(function (o) { return o.id === id; })) {
      state.outbox.push({ id: e.id, date: e.date, desc: e.desc, amount: e.amount, klass: e.klass });
      save(LS.outbox, state.outbox);
    }
    updateSync();
    toast("Retrying…");
    flush();
  }

  function commit(id) {
    var p = pending[id];
    if (!p) return;
    clearInterval(p.timer);
    delete pending[id];
    var entry = p.entry;
    entry.status = "queued";
    state.outbox.push(entry);
    save(LS.outbox, state.outbox);
    appendLog(entry);
    updateRecent(id, { status: navigator.onLine ? "sent" : "error" });
    flush();
    updateSync();
  }

  function appendLog(e) {
    var log = load(LS.log, []);
    log.push({ date: e.date, desc: e.desc, amount: e.amount, klass: e.klass, t: Date.now() });
    if (log.length > 3000) log = log.slice(-3000);
    save(LS.log, log);
  }

  var flushing = false, warnedNoEndpoint = false;
  function endpointReady() {
    return CFG.ENDPOINT && !/PASTE_YOUR/.test(CFG.ENDPOINT);
  }
  function flush() {
    if (flushing || !state.outbox.length) return;
    if (!endpointReady()) {
      if (!warnedNoEndpoint) {
        warnedNoEndpoint = true;
        toast("Set ENDPOINT in config.js — entries are queued", true);
      }
      return;
    }
    if (!navigator.onLine) return;
    flushing = true;

    var item = state.outbox[0];
    send(item).then(function () {
      state.outbox.shift();
      save(LS.outbox, state.outbox);
      updateRecent(item.id, { status: "sent" });
      flushing = false;
      updateSync();
      if (state.outbox.length) flush();
    }).catch(function (err) {
      flushing = false;
      updateRecent(item.id, { status: "error" });
      updateSync();
      console.warn("send failed, will retry:", err);
    });
  }

  function payload(entry) {
    return JSON.stringify({
      id: entry.id,
      token: CFG.TOKEN,
      tab: (CFG.TABS && CFG.TABS[entry.klass]) || entry.klass,
      date: entry.date,
      description: entry.desc,
      amount: entry.amount
    });
  }

  function send(entry) {
    // Belt-and-braces: never let a corrupted/dateless entry reach the sheet -
    // the server also refuses these now, but fail fast locally instead of
    // wasting a round trip.
    if (!isValidDate(entry.date)) {
      return Promise.reject(new Error("entry has no valid date, not sending"));
    }

    // A stalled request must not hang forever - that would wedge `flushing` and
    // silently stop every future retry. Time it out and let it fail instead.
    var ctrl = ("AbortController" in window) ? new AbortController() : null;
    var timer = ctrl && setTimeout(function () { ctrl.abort(); }, 20000);

    // Plain string body => Content-Type text/plain => no CORS preflight.
    // Apps Script /exec 302-redirects to a response with Access-Control-Allow-Origin: *
    return fetch(CFG.ENDPOINT, {
      method: "POST",
      body: payload(entry),
      redirect: "follow",
      keepalive: true,
      signal: ctrl ? ctrl.signal : undefined
    }).then(function (res) {
      return res.text().then(function (t) {
        var data;
        try { data = JSON.parse(t); }
        catch (e) { throw new Error("non-JSON response (deployment not public?): " + t.slice(0, 120)); }
        if (data.ok !== true) throw new Error("server: " + (data.error || res.status));
      });
    }).then(function (v) { if (timer) clearTimeout(timer); return v; },
            function (err) { if (timer) clearTimeout(timer); throw err; });
  }

  /* ---------- lifecycle ---------- */
  function commitAllNow() {
    Object.keys(pending).forEach(function (id) { commit(id); });
  }
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "hidden") {
      commitAllNow();
      // Best-effort extra attempt while the app is being closed/backgrounded.
      // sendBeacon() only confirms the BROWSER accepted the request, never that
      // the server actually received it - so items stay in the outbox regardless
      // and get properly confirmed by a real flush() next time. (A previous
      // version removed them here on a bare "sent" signal, which could silently
      // drop an entry that never actually reached the sheet.)
      if (navigator.sendBeacon && endpointReady()) {
        state.outbox.forEach(function (it) { navigator.sendBeacon(CFG.ENDPOINT, payload(it)); });
      }
    } else {
      // Reopening/foregrounding the app is the most reliable moment to retry -
      // background tabs get their timers throttled, so don't rely on the
      // interval below alone while the app wasn't in front.
      updateSync();
      flush();
    }
  });
  window.addEventListener("online", function () { updateSync(); flush(); });
  window.addEventListener("offline", updateSync);
  setInterval(function () { if (navigator.onLine) flush(); }, 20000);

  /* ---------- wire up ---------- */
  [].forEach.call(dateChips.querySelectorAll(".chip[data-days]"), function (c) {
    c.addEventListener("click", function () { setDate(iso(offsetDays(+c.dataset.days))); });
  });
  dateInput.addEventListener("change", function () {
    if (dateInput.value) setDate(dateInput.value);
  });
  var pickBtn = dateChips.querySelector(".chip-cal");
  if (pickBtn) pickBtn.addEventListener("click", function (e) {
    if (typeof dateInput.showPicker === "function") {
      e.preventDefault();
      try { dateInput.showPicker(); } catch (err) { dateInput.focus(); }
    }
  });
  descInput.addEventListener("input", function () { markActiveChip(descInput.value.trim()); });
  descInput.addEventListener("keydown", function (e) {
    if (e.key === "Enter") { e.preventDefault(); amountInput.focus(); }
  });
  [].forEach.call(form.querySelectorAll('input[name="klass"]'), function (r) {
    r.addEventListener("change", buildDescChips);
  });
  $("clearRecent").addEventListener("click", function () {
    state.recent = state.recent.filter(function (x) { return x.status === "pending"; });
    save(LS.recent, state.recent); renderRecent();
  });

  // A hard crash/close during the undo window: make sure those entries are
  // still delivered by re-queuing them into the outbox on next open.
  state.recent.forEach(function (e) {
    if (e.status === "pending") {
      e.status = "error";
      if (!state.outbox.some(function (o) { return o.id === e.id; })) state.outbox.push(e);
    }
  });
  save(LS.recent, state.recent);
  save(LS.outbox, state.outbox);

  buildDescChips();
  refreshHistDatalist();
  setDate(todayISO());
  renderRecent();
  updateSync();
  flush();
  amountInput.focus();

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", function () {
      navigator.serviceWorker.register("sw.js").catch(function () {});
    });
  }
})();
