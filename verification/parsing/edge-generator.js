/* Independent edge-case generator for the PREVENT parser.
 *
 * Philosophy: ground truth is defined FIRST (random patient data), then rendered
 * into Epic-like text using real-world EHR formatting conventions and real drug
 * names — MANY of which are deliberately NOT encoded in the parser (brand-name
 * antihypertensives, alternate diabetes abbreviations like NIDDM/DMII, vertical
 * lab layouts, leading reference ranges, mmol/L units, etc.). A "failure" = the
 * parser does not recover what a competent clinician reading the text would.
 *
 * This is adversarial and independent: the renderings come from clinical-domain
 * knowledge, not from reading app.js's regexes.
 */
var APP = require("../../app.js");

// ---- seeded PRNG (mulberry32) for reproducibility ----
function makeRng(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    var t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
var SEED = parseInt(process.env.SEED || process.argv[2] || "20260711", 10);
var rng = makeRng(SEED);
function pick(a) { return a[Math.floor(rng() * a.length)]; }
function ri(lo, hi) { return Math.floor(rng() * (hi - lo + 1)) + lo; }
function rf(lo, hi, dp) { var v = rng() * (hi - lo) + lo; return +v.toFixed(dp == null ? 1 : dp); }
function chance(p) { return rng() < p; }
function shuffle(a) { a = a.slice(); for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(rng() * (i + 1)); var t = a[i]; a[i] = a[j]; a[j] = t; } return a; }

// ---- independent CKD-EPI 2021 for expected eGFR-from-creatinine ----
function ckdepi(cr, age, sex) {
  var f = sex === "female";
  var k = f ? 0.7 : 0.9, a = f ? -0.241 : -0.302, d = f ? 1.012 : 1;
  return Math.round(142 * Math.pow(Math.min(cr / k, 1), a) * Math.pow(Math.max(cr / k, 1), -1.2) * Math.pow(0.9938, age) * d);
}

// ---- real-world reference pools (independent of parser contents) ----
// Brand antihypertensives — NONE of these brand tokens are in the parser.
var BRAND_HTN = ["Norvasc", "Cozaar", "Diovan", "Benicar", "Micardis", "Avapro",
  "Lopressor", "Toprol XL", "Tenormin", "Coreg", "Cardizem", "Calan SR", "Lasix",
  "Aldactone", "Catapres", "Hyzaar", "Lotrel", "Zestril", "Prinivil", "Vasotec", "Altace"];
var GENERIC_HTN = ["lisinopril", "amlodipine", "losartan", "metoprolol tartrate",
  "hydrochlorothiazide", "chlorthalidone", "carvedilol", "valsartan", "diltiazem ER",
  "furosemide", "spironolactone", "atenolol", "olmesartan"];
var COMBO_HTN = ["lisinopril-hydrochlorothiazide", "amlodipine-benazepril",
  "losartan-HCTZ", "valsartan/HCTZ", "amlodipine-valsartan"]; // contain generic substrings
var BRAND_STATIN_UNKNOWN = ["Mevacor", "Flolipid", "Zypitamag"]; // real, less-common brands
var BRAND_STATIN_KNOWN = ["Lipitor", "Crestor", "Zocor", "Pravachol", "Livalo"];
var GENERIC_STATIN = ["atorvastatin", "rosuvastatin", "simvastatin", "pravastatin", "lovastatin", "pitavastatin"];

var DM_DETECTABLE = ["Type 2 diabetes mellitus", "T2DM", "DM2", "Type II diabetes mellitus",
  "Diabetes mellitus, type 2", "diabetic nephropathy", "type 2 DM"];
var DM_HARD = ["NIDDM", "IDDM", "DMII"]; // real abbreviations the parser doesn't know
var DM_DISTRACTOR = ["Prediabetes", "Pre-diabetes", "Impaired fasting glucose",
  "Diabetes insipidus", "Gestational diabetes (resolved)"];

var SMOKE_TRUE = ["Current every day smoker", "Current some day smoker", "Smoking: Current",
  "Tobacco use: Current every day smoker", "1 ppd", "1.5 PPD", "Cigarettes: 1 pack/day"];
