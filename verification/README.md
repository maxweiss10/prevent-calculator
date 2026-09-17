# Verification

`test.js` runs the JS engine against a frozen grid of reference outputs
(`grid.jsonl`) produced by the CRAN **preventr** package (the oracle) and asserts
an exact match at the package's 3-decimal output.

```bash
node verification/test.js
# Compared 10000 outcome-values across 1000 cases.
# Mismatches (>5e-4): 0
# Max abs diff: 0.000e+0
# ALL PASS
```

`grid.jsonl` covers all 5 outcomes (total CVD, ASCVD, heart failure, CHD, stroke),
both sexes, both horizons (10/30-yr), all 5 models (base/HbA1c/UACR/SDI/full), and the
spline knots (SBP 110, BMI 30, eGFR 60). To regenerate it you need R with the
`preventr` package installed (`install.packages("preventr")`); the generator script
lives in the project history.

## Parsing

The parser has its own suites under `verification/parsing/`. Run all of them
before pushing any change to `app.js`:

```bash
node verification/parsing/audit-test.js
node verification/parsing/integration-test.js
node verification/parsing/adversarial-probe.js
node verification/parsing/run-cases.js verification/parsing/cases-*.json
node verification/parsing/edge-generator.js   # expects a 0.00% false-alarm rate
```

`run-cases.js` is a data-driven runner: each `cases-*.json` file is a list of
`{name, text, want, note}` records, where `want` names only the fields that case
cares about and `null` means the field MUST be left blank. It also checks
`wantFound`, `wantThreshold`, `wantConflict`, and `wantAnnotate`. Add a case
rather than a bespoke script whenever a new paste layout turns up:

- `cases-negation-traps.json` — family history, allergies, discontinued/held
  medications, resolved problems, and the many ways a note says "not a smoker"
  or "no diabetes". These are the cases where a wrong Yes changes the risk score
  and the guideline pathway.
- `cases-layout-units.json` — Epic lab-row naming, SI (mmol/L and µmol/L) panels,
  reference-range columns, and decimal-comma formats.

The governing rule for every expectation: **a wrong value is far worse than a
blank.** When the text is genuinely ambiguous — a resolved diagnosis, a held
drug, a creatinine drawn during AKI — the expected result is blank, so the
clinician decides.
