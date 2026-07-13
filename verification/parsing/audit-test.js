// Quick smoke test for the audit fixes
var APP = require("../../app.js");
var pass = 0, fail = 0;

function check(label, got, want) {
  var ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) { pass++; }
  else { fail++; console.log("FAIL: " + label + "\n  got:  " + JSON.stringify(got) + "\n  want: " + JSON.stringify(want)); }
}

// 1. "Not on file" → null (not false)
check("parseBool('Not on file') → null", APP.parseBool("Not on file"), null);
check("parseBool('not documented') → null", APP.parseBool("not documented"), null);
check("parseBool('N/A') → null", APP.parseBool("N/A"), null);
check("parseBool('unknown') → null", APP.parseBool("unknown"), null);
check("parseBool('pending') → null", APP.parseBool("pending"), null);
check("parseBool('not available') → null", APP.parseBool("not available"), null);
// Make sure real answers still work
check("parseBool('Yes') → true", APP.parseBool("Yes"), true);
check("parseBool('No') → false", APP.parseBool("No"), false);
check("parseBool('Never') → false", APP.parseBool("Never"), false);
check("parseBool('Current') → true", APP.parseBool("Current"), true);
check("parseBool('Former') → false", APP.parseBool("Former"), false);

// 2. Threshold detection — eGFR ">60" returns value 60 + threshold ">"
var res = APP.parseText("eGFR: >60");
check("eGFR >60 threshold detected", res.thresholds.egfr, ">");
check("eGFR >60 value is 60", res.values.egfr, 60);

var res2 = APP.parseText("eGFR: 85");
check("eGFR 85 no threshold", res2.thresholds.egfr, undefined);
check("eGFR 85 value is 85", res2.values.egfr, 85);

// Threshold in warnings
check("threshold warning present", res.warnings.length > 0, true);
check("threshold warning mentions >60", res.warnings[0].indexOf(">60") >= 0, true);

// 3. Negation-aware smoking detection
check("detectSmoking('current smoker') → true",
  APP.detectSmoking("current smoker").value, true);
check("detectSmoking('not a current smoker') → false",
  APP.detectSmoking("not a current smoker").value, false);
check("detectSmoking('patient is not a current smoker') → false",
  APP.detectSmoking("patient is not a current smoker").value, false);
check("detectSmoking('denies current smoker') → false",
  APP.detectSmoking("denies current smoker").value, false);
// Non-negated still works
check("detectSmoking('every day smoker') → true",
  APP.detectSmoking("every day smoker").value, true);
check("detectSmoking('never smoker') → false",
  APP.detectSmoking("never smoker").value, false);

// 4. Section-aware drug detection — allergy section drugs are skipped
var allergyText = "Allergies:\n  Lisinopril\n  Penicillin\nCurrent Medications:\n  Amlodipine 5mg";
var ANTIHTN_RE = /\b(?:lisinopril|amlodipine)\b/i;
check("detectDrug skips allergy section",
  APP.detectDrug(allergyText, ANTIHTN_RE), "amlodipine");

var noAllergyText = "Current Medications:\n  Lisinopril 10mg\n  Amlodipine 5mg";
check("detectDrug finds drug in med section",
  APP.detectDrug(noAllergyText, ANTIHTN_RE), "lisinopril");

// 5. Multi-line discontinuation check
var disconText = "Amlodipine 5mg\n  Discontinued 2024-01-15\nLisinopril 10mg";
check("detectDrug skips drug with next-line discontinuation",
  APP.detectDrug(disconText, ANTIHTN_RE), "lisinopril");

// 6. Section-aware diabetes detection — family history skipped
var fhxText = "Family History:\n  Mother: Type 2 diabetes\nActive Problem List:\n  Hypertension\n  Obesity";
check("detectDiabetes skips family history section",
  APP.detectDiabetes(fhxText), null);

