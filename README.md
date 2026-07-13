# PREVENT Risk Calculator

A tiny, browser-only calculator for the **American Heart Association PREVENT™
equations**. Paste an Epic `.PREVENT` SmartPhrase — or any Epic text that contains the
values (a `@BRIEFLABS()@` dump, a results view, a note) — verify the scraped values, and
get 10- and 30-year risk of **Total CVD, ASCVD, and Heart Failure** (plus CHD and stroke).

**Live app:** https://maxweiss10.github.io/prevent-calculator/

- **No data leaves your browser, and nothing is even fetched.** All computation is
  client-side with zero network requests after the page loads.
- **ZIP code is not accepted.** A 5-digit ZIP is a HIPAA identifier (PHI), so the app
  neither takes nor looks up ZIP. Enter an SDI decile (1–10, not identifying) directly
  for the SDI/full model.
- **Base + enhanced models.** Add HbA1c, UACR, and/or an SDI decile to also get the
  HbA1c, UACR, SDI, or full models — exactly as the AHA calculator does.
- **Scrapes unstructured text.** You don't have to type each value. It pulls labs and
  vitals out of messy Epic output (e.g. `Chol 210, HDL 39`, `A1C 7.4`, `eGFR 90`,
  `148/86`), and computes eGFR from serum creatinine (CKD-EPI 2021) when eGFR isn't given.
- **Detects the Yes/No flags too.** From a pasted problem list / med list / social history
  (`@PROB@` / `@MEDS@` / `@SOCIALHX@`) it detects diabetes, statin use, antihypertensive
  use, and smoking status — positive-evidence only, with guards (excludes pre-diabetes,
  diabetes insipidus, family history, nystatin, allergy/discontinued lines) — and flags each
  as "auto-detected, verify" with the matched evidence.
- **Editable form.** Pasting pre-fills the form; you can correct anything before
  computing. Values out of the validated ranges are flagged; out-of-range optional
  predictors are ignored (falling back to the base model).

## Workflow

1. Build the PREVENT dot phrase in Epic once — name it anything, or borrow `.MWPREVENT` from
   Max Weiss. See [`epic_smartphrase.md`](epic_smartphrase.md).
2. In a note, type your dot phrase, then select-all, copy.
3. Paste into the app, glance at the parsed values, read the risks.

## Accuracy & verification

The engine ([`prevent.js`](prevent.js)) is a direct port of the CRAN
[**preventr**](https://github.com/martingmayer/preventr) package (v0.11.0), whose
coefficients come from the Supplemental Appendix of the source publication. The
coefficient tables in [`coeffs.js`](coeffs.js) were generated **directly from the
package's data**, not transcribed by hand.

It is verified against `preventr` as an oracle across **1,000 test cases** spanning
all five outcomes, both sexes, both horizons, every model (base/HbA1c/UACR/SDI/full),
and the spline knots (SBP 110, BMI 30, eGFR 60) — **max absolute difference 0** at the
package's 3-decimal output. Reproduce it:

```bash
node verification/test.js     # requires the R `preventr` package to regenerate the grid
```

See [`verification/`](verification/) for the harness and the frozen oracle grid.

Reference: Khan SS, Matsushita K, Sang Y, et al. "Development and Validation of the
American Heart Association's PREVENT Equations." *Circulation.* 2024;149(6):430–449.
[doi:10.1161/CIRCULATIONAHA.123.067626](https://doi.org/10.1161/CIRCULATIONAHA.123.067626)

## Files

| File | Purpose |
|------|---------|
| `index.html` | The whole UI (paste → parse → editable form → results). |
| `app.js` | Parser for pasted Epic text + model selection (mirrors `select_model`). |
| `prevent.js` | The risk engine (transforms + logistic link). |
| `coeffs.js` | All PREVENT coefficient tables (machine-generated from `preventr`). |
| `epic_smartphrase.md` | The Epic `.PREVENT` SmartPhrase + build instructions. |
| `verification/` | Oracle test harness and grid. |

## Scope & disclaimer

10-year risk is validated for ages 30–79; 30-year risk for ages 30–59. ASCVD risk
categories (low/borderline/intermediate/high) follow the 2018/2019 ACC/AHA thresholds,
which were derived with the Pooled Cohort Equations — apply clinical judgment.

**For educational and clinician-support use only.** Not a substitute for clinical
judgment or a validated institutional calculator. Always verify each value before
acting on a result.
