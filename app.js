/* PREVENT calculator — parse Epic .PREVENT output, bind an editable form,
   select the model per preventr::select_model, compute, and render.
   Depends on globals: PREVENT_COEFFS (coeffs.js) and PREVENT (prevent.js). */
(function () {
  "use strict";

  // ---- Valid input ranges (from preventr check_range) --------------------
  var RANGES = {
    age: [30, 79], sbp: [90, 180], bmi: [18.5, 39.9], egfr: [15, 140],
    hba1c: [4.5, 15], uacr: [0.1, 25000], sdi: [1, 10],
    total_c_mgdl: [130, 320], hdl_c_mgdl: [20, 100],
    total_c_mmol: [3.36, 8.28], hdl_c_mmol: [0.52, 2.59],
  };

  // ---- Parsing -----------------------------------------------------------
  // Each field: list of label synonyms (case-insensitive). We take the text
  // after the label on the same line and extract the relevant token.
  var FIELD_LABELS = {
    age: ["age"],
    sex: ["sex", "gender", "legal sex", "sex assigned at birth"],
    sbp: ["sbp", "systolic", "systolic bp", "systolic blood pressure", "blood pressure", "bp"],
    total_c: ["total cholesterol", "total chol", "cholesterol total", "tc", "total-c", "cholesterol"],
    hdl_c: ["hdl cholesterol", "hdl-c", "hdl"],
    dm: ["diabetes", "diabetes mellitus", "dm", "diabetic", "t2dm", "t1dm"],
    smoking: ["current smoker", "current smoking", "smoker", "smoking", "tobacco", "tobacco use"],
    bmi: ["bmi", "body mass index"],
    egfr: ["egfr", "gfr", "estimated gfr", "e-gfr"],
    bp_tx: ["on antihypertensive", "antihypertensive", "anti-hypertensive", "bp meds",
            "bp medication", "blood pressure medication", "htn meds", "on bp treatment",
            "antihypertensive use", "treated for hypertension", "bp tx"],
    statin: ["on statin", "statin", "statin use", "on statin therapy"],
    hba1c: ["hba1c", "a1c", "hemoglobin a1c", "hgba1c", "glycated hemoglobin"],
    uacr: ["uacr", "urine albumin-creatinine ratio", "urine albumin/creatinine",
           "albumin-creatinine ratio", "microalbumin/creatinine", "acr"],
    zip: ["zip", "zip code", "zipcode", "postal code"],
    sdi: ["sdi", "sdi decile", "social deprivation index"],
  };

  // Order matters: match more specific labels first so "hdl" doesn't get
  // grabbed by "cholesterol", "systolic" before "bp", etc.
  var MATCH_ORDER = ["age", "sex", "hba1c", "hdl_c", "total_c", "sbp", "egfr",
    "bmi", "uacr", "sdi", "zip", "bp_tx", "statin", "dm", "smoking"];

  function firstNumber(s) {
    // handles "132/80" -> 132, ">90" -> 90, "6.1 %" -> 6.1, "1,234" -> 1234
    if (s == null) return null;
    var m = String(s).replace(/,(?=\d{3}\b)/g, "").match(/-?\d+(\.\d+)?/);
    return m ? parseFloat(m[0]) : null;
  }

  var TRUE_WORDS = /\b(yes|y|true|positive|pos|present|current|active|on|1|\+)\b/i;
  var FALSE_WORDS = /\b(no|n|false|negative|neg|none|never|former|quit|denies|absent|not on file|off|0)\b/i;

  function parseBool(s) {
    if (s == null) return null;
    var t = String(s).trim();
    if (t === "") return null;
    // Order: explicit negatives (never/former/denies) win for smoking-type fields
    if (FALSE_WORDS.test(t) && !TRUE_WORDS.test(t)) return false;
    if (TRUE_WORDS.test(t) && !FALSE_WORDS.test(t)) return true;
    // both or neither -> prefer negative token position vs positive
    if (FALSE_WORDS.test(t)) return false;
    if (TRUE_WORDS.test(t)) return true;
    return null;
  }

  function parseSex(s) {
    if (s == null) return null;
    if (/\b(female|f|woman|women)\b/i.test(s)) return "female";
    if (/\b(male|m|man|men)\b/i.test(s)) return "male";
    return null;
  }

  // Longest synonyms first so "antihypertensive use" beats "antihypertensive",
  // "total cholesterol" beats "cholesterol", etc.
  var SORTED_LABELS = {};
  Object.keys(FIELD_LABELS).forEach(function (f) {
    SORTED_LABELS[f] = FIELD_LABELS[f].slice().sort(function (a, b) { return b.length - a.length; });
  });

  // From the text after a label, isolate the value region: prefer everything
  // after the first ':' or '=' (skips descriptors like "(CKD-EPI 2021):"),
  // otherwise use the remainder as-is (whitespace-separated values).
  function valueRegion(after) {
    var ci = after.search(/[:=]/);
    return (ci >= 0 ? after.slice(ci + 1) : after).trim();
  }

  var BLANK_RE = /^[\s*_.\-–—]*$/; // empty, wildcard, or dashes only

  // Parse a pasted block into a partial input object + which fields were found.
  function parseText(text) {
    var out = {}, found = {};
    if (!text) return { values: out, found: found };
    var lines = text.split(/\r?\n/);
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      if (!line || !line.trim()) continue;
      for (var k = 0; k < MATCH_ORDER.length; k++) {
        var field = MATCH_ORDER[k];
        if (found[field] !== undefined) continue; // already got it
        var labels = SORTED_LABELS[field];
        for (var j = 0; j < labels.length; j++) {
          // label bounded by non-alphanumerics so "age" != "average", "bp" != "sbp"
          var re = new RegExp("(?:^|[^a-z0-9])" + escapeRe(labels[j]) + "(?![a-z0-9])", "i");
          var m = re.exec(line);
          if (!m) continue;
          var after = line.slice(m.index + m[0].length);
          var rest = valueRegion(after);
          if (BLANK_RE.test(rest)) { break; } // present but blank/wildcard -> leave unset
          var val = interpret(field, rest);
          if (val !== null && val !== undefined) { out[field] = val; found[field] = true; }
          break;
        }
      }
    }
    return { values: out, found: found };
  }

  function interpret(field, rest) {
    switch (field) {
      case "sex": return parseSex(rest);
      case "dm": case "smoking": case "bp_tx": case "statin": return parseBool(rest);
      case "zip":
        var zm = rest.match(/\d{5}/); return zm ? zm[0] : null;
      default: return firstNumber(rest);
    }
  }

  function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

  // ---- Model selection (mirrors preventr::select_model) ------------------
  function usable(v, lo, hi) { return v !== null && v !== undefined && !isNaN(v) && v >= lo && v <= hi; }

  function selectModel(inp) {
    var uH = usable(inp.hba1c, RANGES.hba1c[0], RANGES.hba1c[1]);
    var uU = usable(inp.uacr, RANGES.uacr[0], RANGES.uacr[1]);
    var uS = inp.sdi !== null && inp.sdi !== undefined && !isNaN(inp.sdi);
    if (!uH && !uU && !uS) return "base";
    if (!uH && uU && !uS) return "uacr";
    if (uH && !uU && !uS) return "hba1c";
    if (!uH && !uU && uS) return "sdi";
    return "full";
  }

  // ---- Public compute wrapper -------------------------------------------
  // Returns { base:{r10,r30}, enhanced:{model,r10,r30}|null, problems:[], warnings:[] }
  function computeAll(inp) {
    var problems = [], warnings = [];
    // clean optional predictors that are out of range -> treat as missing
    var eff = Object.assign({}, inp);
    if (eff.hba1c != null && !usable(eff.hba1c, RANGES.hba1c[0], RANGES.hba1c[1])) {
      problems.push("HbA1c " + eff.hba1c + "% is outside 4.5–15; ignored.");
      eff.hba1c = undefined;
    }
    if (eff.uacr != null && !usable(eff.uacr, RANGES.uacr[0], RANGES.uacr[1])) {
      problems.push("UACR " + eff.uacr + " is outside 0.1–25000; ignored.");
      eff.uacr = undefined;
    }
    var base = PREVENT.estimate(eff, "base", PREVENT_COEFFS, null);
    var model = selectModel(eff);
    var enhanced = model === "base" ? null :
      { model: model, r10: PREVENT.riskFor(eff, model, "10yr", PREVENT_COEFFS, null),
                       r30: PREVENT.riskFor(eff, model, "30yr", PREVENT_COEFFS, null) };
    return { base: base, enhanced: enhanced, model: model, problems: problems, warnings: warnings };
  }

  // expose for browser + node tests
  var api = { parseText, selectModel, computeAll, RANGES, firstNumber, parseBool, parseSex };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (typeof window !== "undefined") window.PREVENT_APP = api;
})();