var ownDmText = "Family History:\n  Mother: HTN\nActive Problem List:\n  Type 2 diabetes mellitus\n  Hypertension";
check("detectDiabetes finds patient's own diabetes",
  APP.detectDiabetes(ownDmText), "Type 2 diabetes");

// Single-line family history (extended lookback)
check("detectDiabetes skips 'Family History: Mother had diabetes'",
  APP.detectDiabetes("Family History: Mother had diabetes"), null);

// 7. UACR pattern accepts space separator (no slash)
var uacrText = "Microalbumin Creat Ratio 45";
var uacrResult = APP.scanField(uacrText,
  "(?:uacr|(?:urine\\s+)?(?:micro)?album(?:in)?[/\\s-]+creat(?:inine)?(?:\\s+ratio)?|alb[/\\s-]+cr(?:eat)?|\\bacr\\b)",
  { thousands: true, min: 0.1, max: 25000 });
check("UACR scan with space separator", uacrResult !== null && uacrResult.value, 45);

// 8. Creatinine pattern rejects "creatine kinase"
var ckText = "Creatine Kinase 180";
var ckResult = APP.scanField(ckText,
  "(?:creatinine|creat(?:inine)?\\b)(?!\\s*(?:cl|clearance))",
  { badWords: ["album", "alb", "urine", "uacr", "ratio"], noSlashBefore: true, min: 0.2, max: 15 });
check("creatinine scan rejects creatine kinase", ckResult, null);

// But accepts "creatinine 1.2"
var crText = "Creatinine 1.2";
var crResult = APP.scanField(crText,
  "(?:creatinine|creat(?:inine)?\\b)(?!\\s*(?:cl|clearance))",
  { badWords: ["album", "alb", "urine", "uacr", "ratio"], noSlashBefore: true, min: 0.2, max: 15 });
check("creatinine scan accepts creatinine 1.2", crResult !== null && crResult.value, 1.2);

// 9. Cross-field validation: total_c <= hdl_c warning
var swapped = APP.parseText("Total cholesterol: 46\nHDL: 130");
check("cross-field warning for swapped chol/HDL", swapped.warnings.some(function(w) { return w.indexOf("swapped") >= 0; }), true);

// 10. normalizeText handles unicode
check("normalizeText strips NBSP", APP.normalizeText("Age: 58").indexOf(" ") === -1, true);
check("normalizeText converts en-dash", APP.normalizeText("4–6").indexOf("-") >= 0, true);
check("normalizeText converts smart quotes", APP.normalizeText("“yes”").indexOf('"') >= 0, true);

// 11. firstNumber returns null for missing-data phrases
check("firstNumber('N/A') → null", APP.firstNumber("N/A"), null);
check("firstNumber('unknown') → null", APP.firstNumber("unknown"), null);
check("firstNumber('42') → 42", APP.firstNumber("42"), 42);

// 12. extractNum returns threshold info
var ext1 = APP.extractNum(">60");
check("extractNum('>60') value", ext1.value, 60);
check("extractNum('>60') threshold", ext1.threshold, ">");
var ext2 = APP.extractNum("85");
check("extractNum('85') value", ext2.value, 85);
check("extractNum('85') threshold", ext2.threshold, null);

