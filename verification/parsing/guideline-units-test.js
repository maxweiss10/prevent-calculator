/* Guideline + units: the 2026 dyslipidemia recommendation must not depend on
 * which unit the paste used.
 *
 * The guideline layer is written entirely in mg/dL, and the page converts at the
 * boundary (index.html: toMgdl()). This test reproduces that boundary and asserts
 * that a patient entered in mmol/L lands on the SAME pathway, headline, goals and
 * required LDL-C reduction as the identical patient in mg/dL. A missed conversion
 * here would not change the risk number at all — it would quietly change the
 * treatment recommendation, which is harder to notice.
 */
global.PREVENT_COEFFS = require("../../coeffs.js").PREVENT_COEFFS;
global.PREVENT = require("../../prevent.js");
var APP = require("../../app.js");
var GUIDE = require("../../guideline.js");

var pass = 0, fail = 0;
function check(label, cond, detail) {
  if (cond) { pass++; console.log("  ✓ " + label); }
  else { fail++; console.log("  ✗ " + label + (detail ? "\n      " + detail : "")); }
}

var MMOL = 0.02586;
function mgToMmol(v) { return v == null ? null : +(v * MMOL).toFixed(4); }
// The page's boundary conversion, reproduced exactly (index.html toMgdl).
function toMgdl(v, unit) { return (v === null || v === undefined || isNaN(v)) ? null : (unit === "mg/dL" ? v : v * 38.67); }

// The goal fields as the page renders them: fixed targets verbatim, current
// values rounded exactly as index.html rounds them.
function goalsShown(g) {
  if (!g) return "none";
  return JSON.stringify({
    ldl: g.ldl, nonhdl: g.nonhdl, label: g.label, reduction: g.reduction, gapNote: g.gapNote,
    ldlNow: g.ldlNow == null ? null : Math.round(g.ldlNow),
    nonhdlNow: g.nonhdlNow == null ? null : Math.round(g.nonhdlNow),
  });
}

function recFor(p, unit) {
  var chol = unit === "mg/dL"
    ? { ldl: p.ldl, tc: p.tc, hdl: p.hdl }
    : { ldl: mgToMmol(p.ldl), tc: mgToMmol(p.tc), hdl: mgToMmol(p.hdl) };
  var risk = APP.computeAll({
    age: p.age, sex: p.sex, sbp: p.sbp, bmi: p.bmi, egfr: p.egfr,
    total_c: chol.tc, hdl_c: chol.hdl, chol_unit: unit,
    dm: p.dm, smoking: p.smoking, bp_tx: p.bp_tx, statin: p.statin,
  });
  return {
    risk: risk,
    rec: GUIDE.recommend({
      age: p.age, sex: p.sex, dm: p.dm, smoking: p.smoking, statin: p.statin,
      ascvd10: risk.base.r10.ascvd,
      ascvd30: p.age <= 59 ? risk.base.r30.ascvd : null,
      ldl: toMgdl(chol.ldl, unit), tc: toMgdl(chol.tc, unit), hdl: toMgdl(chol.hdl, unit),
      clinicalAscvd: !!p.clinicalAscvd, veryHigh: !!p.veryHigh,
      cac: p.cac, lpa: p.lpa, enhancers: p.enhancers || [],
    }),
  };
}

var PEOPLE = [
  { name: "low risk primary prevention", age: 42, sex: "female", sbp: 112, bmi: 22.5, egfr: 99, tc: 170, hdl: 65, ldl: 90, dm: false, smoking: false, bp_tx: false, statin: false },
  { name: "borderline risk", age: 52, sex: "male", sbp: 126, bmi: 27.0, egfr: 85, tc: 205, hdl: 48, ldl: 130, dm: false, smoking: false, bp_tx: false, statin: false },
  { name: "intermediate risk", age: 58, sex: "male", sbp: 138, bmi: 29.5, egfr: 75, tc: 215, hdl: 40, ldl: 140, dm: false, smoking: false, bp_tx: true, statin: false },
  { name: "high risk", age: 68, sex: "male", sbp: 155, bmi: 32.0, egfr: 52, tc: 230, hdl: 35, ldl: 155, dm: false, smoking: true, bp_tx: true, statin: false },
  { name: "diabetes pathway", age: 60, sex: "female", sbp: 134, bmi: 31.0, egfr: 70, tc: 200, hdl: 45, ldl: 120, dm: true, smoking: false, bp_tx: true, statin: false },
  { name: "severe hypercholesterolaemia", age: 45, sex: "male", sbp: 120, bmi: 26.0, egfr: 90, tc: 290, hdl: 42, ldl: 195, dm: false, smoking: false, bp_tx: false, statin: false },
  { name: "clinical ASCVD", age: 66, sex: "male", sbp: 130, bmi: 28.0, egfr: 68, tc: 180, hdl: 38, ldl: 105, dm: false, smoking: false, bp_tx: true, statin: true, clinicalAscvd: true },
  { name: "clinical ASCVD very high risk", age: 70, sex: "female", sbp: 140, bmi: 30.0, egfr: 55, tc: 190, hdl: 40, ldl: 110, dm: false, smoking: true, bp_tx: true, statin: true, clinicalAscvd: true, veryHigh: true },
  { name: "age 30-59 LDL 160-189 route", age: 46, sex: "female", sbp: 118, bmi: 24.0, egfr: 95, tc: 250, hdl: 55, ldl: 168, dm: false, smoking: false, bp_tx: false, statin: false },
  { name: "with CAC and Lp(a)", age: 55, sex: "male", sbp: 132, bmi: 28.5, egfr: 80, tc: 210, hdl: 44, ldl: 135, dm: false, smoking: false, bp_tx: false, statin: false, cac: 120, lpa: 90, enhancers: ["lpa"] },
];

