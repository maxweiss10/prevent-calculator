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