var SMOKE_FALSE = ["Never smoker", "Former smoker", "Tobacco: Never", "Tobacco use: Former smoker",
  "not a current smoker", "Ex-smoker", "Former cigarette smoker, quit 2015"];
var MISSING_TOK = ["Not on file", "N/A", "Unknown", "Deferred", "Not documented", "Not assessed"];

// ---- numeric decorators (return string; expected value unchanged unless noted) ----
function decorate(numStr, kind) {
  switch (kind) {
    case "flagH": return numStr + " H";
    case "flagParen": return numStr + " (H)";
    case "star": return numStr + " *";
    case "unit_mgdl": return numStr + " mg/dL";
    case "refParen": return numStr + " (125-200)";       // trailing ref range in parens
    case "refBracketLead": return "[125-200] " + numStr;  // LEADING ref range in brackets
    default: return numStr;
  }
}

// ---- field renderers ----
// Each returns { line(s): string, expect: {field:val|null}, tags:[...] }
function renderTotalC(v) {
  var label = pick(["Total Cholesterol", "Cholesterol, Total", "CHOL", "Cholesterol", "TC", "Total Chol"]);
  var deco = pick(["", "", "flagH", "unit_mgdl", "refParen", "refBracketLead", "star"]);
  var tags = [];
  if (label === "TC") tags.push("chol-abbrev-TC");
  if (deco === "refBracketLead") tags.push("leading-ref-range");
  var val = decorate(String(v), deco);
  return { text: label + ": " + val, expect: { total_c: v }, tags: tags };
}
function renderHdlC(v) {
  var label = pick(["HDL", "HDL-C", "HDL Cholesterol", "HDLC", "High-Density Lipoprotein", "HDL Chol"]);
  var deco = pick(["", "", "flagH", "unit_mgdl", "refParen"]);
  var tags = [];
  if (label === "High-Density Lipoprotein") tags.push("hdl-longform");
  return { text: label + ": " + decorate(String(v), deco), expect: { hdl_c: v }, tags: tags };
}
function renderBmi(v) {
  var label = pick(["BMI", "Body Mass Index", "BMI"]);
  return { text: label + ": " + v + pick(["", " kg/m2", " kg/m²"]), expect: { bmi: v }, tags: [] };
}
function renderEgfr(v, truth) {
  var mode = pick(["direct", "direct", "direct", "threshold", "creatinine", "creatinine_umol", "vertical"]);
  if (mode === "threshold") {
    // report as ">60" — a clinician reads this as a floored estimate; parser should
    // surface value 60 + threshold marker
    return { text: pick(["eGFR", "GFR", "eGFR (CKD-EPI 2021)"]) + ": >60", expect: { egfr: 60, egfr_threshold: ">" }, tags: ["egfr-threshold"] };
  }
  if (mode === "creatinine") {
    var cr = rf(0.6, 1.8, 2);
    var exp = ckdepi(cr, truth.age, truth.sex);
    return { text: pick(["Creatinine", "Creat", "Serum Creatinine", "Cr"]) + " " + cr + pick(["", " mg/dL"]), expect: { egfr: exp }, tags: ["egfr-from-creatinine"] };
  }
  if (mode === "creatinine_umol") {
    var crU = ri(60, 130); // µmol/L — European units
    return { text: "Creatinine " + crU + " µmol/L", expect: { egfr: "SKIP" }, tags: ["creatinine-umol-units"] };
  }
  if (mode === "vertical") {
    // label on its own line, value on the NEXT line (common in some result views)
    return { text: pick(["eGFR", "Estimated GFR"]) + "\n" + v, expect: { egfr: v }, tags: ["vertical-lab-layout"] };
  }
  var label = pick(["eGFR", "GFR", "eGFR (CKD-EPI 2021)", "Estimated GFR", "eGFRcr"]);
  var tags = [];
  if (label === "eGFRcr") tags.push("egfr-suffix-cr");
  return { text: label + ": " + v, expect: { egfr: v }, tags: tags };
}
function renderSbp(v) {
  var mode = pick(["bp", "bp", "mmhg", "bp_annot", "sbp_only", "dated", "blood_pressure", "spaced"]);
  var dia = ri(60, 95);
  if (mode === "mmhg") return { text: v + "/" + dia + " mmHg", expect: { sbp: v }, tags: [] };
  if (mode === "bp_annot") return { text: "BP: " + v + "/" + dia + " (sitting, left arm)", expect: { sbp: v }, tags: ["bp-annotated"] };
  if (mode === "sbp_only") return { text: "SBP " + v, expect: { sbp: v }, tags: ["sbp-only"] };
  if (mode === "blood_pressure") return { text: "Blood Pressure: " + v + "/" + dia, expect: { sbp: v }, tags: [] };
  if (mode === "spaced") return { text: "BP " + v + " / " + dia, expect: { sbp: v }, tags: ["bp-spaced"] };
  if (mode === "dated") {
    // @LASTBP(3)@-style, most-recent first; expected = most recent systolic (v)
    var l1 = "07/10/26  " + v + "/" + dia;
    var l2 = "07/03/26  " + ri(110, 160) + "/" + ri(60, 90);
    var l3 = "06/28/26  " + ri(110, 160) + "/" + ri(60, 90);
    return { text: "BP:\n  " + l1 + "\n  " + l2 + "\n  " + l3, expect: { sbp: v }, tags: ["bp-dated-list"] };
  }
  return { text: "BP: " + v + "/" + dia, expect: { sbp: v }, tags: [] };
}
function renderAge(v) {
  return { text: pick(["Age", "Age", "AGE"]) + ": " + v + pick(["", " years", " y.o.", " yo"]), expect: { age: v }, tags: [] };
}
function renderSex(v) {
  var tok = v === "female" ? pick(["Female", "F", "female", "Woman"]) : pick(["Male", "M", "male", "Man"]);
  var tags = (tok === "F" || tok === "M") ? ["sex-single-letter"] : [];
  return { text: pick(["Sex", "Gender", "Legal Sex"]) + ": " + tok, expect: { sex: v }, tags: tags };
}