// 13. annotateSource: consumed vs missed vs neutral
function annStatus(text, frag) {
  var res = APP.parseText(text);
  var spans = APP.annotateSource(text, res);
  for (var i = 0; i < spans.length; i++) if (text.slice(spans[i].start, spans[i].end) === frag) return { status: spans[i].status, field: spans[i].field };
  return null;
}
var cleanTxt = "Age: 58\nSex: Female\nTotal cholesterol: 213\nHDL: 52\neGFR: 68\nLDL: 130\nTriglycerides: 150";
check("annotate: total_c 213 consumed", annStatus(cleanTxt, "213"), { status: "consumed", field: "total_c" });
check("annotate: hdl 52 consumed", annStatus(cleanTxt, "52"), { status: "consumed", field: "hdl_c" });
check("annotate: LDL 130 neutral (not a PREVENT field)", annStatus(cleanTxt, "130").status, "neutral");
check("annotate: Triglycerides 150 NOT flagged as hba1c miss", annStatus(cleanTxt, "150").status, "neutral");
// mmol/L cholesterol rejected by parser -> flagged as a miss
var mmolTxt = "Age: 58\nSex: Female\nTotal cholesterol: 5.4 mmol/L\nHDL: 1.3 mmol/L\neGFR: 68";
check("annotate: mmol total_c 5.4 flagged missed", annStatus(mmolTxt, "5.4"), { status: "missed", field: "total_c" });
check("annotate: mmol hdl 1.3 flagged missed", annStatus(mmolTxt, "1.3"), { status: "missed", field: "hdl_c" });

// 14. Robust A1c: Epic @LASTLAB@ result table (value beside ref range + cutoff comment)
var a1cTable = [
  "A1c: Hemoglobin A1c",
  "     Date                     Value               Ref Range           Status",
  "     04/09/2026               6.1 (H)             4.3 - 5.6 %         Final",
  "\t\tComment:",
  "\t\tHbA1c cutoffs: 4.3% - 5.6% = normal  5.7% - 6.4% = increased risk  >6.4% = diabetes",
].join("\n");
check("A1c table: value is 6.1 (not the 4.3 ref/cutoff)", APP.parseText("Age: 60\nSex: F\n" + a1cTable).values.hba1c, 6.1);
// simple formats still work ("robust as previous")
check("A1c 'A1c: 7.4' -> 7.4", APP.parseText("Age: 60\nSex: M\nA1c: 7.4").values.hba1c, 7.4);
check("A1c 'Hemoglobin A1c 9.2' -> 9.2", APP.parseText("Age: 60\nSex: M\nHemoglobin A1c 9.2").values.hba1c, 9.2);
check("A1c 'Glycosylated Hgb: 6.8' -> 6.8", APP.parseText("Age: 60\nSex: M\nGlycosylated Hgb: 6.8").values.hba1c, 6.8);
// vertical layout (value on next line)
check("A1c vertical 'A1c\\n6.1' -> 6.1", APP.parseText("Age: 60\nSex: M\nHemoglobin A1c\n6.1").values.hba1c, 6.1);

// 15. BMI not fabricated from an "Obesity (BMI 30.0-34.9)" category descriptor
var obTxt = "Age: 55\nSex: Female\nProblem List:\n  Obesity (BMI 30.0-34.9)\n  Hypertension\nBMI: no height/weight on file";
check("BMI category range not read as BMI", APP.parseText(obTxt).values.bmi, undefined);
check("BMI real value still parsed", APP.parseText("Age: 55\nSex: F\nBMI: 30.0").values.bmi, 30.0);

// 16. A1c diagnostic-cutoff comment must NOT trigger a false diabetes flag
var a1cCommentTxt = "Hemoglobin A1c 6.1\nHbA1c cutoffs for diagnosing diabetes: 4.3-5.6 = normal, 5.7-6.4 = increased risk for diabetes, >6.4 = diabetes";
check("A1c cutoff comment -> no diabetes", APP.detectDiabetes(a1cCommentTxt), null);
check("real Type 2 diabetes still detected", APP.detectDiabetes("Problem List:\n  Type 2 diabetes mellitus"), "Type 2 diabetes");
check("Type 2 diabetes with A1c goal still detected", !!APP.detectDiabetes("Problem List:\n  Type 2 diabetes, goal A1c <7"), true);
check("newly diagnosed diabetes still detected", !!APP.detectDiabetes("Problem List:\n  Newly diagnosed diabetes"), true);

console.log("\n" + pass + " passed, " + fail + " failed");
if (fail > 0) process.exit(1);
