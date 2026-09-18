/* The five decision-support features added on top of the risk number:
 * lab dates, contradiction checks, the contribution breakdown, and the
 * absolute-benefit estimate. (The "what would flip the recommendation" panel is
 * page-level glue over computeAll + guideline.recommend, both covered elsewhere.)
 *
 * The breakdown is the one with a hard correctness property: the contributions
 * must reconstruct exactly the risk the engine reports, or the panel is telling a
 * story about a different calculation than the one on screen.
 */
global.PREVENT_COEFFS = require("../../coeffs.js").PREVENT_COEFFS;
global.PREVENT = require("../../prevent.js");
var COEFFS = global.PREVENT_COEFFS, P = global.PREVENT;
var APP = require("../../app.js");
var GUIDE = require("../../guideline.js");

var pass = 0, fail = 0;
function check(label, cond, detail) {
  if (cond) { pass++; console.log("  ✓ " + label); }
  else { fail++; console.log("  ✗ " + label + (detail ? "\n      " + detail : "")); }
}

console.log("lab dates are reported so the page can flag stale values");
var dated = APP.parseText([
  "Age: 58", "Sex: M",
  "Cholesterol, Total   197   03/14/2024",
  "Cholesterol, HDL      44   03/14/2024",
  "BP Readings:", "08/13/2026 : 128/78",
  "BMI Readings:", "07/01/2026 : 27.4 kg/m2",
  "eGFR 80  01/05/2023",
].join("\n"));
check("total cholesterol carries its date", dated.dates.total_c === 20240314, JSON.stringify(dated.dates));
check("HDL carries its date", dated.dates.hdl_c === 20240314, JSON.stringify(dated.dates));
check("the BP taken is the one whose date is reported", dated.values.sbp === 128 && dated.dates.sbp === 20260813, JSON.stringify(dated.dates));
check("BMI carries its date", dated.dates.bmi === 20260701, JSON.stringify(dated.dates));
check("eGFR carries its date", dated.dates.egfr === 20230105, JSON.stringify(dated.dates));
var undatedRes = APP.parseText("Age: 58\nSex: M\nTotal chol 197\nHDL 44");
check("an undated value reports no date", undatedRes.dates.total_c === undefined, JSON.stringify(undatedRes.dates));
// The date reported must be the date of the value actually chosen, not just any
// date in the text — otherwise a staleness warning would point at the wrong row.
var twoRows = APP.parseText("Age: 58\nSex: M\nCholesterol, Total   220   01/02/2025\nCholesterol, Total   197   08/13/2026");
check("with two dated rows, the date matches the value used",
  twoRows.values.total_c === 197 && twoRows.dates.total_c === 20260813,
  "value " + twoRows.values.total_c + " date " + twoRows.dates.total_c);

console.log("\ncontradictions between fields");
function contra(v) { return APP.crossFieldWarnings(Object.assign({ chol_unit: "mg/dL" }, v)); }
check("diabetes No against a diagnostic HbA1c", /6.5% diagnostic threshold/.test(contra({ dm: false, hba1c: 8.5 })[0] || ""));
check("diabetes Yes with a normal HbA1c is noted, not alarming", /treated diabetes/.test(contra({ dm: true, hba1c: 5.1 })[0] || ""));
check("on a statin with an LDL-C of 195", /adherence/.test(contra({ statin: true, ldl_c: 195 })[0] || ""));
check("total cholesterol not above HDL", /may be swapped/.test(contra({ total_c: 180, hdl_c: 200 })[0] || ""));
check("LDL-C above total cholesterol", /impossible/.test(contra({ total_c: 200, hdl_c: 45, ldl_c: 210 })[0] || ""));
check("LDL plus HDL above total cholesterol", /LDL-C plus HDL/.test((contra({ total_c: 200, hdl_c: 60, ldl_c: 170 })[0] || "")));
check("an eGFR of 22 at age 32", /unusual/.test(contra({ egfr: 22, age: 32 })[0] || ""));
check("a coherent patient raises nothing",
  contra({ total_c: 200, hdl_c: 45, ldl_c: 120, dm: false, hba1c: 5.4, statin: false, egfr: 80, age: 58 }).length === 0);
// same checks must work when the paste was in SI units
check("contradictions work in mmol/L too",
  APP.crossFieldWarnings({ chol_unit: "mmol/L", total_c: 5.2, hdl_c: 1.2, ldl_c: 5.6 }).length > 0);

console.log("\ncontribution breakdown reconstructs the reported risk exactly");
var PEOPLE = [
  { age: 45, sex: "female", sbp: 112, total_c: 170, hdl_c: 65, bmi: 22, egfr: 99, dm: false, smoking: false, bp_tx: false, statin: false },
  { age: 68, sex: "male", sbp: 155, total_c: 230, hdl_c: 35, bmi: 32, egfr: 52, dm: true, smoking: true, bp_tx: true, statin: true },
  { age: 58, sex: "male", sbp: 138, total_c: 215, hdl_c: 38, bmi: 29, egfr: 72, dm: false, smoking: false, bp_tx: true, statin: false, hba1c: 8.4 },
  { age: 60, sex: "female", sbp: 134, total_c: 200, hdl_c: 45, bmi: 31, egfr: 70, dm: true, smoking: false, bp_tx: true, statin: false, hba1c: 7.2, uacr: 120, sdi: 6 },
];
["ascvd", "total_cvd", "heart_failure"].forEach(function (oc) {
  PEOPLE.forEach(function (p, i) {
    var v = Object.assign({ chol_unit: "mg/dL" }, p);
    var model = APP.selectModel(v);
    ["10yr", "30yr"].forEach(function (time) {
      var c = P.contributions(v, model, time, COEFFS, oc);
      var direct = P.riskFor(v, model, time, COEFFS, null)[oc];
      check("person " + i + " " + oc + " " + time + " (" + model + ") reconstructs",
        Math.abs(c.risk - direct) < 1e-12, "breakdown " + c.risk + " vs engine " + direct);
    });
  });
});
var hb = P.contributions(Object.assign({ chol_unit: "mg/dL" }, PEOPLE[2]), "hba1c", "10yr", COEFFS, "ascvd");
function grp(c, name) { var g = c.groups.filter(function (x) { return x.group === name; })[0]; return g ? g.logOdds : null; }
check("HbA1c is its own row, not filed under Diabetes",
  Math.abs(grp(hb, "HbA1c")) > 0.1 && Math.abs(grp(hb, "Diabetes")) < 1e-9,
  "HbA1c " + grp(hb, "HbA1c") + ", Diabetes " + grp(hb, "Diabetes"));
