# ExpenseTracker

A one‑screen web app for logging an expense in a few taps and pushing it
straight into your expenses Google Sheet. Mobile‑first, installable (PWA),
works offline and syncs when you're back online.

Each entry, in order: **Date → Description → Amount**, plus a
**Parents / Private** switch that routes the row to the matching sheet tab.

---

## How it works

```
 phone/browser  ──POST(JSON)──▶  Apps Script Web App  ──appendRow──▶  Google Sheet
   (this site)   fire & forget      (runs as you)        Parents / Private tab
```

No API keys, no backend server, no per‑device login. The Apps Script runs as
your own Google account, so it already has permission to write both tabs.

---

## 1. Put the files online (GitHub Pages)

From this folder:

```bash
git add .
git commit -m "ExpenseTracker app"
git push
```

Then on GitHub: **Settings ▸ Pages ▸ Build and deployment**
- Source: **Deploy from a branch**
- Branch: **main** / **/ (root)** ▸ Save

After ~1 minute your app is at
`https://gittercritterboy.github.io/ExpenseTracker/`
(open it on your phone once, then **Add to Home Screen**).

It will load but say *"Set ENDPOINT in config.js"* until step 2 is done.

---

## 2. Google Sheet setup (one time, ~5 min)

1. Open your expenses Google Sheet. Note the exact names of the two tabs
   (the parent‑covered one and the private one).
2. **Extensions ▸ Apps Script.** Delete the sample code, paste the contents of
   [`apps-script/Code.gs`](apps-script/Code.gs).
3. At the top of that script set:
   - `TOKEN`  – any random string (e.g. mash the keyboard).
   - `TAB_PARENTS` / `TAB_PRIVATE` – your real tab names.
4. **Deploy ▸ New deployment ▸** gear icon ▸ **Web app**
   - *Execute as:* **Me**
   - *Who has access:* **Anyone**
   - Deploy, authorise the permission prompt, **copy the Web app `/exec` URL**.
5. Quick check: open that URL in a browser — you should see
   `{"ok":true,"service":"ExpenseTracker",...}`.

> Editing the script later: **Deploy ▸ Manage deployments ▸** edit (pencil) ▸
> *Version: New version* ▸ Deploy. The URL stays the same.

---

## 3. Point the app at your sheet

Edit [`config.js`](config.js):

```js
ENDPOINT: "https://script.google.com/macros/s/AKfy...../exec",   // from step 2.4
TOKEN:    "the-same-random-string-as-in-Code.gs",
TABS:     { parents: "Parents", private: "Private" },            // match your tabs
```

`commit` + `push`. Reload the app (if installed, close and reopen it once so the
service worker picks up the new `config.js`).

That's it — entries now land in the sheet.

---

## Speed features already built in

| Feature | Why it's faster |
|---|---|
| Amount field is **auto‑focused** on open, `inputmode="decimal"` | numeric keypad appears immediately; accepts `12,34` or `12.34` |
| **Parents/Private** defaults to *Parents*, one tap to switch | no dropdown, no per‑entry decision most of the time |
| Date defaults to **today**; `Today / Yesterday / 2 days ago` chips + calendar | the common case is zero taps |
| Description **quick‑pick chips** (editable list in `config.js`) | one tap instead of typing |
| Free‑text description with **autocomplete** from your own history | past entries come back with 2–3 letters |
| `Enter` in description jumps to amount; `Enter` in amount **submits** | full keyboard entry, no reaching for the button |
| After save the form **keeps date + class, clears the rest, re‑focuses amount** | rapid-fire multiple entries |
| **Undo** for 5 s (configurable) before anything is sent | fix a mistake with no server round‑trip |
| **Offline queue** + auto‑sync, closes‑safe via `sendBeacon` | log on the Bahn with no signal, it syncs later |
| Installable PWA, full‑screen, own home‑screen icon | opens like a native app |

### Ideas to go even faster later
- **Share‑sheet / URL entry**: open `.../index.html?amount=4.20&desc=Essen` prefilled — lets you make an iOS/Android shortcut or widget.
- **Last‑amount memory per description** (e.g. Krankenkasse is always the same number) → offer it as a one‑tap default.
- **Voice**: a mic button using the Web Speech API to parse "Lebensmittel zwölf euro fünfzig".
- **Monthly totals** pulled back from the sheet via a `doGet` summary, shown on the screen.

---

## Files

| File | Purpose |
|---|---|
| `index.html` / `styles.css` / `app.js` | the app |
| `config.js` | **the only file you edit** for setup |
| `sw.js` / `manifest.webmanifest` / `icons/` | PWA / offline |
| `apps-script/Code.gs` | paste into the Sheet's Apps Script editor |

## Troubleshooting

- **Entries stay "to sync".** `ENDPOINT` still the placeholder, or the deployment
  isn't *Anyone* access. Re‑check step 2.4.
- **`{"ok":false,"error":"bad token"}`.** `TOKEN` in `config.js` ≠ `TOKEN` in `Code.gs`.
- **Rows in the wrong tab.** `TABS` values in `config.js` must equal the tab names
  in `Code.gs` / the sheet.
- **Old version keeps loading after a change.** Bump `CACHE` in `sw.js`, or on the
  phone remove and re‑add the app once.
