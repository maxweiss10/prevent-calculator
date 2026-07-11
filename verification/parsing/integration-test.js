// Integration test: realistic Epic output through full parse pipeline
var APP = require("../../app.js");
var pass = 0, fail = 0;

function check(label, got, want) {
  var ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) { pass++; }
  else { fail++; console.log("FAIL: " + label + "\n  got:  " + JSON.stringify(got) + "\n  want: " + JSON.stringify(want)); }
}

// Simulate full dot phrase output with @LASTBP(3)@ date format
var FULL_PASTE = [
  "PREVENT INPUTS",
  "Age: 62",
  "Sex: Female",
  "BP: 07/10/26 : 138/82",
  "    07/03/26 : 142/88",
  "    06/28/26 : 135/78",
  "BMI: 31.4",
  "Cholesterol:",
  "Cholesterol, Total,* 213    mg/dL    07/10/26 1000",
  "HDL Cholesterol,* 52        mg/dL    07/10/26 1000",
  "eGFR: eGFR (CKD-EPI 2021): 68 mL/min/1.73m2",
  "Problems: 1. Hypertension - Active",
  "2. Obesity - Active",
  "3. Type 2 diabetes mellitus - Active",
  "4. Hyperlipidemia - Active",
  "HTN Meds: Current Hypertension Medications",
  "  Amlodipine 10 MG Oral Tab",
  "  Lisinopril 20 MG Oral Tab",
  "Statin: Current Hyperlipidemia Medications",
  "  Atorvastatin 40 MG Oral Tab",
  "Social Hx: Tobacco Use: Never smoker",
].join("\n");

var r = APP.parseText(FULL_PASTE);
check("age", r.values.age, 62);
check("sex", r.values.sex, "female");
check("sbp (most recent from dated list)", r.values.sbp, 138);
check("bmi", r.values.bmi, 31.4);
check("total_c", r.values.total_c, 213);
check("hdl_c", r.values.hdl_c, 52);
check("egfr", r.values.egfr, 68);
check("dm inferred true", r.values.dm, true);
check("dm from problem list", r.inferred.dm.value, true);
check("bp_tx inferred true", r.values.bp_tx, true);
check("statin inferred true", r.values.statin, true);
check("smoking inferred false", r.values.smoking, false);
check("no thresholds", Object.keys(r.thresholds).length, 0);

// Test with eGFR threshold
var THRESHOLD_PASTE = [
  "Age: 55", "Sex: Male", "BP: 128/78", "BMI: 27.2",
  "Total cholesterol: 195", "HDL: 48",
  "eGFR: >60",
  "Diabetes: No", "Current smoker: No",
  "On antihypertensive: Yes", "On statin: Yes",
].join("\n");
var t = APP.parseText(THRESHOLD_PASTE);
check("threshold: egfr value", t.values.egfr, 60);
check("threshold: egfr has > marker", t.thresholds.egfr, ">");
check("threshold: warning present", t.warnings.length > 0, true);

// Test with "not on file" values
var MISSING_PASTE = [
  "Age: 58", "Sex: Female", "BP: 130/80", "BMI: 25.0",
  "Total cholesterol: 200", "HDL: 50",
  "eGFR: 85",
  "Diabetes: Not on file",
  "Current smoker: N/A",
  "On antihypertensive: unknown",
  "On statin: pending",
].join("\n");
var m = APP.parseText(MISSING_PASTE);
check("missing: dm is null (not false)", m.values.dm, undefined);
check("missing: smoking is null", m.values.smoking, undefined);
check("missing: bp_tx is null", m.values.bp_tx, undefined);
check("missing: statin is null", m.values.statin, undefined);
check("missing: age still parsed", m.values.age, 58);

// Test allergy section: drug in allergy list should NOT be detected
var ALLERGY_PASTE = [
  "Age: 50", "Sex: Male", "BP: 140/90", "BMI: 28.0",
  "Total cholesterol: 220", "HDL: 40", "eGFR: 75",
  "Diabetes: No", "Current smoker: No",
  "Allergies:",
  "  Lisinopril - cough",
  "  Atorvastatin - myalgia",
  "Current Medications:",
  "  Losartan 50 MG Oral Tab",
  "  Metoprolol 25 MG Oral Tab",
].join("\n");
var a = APP.parseText(ALLERGY_PASTE);
check("allergy: bp_tx from losartan not lisinopril", a.inferred.bp_tx && a.inferred.bp_tx.evidence, "losartan");
check("allergy: statin not detected (allergy only)", a.values.statin, undefined);

// Test family history diabetes should not trigger dm=true
var FHX_PASTE = [
  "Age: 45", "Sex: Female", "BP: 120/75", "BMI: 24.0",
  "Total cholesterol: 190", "HDL: 55", "eGFR: 95",
  "Current smoker: No", "On antihypertensive: No", "On statin: No",
  "Family History:",
  "  Mother: Type 2 diabetes, Hypertension",
  "  Father: CAD",
  "Active Problem List:",
  "  Anxiety",
  "  Seasonal allergies",
].join("\n");
var f = APP.parseText(FHX_PASTE);
check("fhx: dm NOT detected from family history", f.values.dm, false);
check("fhx: dm inferred as not-on-problem-list", f.inferred.dm && f.inferred.dm.evidence, "not on problem list");

// Test negated smoking
var NEGSMOKE_PASTE = [
  "Age: 60", "Sex: Male", "BP: 145/92", "BMI: 30.0",
  "Total cholesterol: 240", "HDL: 38", "eGFR: 55",
  "Diabetes: Yes", "On antihypertensive: Yes", "On statin: Yes",
  "Patient is not a current smoker.",
].join("\n");
var ns = APP.parseText(NEGSMOKE_PASTE);
check("negated smoking: value is false", ns.values.smoking, false);

console.log("\n" + pass + " passed, " + fail + " failed");
if (fail > 0) process.exit(1);
