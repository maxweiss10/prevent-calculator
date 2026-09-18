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
node verification/parsing/units-integration-test.js
node verification/parsing/guideline-units-test.js
node verification/parsing/robustness-test.js
node verification/parsing/edge-generator.js   # expects a 0.00% false-alarm rate
```

`units-integration-test.js` closes the parse-to-risk loop: it asserts that the
same patient written in mmol/L and in mg/dL produces an identical risk across
every model, both sexes and both horizons. The parser never converts units, it
only reports which one it saw, so a unit that fails to reach the engine would be
silently wrong in a way no parsing assertion can catch.

`guideline-units-test.js` does the same for the recommendation layer. The
guideline is written entirely in mg/dL and the page converts at the boundary, so
a missed conversion would leave the risk number untouched while quietly changing
the treatment advice. It asserts an identical pathway, headline, goals and
category in both unit systems across every pathway the guideline has.

`robustness-test.js` is the crash floor: empty input, an unresolved SmartPhrase
template, CRLF, non-breaking spaces, HTML, JSON, emoji, a 40 KB line, regex
metacharacters and unterminated brackets. The parser must never throw and never
emit NaN or Infinity.

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
- `cases-bmi.json` — every layout BMI arrives in: `@LASTBMI(n)@` reading lists
  with each separator, result-table rows, prose, obesity-class descriptors, and
  height/weight without a BMI.
- `cases-targets-family.json` — treatment targets ("LDL goal <70") and relatives'
  values, neither of which is a measurement of this patient. These leak into
  *every* numeric field if unguarded.
- `cases-lab-layouts.json` — result-table column orders (including Ref Range
  before Value), reference-lab report styles, and the distractor numbers in a
  note header: MRN, DOB, phone, room, order ids, other vitals, and a metabolic
  panel.
- `cases-prose.json` — narrative clinic notes rather than SmartLink output: the
  clinic one-liner, ages written "58 yo M" / "74-year-old woman", and the
  relatives who appear mid-sentence ("his wife has diabetes").
- `cases-ordering.json` — which of several candidate values wins: dated rows
  sorted oldest-first, the boundary between a treatment target and the reading
  that follows it on the same line, two records pasted together, and dual-unit
  lab reports.
- `cases-tense-and-owner.json` — tense and ownership: a drug the plan intends,
  offers or has already failed versus one the patient takes; a then/now pair; a
  clause that calls its own value old; and specimens belonging to a transplant
  donor or a fetus.

Most bugs found so far fall into three classes, which is the most productive
place to aim a new case:

1. **Whose value is it?** Family history, treatment targets, resolved problems,
   a spouse's smoking, a donor's creatinine, a fetus's measurements. The number
   is real but describes someone or something other than this patient now.
2. **Which number is it?** A reference-range bound, a date component, a dose, a
   hyphenated word ("4-variable"), the first two digits of a longer number, or a
   neighbouring analyte's row. The parser anchors on a label and then grabs the
   wrong nearby number.
3. **Is the polarity right?** "No changes to" versus "no", planned versus
   current, "at goal" versus a goal, failed versus taking, never versus former.

A fourth rule cuts across all of them: whatever the primary parser learns,
`parseIndependent` must learn too, or the cross-check disagrees with a correct
value and trains the reader to ignore it.

The governing rule for every expectation: **a wrong value is far worse than a
blank.** When the text is genuinely ambiguous — a resolved diagnosis, a held
drug, a creatinine drawn during AKI — the expected result is blank, so the
clinician decides.
