/* Tests for the 2026 dyslipidemia guideline recommendation engine (guideline.js).
   Run: node verification/guideline-test.js

   These assert the guideline's decision boundaries, not prose. Each case names the
   rule it pins down so a future guideline revision fails loudly at the right line. */
"use strict";
var G = require("../guideline.js");

var pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; return; }
  fail++;
  console.log("  FAIL  " + name + (extra ? "\n        " + extra : ""));
}
function titles(rec) { return rec.items.map(function (i) { return i.title; }).join(" | "); }
function has(rec, re) { return re.test(titles(rec) + " " + rec.headline + " " + (rec.cac ? rec.cac.title : "")); }

// Baseline: 55-year-old man, no diabetes, not on a statin, LDL 120.
function base(over) {
  var c = { age: 55, sex: "male", dm: false, smoking: false, statin: false,
    ldl: 120, tc: 200, hdl: 50, enhancers: [] };
  for (var k in (over || {})) c[k] = over[k];
  return c;
}

console.log("\n2026 dyslipidemia guideline engine\n");

// ---- Risk categorization (the 2026 bands, not the PCE bands) ----
console.log("Risk categories");
ok("2.9% is low", G.categorize(2.9).key === "low");
ok("3.0% is borderline (band edge)", G.categorize(3.0).key === "borderline");
ok("4.99% is borderline", G.categorize(4.99).key === "borderline");
ok("5.0% is intermediate (Class 1 threshold)", G.categorize(5.0).key === "intermediate");
ok("9.99% is intermediate", G.categorize(9.99).key === "intermediate");
ok("10.0% is high", G.categorize(10.0).key === "high");
ok("old PCE 7.5% cutpoint is NOT a boundary here", G.categorize(7.4).key === G.categorize(7.6).key);
ok("old PCE 20% cutpoint is NOT a boundary here", G.categorize(19).key === G.categorize(21).key);

// ---- Risk-based primary prevention ----
console.log("Risk-based primary prevention");
var high = G.recommend(base({ ascvd10: 0.14, ascvd30: 0.35 }));
ok("high risk → high-intensity statin", /High-intensity/.test(high.headline));
ok("high risk → Class 1", high.items[0].cor === "Class 1");
ok("high risk → LDL goal <70", high.goals.ldl === 70 && high.goals.nonhdl === 100);
ok("high risk → ezetimibe then PCSK9i offered", has(high, /ezetimibe/i) && has(high, /PCSK9/));

var inter = G.recommend(base({ ascvd10: 0.07, ascvd30: 0.28 }));
ok("intermediate → moderate-to-high statin", /Moderate- to high-intensity/.test(inter.headline));
ok("intermediate → Class 1", inter.items[0].cor === "Class 1");
ok("intermediate → LDL goal <100", inter.goals.ldl === 100 && inter.goals.nonhdl === 130);

var bord = G.recommend(base({ ascvd10: 0.04, ascvd30: 0.09 }));
ok("borderline → Class 2 consideration", bord.items[0].cor === "Class 2");
ok("borderline → moderate intensity", /Moderate-intensity/.test(bord.headline));
ok("borderline → LDL goal <100", bord.goals.ldl === 100);

var low = G.recommend(base({ ascvd10: 0.02, ascvd30: 0.06 }));
ok("low risk → no routine statin", /Health-behavior/.test(low.headline));
ok("low risk → health-behavior therapy listed", has(low, /Health-behavior therapy/));

// ---- The two age-restricted Class 2 pathways new in 2026 ----
console.log("30-year and LDL 160-189 pathways (ages 30-59)");
var pathway30 = G.recommend(base({ age: 45, ascvd10: 0.02, ascvd30: 0.14 }));
ok("age 45, 10-yr 2%, 30-yr 14% → 30-yr pathway fires", has(pathway30, /30-year ASCVD risk ≥10%/));
ok("30-yr pathway is Class 2", pathway30.items.some(function (i) { return /30-year/.test(i.title) && i.cor === "Class 2"; }));
ok("30-yr pathway changes the headline", /30-year risk pathway/.test(pathway30.headline));

var tooOld = G.recommend(base({ age: 65, ascvd10: 0.02, ascvd30: 0.20 }));
ok("age 65 → 30-yr pathway does NOT fire", !has(tooOld, /30-year ASCVD risk ≥10%/));
ok("age 65 → caveat explains why", tooOld.caveats.some(function (c) { return /30–59 age range/.test(c); }));

var justUnder = G.recommend(base({ age: 45, ascvd10: 0.02, ascvd30: 0.099 }));
ok("30-yr 9.9% → pathway does not fire", !has(justUnder, /≥10%/));