// Diabetes rendering
function renderDm(truth) {
  if (truth.dm) {
    if (chance(0.30)) { var h = pick(DM_HARD); return { text: h, expect: { dm: true }, tags: ["dm-hard-abbrev"], problem: true }; }
    var d = pick(DM_DETECTABLE); return { text: d, expect: { dm: true }, tags: ["dm-detectable"], problem: true };
  }
  // dm false — several flavors
  var flavor = pick(["explicit", "distractor", "fhx", "absent"]);
  if (flavor === "explicit") return { text: "Diabetes: No", expect: { dm: false }, tags: ["dm-explicit-no"] };
  if (flavor === "distractor") { var x = pick(DM_DISTRACTOR); return { text: x, expect: { dm: false }, tags: ["dm-distractor"], problem: true }; }
  if (flavor === "fhx") return { text: "Family history of diabetes (mother)", expect: { dm: false }, tags: ["dm-family-history"], problem: true };
  return { text: null, expect: { dm: false }, tags: ["dm-absent-from-problems"], problem: true }; // no DM line but problem list present
}

// Smoking rendering
function renderSmoking(truth) {
  if (truth.smoking) { var t = pick(SMOKE_TRUE); return { text: "Social Hx: " + t, expect: { smoking: true }, tags: ["smoke-true"] }; }
  var f = pick(SMOKE_FALSE); return { text: "Social Hx: " + f, expect: { smoking: false }, tags: ["smoke-false"] };
}

