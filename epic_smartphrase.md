# Epic `.PREVENT` SmartPhrase

The calculator does **not** need a rigid format. It scrapes the values out of whatever
you paste — a `.PREVENT` SmartPhrase, a raw `@BRIEFLABS()@` lab dump, a results view, or
free-text note. You don't have to type each value. Anything it can't find, you fill in the
browser form (which is fully editable). So the SmartPhrase's job is just to **dump the data**,
not to format it perfectly.

Two versions:

- **Version A — auto-pull with `@BRIEFLABS()@` (recommended).** SmartLinks pull age, sex,
  BP, BMI, and a block of recent labs. You answer four Yes/No questions. The calculator
  scrapes Total chol, HDL, HbA1c, eGFR (or computes it from creatinine), and UACR out of
  the lab block.
- **Version B — all-manual.** Every value a `***` wildcard. Works in any build, zero setup.

Press **F2** to jump between wildcards.

---

## Version A — auto-pull (recommended)

```
PREVENT INPUTS
Age: @AGE@
Sex: @SEX@
BP: @BP@
BMI: @BMI@
Diabetes: ***
Current smoker: ***
On antihypertensive: ***
On statin: ***
ZIP (optional): ***
Labs: @BRIEFLABS()@
```

- `@AGE@ @SEX@ @BP@ @BMI@` are standard foundation SmartLinks and should resolve at UCSF.
  (The calculator takes the systolic number from `@BP@`'s "148/86".)
- `@BRIEFLABS()@` prints a compact list of recent labs. The calculator finds the
  PREVENT-relevant ones anywhere in that text — abbreviations and formats like
  `Chol 210`, `HDL 39`, `A1C 7.4`, `eGFR 90`, `Cr 0.9`, `Microalbumin/Creatinine Ratio 512`
  all work. It ignores the labs it doesn't need (Na, K, glucose, CBC…).
- If your `@BRIEFLABS()@` doesn't include a lab you want (some builds limit it to a chem/CBC
  panel), either pass parameters / add that component's result SmartLink, or just type the
  one value into the form. **eGFR is optional in the dump** — if only creatinine is present,
  the calculator computes eGFR with the CKD-EPI 2021 (race-free) equation and flags that it did.
- The four Yes/No lines are clinical judgments. The calculator understands `Yes`/`No` and
  also `Never`/`Former` (→ not a current smoker), `T2DM`, `active`, `denies`, etc.

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

## Create the SmartPhrase in Epic

1. Open **SmartPhrase Manager** (search "SmartPhrase Manager", or **Epic → Tools →
   SmartPhrase Manager**).
2. **New SmartPhrase**, name it `PREVENT` (so you invoke it with `.prevent`).
3. Paste one of the blocks above. The `@...@` tokens are recognized as SmartLinks
   automatically; leave the `***` wildcards as-is.
4. **Save.**
5. In a note: type `.prevent`, let the SmartLinks fill, press **F2** through the four
   Yes/No wildcards, then select the block, copy, and paste into the calculator.

> You don't even need the SmartPhrase to try it: paste any Epic labs view or note and the
> calculator will scrape what it can. The SmartPhrase just makes it one keystroke.

---

## What each value is used for

| Field | Source in Version A | Notes |
|-------|---------------------|-------|
| Age | `@AGE@` | 30–79 (30-yr risk validated to 59) |
| Sex | `@SEX@` | sex-specific equations |
| Systolic BP | `@BP@` (systolic taken) | 90–180 mmHg |
| BMI | `@BMI@` | 18.5–39.9 kg/m² |
| Total cholesterol | `@BRIEFLABS()@` | mg/dL 130–320 (mmol/L toggle in app) |
| HDL | `@BRIEFLABS()@` | non-HDL derived as Total − HDL |
| eGFR | `@BRIEFLABS()@` or computed from creatinine | CKD-EPI 2021; 15–140 |
| HbA1c *(optional)* | `@BRIEFLABS()@` | % 4.5–15 → HbA1c/full model |
| UACR *(optional)* | `@BRIEFLABS()@` | mg/g 0.1–25000 → UACR/full model |
| Diabetes / Smoker / Antihypertensive / Statin | Yes/No wildcards | current smoking only |
| ZIP *(optional)* | wildcard | → Social Deprivation Index decile → SDI/full model |

Optional values that are blank or out of range are ignored (you get the base model).
Provide any of HbA1c / UACR / ZIP to also get the corresponding enhanced model.