var ldl170 = G.recommend(base({ age: 50, ldl: 170, ascvd10: 0.02, ascvd30: 0.05 }));
ok("LDL 170 at age 50 → Class 2 pathway fires", has(ldl170, /LDL-C 170 mg\/dL \(160–189\)/));
var ldl170old = G.recommend(base({ age: 70, ldl: 170, ascvd10: 0.02, ascvd30: null }));
ok("LDL 170 at age 70 → pathway does not fire", !has(ldl170old, /160–189/));

// ---- Risk-independent pathways take precedence ----
console.log("Risk-independent pathways");
var sev = G.recommend(base({ ldl: 205, ascvd10: 0.01 }));
ok("LDL 205 → severe hypercholesterolemia pathway", sev.pathway === "severe");
ok("severe → treats regardless of a 1% risk", /Maximally tolerated statin/.test(sev.headline));
ok("severe → FH genetic testing", has(sev, /familial hypercholesterolemia/i));
ok("severe → inclisiran named as alternative", has(sev, /Inclisiran|ezetimibe/i));

var sec = G.recommend(base({ clinicalAscvd: true, veryHigh: true, ascvd10: 0.09 }));
ok("clinical ASCVD → secondary pathway", sec.pathway === "secondary");
ok("very high risk → LDL <55, non-HDL <85", sec.goals.ldl === 55 && sec.goals.nonhdl === 85);
ok("secondary → says PREVENT does not apply", /does not apply/.test(sec.headlineNote));
var secNotVH = G.recommend(base({ clinicalAscvd: true, veryHigh: false, ascvd10: 0.09 }));
ok("ASCVD not very high → LDL <70", secNotVH.goals.ldl === 70);
var secLpa = G.recommend(base({ clinicalAscvd: true, veryHigh: true, lpa: 80, ascvd10: 0.09 }));
ok("ASCVD + Lp(a) ≥50 → PCSK9 mAb specifically favored", has(secLpa, /Lp\(a\) ≥50 mg\/dL with clinical ASCVD/));

var dm50 = G.recommend(base({ dm: true, age: 50, ascvd10: 0.06 }));
ok("diabetes 40–75 → diabetes pathway", dm50.pathway === "diabetes");
ok("diabetes, risk <10% → moderate intensity", /Moderate-intensity/.test(dm50.headline));
var dm50hi = G.recommend(base({ dm: true, age: 50, ascvd10: 0.13 }));
ok("diabetes, risk ≥10% → high intensity", /High-intensity/.test(dm50hi.headline));
ok("diabetes, risk ≥10% → LDL goal <70", dm50hi.goals.ldl === 70);
var dm35 = G.recommend(base({ dm: true, age: 35, ascvd10: 0.01, ascvd30: 0.05 }));
ok("diabetes under 40 with no qualifier → not automatic", /not automatically indicated/.test(dm35.headline));
var dm35q = G.recommend(base({ dm: true, age: 35, ascvd10: 0.035, ascvd30: 0.05 }));
ok("diabetes under 40 with 10-yr ≥3% → moderate statin reasonable", /Moderate-intensity statin is reasonable/.test(dm35q.headline));

// Precedence: ASCVD outranks severe LDL outranks diabetes.
var both = G.recommend(base({ clinicalAscvd: true, ldl: 200, dm: true, ascvd10: 0.09 }));
ok("ASCVD outranks LDL≥190 and diabetes", both.pathway === "secondary");
var sevDm = G.recommend(base({ ldl: 200, dm: true, ascvd10: 0.04 }));
ok("LDL≥190 outranks diabetes", sevDm.pathway === "severe");

// ---- Coronary artery calcium ----
console.log("Coronary artery calcium");
var cacOffer = G.recommend(base({ ascvd10: 0.07 }));
ok("intermediate + man ≥40 → CAC offered", cacOffer.cac && cacOffer.cac.score === null);
var cacNotOffered = G.recommend(base({ ascvd10: 0.14 }));
ok("high risk → CAC not offered as a decision aid", !cacNotOffered.cac);
var cac0 = G.recommend(base({ ascvd10: 0.07, cac: 0 }));
ok("CAC 0 → defer is reasonable", /deferring/.test(cac0.cac.title) && cac0.cac.cor === "Class 2");
var cac0dm = G.recommend(base({ ascvd10: 0.07, cac: 0, dm: true }));
ok("CAC 0 with diabetes → deferral explicitly not warranted", /does not warrant/.test(cac0dm.cac.detail));
var cac50 = G.recommend(base({ ascvd10: 0.04, cac: 50 }));
ok("CAC 1–99 → moderate statin, Class 1", /moderate-intensity statin/.test(cac50.cac.title) && cac50.cac.cor === "Class 1");
ok("CAC >0 tightens a borderline goal to <100", cac50.goals.ldl === 100);
var cac1500 = G.recommend(base({ ascvd10: 0.04, cac: 1500 }));
ok("CAC ≥1000 → LDL <55 / non-HDL <85", cac1500.goals.ldl === 55 && cac1500.goals.nonhdl === 85);
var cac400 = G.recommend(base({ ascvd10: 0.04, cac: 400 }));
ok("CAC 300–999 → goal tightened to <70", cac400.goals.ldl === 70);
// A high-risk patient's <70 goal must not be loosened by a modest CAC score.
var cacHigh = G.recommend(base({ ascvd10: 0.14, cac: 150 }));
ok("CAC 150 does not loosen a high-risk <70 goal", cacHigh.goals.ldl === 70);

