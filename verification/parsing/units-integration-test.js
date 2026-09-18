/* Units integration: a paste in mmol/L must produce the SAME risk as the
 * identical patient written in mg/dL.
 *
 * The parser reports which unit a paste used (values.chol_unit) and the page
 * feeds that through to the engine; the parser itself never converts. This test
 * closes that loop end to end — parse -> computeAll -> risk — because a unit that
 * fails to reach the engine is silently wrong in a way no parsing test can see.
 */
global.PREVENT_COEFFS = require("../../coeffs.js").PREVENT_COEFFS;
global.PREVENT = require("../../prevent.js");
var APP = require("../../app.js");

var pass = 0, fail = 0;
function check(label, cond, detail) {
  if (cond) { pass++; console.log("  ✓ " + label); }
  else { fail++; console.log("  ✗ " + label + (detail ? "\n      " + detail : "")); }
}

var MMOL = 0.02586;                 // mg/dL -> mmol/L (preventr convert_chol_to_mmol)
function mgToMmol(v) { return +(v * MMOL).toFixed(4); }

// Same patient, written both ways. Each pair: [mg/dL total, mg/dL HDL]
var PAIRS = [[200, 45], [164, 39], [280, 70], [130, 20], [320, 100]];
var PEOPLE = [
  { age: 45, sex: "female", sbp: 118, bmi: 24.0, egfr: 95, dm: false, smoking: false, bp_tx: false, statin: false },
  { age: 68, sex: "male", sbp: 152, bmi: 33.5, egfr: 48, dm: true, smoking: true, bp_tx: true, statin: true },
  { age: 58, sex: "male", sbp: 110, bmi: 30.0, egfr: 60, dm: false, smoking: true, bp_tx: false, statin: false },
];
var EXTRAS = [{}, { hba1c: 7.2 }, { uacr: 45 }, { sdi: 6 }, { hba1c: 6.4, uacr: 120, sdi: 3 }];

console.log("mg/dL vs mmol/L give identical risk (all models, both sexes)");
PEOPLE.forEach(function (base, pi) {
  PAIRS.forEach(function (pair) {
    EXTRAS.forEach(function (extra, ei) {
      var mg = Object.assign({}, base, extra, { total_c: pair[0], hdl_c: pair[1], chol_unit: "mg/dL" });
      var si = Object.assign({}, base, extra, { total_c: mgToMmol(pair[0]), hdl_c: mgToMmol(pair[1]), chol_unit: "mmol/L" });
      var a = APP.computeAll(mg), b = APP.computeAll(si);
      var modelSame = a.model === b.model;
      var keys = Object.keys(a.base.r10);
      var worst = 0;
      keys.forEach(function (k) {
        worst = Math.max(worst, Math.abs(a.base.r10[k] - b.base.r10[k]), Math.abs(a.base.r30[k] - b.base.r30[k]));
      });
      if (a.enhanced && b.enhanced) {
        keys.forEach(function (k) {
          worst = Math.max(worst, Math.abs(a.enhanced.r10[k] - b.enhanced.r10[k]), Math.abs(a.enhanced.r30[k] - b.enhanced.r30[k]));
        });
      }
      check("person " + pi + " chol " + pair[0] + "/" + pair[1] + " model " + a.model + (ei ? " +extras" : ""),
        modelSame && worst < 5e-4,
        "model " + a.model + " vs " + b.model + ", max risk diff " + worst.toExponential(2));
    });
  });
});

// The parser must REPORT the unit, since the page keys its conversion off it.
console.log("\nparser reports the unit it saw");
var siPaste = "Age: 58\nSex: Female\nBP: 128/78\nBMI: 26.2\nTotal cholesterol: 5.17 mmol/L\nHDL cholesterol: 1.16 mmol/L\neGFR: 80";
var mgPaste = "Age: 58\nSex: Female\nBP: 128/78\nBMI: 26.2\nTotal cholesterol: 200\nHDL cholesterol: 45\neGFR: 80";
var sp = APP.parseText(siPaste).values, mp = APP.parseText(mgPaste).values;
check("SI paste -> chol_unit mmol/L", sp.chol_unit === "mmol/L", "got " + sp.chol_unit);
check("mg/dL paste -> chol_unit mg/dL", mp.chol_unit === "mg/dL", "got " + mp.chol_unit);
check("SI values kept raw (not converted by the parser)", Math.abs(sp.total_c - 5.17) < 0.01, "got " + sp.total_c);

// And the two pastes, each with its own reported unit, must agree on the risk.
var siFull = Object.assign({}, sp, { dm: false, smoking: false, bp_tx: false, statin: false });
var mgFull = Object.assign({}, mp, { dm: false, smoking: false, bp_tx: false, statin: false });
var ra = APP.computeAll(siFull), rb = APP.computeAll(mgFull);
var d = Math.abs(ra.base.r10.ascvd - rb.base.r10.ascvd);
check("parsed SI paste and parsed mg/dL paste agree on 10-yr ASCVD", d < 2e-3,
  "SI " + ra.base.r10.ascvd + " vs mg/dL " + rb.base.r10.ascvd + " (diff " + d.toExponential(2) + ")");

// Out-of-range optional predictors must be dropped with a message, not used.
console.log("\nimplausible optional predictors are dropped, not used");
var ifcc = APP.computeAll({ age: 58, sex: "male", sbp: 120, total_c: 200, hdl_c: 45, bmi: 27, egfr: 80,
  dm: false, smoking: false, bp_tx: false, statin: false, hba1c: 48, chol_unit: "mg/dL" });
check("A1c of 48 (IFCC units) is ignored", ifcc.model === "base", "model " + ifcc.model);
check("...and says so", ifcc.problems.length > 0 && /48/.test(ifcc.problems[0]), JSON.stringify(ifcc.problems));

console.log("\n" + pass + " passed, " + fail + " failed");
if (fail > 0) process.exit(1);
