/* ============================================================================
 *  ExpenseTracker – configuration
 *  Edit this file, commit, done. Nothing else here needs touching for setup.
 * ==========================================================================*/
window.CONFIG = {
  /* Paste the /exec URL of your deployed Apps Script Web App here.
     (README.md -> "2. Google Sheet setup" walks through getting it.) */
  ENDPOINT: "PASTE_YOUR_APPS_SCRIPT_EXEC_URL_HERE",

  /* Shared secret – must match TOKEN in Code.gs. Change it to any random string.
     It only stops random people who find the URL from writing to your sheet. */
  TOKEN: "change-me-to-a-random-string",

  /* Currency shown in the UI. Sent value is always a plain number. */
  CURRENCY: "€",

  /* Which sheet tab each class writes to. Must match the tab names in Code.gs. */
  TABS: { parents: "Parents", private: "Private" },

  /* Quick-pick description buttons. Reorder / edit freely – most used first. */
  DESCRIPTIONS: [
    "Lebensmittel",
    "Essen",
    "Bahn Fahrt",
    "Krankenkasse",
    "Drogerie",
    "Kleidung",
    "Freizeit",
    "Sonstiges"
  ],

  /* Seconds an entry can be undone before it is committed to the sheet.
     During this window it sits locally; Undo cancels it with zero server calls. */
  UNDO_SECONDS: 5
};