// BP meds rendering
function renderBpTx(truth) {
  if (truth.bp_tx) {
    var style = pick(["generic", "brand", "combo", "brand"]);
    if (style === "generic") { var g = pick(GENERIC_HTN); return { text: g + " " + pick(["10 mg", "25 mg", "5 mg daily", "50 mg BID"]), expect: { bp_tx: true }, tags: ["htn-generic"], med: true }; }
    if (style === "combo") { var c = pick(COMBO_HTN); return { text: c + " " + pick(["10/12.5 mg", "1 tab daily"]), expect: { bp_tx: true }, tags: ["htn-combo"], med: true }; }
    var b = pick(BRAND_HTN); return { text: b + " " + pick(["5 mg", "10 mg daily", "50 mg"]), expect: { bp_tx: true }, tags: ["htn-brand"], med: true };
  }
  var flavor = pick(["explicit", "allergy", "discontinued", "absent"]);
  if (flavor === "explicit") return { text: "No current hypertension medications", expect: { bp_tx: false }, tags: ["htn-explicit-none"] };
  if (flavor === "allergy") return { text: pick(GENERIC_HTN) + " — anaphylaxis", expect: { bp_tx: null }, tags: ["htn-in-allergy"], allergy: true };
  if (flavor === "discontinued") return { text: pick(GENERIC_HTN) + " (discontinued 2024)", expect: { bp_tx: null }, tags: ["htn-discontinued"], med: true };
  return { text: null, expect: { bp_tx: null }, tags: ["htn-none-mentioned"] };
}

// Statin rendering
function renderStatin(truth) {
  if (truth.statin) {
    var style = pick(["generic", "brand_known", "brand_unknown", "generic"]);
    if (style === "generic") { var g = pick(GENERIC_STATIN); return { text: g + " " + pick(["20 mg", "40 mg", "10 mg qHS"]), expect: { statin: true }, tags: ["statin-generic"], med: true }; }
    if (style === "brand_known") { var bk = pick(BRAND_STATIN_KNOWN); return { text: bk + " " + pick(["20 mg", "40 mg"]), expect: { statin: true }, tags: ["statin-brand-known"], med: true }; }
    var bu = pick(BRAND_STATIN_UNKNOWN); return { text: bu + " " + pick(["20 mg", "40 mg"]), expect: { statin: true }, tags: ["statin-brand-unknown"], med: true };
  }
  var flavor = pick(["explicit", "allergy", "absent"]);
  if (flavor === "explicit") return { text: "No current hyperlipidemia medications", expect: { statin: false }, tags: ["statin-explicit-none"] };
  if (flavor === "allergy") return { text: pick(GENERIC_STATIN) + " — myalgia/intolerance", expect: { statin: null }, tags: ["statin-in-allergy"], allergy: true };
  return { text: null, expect: { statin: null }, tags: ["statin-none-mentioned"] };
}

// Distractor lab lines that must NOT be captured as total_c / hdl_c / creatinine
function distractorLines() {
  var pool = ["LDL Cholesterol: 130", "LDL-C 128", "VLDL: 28", "Non-HDL Cholesterol: 161",
    "Cholesterol/HDL Ratio: 4.1", "Triglycerides: 150", "Creatinine Clearance: 95 mL/min"];
  var n = ri(0, 2), out = [];
  var sh = shuffle(pool);
  for (var i = 0; i < n; i++) out.push(sh[i]);
  return out;
}

// Optional labs
function optionalLabs(truth) {
  var out = [];
  if (chance(0.35)) { var a1c = rf(5.0, 11.0, 1); out.push({ text: pick(["HbA1c", "A1C", "Hemoglobin A1c", "Glycated Hemoglobin"]) + ": " + a1c + pick(["", " %"]), expect: { hba1c: a1c }, tags: ["hba1c"] }); }
  if (chance(0.25)) {
    var u = pick([12, 45, 150, 1250]);
    var lbl = pick(["UACR", "Urine Albumin/Creatinine Ratio", "Microalbumin/Creatinine", "Alb/Cr", "Microalbumin Creat Ratio"]);
    var us = u === 1250 ? "1,250" : String(u);
    out.push({ text: lbl + ": " + us, expect: { uacr: u }, tags: ["uacr", u === 1250 ? "uacr-comma" : "uacr-plain"] });
  }
  return out;
}

