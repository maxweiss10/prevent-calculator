// Robustness fuzz: the parser must never throw and never emit NaN/Infinity,
// no matter what a clinician pastes.

global.PREVENT_COEFFS = require("../../coeffs.js").PREVENT_COEFFS;
global.PREVENT = require("../../prevent.js");
var A = require("../../app.js");

var NBSP = String.fromCharCode(0xa0);
var NUL = String.fromCharCode(0);
var FW = "\uFF15\uFF18"; // fullwidth 58
var cases = {
  "empty": "",
  "whitespace only": "   \n\t\n  ",
  "only newlines": "\n\n\n",
  "unresolved template": "PREVENT INPUTS\nAge: @AGE@\nSex: @SEX@\nBP: @LASTBP(3)@\nBMI: @LASTBMI(3)@\nCholesterol: @BRIEFLAB(CHOL,HDL,LDL)@\neGFR: @NEPHEGFR@\nProblems: @PROB@\nHTN Meds: @HTNMEDS@\nStatin: @STATINS@",
  "CRLF": "Age: 58\r\nSex: M\r\nBMI: 27\r\nTotal chol: 200\r\nHDL: 45",
  "NBSP and tabs": "Age:" + NBSP + "58\nSex:" + NBSP + "M\n\t\tBMI:\t27",
  "fullwidth digits": "Age: " + FW + "\nSex: M",
  "smart punctuation": "Age: 58\nSex: M\nBMI: 27\u2013 \u201cnormal\u201d \u2018ok\u2019",
  "html markup": "<div><b>Age:</b> 58</div><div>Sex: M</div><p>BMI: 27</p>&nbsp;&amp;",
  "json blob": '{"age":58,"sex":"M","bmi":27.4,"labs":{"chol":200}}',
  "units only": "mg/dL\nmmol/L\nkg/m2\nmL/min/1.73m2",
  "huge filler": new Array(400).join("Lorem ipsum dolor sit amet 12345 consectetur. "),
  "deep parens": "Age: 58 ((((((((((58))))))))))\nSex: M",
  "many slashes": "BP: 1/2/3/4/5/6/7/8\nAge: 58",
  "bare numbers": "58\n27\n200\n45\n80",
  "emoji": "Age: 58 \uD83D\uDE00\nSex: M\nBMI: 27",
  "NUL byte": "Age: 58" + NUL + "\nSex: M",
  "very long line": "Age: 58 " + new Array(5000).join("x") + " BMI: 27",
  "regex metachars": "Age: 58\nSex: M\nBMI: 27 [(*+?{}\\^$|]",
  "duplicate fields": "Age: 58\nSex: M\nBMI: 27\nAge: 74\nSex: F\nBMI: 41",
  "unterminated paren": "Age: 58\nSex: M\nBMI: 27 (unclosed",
  "unterminated bracket": "Age: 58\nSex: M\nHDL: 45 [125-200",
  "huge numbers": "Age: 999999999999\nSex: M\nBMI: 1e308\nHDL: 99999999",
  "negative numbers": "Age: -58\nSex: M\nBMI: -27\nHDL: -45",
  "all labels no values": "Age:\nSex:\nBP:\nBMI:\nTotal chol:\nHDL:\neGFR:\nA1c:\nDiabetes:\nSmoking:",
  "repeated paste": "Age: 58\nSex: M\nBMI: 27\nTotal chol: 200\nHDL: 45\nAge: 58\nSex: M\nBMI: 27\nTotal chol: 200\nHDL: 45",
  "mixed rtl": "Age: 58\n\u05e9\u05dc\u05d5\u05dd Sex: M\nBMI: 27",
};

var bad = 0, n = 0, notes = [];
Object.keys(cases).forEach(function (k) {
  n++;
  var txt = cases[k];
  try {
    var r = A.parseText(txt);
    A.annotateSource(txt, r);
    A.parseIndependent(txt);
    // computeAll deliberately rejects incomplete input (the page blocks on
    // missingRequired first), so only exercise it when every required field is in.
    var REQ = ["age", "sex", "sbp", "total_c", "hdl_c", "bmi", "egfr", "dm", "smoking", "bp_tx", "statin"];
    if (REQ.every(function (f) { return r.values[f] !== undefined && r.values[f] !== null; }))
      A.computeAll(Object.assign({ chol_unit: "mg/dL" }, r.values));
    var issues = [];
    Object.keys(r.values).forEach(function (f) {
      var v = r.values[f];
      if (typeof v === "number" && !isFinite(v)) issues.push(f + "=" + v);
    });
    if (issues.length) { bad++; notes.push("  NONFINITE " + k + ": " + issues.join(", ")); }
  } catch (e) {
    bad++; notes.push("  CRASH " + k + ": " + e.message);
  }
});
console.log(notes.join("\n"));
console.log("robustness: " + (n - bad) + "/" + n + " clean (no crash, no NaN/Infinity)\n");
if (bad > 0) process.exitCode = 1;

function show(k) { console.log(k.padEnd(22) + JSON.stringify(A.parseText(cases[k]).values)); }
["duplicate fields", "fullwidth digits", "html markup", "json blob", "bare numbers",
 "huge numbers", "negative numbers", "all labels no values", "units only",
 "unresolved template", "many slashes"].forEach(show);
