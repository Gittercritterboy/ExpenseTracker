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
      var label = item.label;
      var b = document.createElement("button");
      b.type = "button";
      b.className = "chip";
      b.dataset.label = label;
      b.textContent = (item.emoji ? item.emoji + " " : "") + label;
      b.addEventListener("click", function () {
        descInput.value = label;                  // clean text only -> that's what the sheet gets
        markActiveChip(label);
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

  /* ---------- sync indicator ---------- */
  function updateSync() {
    var btn = $("syncBtn"), txt = $("syncText");
    btn.classList.remove("is-ok", "is-wait", "is-off");
    var waiting = state.outbox.length + Object.keys(pending).length;
    if (!navigator.onLine && (waiting || state.outbox.length)) {
      btn.classList.add("is-off"); txt.textContent = "Offline · " + state.outbox.length + " queued";
    } else if (waiting) {
      btn.classList.add("is-wait"); txt.textContent = waiting + " to sync";
    } else {
      btn.classList.add("is-ok"); txt.textContent = "Synced";
    }
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
    // Plain string body => Content-Type text/plain => no CORS preflight.
    // Apps Script /exec 302-redirects to a response with Access-Control-Allow-Origin: *
    return fetch(CFG.ENDPOINT, {
      method: "POST",
      body: payload(entry),
      redirect: "follow",
      keepalive: true
    }).then(function (res) {
      return res.text().then(function (t) {
        var data;
        try { data = JSON.parse(t); }
        catch (e) { throw new Error("non-JSON response (deployment not public?): " + t.slice(0, 120)); }
        if (data.ok !== true) throw new Error("server: " + (data.error || res.status));
      });
    });
  }

  /* ---------- lifecycle ---------- */
  function commitAllNow() {
    Object.keys(pending).forEach(function (id) { commit(id); });
  }
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "hidden") {
      commitAllNow();
      // best-effort delivery if the app is being closed
      if (navigator.sendBeacon && endpointReady()) {
        var left = [];
        state.outbox.forEach(function (it) {
          var sent = navigator.sendBeacon(CFG.ENDPOINT, payload(it));
          if (!sent) left.push(it);
        });
        if (left.length !== state.outbox.length) {
          state.outbox = left; save(LS.outbox, state.outbox);
        }
      }
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

  /* ---------- voice entry ---------- */
  var voiceBtn = $("voiceBtn"), voiceLabel = $("voiceLabel");
  if (voiceBtn && window.Voice && Voice.supported) {
    voiceBtn.hidden = false;
    voiceBtn.addEventListener("click", function () {
      Voice.toggle({
        onstate: function (listening, interim) {
          voiceBtn.classList.toggle("listening", listening);
          voiceLabel.textContent = listening
            ? (interim ? '“' + interim + '”' : "Listening…")
            : "Speak";
        },
        onresult: function (parsed) {
          var bits = [];
          if (parsed.klass) {
            var r = $("k-" + parsed.klass);
            if (r) { r.checked = true; buildDescChips(); }   // .checked doesn't fire change
            bits.push(parsed.klass === "private" ? "Private" : "Parents");
          }
          if (parsed.desc) {
            descInput.value = parsed.desc;
            markActiveChip(parsed.desc);
            bits.push(parsed.desc);
          }
          if (parsed.amount != null) {
            amountInput.value = Number.isInteger(parsed.amount)
              ? String(parsed.amount)
              : parsed.amount.toFixed(2).replace(".", ",");
            bits.push(money(parsed.amount));
          }
          toast(bits.length ? "Heard: " + bits.join(" · ") : "Nothing recognised", !bits.length);
          (parsed.amount != null ? submitBtn : amountInput).focus();
        },
        onerror: function (msg) {
          voiceBtn.classList.remove("listening");
          voiceLabel.textContent = "Speak";
          toast(msg, true);
        }
      });
    });
  }

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