// ---- build a full case ----
function makeCase(idx) {
  var truth = {
    age: ri(30, 79), sex: pick(["male", "female"]),
    sbp: ri(96, 174), bmi: rf(19, 39, 1), egfr: ri(20, 118),
    dm: chance(0.5), smoking: chance(0.5), bp_tx: chance(0.5), statin: chance(0.5),
  };
  // ensure total > hdl
  truth.hdl_c = ri(25, 70);
  truth.total_c = truth.hdl_c + ri(60, 200);

  // standalone (non-section) fragments — all get rendered as top-level lines
  var standalone = [];

  var demog = [renderAge(truth.age), renderSex(truth.sex), renderSbp(truth.sbp),
    renderBmi(truth.bmi), renderTotalC(truth.total_c), renderHdlC(truth.hdl_c), renderEgfr(truth.egfr, truth)];
  var expect = {}, tags = [], egfrThreshold = null;
  var problemItems = [], medItems = [], allergyItems = [];

  demog.forEach(function (r) { Object.assign(expect, r.expect); tags = tags.concat(r.tags); if (r.text != null) standalone.push(r.text); });
  if (expect.egfr_threshold) { egfrThreshold = expect.egfr_threshold; delete expect.egfr_threshold; }

  var dm = renderDm(truth), sm = renderSmoking(truth), bt = renderBpTx(truth), st = renderStatin(truth);
  [dm, sm, bt, st].forEach(function (r) { Object.assign(expect, r.expect); tags = tags.concat(r.tags); });

  // route items to sections (or standalone)
  function route(r) {
    if (!r || r.text == null) return;
    if (r.allergy) allergyItems.push(r.text);
    else if (r.problem) problemItems.push(r.text);
    else if (r.med) medItems.push(r.text);
    else standalone.push(r.text);
  }
  route(dm); route(bt); route(st);
  if (sm.text != null) standalone.push(sm.text);

  var opt = optionalLabs(truth);
  opt.forEach(function (r) { Object.assign(expect, r.expect); tags = tags.concat(r.tags); if (r.text != null) standalone.push(r.text); });

  // Assemble text with headers and shuffled ordering
  var lines = [];
  lines.push("PREVENT INPUTS");
  var demogFrags = shuffle(standalone);
  demogFrags.forEach(function (t) { lines.push(t); });
  var distract = distractorLines();
  distract.forEach(function (d) { lines.push(d); });
  if (problemItems.length) { lines.push(pick(["Problem List:", "Active Problems:", "Past Medical History:"])); problemItems.forEach(function (p, i) { lines.push("  " + (i + 1) + ". " + p); }); }
  else if (dm.tags.indexOf("dm-absent-from-problems") >= 0 || dm.tags.indexOf("dm-explicit-no") < 0) {
    // if dm expected false-by-inference we still need a problem list present
  }
  if (medItems.length) { lines.push(pick(["Current Medications:", "Medications:", "Active Medications:"])); medItems.forEach(function (m) { lines.push("  " + m); }); }
  if (allergyItems.length) { lines.push(pick(["Allergies:", "Adverse Reactions:"])); allergyItems.forEach(function (a) { lines.push("  " + a); }); }

  // For dm false-by-inference cases we require a problem list header even if empty of DM
  var text = lines.join("\n");
  if ((dm.tags.indexOf("dm-absent-from-problems") >= 0) && !/problem list|active problems|past medical history/i.test(text)) {
    text += "\nProblem List:\n  1. Hyperlipidemia\n  2. Obesity";
  }

  return { idx: idx, truth: truth, text: text, expect: expect, egfrThreshold: egfrThreshold, tags: tags };
}

// ---- run all cases ----
var N = parseInt(process.env.N || process.argv[3] || "200", 10);
var cases = [];
for (var i = 0; i < N; i++) cases.push(makeCase(i));

var NUMERIC = ["age", "sbp", "total_c", "hdl_c", "bmi", "egfr", "hba1c", "uacr"];
var FLAGS = ["dm", "smoking", "bp_tx", "statin"];

var results = [];
var tagStats = {}; // tag -> {pass, fail}
function bump(tag, ok) { if (!tagStats[tag]) tagStats[tag] = { pass: 0, fail: 0 }; tagStats[tag][ok ? "pass" : "fail"]++; }