// ---- Goal gap arithmetic ----
console.log("Goal gap");
ok("120 → <70 needs 42%", G.reductionNeeded(120, 70) === 42);
ok("already at goal returns 0", G.reductionNeeded(60, 70) === 0);
var gap = G.recommend(base({ ldl: 160, ascvd10: 0.14 }));
ok("LDL 160 → <70 is a 56% cut, high-intensity territory",
  /56% reduction — high-intensity statin territory/.test(gap.goals.gapNote), gap.goals.gapNote);
ok("a ≥50% required cut is flagged for the UI's warning styling", gap.goals.reduction >= 50);
var gapOk = G.recommend(base({ ldl: 95, ascvd10: 0.14 }));
ok("LDL 95 → <70 is a 26% cut, moderate-intensity range",
  /26% reduction — within reach of a moderate-intensity/.test(gapOk.goals.gapNote), gapOk.goals.gapNote);
var gapMid = G.recommend(base({ ldl: 110, ascvd10: 0.14 }));
ok("LDL 110 → <70 is a 36% cut, top of moderate range",
  /36% reduction — a moderate-intensity statin/.test(gapMid.goals.gapNote), gapMid.goals.gapNote);
var gapWide = G.recommend(base({ ldl: 185, clinicalAscvd: true, veryHigh: true, ascvd10: 0.14 }));
ok("LDL 185 → <55 is a 70% cut, needs a nonstatin",
  /beyond a high-intensity statin alone/.test(gapWide.goals.gapNote), gapWide.goals.gapNote);
var nonhdl = G.recommend(base({ tc: 220, hdl: 40, ascvd10: 0.14 }));
ok("non-HDL computed as TC − HDL", nonhdl.goals.nonhdlNow === 180);

// ---- Cross-cutting ----
console.log("Cross-cutting");
var lpaNone = G.recommend(base({ ascvd10: 0.07 }));
ok("no Lp(a) → one-time measurement recommended", has(lpaNone, /Measure Lp\(a\) once/));
var lpaHi = G.recommend(base({ ascvd10: 0.07, lpa: 120 }));
ok("Lp(a) 120 → flagged as ~2× risk", has(lpaHi, /roughly double/));
ok("Lp(a) present → no longer asks to measure it", !has(lpaHi, /Measure Lp\(a\) once/));
var onStatin = G.recommend(base({ ascvd10: 0.07, statin: true }));
ok("already on a statin → on-treatment-risk caveat", onStatin.caveats.some(function (c) { return /on-treatment risk/.test(c); }));
var old = G.recommend(base({ age: 78, ascvd10: 0.14 }));
ok("age >75 → individualized-discussion caveat", old.caveats.some(function (c) { return /Above age 75/.test(c); }));
var enh2 = G.recommend(base({ ascvd10: 0.04, enhancers: ["famhx", "lpa"] }));
ok("enhancers counted in borderline range", /2 risk-enhancing factors present/.test(titles(enh2)));
ok("every recommendation carries lifestyle", has(lpaNone, /Health-behavior therapy for everyone/));
ok("apoB is an action, not a warning", has(lpaNone, /Consider apoB/));
// The caveat box is warning-styled, so it must stay empty when there is nothing to warn about.
ok("no caveats for a straightforward patient", lpaNone.caveats.length === 0,
  JSON.stringify(lpaNone.caveats));

// ---- Degenerate input ----
console.log("Degenerate input");
var noRisk = G.recommend({ age: 55, sex: "male" });
ok("no risk supplied → asks for inputs rather than throwing", /Enter the remaining inputs/.test(noRisk.headline));
ok("categorize(null) is null", G.categorize(null) === null);

console.log("\n" + pass + " passed, " + fail + " failed\n");
process.exit(fail ? 1 : 0);
