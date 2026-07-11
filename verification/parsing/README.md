# Parser test harness

These tests exercise the **text parser** in [`app.js`](../../app.js) (the code that
scrapes values out of pasted Epic text). They are separate from the math oracle in
[`../`](../), which verifies the risk engine against CRAN `preventr`.

## Philosophy: ground truth first, then render

To avoid a circular test (writing inputs that happen to match the parser's own
regexes), `edge-generator.js` defines **ground-truth patient data first**, then renders
it into Epic-like text using formatting conventions and **real drug/lab names drawn from
clinical knowledge** — deliberately including many the parser was *not* written around
(brand-name antihypertensives, `NIDDM`/`IDDM`/`DMII`, vertical lab layouts, leading
reference ranges, `>60` thresholds, µmol/L units, `@LASTBP(3)@` dated lists). A failure
= the parser doesn't recover what a clinician reading the text would.

The first run of this generator found **real bugs** (brand drugs undetected, `NIDDM`
silently read as "no diabetes", a vertical-layout eGFR miscomputed as 4 via a creatinine
false-match, leading `[125-200]` ranges grabbed as the value). Those are now fixed; the
generator is kept as a regression guard.

## Files

| File | What it does |
|------|--------------|
| `edge-generator.js` | Generates N cases from ground truth, renders diverse Epic text, checks recovery. `SEED=<n> N=<count> node edge-generator.js`. Writes `edge-results.json`. |
| `adversarial-probe.js` | Hand-crafted inputs in formats the parser was intentionally *not* tuned for — finds the current frontier. |
| `audit-test.js` | Unit tests for the audit fixes (missing-data, thresholds, negation, section awareness, cross-field). |
| `integration-test.js` | Full realistic dot-phrase pastes end-to-end. |

## Differential cross-check (independent second parser)

`app.js` runs a **second, independent parser** (`parseIndependent`) alongside the primary
one and compares them (`crossCheck`). The two use deliberately different algorithms:

- **Primary** — *label-anchored*: find "eGFR", read the number after it.
- **Second** — *number/unit harvesting*: collect every number with its unit and same-line
  context, classify by physiologic magnitude; independently **derive eGFR from any serum
  creatinine** as an extra check on the single most dangerous field.

The primary parser's values are always what the app uses. When the two disagree on a
field, the UI keeps the primary value but flags it **red** ("parsers disagree — check").
The second parser is tuned for **precision over recall** — it abstains when unsure — so a
flag is meaningful. Measured on the 5×1000-case harness: **98.7% of fields actively
agree, ~1.3% abstain (unconfirmed), 0.00% false alarms.** It catches, e.g., a stated eGFR
that is contradicted by the serum creatinine (stale value pasted next to a current Cr).

## Current status

- `edge-generator.js`: **100%** field-level recovery across 6 seeds × 1000 cases (~69k assertions).
- `audit-test.js`: 43/43. `integration-test.js`: 26/26.
- `adversarial-probe.js`: 19/24 — the 5 failures are **documented known limitations**, not bugs:

| Not handled | Why it's left alone |
|-------------|---------------------|
| `BP 138 over 82`, `BP 138, 82` | Epic prints `/`; a bare comma is too ambiguous to parse safely |
| `Cholesterol 5.4 mmol/L` | The app works in mg/dL with a **manual mmol/L toggle**; auto-switching units from free text is unsafe |
| `Chol 210 / HDL 45 / LDL 130` | Loosening the slash guard that (correctly) rejects "Chol/HDL ratio" would create false positives |
| `Pt is a smoker` (bare prose) | Matching bare "smoker" would false-match "non-smoker" / "former smoker" |

Every parsed value lands in an **editable, verify-flagged form**, so these degrade to a
blank field the user fills in — never a silently wrong number.
