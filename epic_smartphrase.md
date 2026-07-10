# Epic `.PREVENT` SmartPhrase

This SmartPhrase prints one labeled value per line. Copy the whole block, paste it
into the [PREVENT calculator](https://maxweiss10.github.io/prevent-calculator/), and
it parses every line automatically. The labels below are exactly what the calculator
looks for, so **keep the label text unchanged** — you can change the values freely.

There are two versions:

- **Version A — auto-pull (recommended).** Uses Epic SmartLinks for the data Epic
  stores discretely (age, sex, blood pressure, BMI). You fill the rest.
- **Version B — all-manual.** Every value is a `***` wildcard. Works in any Epic
  build with zero setup. Press **F2** to jump between wildcards.

The calculator's form is fully editable, so anything that doesn't auto-resolve you
just type in the browser before computing. Nothing has to be perfect in Epic.

---

## Version A — auto-pull (recommended)

```
PREVENT INPUTS
Age: @AGE@
Sex: @SEX@
Blood pressure: @BP@
BMI: @BMI@
eGFR: ***
Total cholesterol: ***
HDL: ***
Diabetes: ***
Current smoker: ***
On antihypertensive: ***
On statin: ***
HbA1c (optional): ***
UACR (optional): ***
ZIP (optional): ***
```

- `@AGE@`, `@SEX@`, `@BP@` (most recent BP — the calculator uses the systolic
  number), and `@BMI@` are standard foundation SmartLinks and should resolve at UCSF.
- Replace the `***` after each **lab** (eGFR, Total cholesterol, HDL, HbA1c, UACR)
  with your most-recent-result SmartLink if you want those to auto-pull too — see
  **"Auto-pulling labs"** below. Left as `***`, you just type the value (or fill it
  in the browser).
- The four Yes/No lines (Diabetes, Current smoker, On antihypertensive, On statin)
  are clinical judgments — answer `Yes` or `No`. The calculator also understands
  `Never`/`Former` (→ not a current smoker), `T2DM`, `active`, `denies`, etc.

## Version B — all-manual (works everywhere, no setup)

```
PREVENT INPUTS
Age: ***
Sex: ***
SBP: ***
Total cholesterol: ***
HDL: ***
Diabetes: ***
Current smoker: ***
BMI: ***
eGFR: ***
On antihypertensive: ***
On statin: ***
HbA1c (optional): ***
UACR (optional): ***
ZIP (optional): ***
```

---

## How to create the SmartPhrase in Epic

1. In Epic, open **SmartPhrase Manager** (search "SmartPhrase Manager" in the
   Epic search box, or **Epic button → Tools → SmartPhrase Manager**).
2. **New SmartPhrase**. Name it `PREVENT` (so you invoke it by typing `.prevent`).
   Give it a summary like "PREVENT risk inputs".
3. Paste one of the blocks above into the content area.
4. The `@...@` tokens are recognized as SmartLinks automatically (they turn into
   fields). The `***` are wildcards — leave them as-is.
5. **Accept / Save**.
6. In any note, type `.prevent` and press Enter. Epic drops in the block, fills the
   SmartLinks, and lands you on the first wildcard. Press **F2** to move to the next.
7. Select the whole block (click at the start, shift-click at the end) → **Ctrl-C**
   → paste into the calculator.

> Tip: keep the note text and just re-run `.prevent` on your next patient; the
> SmartLinks refresh to that patient automatically.

---

## Auto-pulling labs (optional upgrade)

Lab-result SmartLinks are component-specific and differ between Epic builds, so
there's no single universal token to hard-code. To make a lab auto-pull:

1. In the SmartPhrase editor, put your cursor where the value goes (after
   `Total cholesterol: `).
2. Click **Insert SmartLink** (or type `@` and start the name).
3. Search for the result component (e.g., **cholesterol**, **HDL**, **A1C**,
   **creatinine/eGFR**, **microalbumin/creatinine**) and pick the
   "most recent result value" SmartLink your org exposes.
4. Repeat per lab. Ask a UCSF Epic analyst or a co-resident which lab-result
   SmartLinks are enabled if you can't find them — many orgs name them like
   `@LATESTLABVALUE(...)@` or expose them as SmartData elements.

If you'd rather not bother, leave the labs as `***` — typing five numbers takes a
few seconds, and the browser form is right there to correct anything.

---

## Faster Yes/No (optional upgrade)

To click instead of type the four Yes/No answers, build a tiny SmartList:

1. **SmartList** editor (or ask an analyst) → new SmartList named e.g. `YESNO`
   with two choices: `Yes`, `No` (single-select).
2. In the SmartPhrase, replace each `***` on the Diabetes / Current smoker /
   On antihypertensive / On statin lines with `{YESNO:your_id}`.
3. Now those lines become one-click pick-lists.

---

## What each value means for PREVENT

| Line | PREVENT input | Notes |
|------|---------------|-------|
| Age | age (30–79) | 30-year risk only validated to 59 |
| Sex | female/male | uses sex-specific equations |
| Blood pressure / SBP | systolic BP (90–180 mmHg) | calculator takes the systolic number |
| Total cholesterol | mg/dL (130–320) | toggle to mmol/L in the app if needed |
| HDL | mg/dL (20–100) | non-HDL is derived as Total − HDL |
| Diabetes | yes/no | |
| Current smoker | yes/no | **current** use; former/never = No |
| BMI | kg/m² (18.5–39.9) | |
| eGFR | mL/min/1.73m² (15–140) | CKD-EPI 2021 (Epic's eGFR) |
| On antihypertensive | yes/no | changes the BP term |
| On statin | yes/no | changes the non-HDL term |
| HbA1c *(optional)* | % (4.5–15) | enables the HbA1c / full model |
| UACR *(optional)* | mg/g (0.1–25000) | enables the UACR / full model |
| ZIP *(optional)* | 5-digit | maps to Social Deprivation Index decile → SDI/full model |

Optional values that are blank or out of range are simply ignored (you get the base
model). Provide any of HbA1c / UACR / ZIP to also get the corresponding enhanced model.