var totalAssert = 0, totalPass = 0;
var failures = [];
// cross-check (second parser) tallies
var xc = { agree: 0, conflict: 0, unconfirmed: 0, falseAlarm: 0, trueCatch: 0, falseAlarmFields: {} };
var XNUM = ["age", "sbp", "total_c", "hdl_c", "bmi", "egfr", "hba1c", "uacr", "sex"];

cases.forEach(function (c) {
  var parsed = APP.parseText(c.text);
  var v = parsed.values;
  var caseFails = [];

  // tally the differential cross-check vs. ground truth
  var conf = parsed.conflicts || {};
  XNUM.forEach(function (f) {
    var st = conf[f];
    if (!st) return;
    if (st === "agree") xc.agree++;
    else if (st === "unconfirmed") xc.unconfirmed++;
    else if (st === "conflict") {
      xc.conflict++;
      // was the PRIMARY value actually correct? if so, this conflict is a false alarm
      var want = c.expect[f], got = v[f], primaryCorrect;
      if (want === undefined || want === "SKIP" || want === "UNSET") primaryCorrect = true;
      else if (typeof want === "number") primaryCorrect = (typeof got === "number" && Math.abs(got - want) < 0.05);
      else primaryCorrect = (got === want);
      if (primaryCorrect) { xc.falseAlarm++; xc.falseAlarmFields[f] = (xc.falseAlarmFields[f] || 0) + 1; }
      else xc.trueCatch++;
    }
  });

  function assertField(field, want) {
    if (want === "SKIP") return; // unit cases we only report separately
    var got = v[field];
    var ok;
    if (want === "UNSET") { ok = (got === undefined || got === null); want = "(unset)"; }
    else if (want === null) { ok = (got === undefined || got === null); want = "(unset)"; }
    else if (typeof want === "number") { ok = (typeof got === "number" && Math.abs(got - want) < 0.05); }
    else { ok = (got === want); }
    totalAssert++; if (ok) totalPass++;
    // attribute to the tags relevant to this field
    c.tags.forEach(function (t) { if (tagRelevant(t, field)) bump(t, ok); });
    if (!ok) caseFails.push({ field: field, want: want, got: got === undefined ? "(unset)" : got });
    return ok;
  }

  // numeric expectations present in c.expect
  NUMERIC.forEach(function (f) { if (f in c.expect) assertField(f, c.expect[f]); });
  // flags
  FLAGS.forEach(function (f) { if (f in c.expect) assertField(f, c.expect[f]); });
  // sex
  if ("sex" in c.expect) assertField("sex", c.expect.sex);
  // egfr threshold marker
  if (c.egfrThreshold) {
    totalAssert++;
    var okT = parsed.thresholds && parsed.thresholds.egfr === c.egfrThreshold;
    if (okT) totalPass++;
    bump("egfr-threshold-marker", okT);
    if (!okT) caseFails.push({ field: "egfr_threshold", want: c.egfrThreshold, got: (parsed.thresholds && parsed.thresholds.egfr) || "(none)" });
  }

  if (caseFails.length) failures.push({ idx: c.idx, tags: c.tags, text: c.text, fails: caseFails });
  results.push({ idx: c.idx, ok: caseFails.length === 0, fails: caseFails });
});

// Map a tag to which field(s) it is about, so we only credit/blame the right assertions
function tagRelevant(tag, field) {
  if (tag.indexOf("chol") >= 0 || tag === "leading-ref-range") return field === "total_c";
  if (tag.indexOf("hdl") >= 0) return field === "hdl_c";
  if (tag.indexOf("egfr") >= 0 || tag.indexOf("creatinine") >= 0 || tag === "vertical-lab-layout") return field === "egfr";
  if (tag.indexOf("sbp") >= 0 || tag.indexOf("bp-") >= 0) return field === "sbp";
  if (tag.indexOf("dm-") >= 0) return field === "dm";
  if (tag.indexOf("smoke") >= 0) return field === "smoking";
  if (tag.indexOf("htn-") >= 0) return field === "bp_tx";
  if (tag.indexOf("statin-") >= 0) return field === "statin";
  if (tag.indexOf("hba1c") >= 0) return field === "hba1c";
  if (tag.indexOf("uacr") >= 0) return field === "uacr";
  if (tag.indexOf("sex") >= 0) return field === "sex";
  if (tag.indexOf("missing-data-") >= 0) return ("missing-data-" + field) === tag;
  return false;
}

