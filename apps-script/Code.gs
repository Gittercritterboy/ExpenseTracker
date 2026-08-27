/**
 * ExpenseTracker — Google Sheets write endpoint
 * ---------------------------------------------------------------------------
 * SETUP (one time):
 *  1. Open your expenses Google Sheet.
 *  2. Extensions ▸ Apps Script. Delete whatever is there, paste this file.
 *  3. Set TOKEN below to the same random string you put in config.js.
 *  4. Check TAB_PARENTS / TAB_PRIVATE match your real tab names exactly.
 *  5. Deploy ▸ New deployment ▸ type "Web app".
 *        Execute as:  Me
 *        Who has access:  Anyone
 *     Copy the /exec URL into config.js -> ENDPOINT.
 *  6. When you later edit this script, Deploy ▸ Manage deployments ▸ edit ▸
 *     Version: New version ▸ Deploy (the URL stays the same).
 *
 * The web app appends one row per request in the order:  Date | Description | Amount
 */

var TOKEN        = "change-me-to-a-random-string";  // MUST match config.js TOKEN
var TAB_PARENTS  = "Parents";                        // tab for parent-covered expenses
var TAB_PRIVATE  = "Private";                        // tab for private expenses
var HEADERS      = ["Date", "Description", "Amount"];// written only if a tab is empty

function doPost(e) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var body = JSON.parse(e.postData.contents || "{}");

    if (String(body.token) !== String(TOKEN)) {
      return json({ ok: false, error: "bad token" });
    }

    var tabName = resolveTab(body.tab);
    var sheet = getOrCreateTab(tabName);

    var when = parseDate(body.date);
    var desc = String(body.description || "").trim();
    var amount = Number(body.amount);

    if (!desc) return json({ ok: false, error: "empty description" });
    if (!isFinite(amount) || amount <= 0) return json({ ok: false, error: "bad amount" });

    // idempotency: a retry after a flaky connection must not double-post
    if (body.id && isSeen(body.id)) {
      return json({ ok: true, dedup: true });
    }

    sheet.appendRow([when, desc, amount]);
    if (body.id) markSeen(body.id);

    return json({ ok: true, tab: tabName, row: sheet.getLastRow() });
  } catch (err) {
    return json({ ok: false, error: String(err) });
  } finally {
    lock.releaseLock();
  }
}

function doGet() {
  return json({ ok: true, service: "ExpenseTracker", tabs: [TAB_PARENTS, TAB_PRIVATE] });
}

/* ---------- helpers ---------- */

function resolveTab(raw) {
  var t = String(raw || "").trim().toLowerCase();
  if (t === "private" || t === TAB_PRIVATE.toLowerCase()) return TAB_PRIVATE;
  if (t === "parents" || t === TAB_PARENTS.toLowerCase()) return TAB_PARENTS;
  // fall back: treat an exact given name as-is, else default to parents
  return raw || TAB_PARENTS;
}

function getOrCreateTab(name) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]).setFontWeight("bold");
    sheet.setFrozenRows(1);
  } else if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]).setFontWeight("bold");
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function parseDate(s) {
  // expects "YYYY-MM-DD"; build a local Date so the Sheet stores a real date value
  var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || ""));
  if (!m) return new Date();
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

function isSeen(id) {
  var raw = PropertiesService.getScriptProperties().getProperty("seen");
  return !!raw && JSON.parse(raw).indexOf(id) !== -1;
}

function markSeen(id) {
  var p = PropertiesService.getScriptProperties();
  var arr = JSON.parse(p.getProperty("seen") || "[]");
  arr.push(id);
  if (arr.length > 300) arr = arr.slice(-300);
  p.setProperty("seen", JSON.stringify(arr));
}

function json(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
