# Epic PREVENT SmartPhrase

The calculator scrapes the values out of whatever you paste, so the SmartPhrase's only job is to
**dump the data** — you don't type it. Build it once in **SmartPhrase Manager** and name it whatever
you like, or just **borrow `.MWPREVENT` from Max Weiss** instead of building your own. In a note, type
your dot phrase, then select-all → copy → paste into the calculator.

## The dot phrase

This uses one working **UCSF** SmartLink set — swap in your build's tokens if they differ. Whatever
they print, the parser reads it.

```
PREVENT INPUTS
Age: @AGE@
Sex: @SEX@
BP: @LASTBP(3)@
BMI: @BMI@
Cholesterol: @BRIEFLAB(CHOL,HDL)@
eGFR: @NEPHEGFR@
Problems: @PROB@
HTN Meds: @HTNMEDS@
Statin: @STATINS@
Social Hx: @TOBHX@
```

Anything auto-*detected* from meds/problems/social history is flagged **amber ("verify")** in the app
and listed with the evidence it matched — because a list can't always convey intent (e.g. a β-blocker
or diuretic may not be for blood pressure). Always confirm those. Per token:

- `@AGE@ @SEX@ @BMI@` — demographics/vitals. `@LASTBP(3)@` prints the last 3 BP readings; the app
  takes the systolic of the **most recent** one (and isn't fooled by the dates).
- `@BRIEFLAB(CHOL,HDL)@` and `@NEPHEGFR@` — the app pulls Total chol, HDL, and eGFR out of the
  result tables (and computes eGFR from creatinine if only that is shown).
- `@PROB@` / `@HTNMEDS@` / `@STATINS@` / `@TOBHX@` — problem list, focused HTN-med and statin lists,
  and tobacco history. The app detects **diabetes** (from problems), and reads the focused lists
  directly: a **"No current … medications"** line ⇒ that flag is **No**; a listed drug ⇒ **Yes**.
  Smoking comes from the tobacco status (Never/Former/Current). All four are marked "verify."
- Other builds: common equivalents include `@BP@`, `@BRIEFLABS()@`, `@PROBLEMLIST@`,
  `@CURMEDS@`/`@OUTMEDS@`, `@SMOKINGSTATUS@`. If a token doesn't resolve, use your build's equivalent
  or just type that one value into the form.
- To add the SDI/full model, include a `City/State/ZIP: @CTYSTZIP@` line — the app pulls the ZIP.

## Manual fallback (works everywhere, no setup)

Prefer to type it all, or don't have the SmartLinks? Every value can be a `***` wildcard:

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
2. **New SmartPhrase**, name it whatever you like — or **borrow `.MWPREVENT` from Max Weiss** instead
   of building your own.
3. Paste the block. `@...@` become SmartLinks automatically; leave any `***` wildcards as-is.
4. **Save.**
5. In a note: type your dot phrase, let it fill, **F2** through any wildcards, select-all, copy,
   paste into the calculator.

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
| ZIP → SDI decile | add `@CTYSTZIP@` (not in the default phrase) | optional; app pulls the 5-digit ZIP → SDI/full model |

Out-of-range or blank optional values (HbA1c/UACR/ZIP) are ignored → base model. Provide any of
them to also get the corresponding enhanced model. Every value lands in an editable form, so fix
anything before reading the result.
