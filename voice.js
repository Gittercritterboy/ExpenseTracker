/* ExpenseTracker — voice entry ------------------------------------------------
 * Uses the Web Speech API (Chrome / Edge / Android Chrome). Not available on
 * iOS Safari — the mic button stays hidden there.
 *
 * Voice.parse("Tankstelle 45 euro privat")
 *   -> { desc: "Tankstelle", amount: 45, klass: "private" }
 * ------------------------------------------------------------------------- */
(function () {
  "use strict";

  var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  var CFG = window.CONFIG || {};

  var Voice = { supported: !!SR, listening: false, _rec: null };

  /* ---- German number words, 0..99 plus hundert ---- */
  var ONES = {
    "null": 0, ein: 1, eins: 1, eine: 1, zwei: 2, zwo: 2, drei: 3, vier: 4,
    "fünf": 5, fuenf: 5, sechs: 6, sieben: 7, acht: 8, neun: 9, zehn: 10, elf: 11,
    "zwölf": 12, zwoelf: 12, dreizehn: 13, vierzehn: 14, "fünfzehn": 15, fuenfzehn: 15,
    sechzehn: 16, siebzehn: 17, achtzehn: 18, neunzehn: 19
  };
  var TENS = {
    zwanzig: 20, "dreißig": 30, dreissig: 30, vierzig: 40, "fünfzig": 50, fuenfzig: 50,
    sechzig: 60, siebzig: 70, achtzig: 80, neunzig: 90
  };

  function wordToNumber(w) {
    w = String(w || "").replace(/\s+/g, "");
    if (w in ONES) return ONES[w];
    if (w in TENS) return TENS[w];
    var h = 0, rest = w;
    var mH = /^(.*?)hundert(.*)$/.exec(w);
    if (mH) {
      h = (mH[1] ? (wordToNumber(mH[1]) || 1) : 1) * 100;
      rest = mH[2];
      if (!rest) return h;
    }
    var mU = /^(.*?)und(.*)$/.exec(rest);
    if (mU) {
      var a = ONES[mU[1]] || 0, b = TENS[mU[2]] || 0;
      if (a || b) return h + a + b;
    }
    if (rest in ONES) return h + ONES[rest];
    if (rest in TENS) return h + TENS[rest];
    return h || null;
  }

  var FILLER = /\b(f[üu]r|kostet|kosten|ausgabe|ausgaben|hab|habe|ich|bezahlt|gezahlt|bei|vom|von|einen|eine|einer|das|der|die|mir|heute|war|waren|betrag|gerade|so|circa|etwa)\b/g;
  var CURRENCY = /\b(euros?|eur|€|cents?)\b/g;

  function two(x) { return x.length === 1 ? x + "0" : x.slice(0, 2); }

  function parse(text) {
    var t = (" " + String(text).toLowerCase() + " ")
      .replace(/[.,](?=\s|$)/g, " ")
      .replace(/\s+/g, " ");

    /* class */
    var klass = null;
    if (/\b(privat|private|mein|meine)\b/.test(t)) klass = "private";
    else if (/\b(eltern|parents|papa|mama|mutter|vater)\b/.test(t)) klass = "parents";
    t = t.replace(/\b(privat|private|eltern|parents)\b/g, " ");

    /* amount */
    var amount = null, amtStr = null, m;
    if ((m = /(\d+)[.,](\d{1,2})/.exec(t))) {
      amount = parseFloat(m[1] + "." + two(m[2])); amtStr = m[0];
    } else if ((m = /(\d+)\s*(?:euro|eur|€)\s*(\d{1,2})\b/.exec(t))) {
      amount = parseFloat(m[1] + "." + two(m[2])); amtStr = m[0];
    } else if ((m = /(\d+)\s*(?:euro|eur|€)/.exec(t))) {
      amount = parseFloat(m[1]); amtStr = m[0];
    } else if ((m = /\b(\d{1,5})\b/.exec(t))) {
      amount = parseFloat(m[1]); amtStr = m[0];
    } else {
      var em = /([a-zäöüß]+(?:\s+und\s+[a-zäöüß]+)?)\s+(?:euro|eur)(?:\s+([a-zäöüß]+))?/.exec(t);
      if (em) {
        var eur = wordToNumber(em[1].replace(/\s+und\s+/g, "und"));
        var ct = em[2] ? wordToNumber(em[2]) : 0;
        if (eur != null) { amount = eur + (ct ? ct / 100 : 0); amtStr = em[0]; }
      }
    }
    if (amount != null && (!isFinite(amount) || amount <= 0 || amount > 100000)) {
      amount = null; amtStr = null;
    }

    /* description = the leftovers */
    var desc = t;
    if (amtStr) desc = desc.replace(amtStr, " ");
    desc = desc.replace(/\d+/g, " ").replace(CURRENCY, " ").replace(FILLER, " ")
               .replace(/\s+/g, " ").trim();
    if (desc) {
      var hit = (CFG.DESCRIPTIONS || []).filter(function (d) {
        var a = d.toLowerCase(), b = desc;
        return a === b || a.replace(/\s+/g, "") === b.replace(/\s+/g, "");
      })[0];
      desc = hit || desc.charAt(0).toUpperCase() + desc.slice(1);
    }

    return {
      desc: desc || null,
      amount: amount != null ? Math.round(amount * 100) / 100 : null,
      klass: klass
    };
  }
  Voice.parse = parse;

  Voice.toggle = function (cb) {
    cb = cb || {};
    if (!SR) { cb.onerror && cb.onerror("Voice input isn't supported in this browser"); return; }
    if (Voice.listening) { try { Voice._rec.stop(); } catch (e) {} return; }

    var rec = new SR();
    Voice._rec = rec;
    rec.lang = CFG.VOICE_LANG || "de-DE";
    rec.interimResults = true;
    rec.maxAlternatives = 1;
    rec.continuous = false;

    var finalText = "";
    rec.onstart = function () { Voice.listening = true; cb.onstate && cb.onstate(true, ""); };
    rec.onresult = function (e) {
      var interim = "";
      for (var i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) finalText += e.results[i][0].transcript;
        else interim += e.results[i][0].transcript;
      }
      cb.onstate && cb.onstate(true, (interim || finalText).trim());
    };
    rec.onerror = function (e) {
      Voice.listening = false;
      cb.onstate && cb.onstate(false, "");
      if (e.error !== "aborted" && e.error !== "no-speech") {
        cb.onerror && cb.onerror(e.error === "not-allowed"
          ? "Microphone permission denied" : "Voice error: " + e.error);
      }
    };
    rec.onend = function () {
      Voice.listening = false;
      cb.onstate && cb.onstate(false, "");
      var text = finalText.trim();
      if (text) cb.onresult && cb.onresult(parse(text), text);
      else cb.onerror && cb.onerror("Didn't catch that — try again");
    };

    try { rec.start(); }
    catch (e) { cb.onerror && cb.onerror("Could not start the microphone"); }
  };

  window.Voice = Voice;
})();