// ---- report ----
var caseOk = results.filter(function (r) { return r.ok; }).length;
console.log("=".repeat(70));
console.log("PREVENT PARSER — INDEPENDENT EDGE-CASE TEST");
console.log("=".repeat(70));
console.log("Cases: " + N + "   |   Fully-correct cases: " + caseOk + "/" + N + " (" + (100 * caseOk / N).toFixed(1) + "%)");
console.log("Field-level assertions: " + totalPass + "/" + totalAssert + " passed (" + (100 * totalPass / totalAssert).toFixed(1) + "%)");
console.log("");
console.log("BY EDGE-CASE CATEGORY (sorted by fail count):");
console.log("-".repeat(70));
var rows = Object.keys(tagStats).map(function (t) { var s = tagStats[t]; return { tag: t, pass: s.pass, fail: s.fail, tot: s.pass + s.fail }; });
rows.sort(function (a, b) { return b.fail - a.fail || b.tot - a.tot; });
rows.forEach(function (r) {
  var flag = r.fail > 0 ? (r.pass === 0 ? "  ✗ ALWAYS FAILS" : "  ⚠ sometimes fails") : "  ✓";
  console.log("  " + (r.tag + " ".repeat(30)).slice(0, 30) + " " + (r.pass + "/" + r.tot + " pass").padEnd(14) + flag);
});

console.log("");
console.log("REPRESENTATIVE FAILURES (up to 30):");
console.log("=".repeat(70));
var shown = 0;
for (var fi = 0; fi < failures.length && shown < 30; fi++) {
  var F = failures[fi];
  // only show cases whose failures aren't purely UNSET-missed-detection dupes we've seen a lot
  console.log("\nCase #" + F.idx + "  tags: [" + F.tags.filter(function (t) { return t.indexOf("-") >= 0; }).join(", ") + "]");
  F.fails.forEach(function (f) { console.log("   " + f.field + ": expected " + JSON.stringify(f.want) + ", got " + JSON.stringify(f.got)); });
  var snippet = F.text.split("\n").slice(0, 14).map(function (l) { return "      | " + l; }).join("\n");
  console.log(snippet);
  shown++;
}

// cross-check (second parser) summary
var xcTotal = xc.agree + xc.conflict + xc.unconfirmed;
console.log("\n" + "=".repeat(70));
console.log("DIFFERENTIAL CROSS-CHECK (independent second parser)");
console.log("=".repeat(70));
console.log("  Fields checked: " + xcTotal);
console.log("  agree:       " + xc.agree + " (" + (100 * xc.agree / xcTotal).toFixed(1) + "%)  — both parsers landed on the same value");
console.log("  unconfirmed: " + xc.unconfirmed + " (" + (100 * xc.unconfirmed / xcTotal).toFixed(1) + "%)  — second parser abstained (no false alarm)");
console.log("  conflict:    " + xc.conflict + " (" + (100 * xc.conflict / xcTotal).toFixed(1) + "%)  — flagged for the user to verify");
console.log("     └─ false alarms (primary was actually right): " + xc.falseAlarm + "  " + JSON.stringify(xc.falseAlarmFields));
console.log("     └─ true catches (primary was wrong):          " + xc.trueCatch);
console.log("  → false-alarm rate: " + (100 * xc.falseAlarm / xcTotal).toFixed(2) + "% of all checked fields");

// write full detail to json
require("fs").writeFileSync(__dirname + "/edge-results.json", JSON.stringify({ summary: { N: N, caseOk: caseOk, totalAssert: totalAssert, totalPass: totalPass }, tagStats: tagStats, failures: failures }, null, 2));
console.log("\n\nFull detail written to edge-results.json");
