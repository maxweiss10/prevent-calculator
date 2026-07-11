# Epic `.PREVENT` SmartPhrase

The calculator doesn't need a rigid format — it scrapes the values out of whatever you paste.
So the SmartPhrase's only job is to **dump the data**; you don't type it. Three versions,
from most-automated to fully manual:

- **Full auto (recommended).** Pulls age/sex/BP/BMI, a labs block (`@BRIEFLABS()@`), and your
  problem list, med list, and social history. The calculator scrapes the labs **and** detects
  diabetes, statin use, antihypertensive use, and smoking status from those lists — nothing to type.
- **Labs only.** Auto-pulls demographics + labs; you answer the four Yes/No questions as `***`
  wildcards.
- **Manual.** Every value a `***` wildcard; works in any build with zero setup.

Anything auto-*detected* from meds/problems/social history is flagged **amber ("verify")** in the
app and listed with the evidence it matched — because a list can't always convey intent (e.g. a
β-blocker or diuretic may not be for blood pressure). Always confirm those four.

Press **F2** to jump between wildcards.

---

## Full auto (recommended)

```
PREVENT INPUTS
Age: @AGE@
Sex: @SEX@
BP: @BP@
BMI: @BMI@
ZIP (optional): ***
Labs: @BRIEFLABS()@
Problems: @PROB@
Meds: @MEDS@
Social Hx: @SOCIALHX@
```

- `@AGE@ @SEX@ @BP@ @BMI@` — standard foundation SmartLinks (systolic taken from `@BP@`).
- `@BRIEFLABS()@` — recent labs; the app finds Total chol, HDL, HbA1c, eGFR (or computes it from
  creatinine), and UACR anywhere in it.
- `@PROB@` / `@MEDS@` / `@SOCIALHX@` — problem list / medication list / social history. The app
  detects **diabetes** (from problems), **statin** and **antihypertensive** (from meds, ignoring
  allergy/discontinued lines), and **smoking status** (from social hx). Detected values are marked
  "verify."
- Token names vary a little by build: if `@PROB@`, `@MEDS@`, or `@SOCIALHX@` don't resolve, use your
  build's equivalents (e.g. `@PROBLEMLIST@`, `@CURMEDS@`/`@OUTMEDS@`, `@SMOKINGSTATUS@`). Whatever
  they print, the calculator scrapes it.

## Labs only

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

## Manual (works everywhere, no setup)

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

1. **SmartPhrase Manager** (search it, or **Epic → Tools → SmartPhrase Manager**).
2. **New SmartPhrase**, name it `PREVENT` (invoke with `.prevent`).
3. Paste one of the blocks. `@...@` become SmartLinks automatically; leave `***` wildcards as-is.
4. **Save.**
5. In a note: `.prevent`, let it fill, **F2** through any wildcards, select-all, copy, paste into
   the calculator.

> You don't even need the SmartPhrase to try it — paste any labs view or note and it scrapes what
> it can. The SmartPhrase just makes it one keystroke.

---

## What the app detects, and how reliably

| Field | Source | Reliability |
|-------|--------|-------------|
| Age, Sex, SBP, BMI | SmartLinks | discrete — high |
| Total chol, HDL, HbA1c, eGFR, UACR | labs block | high (eGFR computed from creatinine if absent, flagged) |
| **Smoking** | social hx | high (uses the discrete status: Never / Former / Current …) |
| **Statin** | med list | high — matched by statin drug names (nystatin excluded) |
| **Antihypertensive** | med list | medium — β-blockers/diuretics may be for other indications ⇒ **verify** |
| **Diabetes** | problem list | medium — excludes pre-diabetes, gestational, family hx, diabetes insipidus ⇒ **verify** |
| ZIP → SDI decile | wildcard | optional |

Out-of-range or blank optional values (HbA1c/UACR/ZIP) are ignored → base model. Provide any of
them to also get the corresponding enhanced model. Every value lands in an editable form, so fix
anything before reading the result.