console.log("mmol/L and mg/dL give the same recommendation");
PEOPLE.forEach(function (p) {
  var a = recFor(p, "mg/dL"), b = recFor(p, "mmol/L");
  var ra = a.rec, rb = b.rec;
  // ldlNow/nonhdlNow are raw values that the page rounds at every display site
  // (index.html Math.round), so compare them the way they are actually shown; the
  // mmol round-trip leaves float dust (175.00108) that is invisible to the user.
  var same = ra.pathway === rb.pathway &&
             ra.pathwayLabel === rb.pathwayLabel &&
             ra.headline === rb.headline &&
             goalsShown(ra.goals) === goalsShown(rb.goals) &&
             (ra.category ? ra.category.label : null) === (rb.category ? rb.category.label : null) &&
             ra.items.length === rb.items.length;
  check(p.name + " → " + ra.pathway + (ra.goals ? " (LDL goal " + ra.goals.ldl + ")" : ""), same,
    "mg/dL: " + ra.pathway + "/" + (ra.goals && ra.goals.ldl) + "/" + ra.headline +
    "\n      mmol:  " + rb.pathway + "/" + (rb.goals && rb.goals.ldl) + "/" + rb.headline);
});

// The goals themselves are mg/dL constants from the guideline text, so they must
// NOT be silently rescaled by the unit toggle.
console.log("\ngoals stay in the guideline's own mg/dL units");
var hi = recFor(PEOPLE[3], "mmol/L").rec;
check("a high-risk goal is a plausible mg/dL number, not an mmol one",
  hi.goals && hi.goals.ldl >= 50 && hi.goals.ldl <= 130, JSON.stringify(hi.goals));

// A parsed SI paste, carried through exactly as the page does it.
console.log("\nend to end from a pasted SI panel");
var siText = "Age: 58\nSex: Male\nBP: 138/84\nBMI: 29.5\nTotal cholesterol: 5.56 mmol/L\nHDL cholesterol: 1.03 mmol/L\nLDL cholesterol: 3.62 mmol/L\neGFR: 75\nProblem List:\n  Essential hypertension\nCurrent Outpatient Medications:\n  amlodipine 10 mg daily\nSocial: never smoker";
var parsed = APP.parseText(siText).values;
check("paste reports mmol/L", parsed.chol_unit === "mmol/L", "got " + parsed.chol_unit);
check("LDL parsed raw as 3.62", Math.abs(parsed.ldl_c - 3.62) < 0.01, "got " + parsed.ldl_c);
var ldlMg = toMgdl(parsed.ldl_c, parsed.chol_unit);
check("LDL converts to ~140 mg/dL at the boundary", Math.abs(ldlMg - 140) < 1.5, "got " + ldlMg);
var risk = APP.computeAll(Object.assign({}, parsed, { dm: false, smoking: false, bp_tx: true, statin: false }));
var rec = GUIDE.recommend({
  age: parsed.age, sex: parsed.sex, dm: false, smoking: false, statin: false,
  ascvd10: risk.base.r10.ascvd, ascvd30: risk.base.r30.ascvd,
  ldl: ldlMg, tc: toMgdl(parsed.total_c, parsed.chol_unit), hdl: toMgdl(parsed.hdl_c, parsed.chol_unit),
  clinicalAscvd: false, veryHigh: false, enhancers: [],
});
check("SI paste yields a real pathway and goal", !!rec.pathway && !!rec.goals,
  rec.pathway + " / " + JSON.stringify(rec.goals));

console.log("\n" + pass + " passed, " + fail + " failed");
if (fail > 0) process.exit(1);
