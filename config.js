/* ============================================================================
 *  ExpenseTracker – configuration
 *  Edit this file, commit, done. Nothing else here needs touching for setup.
 * ==========================================================================*/
window.CONFIG = {
  /* Paste the /exec URL of your deployed Apps Script Web App here.
     (README.md -> "2. Google Sheet setup" walks through getting it.) */
  ENDPOINT: "https://script.google.com/macros/s/AKfycbzeo3e5Hl4fLDM1CswgmoeY6Pm5yvELI8zA-cMKgXjTs-R0UXESGTZfdOHWAcimj2g0/exec",

  /* Shared secret – must match TOKEN in Code.gs. Change it to any random string.
     It only stops random people who find the URL from writing to your sheet. */
  TOKEN: "exp-7h3k9q2p",

  /* Currency shown in the UI. Sent value is always a plain number. */
  CURRENCY: "€",

  /* Language for the microphone / voice entry (BCP-47 tag). */
  VOICE_LANG: "de-DE",

  /* Which sheet tab each class writes to. Must match the tab names in Code.gs. */
  TABS: { parents: "Parents", private: "Private" },

  /* Quick-pick description buttons.
     - "parents" buttons show only while the Parents mode is selected
     - "private" buttons show only while the Private mode is selected
     - "both"    buttons always show
     Only `label` is written to the sheet; `emoji` is cosmetic. Edit freely. */
  DESCRIPTIONS: {
    parents: [
      { emoji: "🛒", label: "Lebensmittel" },
      { emoji: "🍽️", label: "Essen" },
      { emoji: "🚆", label: "Bahn Fahrt" },
      { emoji: "🩺", label: "Krankenkasse" },
      { emoji: "👕", label: "Kleidung" }
    ],
    private: [
      { emoji: "🎉", label: "Freizeit" },
      { emoji: "⛽", label: "Tankstelle" }
    ],
    both: [
      { emoji: "🧾", label: "Sonstiges" }
    ]
  },

  /* Seconds an entry can be undone before it is committed to the sheet.
     During this window it sits locally; Undo cancels it with zero server calls. */
  UNDO_SECONDS: 5
};