check("BMI contributes nothing to ASCVD", Math.abs(grp(hb, "BMI")) < 1e-9, String(grp(hb, "BMI")));
var hf = P.contributions(Object.assign({ chol_unit: "mg/dL" }, PEOPLE[1]), "base", "10yr", COEFFS, "heart_failure");
check("BMI does contribute to heart failure", Math.abs(grp(hf, "BMI")) > 0.05, String(grp(hf, "BMI")));

console.log("\nabsolute benefit");
var b = APP.absoluteBenefit(0.136, 130, "moderate");
check("moderate-intensity lowers LDL-C by about a third", b.newLdl === 85 && b.ldlDrop === 46, JSON.stringify(b));
check("risk on treatment is below baseline", b.riskOn < 0.136 && b.riskOn > 0);
check("absolute reduction and NNT agree with each other", Math.abs(1 / b.arr - b.nnt) < 1, JSON.stringify(b));
var bh = APP.absoluteBenefit(0.136, 130, "high");
check("high-intensity beats moderate", bh.arr > b.arr && bh.nnt < b.nnt, JSON.stringify(bh));
check("benefit scales with baseline risk",
  APP.absoluteBenefit(0.30, 130, "moderate").arr > APP.absoluteBenefit(0.05, 130, "moderate").arr);
check("no LDL-C, no estimate", APP.absoluteBenefit(0.136, null, "moderate") === null);
check("no intensity, no estimate", APP.absoluteBenefit(0.136, 130, null) === null);
// A sanity anchor: at a 10-year risk of 13.6% with an LDL-C of 130, a moderate
// statin should need roughly 25-40 patients treated for 10 years to prevent one
// event. Far outside that and something is wrong with the arithmetic.
check("NNT lands in a clinically plausible range", b.nnt >= 20 && b.nnt <= 45, "NNT " + b.nnt);

console.log("\nbenefit for a patient who is ALREADY on a statin");
// Their current LDL-C is a treated value, so the benefit behind it is already
// banked. Quoting the benefit of "starting a statin" there counts it twice.
var treated = APP.absoluteBenefit(0.038, 108, "custom", (108 - 100) / 108);
check("only the remaining gap to goal is modelled", treated.newLdl === 100, JSON.stringify(treated));
check("a small further drop yields a correspondingly small benefit", treated.nnt > 200, "NNT " + treated.nnt);
var untreated = APP.absoluteBenefit(0.038, 108, "moderate");
check("and it is far smaller than pretending they were untreated",
  treated.arr < untreated.arr / 2, "treated ARR " + treated.arr + " vs untreated " + untreated.arr);
check("a zero-size custom drop yields nothing", APP.absoluteBenefit(0.1, 130, "custom", 0) === null);
check("a nonsensical custom drop yields nothing", APP.absoluteBenefit(0.1, 130, "custom", 1.2) === null);
check("a negative custom drop yields nothing", APP.absoluteBenefit(0.1, 130, "custom", -0.2) === null);

console.log("\na creatinine-derived eGFR carries the creatinine's date");
// Otherwise a three-year-old creatinine drives the eGFR with nothing to flag it.
var derived = APP.parseText("Age: 58\nSex: M\nSerum Creatinine: 1.3 mg/dL at 03/14/2023\nTotal chol 197\nHDL 44");
check("derived eGFR inherits the creatinine date",
  derived.found.egfr === "computed_from_cr" && derived.dates.egfr === 20230314, JSON.stringify(derived.dates));
var stated = APP.parseText("Age: 58\nSex: M\neGFR 72 at 08/13/2026\nCr 1.1 at 01/01/2020");
check("a stated eGFR reports its own date, not the creatinine's",
  stated.values.egfr === 72 && stated.dates.egfr === 20260813, JSON.stringify(stated.dates));

console.log("\nthe guideline reports a machine-readable intensity");
function inten(ctx) { return GUIDE.recommend(ctx).intensity; }
check("high risk → high", inten({ age: 58, sex: "male", dm: false, smoking: false, statin: false, ascvd10: 0.136, ldl: 130, tc: 200, hdl: 45 }) === "high");
check("intermediate → moderate-to-high", inten({ age: 58, sex: "male", dm: false, smoking: false, statin: false, ascvd10: 0.07, ldl: 130, tc: 200, hdl: 45 }) === "modhigh");
check("severe hypercholesterolaemia → high", inten({ age: 45, sex: "male", dm: false, smoking: false, statin: false, ascvd10: 0.05, ldl: 195, tc: 290, hdl: 42 }) === "high");
check("low risk → no statin intensity", inten({ age: 45, sex: "female", dm: false, smoking: false, statin: false, ascvd10: 0.01, ldl: 100, tc: 170, hdl: 60 }) === null);

console.log("\n" + pass + " passed, " + fail + " failed");
if (fail > 0) process.exit(1);
