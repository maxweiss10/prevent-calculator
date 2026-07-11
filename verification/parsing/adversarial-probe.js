/* Adversarial probe: hand-crafted inputs in formats the parser was NOT tuned for.
 * Goal is to find the CURRENT frontier — honest failures, not a victory lap.
 * Each probe states what a clinician reading the text would extract. */
var APP = require("../../app.js");

var probes = [
  // --- BP phrasings ---
  { name: "BP 'over' word", text: "Age: 58\nSex: M\nBP: 138 over 82\nBMI: 27\nTotal chol: 200\nHDL: 45\neGFR: 80", want: { sbp: 138 } },
  { name: "BP with comma sep", text: "Age: 58\nSex: M\nBP 138, 82\nTotal chol: 200\nHDL: 45", want: { sbp: 138 } },
  { name: "SBP with equals", text: "Age: 58\nSex: M\nSBP = 140\nHDL: 45", want: { sbp: 140 } },

  // --- Units (European) ---
  { name: "Chol mmol/L", text: "Age: 58\nSex: F\nTotal cholesterol: 5.4 mmol/L\nHDL: 1.3 mmol/L\neGFR: 80", want: { total_c_mmol: 5.4 }, note: "app default is mg/dL; mmol/L needs manual toggle" },
  { name: "Creatinine µmol/L", text: "Age: 58\nSex: F\nCreatinine 88 µmol/L\nTotal chol: 200\nHDL: 45", want: { egfr_from_umol: true }, note: "µmol/L not auto-detected" },

  // --- A1c spellings ---
  { name: "Hgb A1C spelling", text: "Age: 58\nSex: M\nHgb A1C: 7.2\nTotal chol: 200\nHDL: 45", want: { hba1c: 7.2 } },
  { name: "Glycosylated Hgb", text: "Age: 58\nSex: M\nGlycosylated Hgb: 6.8\nHDL: 45", want: { hba1c: 6.8 } },
  { name: "A1c integer", text: "Age: 58\nSex: M\nA1c: 7\nHDL: 45", want: { hba1c: 7 } },

  // --- Cholesterol layouts ---
  { name: "all-slash one line", text: "Age: 58\nSex: M\nChol 210 / HDL 45 / LDL 130\neGFR: 80", want: { total_c: 210, hdl_c: 45 } },
  { name: "Total Cholesterol Level", text: "Age: 58\nSex: M\nTotal Cholesterol Level: 215\nHDL-Cholesterol: 44", want: { total_c: 215, hdl_c: 44 } },
  { name: "chol on same line as A1c", text: "Age: 58\nSex: M\nLabs: Chol 198, HDL 51, A1c 5.6, eGFR 92", want: { total_c: 198, hdl_c: 51, hba1c: 5.6, egfr: 92 } },

  // --- Diabetes phrasings ---
  { name: "DM well-controlled", text: "Age: 58\nSex: M\nProblem List:\n  1. DM, well-controlled\nHDL: 45", want: { dm: true } },
  { name: "diabetes prose sentence", text: "Age: 58\nSex: M\nProblem List:\n  1. Patient has longstanding diabetes\nHDL: 45", want: { dm: true } },
  { name: "insulin-dependent", text: "Age: 58\nSex: M\nProblem List:\n  1. Insulin-dependent diabetes\nHDL: 45", want: { dm: true } },

  // --- Smoking phrasings ---
  { name: "Nonsmoker one word", text: "Age: 58\nSex: M\nSocial: Nonsmoker\nHDL: 45", want: { smoking: false } },
  { name: "Pt is a smoker prose", text: "Age: 58\nSex: M\nSocial Hx: Pt is a smoker\nHDL: 45", want: { smoking: true } },
  { name: "half pack per day", text: "Age: 58\nSex: M\nSocial Hx: 1/2 pack per day\nHDL: 45", want: { smoking: true } },

  // --- Statin combos ---
  { name: "atorvastatin/ezetimibe", text: "Age: 58\nSex: M\nMedications:\n  atorvastatin/ezetimibe 10 mg\nHDL: 45", want: { statin: true } },

  // --- Label separators / spacing ---
  { name: "Age no colon", text: "Age 58 yo\nSex: M\nHDL: 45", want: { age: 58 } },
  { name: "tabs as separators", text: "Age:\t58\nSex:\tM\neGFR:\t72\nHDL:\t45", want: { age: 58, egfr: 72 } },
  { name: "eGFR >= with space", text: "Age: 58\nSex: M\neGFR >= 60\nHDL: 45", want: { egfr: 60, egfr_threshold: true } },

  // --- eGFR / creatinine ---
  { name: "eGFR decimal threshold", text: "Age: 58\nSex: M\neGFR: >60.0\nHDL: 45", want: { egfr: 60 } },
  { name: "SCr abbreviation", text: "Age: 58\nSex: F\nSCr 1.1 mg/dL\nTotal chol: 200\nHDL: 45", want: { egfr_computed: true } },

  // --- Multi-patient contamination ---
  { name: "two BPs oldest-last (take recent=first)", text: "Age: 58\nSex: M\nBP:\n  Today 142/88\n  Last month 130/80\nHDL: 45", want: { sbp: 142 } },
];

var pass = 0, fail = 0, limitations = [];
console.log("ADVERSARIAL PROBE — formats the parser was NOT tuned for\n" + "=".repeat(64));
probes.forEach(function (p) {
  var r = APP.parseText(p.text);
  var v = r.values;
  var checks = [], ok = true;
  Object.keys(p.want).forEach(function (k) {
    var w = p.want[k], got, good;
    if (k === "egfr_threshold") { got = r.thresholds && r.thresholds.egfr; good = !!got; }
    else if (k === "egfr_from_umol") { got = v.egfr; good = (typeof got === "number" && got > 30 && got < 140); }
    else if (k === "egfr_computed") { got = v.egfr; good = (typeof got === "number"); }
    else if (k === "total_c_mmol") { got = v.total_c; good = (got === w) || (typeof got === "number" && Math.abs(got - w) < 0.1); }
    else { got = v[k]; good = (typeof w === "number") ? (typeof got === "number" && Math.abs(got - w) < 0.05) : (got === w); }
    if (!good) ok = false;
    checks.push(k + "=" + JSON.stringify(got === undefined ? null : got) + (good ? "✓" : " (want " + JSON.stringify(w) + ")✗"));
  });
  if (ok) { pass++; console.log("  ✓ " + p.name + "  [" + checks.join(", ") + "]"); }
  else { fail++; console.log("  ✗ " + p.name + "  [" + checks.join(", ") + "]" + (p.note ? "  — " + p.note : "")); limitations.push(p); }
});
console.log("\n" + pass + " pass, " + fail + " fail (of " + probes.length + " adversarial probes)");
