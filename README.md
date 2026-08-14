# PREVENT Risk Calculator

A tiny, browser-only calculator for the **American Heart Association PREVENT™
equations**. Paste an Epic `.PREVENT` SmartPhrase — or any Epic text that contains the
values (a `@BRIEFLABS()@` dump, a results view, a note) — verify the scraped values, and
get 10- and 30-year risk of **Total CVD, ASCVD, and Heart Failure** (plus CHD and stroke).

**Live app:** https://maxweiss10.github.io/prevent-calculator/

- **Turns the risk into a recommendation.** Applies the **2026 ACC/AHA dyslipidemia guideline** —
  the treatment pathway, statin intensity, LDL-C and non-HDL-C goals, the two new 30-year and
  LDL 160–189 pathways, and how a CAC score changes the decision. See below.
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
4. Add LDL-C (and optionally CAC, Lp(a), ASCVD history, risk enhancers) to get the guideline
   recommendation for that risk.

## Guideline recommendations

The app doesn't stop at a number. [`guideline.js`](guideline.js) turns the computed risk into
the treatment recommendation from the **2026 ACC/AHA/AACVPR/ABC/ACPM/ADA/AGS/APhA/ASPC/NLA/PCNA
Guideline on the Management of Dyslipidemia** — the first ACC/AHA lipid guideline built on
PREVENT rather than the Pooled Cohort Equations.

It applies the risk-independent pathways first, then the risk-based one:

| Pathway | Trigger | Recommendation |
|---|---|---|
| Secondary prevention | Clinical ASCVD | High-intensity statin; LDL-C <55 (very high risk) or <70 |
| Severe hypercholesterolemia | LDL-C ≥190 | Max tolerated statin regardless of risk; FH genetic testing |
| Diabetes | Ages 40–75 | Moderate-intensity, or high-intensity if 10-yr ≥10% or multiple risk factors |
| High risk | 10-yr ≥10% | High-intensity statin (Class 1); LDL-C <70 |
| Intermediate | 10-yr 5–<10% | Moderate-to-high-intensity statin (Class 1); LDL-C <100 |
| Borderline | 10-yr 3–<5% | Moderate-intensity may be considered (Class 2); personalize, then CAC |
| Low | 10-yr <3% | Health-behavior therapy |

Plus the two age-restricted **Class 2 pathways new in 2026**, which treat patients the 10-year
number alone would miss: at ages 30–59, a **30-year ASCVD risk ≥10%** or an **LDL-C of 160–189
mg/dL**. The 30-year route is the single largest source of newly statin-eligible adults under
the 2026 guideline.

It also interprets a **CAC score** (0 → defer and repeat in 3–7 years, unless a higher-risk
condition is present; 1–99 → moderate statin; ≥100 → treat; ≥1000 → LDL-C <55), computes the
**percent LDL-C reduction** the goal requires so you know up front whether a statin alone will
get there, and flags that a **patient already on a statin** has an on-treatment risk estimate,
which is not what the guideline's thresholds were framed around.

> **Note on categories:** the 2026 bands are **<3 / 3–<5 / 5–<10 / ≥10%** — *not* the 2018/2019
> cutpoints of 5/7.5/20%, which were derived with the PCE. PREVENT reads systematically lower
> than the PCE, so reading a PREVENT score against the old bands would substantially undertreat.

LDL-C, CAC, Lp(a), ASCVD history, and risk enhancers are inputs to the *recommendation only* —
none of them touch the PREVENT computation.

Reference: [Circulation](https://www.ahajournals.org/doi/10.1161/CIR.0000000000001423) ·
[Guideline-at-a-Glance](https://www.jacc.org/doi/10.1016/j.jacc.2026.02.4872) ·
[ACC summary](https://www.acc.org/latest-in-cardiology/journal-scans/2026/03/13/15/20/acc-aha-release-new-clinical-guideline-for-managing-dyslipidemia)

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

The guideline layer has its own suite pinning every decision boundary — the category edges, the
pathway precedence order, the age restrictions on the 30-year and LDL 160–189 routes, and the CAC
cutpoints — so a future guideline revision fails loudly at the line that encodes the changed rule:

```bash
node verification/guideline-test.js
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
| `guideline.js` | 2026 dyslipidemia guideline recommendations from a computed risk. |
| `coeffs.js` | All PREVENT coefficient tables (machine-generated from `preventr`). |
| `epic_smartphrase.md` | The Epic `.PREVENT` SmartPhrase + build instructions. |
| `verification/` | Oracle test harness and grid. |

## Scope & disclaimer

10-year risk is validated for ages 30–79; 30-year risk for ages 30–59. ASCVD risk categories
follow the **2026 PREVENT-ASCVD** thresholds (<3 / 3–<5 / 5–<10 / ≥10%), not the 2018/2019
PCE-derived cutpoints. Recommendations are guideline defaults for a typical patient: they do not
account for statin intolerance, drug interactions, pregnancy, or competing goals of care. For
educational and clinician-support use only — not a substitute for clinical judgment or a validated
institutional calculator. Verify every value before acting.

**For educational and clinician-support use only.** Not a substitute for clinical
judgment or a validated institutional calculator. Always verify each value before
acting on a result.
