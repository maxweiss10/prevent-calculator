/* Guideline recommendation engine — 2026 ACC/AHA/Multisociety dyslipidemia guideline.
   Pure function over a computed PREVENT result plus lipid/clinical context; no DOM,
   no network. Loaded by index.html and exercised by verification/guideline-test.js.

   Source: 2026 ACC/AHA/AACVPR/ABC/ACPM/ADA/AGS/APhA/ASPC/NLA/PCNA Guideline on the
   Management of Dyslipidemia. Circulation. 2026;153:e####. doi:10.1161/CIR.0000000000001423

   Threshold conventions encoded here:
     - 10-yr PREVENT-ASCVD categories: low <3%, borderline 3–<5%, intermediate 5–<10%, high >=10%.
     - Class 1 risk threshold for statin therapy is 10-yr >=5%.
     - Class 2 (consider, after clinician–patient discussion) covers 10-yr 3–<5%,
       LDL-C 160–189 mg/dL at ages 30–59, and 30-yr ASCVD >=10% at ages 30–59.
   The guideline states class 2 without our sources distinguishing 2a from 2b, so this
   module says "Class 2" rather than inventing a precision the sources don't support. */
(function () {
  "use strict";

  // ---- Reference data ----------------------------------------------------
  var INTENSITY = {
    high: {
      label: "High-intensity statin",
      detail: "Atorvastatin 40–80 mg or rosuvastatin 20–40 mg daily (expected LDL-C reduction ≥50%).",
    },
    moderate: {
      label: "Moderate-intensity statin",
      detail: "Atorvastatin 10–20 mg, rosuvastatin 5–10 mg, simvastatin 20–40 mg, pravastatin 40–80 mg, " +
        "lovastatin 40–80 mg, fluvastatin XL 80 mg, or pitavastatin 1–4 mg daily (expected LDL-C reduction 30–49%).",
    },
    modhigh: {
      label: "Moderate- to high-intensity statin",
      detail: "Moderate-intensity is the usual starting point; favor high-intensity (atorvastatin 40–80 mg or " +
        "rosuvastatin 20–40 mg) toward the upper end of the risk range or with risk-enhancing factors.",
    },
  };

  // 2026 guideline Table 1 — ASCVD risk-enhancing factors. Used to personalize the
  // estimate in the borderline/intermediate range (the "P" of Calculate–Personalize–Reclassify).
  var ENHANCERS = [
    { key: "famhx",     label: "Premature ASCVD in a first-degree relative (men <55, women <65)" },
    { key: "ancestry",  label: "Higher-risk ancestry (e.g. South Asian, Filipino)" },
    { key: "polygenic", label: "High polygenic risk score" },
    { key: "inflam",    label: "Chronic inflammatory disease (RA, lupus, psoriasis, HIV)" },
    { key: "lpa",       label: "Lp(a) ≥50 mg/dL (≈125 nmol/L)" },
    { key: "hscrp",     label: "hsCRP ≥2 mg/L" },
    { key: "tg",        label: "Triglycerides ≥175 mg/dL nonfasting (≥150 fasting)" },
    { key: "ckm",       label: "Cardiovascular–kidney–metabolic syndrome (obesity, metabolic syndrome, CKD)" },
    { key: "ldl160",    label: "LDL-C persistently 160–189 mg/dL or non-HDL-C 190–219 mg/dL" },
    { key: "repro",     label: "Female-specific: early menopause, preeclampsia, or gestational diabetes" },
  ];

  var COR = { one: "Class 1", two: "Class 2", none: null };

  // ---- Risk categorization ------------------------------------------------
  // 2026 PREVENT-ASCVD categories. NOTE these are NOT the 2018/2019 PCE cutpoints
  // (5 / 7.5 / 20%) — PREVENT is better calibrated and runs lower, so the guideline
  // lowered the bands to match.
  function categorize(pct10) {
    if (pct10 == null || isNaN(pct10)) return null;
    if (pct10 < 3)  return { key: "low",          label: "Low",          range: "<3%" };
    if (pct10 < 5)  return { key: "borderline",   label: "Borderline",   range: "3–<5%" };
    if (pct10 < 10) return { key: "intermediate", label: "Intermediate", range: "5–<10%" };
    return            { key: "high",         label: "High",         range: "≥10%" };
  }

  function item(title, detail, cor) { return { title: title, detail: detail, cor: cor || null }; }

  // Thresholds compare against the exact value; only the human-readable string is
  // rounded, so a converted mmol/L LDL reads "142" rather than "141.9189".
  function disp(v) { return v == null ? "" : String(Math.round(v)); }

  // Percent LDL-C reduction needed to reach goal — answers "will a statin alone get
  // there?" before the patient comes back in 8 weeks having not gotten there.
  function reductionNeeded(ldl, goal) {
    if (ldl == null || goal == null || ldl <= 0) return null;
    if (ldl < goal) return 0;
    return Math.round((1 - goal / ldl) * 100);
  }

  // ---- Main -------------------------------------------------------------
  /* ctx: { age, sex, dm, smoking, statin, ascvd10, ascvd30 (fractions),
            ldl, tc, hdl (mg/dL), clinicalAscvd, veryHigh, cac, cacHighPct, lpa,
            enhancers: [key] }
     returns { pathway, pathwayLabel, category, headline, items[], goals, cac, caveats[] } */
  function recommend(ctx) {
    var c = ctx || {};
    var r10 = c.ascvd10 == null ? null : c.ascvd10 * 100;
    var r30 = c.ascvd30 == null ? null : c.ascvd30 * 100;
    var ldl = num(c.ldl);
    var nonhdl = (num(c.tc) != null && num(c.hdl) != null) ? num(c.tc) - num(c.hdl) : null;
    var age = num(c.age);
    var enh = (c.enhancers || []).slice();
    var cat = categorize(r10);

    var out = {
      pathway: "risk", pathwayLabel: "", category: cat, headline: "", headlineNote: "",
      items: [], goals: null, cac: null, caveats: [], enhancerCount: enh.length,
    };

    // The 30-year pathway and the LDL 160–189 pathway are both age-restricted to 30–59.
    var young = age != null && age >= 30 && age <= 59;
    var r30Qualifies = young && r30 != null && r30 >= 10;
    var ldl160Qualifies = young && ldl != null && ldl >= 160 && ldl < 190;

    // ---------------- Pathway 1: clinical ASCVD (secondary prevention) ----
    if (c.clinicalAscvd) {
      out.pathway = "secondary";
      out.pathwayLabel = "Secondary prevention — established clinical ASCVD";
      out.goals = c.veryHigh ? { ldl: 55, nonhdl: 85, label: "Very high-risk ASCVD" }
                             : { ldl: 70, nonhdl: 100, label: "ASCVD, not very high risk" };
      out.headline = "High-intensity statin at the maximally tolerated dose.";
      out.headlineNote = "PREVENT is a primary-prevention tool and does not apply here — the risk numbers " +
        "above are shown for context only, not to decide therapy.";
      out.items.push(item(INTENSITY.high.label, INTENSITY.high.detail, COR.one));
      out.items.push(item("Add ezetimibe if the LDL-C goal is not met",
        "Ezetimibe 10 mg daily is the first add-on when maximally tolerated statin alone leaves LDL-C above goal.", COR.one));
      out.items.push(item("Escalate to a PCSK9 monoclonal antibody or bempedoic acid",
        "Indicated when statin plus ezetimibe still leaves LDL-C above goal. Inclisiran is a reasonable alternative.", COR.one));
      if (num(c.lpa) != null && num(c.lpa) >= 50) {
        out.items.push(item("Lp(a) ≥50 mg/dL with clinical ASCVD — favor a PCSK9 monoclonal antibody",
          "The guideline specifically recommends a PCSK9 mAb in this combination.", COR.one));
      }
      addGoalGap(out, ldl, nonhdl);
      addUniversal(out, c, age);
      return out;
    }

    // ---------------- Pathway 2: severe hypercholesterolemia --------------
    if (ldl != null && ldl >= 190) {
      out.pathway = "severe";
      out.pathwayLabel = "Severe hypercholesterolemia — LDL-C ≥190 mg/dL";
      out.goals = { ldl: 100, nonhdl: 130, label: "LDL-C ≥50% reduction, and <100 mg/dL" };
      out.headline = "Maximally tolerated statin regardless of calculated risk.";
      out.headlineNote = "LDL-C ≥190 mg/dL is a risk-independent indication — do not use the PREVENT " +
        "estimate to decide whether to treat.";
      out.items.push(item("High-intensity statin, titrated to maximally tolerated dose", INTENSITY.high.detail, COR.one));
      out.items.push(item("Add ezetimibe, then a PCSK9 monoclonal antibody or bempedoic acid",
        "Escalate sequentially until LDL-C falls at least 50% and below 100 mg/dL. Inclisiran is a reasonable " +
        "alternative if LDL-C remains ≥100 mg/dL on maximally tolerated statin plus ezetimibe.", COR.one));
      out.items.push(item("Genetic testing for familial hypercholesterolemia",
        "Recommended at this LDL-C level, with cascade screening of first-degree relatives.", COR.one));
      addGoalGap(out, ldl, nonhdl);
      addUniversal(out, c, age);
      return out;
    }

    // ---------------- Pathway 3: diabetes ---------------------------------
    if (c.dm) {
      out.pathway = "diabetes";
      out.pathwayLabel = "Diabetes — risk-independent statin indication";
      var multi = enh.length >= 2 || !!c.smoking;
      if (age != null && age >= 40 && age <= 75) {
        var wantHigh = (r10 != null && r10 >= 10) || multi;
        out.goals = (r10 != null && r10 >= 10) ? { ldl: 70, nonhdl: 100, label: "Diabetes with 10-yr risk ≥10%" }
                                               : { ldl: 100, nonhdl: 130, label: "Diabetes, 10-yr risk <10%" };
        out.headline = wantHigh ? "High-intensity statin." : "Moderate-intensity statin.";
        out.headlineNote = "Ages 40–75 with diabetes warrant a statin irrespective of calculated risk.";
        out.items.push(wantHigh
          ? item(INTENSITY.high.label, INTENSITY.high.detail + (r10 != null && r10 >= 10
              ? " Chosen because 10-year risk is ≥10%." : " Chosen because of multiple additional risk factors."), COR.one)
          : item(INTENSITY.moderate.label, INTENSITY.moderate.detail +
              " Escalate to high-intensity if 10-year risk reaches 10% or multiple risk factors are present.", COR.one));
        if (r10 != null && r10 >= 10) {
          out.items.push(item("Add ezetimibe, then a PCSK9 monoclonal antibody, if goals are not met",
            "At 10-year risk ≥10% the guideline supports nonstatin escalation to reach the LDL-C goal.", COR.one));
        }
      } else if (age != null && age < 40) {
        var qualifies = (r10 != null && r10 >= 3) || r30Qualifies || enh.length > 0;
        out.goals = { ldl: 100, nonhdl: 130, label: "Diabetes, primary prevention" };
        out.headline = qualifies ? "Moderate-intensity statin is reasonable."
                                 : "Health-behavior therapy; statin not automatically indicated at this age.";
        out.headlineNote = "Under age 40, diabetes alone is not an automatic statin indication — eligibility " +
          "rests on diabetes-specific risk enhancers or, at age ≥30, a 10-year risk ≥3% or 30-year risk ≥10%.";
        out.items.push(item(qualifies ? INTENSITY.moderate.label : "Reassess annually",
          qualifies ? INTENSITY.moderate.detail + reasonText(r10, r30Qualifies, enh.length)
                    : "Recheck lipids and recalculate risk annually; treat when a qualifying criterion is met.", COR.two));
      } else {
        out.goals = { ldl: 100, nonhdl: 130, label: "Diabetes, primary prevention" };
        out.headline = "Continue statin therapy; individualize above age 75.";
        out.headlineNote = "Above age 75 the guideline favors an individualized discussion weighing comorbidity, " +
          "frailty, polypharmacy, and patient preference.";
        out.items.push(item("Individualized clinician–patient discussion",
          "Continuation is generally reasonable in those already tolerating a statin.", COR.two));
      }
      addCac(out, c, cat, age);
      addGoalGap(out, ldl, nonhdl);
      addUniversal(out, c, age);
      return out;
    }

    // ---------------- Pathway 4: risk-based primary prevention ------------
    out.pathway = "risk";
    out.pathwayLabel = "Primary prevention — risk-based";
    if (!cat) {
      out.headline = "Enter the remaining inputs to generate a recommendation.";
      return out;
    }

    if (cat.key === "high") {
      out.goals = { ldl: 70, nonhdl: 100, label: "High risk (10-yr ≥10%)" };
      out.headline = "High-intensity statin.";
      out.headlineNote = "10-year PREVENT-ASCVD risk ≥10% is a Class 1 indication.";
      out.items.push(item(INTENSITY.high.label, INTENSITY.high.detail, COR.one));
      out.items.push(item("Add ezetimibe if the LDL-C goal is not met", "First-line nonstatin add-on.", COR.one));
      out.items.push(item("Then a PCSK9 monoclonal antibody or bempedoic acid",
        "If statin plus ezetimibe leaves LDL-C above goal.", COR.one));
    } else if (cat.key === "intermediate") {
      out.goals = { ldl: 100, nonhdl: 130, label: "Intermediate risk (10-yr 5–<10%)" };
      out.headline = "Moderate- to high-intensity statin, after a clinician–patient discussion.";
      out.headlineNote = "10-year risk ≥5% is the Class 1 threshold for lipid-lowering therapy.";
      out.items.push(item(INTENSITY.modhigh.label, INTENSITY.modhigh.detail, COR.one));
      if (enh.length) {
        out.items.push(item(enh.length + " risk-enhancing factor" + (enh.length > 1 ? "s" : "") + " present — favors high-intensity",
          "Risk enhancers argue for treating at the more intensive end of this range.", COR.none));
      }
    } else if (cat.key === "borderline") {
      out.goals = { ldl: 100, nonhdl: 130, label: "Borderline risk (10-yr 3–<5%)" };
      out.headline = "Moderate-intensity statin may be considered after a clinician–patient discussion.";
      out.headlineNote = "This is the Class 2 range — the decision should be personalized with " +
        "risk-enhancing factors, and reclassified with CAC when it remains uncertain.";
      out.items.push(item(INTENSITY.moderate.label, INTENSITY.moderate.detail, COR.two));
      out.items.push(item(enh.length ? enh.length + " risk-enhancing factor" + (enh.length > 1 ? "s" : "") + " present — favors treating"
                                     : "Review risk-enhancing factors before deciding",
        enh.length ? "Risk enhancers shift the balance toward starting a statin in this range."
                   : "None entered. Family history, Lp(a), hsCRP, triglycerides, inflammatory disease, CKM " +
                     "syndrome, ancestry, and female-specific factors all move this decision.", COR.none));
    } else {
      out.goals = { ldl: 100, nonhdl: 130, label: "Low risk (10-yr <3%)" };
      out.headline = "Health-behavior therapy; a statin is not routinely indicated.";
      out.headlineNote = "At 10-year risk <3%, treatment rests on the two age-restricted Class 2 pathways below.";
    }

    // Class 2 pathways that can pull a low- or borderline-risk patient into treatment.
    if (cat.key === "low" || cat.key === "borderline") {
      if (r30Qualifies) {
        out.items.push(item("30-year ASCVD risk ≥10% (" + r30.toFixed(1) + "%) at age " + age +
          " — moderate-intensity statin may be considered",
          "New in 2026: at ages 30–59, a 30-year risk ≥10% is its own pathway to statin consideration, " +
          "independent of the 10-year estimate. This is the single largest source of newly eligible adults " +
          "under the 2026 guideline.", COR.two));
        if (cat.key === "low") out.headline = "Consider a moderate-intensity statin via the 30-year risk pathway.";
      } else if (young && r30 != null) {
        out.items.push(item("30-year ASCVD risk " + r30.toFixed(1) + "% — below the 10% pathway threshold",
          "The 30-year pathway does not add an indication here.", COR.none));
      }
      if (ldl160Qualifies) {
        out.items.push(item("LDL-C " + disp(ldl) + " mg/dL (160–189) at age " + age +
          " — moderate-intensity statin may be considered",
          "At ages 30–59 an LDL-C of 160–189 mg/dL is its own Class 2 pathway, independent of calculated risk.", COR.two));
        if (cat.key === "low" && !r30Qualifies) out.headline = "Consider a moderate-intensity statin for LDL-C 160–189 mg/dL.";
      }
      if (!r30Qualifies && !ldl160Qualifies && cat.key === "low") {
        out.items.push(item("Health-behavior therapy",
          "Diet, physical activity, weight management, and tobacco cessation. Recheck lipids and recalculate risk " +
          "in 4–6 years, or sooner if risk factors change.", COR.one));
      }
      if (age != null && age > 59) {
        out.caveats.push("Age " + age + " is above the 30-year pathway's 30–59 age range, so that route to " +
          "treatment does not apply.");
      }
    }

    addCac(out, c, cat, age);
    addGoalGap(out, ldl, nonhdl);
    addUniversal(out, c, age);
    return out;
  }

  function reasonText(r10, r30q, nEnh) {
    if (r10 != null && r10 >= 3) return " Qualifies on a 10-year risk ≥3%.";
    if (r30q) return " Qualifies on a 30-year risk ≥10%.";
    if (nEnh) return " Qualifies on diabetes-specific risk-enhancing factors.";
    return "";
  }

  // ---- Coronary artery calcium ------------------------------------------
  // CAC is the "Reclassify" step: offered only where it can actually change the
  // decision (borderline/intermediate), and interpreted if a score is already known.
  function addCac(out, c, cat, age) {
    var cac = num(c.cac);
    var eligibleAge = age != null && ((c.sex === "male" && age >= 40) || (c.sex === "female" && age >= 45) ||
      (!c.sex && age >= 45));
    var eligibleRisk = cat && (cat.key === "borderline" || cat.key === "intermediate");

    if (cac != null) {
      var block = { score: cac, title: "", detail: "", cor: null };
      if (cac === 0) {
        block.title = "CAC 0 — deferring lipid-lowering therapy is reasonable";
        block.detail = "In a borderline- or intermediate-risk patient who prefers to avoid therapy and has no " +
          "higher-risk condition (familial hypercholesterolemia, severe hypercholesterolemia, diabetes, current " +
          "smoking), it is reasonable to defer and repeat the CAC in 3–7 years.";
        block.cor = COR.two;
        if (c.dm || c.smoking) {
          block.detail += " Note this patient has " + (c.dm ? "diabetes" : "") + (c.dm && c.smoking ? " and " : "") +
            (c.smoking ? "current smoking" : "") + ", a higher-risk condition — a CAC of 0 does not warrant " +
            "deferring therapy here.";
        }
      } else if (cac < 100) {
        block.title = "CAC " + cac + " (1–99) — start a moderate-intensity statin";
        block.detail = "For CAC 1–99 AU below the 75th percentile for age and sex — or incidental mild " +
          "coronary calcium on a noncardiac CT — moderate-intensity statin therapy is recommended. Any " +
          "detectable calcium supports an LDL-C goal <100 mg/dL.";
        block.cor = COR.one;
        if (!out.goals || out.goals.ldl > 100) out.goals = { ldl: 100, nonhdl: 130, label: "CAC >0" };
      } else if (cac < 300) {
        block.title = "CAC " + cac + " (≥100) — initiate lipid-lowering therapy";
        block.detail = "A CAC ≥100 AU (or ≥75th percentile) reclassifies the patient upward and is an " +
          "indication to treat, with an LDL-C goal <100 mg/dL.";
        block.cor = COR.one;
        if (!out.goals || out.goals.ldl > 100) out.goals = { ldl: 100, nonhdl: 130, label: "CAC ≥100" };
      } else if (cac < 1000) {
        block.title = "CAC " + cac + " (300–999) — treat, and consider intensification";
        block.detail = "Extensive calcification supports lipid-lowering therapy and consideration of more " +
          "aggressive LDL-C goals.";
        block.cor = COR.one;
        if (!out.goals || out.goals.ldl > 70) out.goals = { ldl: 70, nonhdl: 100, label: "CAC 300–999" };
      } else {
        block.title = "CAC ≥1000 — treat to secondary-prevention-level goals";
        block.detail = "At CAC ≥1000 AU the guideline sets an LDL-C goal <55 mg/dL and non-HDL-C <85 mg/dL.";
        block.cor = COR.one;
        out.goals = { ldl: 55, nonhdl: 85, label: "CAC ≥1000" };
      }
      if (!eligibleRisk && cat) {
        block.detail += " (CAC is intended for borderline- or intermediate-risk decision-making; this patient is " +
          cat.label.toLowerCase() + " risk, so weigh it alongside the indication already established.)";
      }
      out.cac = block;
    } else if (eligibleRisk && eligibleAge) {
      out.cac = {
        score: null,
        title: "CAC scoring is reasonable if the decision remains uncertain",
        detail: "For men ≥40 and women ≥45 at borderline or intermediate risk, a CAC score is the " +
          "guideline's reclassification step when the statin decision is still uncertain after considering " +
          "risk-enhancing factors. Enter the score above to see how it changes this recommendation.",
        cor: COR.one,
      };
    }
  }

  // ---- Goal gap ----------------------------------------------------------
  // Whether the goal is reachable on a statin alone, computed up front rather than
  // discovered at the 8-week recheck.
  function addGoalGap(out, ldl, nonhdl) {
    if (!out.goals) return;
    out.goals.ldlNow = ldl;
    out.goals.nonhdlNow = nonhdl;
    if (ldl == null) return;
    var need = reductionNeeded(ldl, out.goals.ldl);
    out.goals.reduction = need;
    if (need === 0) {
      out.goals.gapNote = "LDL-C " + disp(ldl) + " mg/dL is already below the " + out.goals.ldl + " mg/dL goal.";
    } else if (need != null) {
      // Benchmarks: moderate-intensity ≈30–49% LDL-C reduction, high-intensity ≥50%,
      // ezetimibe adds roughly a further 20% on top of a statin.
      var how = need < 30 ? " — within reach of a moderate-intensity statin (30–49%)."
        : need < 50 ? " — a moderate-intensity statin (30–49%) should reach it; high-intensity adds margin."
        : need < 60 ? " — high-intensity statin territory (≈50%); add ezetimibe if the response falls short."
        : " — beyond a high-intensity statin alone (≈50%). Plan on ezetimibe (a further ~20%) or a PCSK9 inhibitor.";
      out.goals.gapNote = "LDL-C " + disp(ldl) + " → <" + out.goals.ldl + " mg/dL requires a " + need + "% reduction" + how;
    }
  }

  // ---- Cross-cutting recommendations ------------------------------------
  function addUniversal(out, c, age) {
    var lpa = num(c.lpa);
    if (lpa == null) {
      out.items.push(item("Measure Lp(a) once in adulthood",
        "The 2026 guideline recommends a one-time Lp(a) measurement in all adults. Lp(a) ≥50 mg/dL " +
        "(≈125 nmol/L) carries roughly 1.4× the risk and ≥100 mg/dL (≈250 nmol/L) roughly 2×.", COR.one));
    } else if (lpa >= 100) {
      out.items.push(item("Lp(a) " + disp(lpa) + " mg/dL — roughly double the ASCVD risk",
        "Treat as a major risk-enhancing factor; it argues for treating at the more intensive end of any range " +
        "and for cascade screening of first-degree relatives.", COR.none));
    } else if (lpa >= 50) {
      out.items.push(item("Lp(a) " + disp(lpa) + " mg/dL — risk-enhancing factor (≈1.4× risk)",
        "Weigh this toward treatment and toward the more intensive end of any range.", COR.none));
    }

    out.items.push(item("Health-behavior therapy for everyone",
      "Dietary pattern emphasizing vegetables, fruits, legumes, whole grains, nuts, and fish with limited " +
      "saturated fat; ≥150 min/week of moderate physical activity; weight management; tobacco cessation. " +
      "This is the foundation at every risk level, not an alternative to therapy.", COR.one));

    out.items.push(item("Recheck a lipid panel 4–12 weeks after starting or changing therapy",
      "Confirm adherence and percent LDL-C reduction, then every 3–12 months once stable.", COR.one));

    out.items.push(item("Consider apoB to refine risk and intensity",
      "Most informative with high triglycerides, diabetes, or a low achieved LDL-C, where LDL-C alone " +
      "understates atherogenic particle burden.", COR.two));

    if (c.statin) {
      out.caveats.push("This patient is already on a statin, and statin use is an input to PREVENT — so the " +
        "risk shown is on-treatment risk, not the untreated risk that the guideline's treatment thresholds were " +
        "framed around. Use it to judge residual risk and intensification, not to decide initial eligibility.");
    }
    if (age != null && age > 75) {
      out.caveats.push("Above age 75 the evidence for initiating primary-prevention statins is weaker; the " +
        "guideline favors an individualized discussion weighing comorbidity, frailty, life expectancy, and preference.");
    }
  }

  function num(v) {
    if (v === null || v === undefined || v === "") return null;
    var n = typeof v === "number" ? v : parseFloat(v);
    return isNaN(n) ? null : n;
  }

  var api = { recommend: recommend, categorize: categorize, ENHANCERS: ENHANCERS, INTENSITY: INTENSITY,
    reductionNeeded: reductionNeeded };
  if (typeof window !== "undefined") window.PREVENT_GUIDELINE = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
