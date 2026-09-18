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
    // LDL-C is not a PREVENT predictor — it drives the 2026 dyslipidemia guideline
    // recommendations only, so its range is the plausible-value range, not a
    // preventr validity range.
    ldl_c_mgdl: [20, 400], ldl_c_mmol: [0.52, 10.34],
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
    // "tobacco" intentionally excluded — it matches "Smokeless tobacco: Never"
    // and would hijack cigarette smoking status. detectSmoking() handles tobacco.
    smoking: ["current smoker", "current smoking", "smoker", "smoking"],
    bmi: ["bmi", "body mass index"],
    egfr: ["egfr", "gfr", "estimated gfr", "e-gfr"],
    bp_tx: ["on antihypertensive", "antihypertensive", "anti-hypertensive", "bp meds",
            "bp medication", "blood pressure medication", "htn meds", "on bp treatment",
            "antihypertensive use", "treated for hypertension", "bp tx"],
    statin: ["on statin", "statin", "statin use", "on statin therapy"],
    hba1c: ["hba1c", "a1c", "hemoglobin a1c", "hgba1c", "glycated hemoglobin"],
    uacr: ["uacr", "urine albumin-creatinine ratio", "urine albumin/creatinine",
           "albumin-creatinine ratio", "microalbumin/creatinine", "acr"],
    // NOTE: ZIP code is intentionally NOT parsed — a 5-digit ZIP is a HIPAA
    // identifier (PHI). SDI decile (a 1–10 index, not identifying) may be entered.
    sdi: ["sdi", "sdi decile", "social deprivation index"],
  };

  // Labeled pass handles the explicit/non-lab fields. Numeric lab & vital
  // values (sbp, bmi, total_c, hdl_c, egfr, hba1c, uacr) are handled by
  // scanClinical(), which also works on unstructured lab dumps.
  var MATCH_ORDER = ["age", "sex", "sdi", "bp_tx", "statin", "dm", "smoking"];
  // Yes/No fields: only accept an EXPLICIT "Label: value" line (colon/equals).
  // A bare keyword in prose (e.g. "type 2 diabetes mellitus" in a problem list)
  // must fall through to the guarded inference, not be read as a Yes/No answer.
  var BOOL_FIELDS = { dm: 1, smoking: 1, bp_tx: 1, statin: 1 };

  // Phrases that mean "data is missing/unknown" — must return null, not a
  // clinical Yes or No. Checked before TRUE/FALSE word matching.
  var MISSING_DATA = /\b(?:not on file|not documented|not assessed|not available|unavailable|unknown|n\/a|no data|not recorded|not entered|unable to obtain|pending|not provided|deferred)\b/i;

  function firstNumber(s) {
    // handles "132/80" -> 132, ">90" -> 90, "6.1 %" -> 6.1, "1,234" -> 1234
    if (s == null) return null;
    var str = String(s);
    if (MISSING_DATA.test(str)) return null;
    var m = str.replace(/,(?=\d{3}\b)/g, "").match(/-?\d+(\.\d+)?/);
    return m ? parseFloat(m[0]) : null;
  }

  // The bare digits 1/0 are guarded so they can't match INSIDE a number:
  // "Smoking: 0.5 ppd" is half a pack a day, not a "0" meaning No.
  var TRUE_WORDS = /\b(yes|y|true|positive|pos|present|current|active|on|\+)\b|(?<![\d.])1(?![\d.])/i;
  var FALSE_WORDS = /\b(no|not|n|false|negative|neg|none|never|former|quit|denies|absent|off)\b|(?<![\d.])0(?![\d.])/i;
  // Values that answer nothing. "no change" describes a CONTINUING regimen and
  // "on hold" a suspended one; both contain words ("no", "on") that parseBool
  // would otherwise turn into a confident Yes or No.
  var NON_ANSWER = /^\s*(?:no\s+chang|unchanged|same\b|continue|cont\b|on\s+hold|held\b|holding\b|pending)/i;

  function parseBool(s) {
    if (s == null) return null;
    var t = String(s).trim();
    if (t === "") return null;
    if (MISSING_DATA.test(t)) return null;
    if (NON_ANSWER.test(t)) return null;
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
    var ci = after.search(/[:=?]/);
    return (ci >= 0 ? after.slice(ci + 1) : after).trim();
  }

  var BLANK_RE = /^[\s*_.\-–—]*$/; // empty, wildcard, or dashes only

  // ---- Text normalization ------------------------------------------------
  // Epic output can contain non-breaking spaces, smart quotes, en/em-dashes,
  // tabs, and CRLF. Normalizing before parsing prevents subtle match failures.
  // IMPORTANT: every replacement is LENGTH-PRESERVING (1 char -> 1 char), so a
  // character offset in the normalized text is also valid in the RAW pasted text.
  // That keeps the "show your work" highlighter aligned — Epic's tabular output
  // is full of tabs, and expanding them would shift every downstream highlight.
  function normalizeText(text) {
    return text
      .replace(/ /g, " ")
      .replace(/–/g, "-")
      .replace(/—/g, "-")
      .replace(/[‘’]/g, "'")
      .replace(/[“”]/g, '"')
      .replace(/\r/g, " ")
      .replace(/\t/g, " ");
  }

  // Parse a pasted block into a partial input object + which fields were found.
  function parseText(text) {
    var out = {}, found = {}, thresholds = {};
    if (!text) return { values: out, found: found, thresholds: thresholds, warnings: [] };
    text = normalizeText(text);
    var lines = text.split(/\n/);
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
          // Yes/No fields require an explicit ":"/"=" right after the label,
          // so bare mentions in prose/problem lists don't become answers.
          // "?" included so a pre-visit questionnaire ("Diabetes? No",
          // "Smoker? No") is read as the explicit No that it is.
          if (BOOL_FIELDS[field] && !/^\s*[:=?]/.test(after)) break;
          var rest = valueRegion(after);
          // A bool value that names a med section ("Current Hypertension
          // Medications") is a header, not a Yes/No answer — defer to inference,
          // which reads the "No current ... medications" / drug lines below it.
          if (BOOL_FIELDS[field] && /\bmedications?\b|\bhypertension\b|\bhyperlipidemia\b/i.test(rest)) break;
          if (BLANK_RE.test(rest)) { break; } // present but blank/wildcard -> leave unset
          var val = interpret(field, rest);
          if (val !== null && val !== undefined) { out[field] = val; found[field] = true; }
          break;
        }
      }
    }
    scanClinical(text, out, found, thresholds); // scrape labs/vitals from unstructured text
    var inferred = inferFlags(text, out, found); // meds/problems/social hx -> Yes/No flags
    var warnings = validateParsed(out, thresholds);
    // Independent second parse + differential cross-check (does NOT change values;
    // only flags fields where a different algorithm disagrees).
    var second = parseIndependent(text);
    var conflicts = crossCheck(out, second);
    return { values: out, found: found, inferred: inferred, thresholds: thresholds, warnings: warnings, second: second, conflicts: conflicts };
  }

  function interpret(field, rest) {
    switch (field) {
      case "sex": return parseSex(rest);
      case "dm": case "smoking": case "bp_tx": case "statin": return parseBool(rest);
      default: return firstNumber(rest);
    }
  }

  function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

  // ---- Number extraction with threshold detection ------------------------
  // Returns { value, threshold } where threshold is "<", ">", etc. or null.
  // Many labs report values as ">60" or "<0.5" — the threshold operator is
  // clinically significant (the real value could be very different) and must
  // be surfaced to the user.
  function extractNum(s, allowThousands) {
    if (!s) return null;
    // normalize two-char inequalities so ">= 60"/"<= 0.3" register a threshold
    s = String(s).replace(/>=/g, "≥").replace(/<=/g, "≤");
    // drop parentheticals AND bracketed ranges: "(125-200)", "[70-99]" — these are
    // reference ranges, dates, or eAG annotations, never the reported value.
    s = s.replace(/\([^)]*\)/g, " ").replace(/\[[^\]]*\]/g, " ");
    // European decimal comma ("5,4 mmol/L"): a comma between digits with only 1–2
    // digits after it is a decimal separator, not a thousands separator. Without
    // this the value silently TRUNCATES to 5 — a wrong number that still computes.
    // Gated on an SI unit in the same value region, so US thousands ("1,234 mg/g")
    // and comma-separated lists are untouched.
    if (/mmol/i.test(s)) s = s.replace(/(\d),(\d{1,2})(?!\d)/g, "$1.$2");
    var re = allowThousands
      ? /([<>≤≥])?\s*(\d[\d,]*(?:\.\d+)?)/
      : /([<>≤≥])?\s*(\d+(?:\.\d+)?)/;
    var m = s.match(re);
    if (!m) return null;
    return { value: parseFloat(m[2].replace(/,/g, "")), threshold: m[1] || null };
  }

  // ---- Unstructured / lab-dump scanning ---------------------------------
  // Scrapes clinical numbers out of free text (@BRIEFLABS()@ output, a pasted
  // results view, a note). Handles both "Label: value" and compact/vertical
  // lab formats. Fills only fields not already set.
  function lineAfter(text, idx) {
    var after = text.slice(idx);
    var nl = after.search(/\n/);
    return nl >= 0 ? after.slice(0, nl) : after;
  }
  function firstNumIn(s, allowThousands) {
    var r = extractNum(s, allowThousands);
    return r ? r.value : null;
  }
  // Value that follows a lab-name pattern anywhere in the text.
  // Returns { value, threshold } or null.
  function scanField(text, namePat, opts) {
    opts = opts || {};
    var re = new RegExp(namePat, "gi"), m;
    while ((m = re.exec(text)) !== null) {
      if (m.index === re.lastIndex) re.lastIndex++;
      // Look-back for badWords, but CLAMP to the current line — never cross a
      // newline into the previous line (else "HDL: 30\nCHOL" would see "hdl" and
      // wrongly reject the cholesterol; "Ratio: 150\nCreatinine" would see "ratio").
      var lnStart = text.lastIndexOf("\n", m.index - 1) + 1;
      var pre = text.slice(Math.max(lnStart, m.index - 12), m.index).toLowerCase();
      if (opts.badWords && opts.badWords.some(function (w) { return pre.indexOf(w) >= 0; })) continue;
      // line-level reject: skip if the label's whole line contains an excluded word
      // (e.g. "Microalbumin Creat Ratio: 12" must not be read as creatinine).
      if (opts.rejectLine) {
        var ls = text.lastIndexOf("\n", m.index) + 1;
        var le0 = text.indexOf("\n", m.index); if (le0 < 0) le0 = text.length;
        if (opts.rejectLine.test(text.slice(ls, le0))) continue;
      }
      // ratio guard: reject "Chol/HDL", "LDL / HDL" (a NAME right before the slash =
      // a ratio) — but not "Chol 210 / HDL 45" (a NUMBER before the slash = values
      // delimited by slashes). noSlashAfter rejects the "Chol" of "Chol/HDL".
      if (opts.noSlashBefore && /[a-z)]\s*\/\s*$/i.test(text.slice(Math.max(lnStart, m.index - 12), m.index))) continue;
      var rawAfter = text.slice(m.index + m[0].length);
      if (opts.noSlashAfter && /^\s*\//.test(rawAfter)) continue;
      var after = lineAfter(text, m.index + m[0].length);
      // Some lab reports put the Ref Range column BEFORE the Value column
      // ("Cholesterol   100-199   197"). Step over a leading range when a real
      // number follows it, otherwise the range's low bound becomes the result.
      if (opts.skipRange) {
        // The whitespace before the next number is REQUIRED: without it the
        // pattern could split "60-89" into "60-8" and a leftover "9".
        var rng = after.match(/^(\s*[\d.,]+\s*[-–]\s*[\d.,]+[^\d\n]{0,12}\s)(?=[<>≤≥]?\s*\d)/);
        if (rng) after = after.slice(rng[1].length);
      }
      // reject a value that is the lower bound of a range like "BMI 30.0-34.9"
      // (an obesity/category descriptor, not a measured value).
      if (opts.rejectRange && /^\s*[<>≤≥]?\s*\d[\d.,]*\s*[-–]\s*\d/.test(after)) continue;
      if (opts.commaCut) { var c = after.indexOf(","); if (c >= 0) after = after.slice(0, c); }
      // European decimal comma for fields that are written that way abroad
      // ("BMI 31,4 kg/m2"); without this the value truncates to 31.
      if (opts.decimalComma) after = after.replace(/(\d),(\d{1,2})(?!\d)/g, "$1.$2");
      // "increased from 28.1 to 31.4" — the current value is the one after "to".
      var fromTo = after.match(/^[^\d\n]{0,24}from\s+[\d.,]+\s+to\s+([\d.,]+)/i);
      if (fromTo) after = " " + fromTo[1];
      var result = extractNum(after, opts.thousands);
      var unitScope = after; // where a required unit (opts.requireUnit) must appear
      // vertical-layout fallback: label on its own line, value on the NEXT line.
      // Only accept a next line that is ENTIRELY a number (optionally with a unit),
      // so "eGFR\n68" works but "eGFR\ncarvedilol 10 mg" does not.
      if (result === null && opts.allowNextLine) {
        var lend = text.indexOf("\n", m.index + m[0].length);
        if (lend >= 0) {
          var nend = text.indexOf("\n", lend + 1); if (nend < 0) nend = text.length;
          var nextLine = text.slice(lend + 1, nend);
          if (/^\s*[<>≤≥]?\s*\d[\d,]*(?:\.\d+)?\s*(?:%|mg\/dl|mmol\/l|ml\/min[^\n]*|kg\/m²?2?|µmol\/l)?\s*$/i.test(nextLine)) {
            result = extractNum(nextLine, opts.thousands);
            unitScope = nextLine;
          }
        }
      }
      if (result === null) continue;
      if (opts.requireUnit && !opts.requireUnit.test(unitScope)) continue;
      // reject when a COMPETING analyte name sits between the label and the number:
      // "Cholesterol, HDL, P*  52" must not satisfy a total-cholesterol scan just
      // because it starts with "Cholesterol". badWords only looks BEHIND the label,
      // so this is the forward-looking half of the same guard.
      if (opts.rejectBetween) {
        var dIdx = unitScope.search(/\d/);
        if (opts.rejectBetween.test(dIdx >= 0 ? unitScope.slice(0, dIdx) : unitScope)) continue;
      }
      var n = result.value;
      if ((opts.min != null && n < opts.min) || (opts.max != null && n > opts.max)) continue;
      return { value: n, threshold: result.threshold };
    }
    return null;
  }
  function scanSbp(text) {
    // 1) explicit "BP 148/86", "BP 148 over 86", "148/86 mmHg", "SBP 148"
    var pats = [
      /\b(?:bp|blood\s*pressure)\b[^\d\n]{0,10}(\d{2,3})\s*(?:\/|over)\s*\d{2,3}/i,
      /(\d{2,3})\s*(?:\/|over)\s*\d{2,3}\s*mm\s*hg/i,
      /\b(?:sbp|systolic(?:\s*(?:bp|blood\s*pressure))?)\b[^\d\n]{0,12}(\d{2,3})/i,
    ];
    for (var i = 0; i < pats.length; i++) {
      var m = text.match(pats[i]);
      if (m) { var v = parseFloat(m[1]); if (v >= 70 && v <= 260) return v; }
    }
    // 1b) comma-separated pair "BP 138, 82": only when both numbers are in
    //     physiologic range, systolic > diastolic, and no further number follows
    //     (so "BP 138, HR 82" — a different vital — is not read as a pair).
    var cm = text.match(/\b(?:bp|blood\s*pressure)\b[^\d\n]{0,10}(\d{2,3})\s*,\s*(\d{2,3})\b(?!\s*[\/,.]\s*\d)/i);
    if (cm) { var cs = +cm[1], cd = +cm[2]; if (cs >= 70 && cs <= 260 && cd >= 30 && cd <= 160 && cs > cd) return cs; }
    // 2) fallback for reading lists (@LASTBP(n)@ -> "07/10/26 : 110/72"): first
    //    SBP/DBP pair that isn't part of a date (not followed by another "/digits")
    //    and whose values are in physiologic range. Readings are most-recent-first.
    var re = /(\d{2,3})\s*\/\s*(\d{2,3})(?!\s*\/\s*\d)/g, mm;
    while ((mm = re.exec(text)) !== null) {
      var s = +mm[1], d = +mm[2];
      if (s >= 70 && s <= 260 && d >= 30 && d <= 160) return s;
    }
    return null;
  }
  // BMI from an @LASTBMI(n)@ dated reading list ("BMI Readings from Last 3
  // Encounters:\n04/13/26<TAB>28.4") — the BMI analogue of the @LASTBP@ list.
  // Anchors on a BMI label, then takes the most recent (first) reading: a date
  // IMMEDIATELY followed by the value — separated by whitespace, a tab, or the
  // " : " Epic prints in @LASTBMI(n)@ ("09/10/26 : 21.35 kg/m²"), same as the
  // @LASTBP(n)@ list. A lab row like "HDL 39 ... 04/09/2026" (value first, date
  // trailing) is NOT matched, so it can't be misread as BMI.
  function scanBmiList(text) {
    var lines = text.split(/\n/);
    for (var i = 0; i < lines.length; i++) {
      if (!/\bbmi\b|body\s*mass/i.test(lines[i])) continue;
      for (var j = i; j < Math.min(lines.length, i + 6); j++) {
        var m = lines[j].replace(/(\d),(\d{1,2})(?!\d)/g, "$1.$2")
                        .match(/\d{1,2}\/\d{1,2}\/\d{2,4}(?:\s*[:\-–]\s*|\s+)(\d{2,3}(?:\.\d+)?)/);
        if (m) { var v = parseFloat(m[1]); if (v >= 12 && v <= 80) return v; }
      }
    }
    return null;
  }
  // CKD-EPI 2021 (race-free) creatinine eGFR — matches preventr::calc_egfr.
  function ckdEpi2021(cr, age, sex, units) {
    if (!(cr > 0) || !(age >= 18 && age <= 100)) return null;
    var s = (sex === "female" || sex === "f") ? "f" : "m";
    if (units && /umol|μmol/i.test(units)) cr = cr / 88.4;
    var k = s === "f" ? 0.7 : 0.9;
    var a1 = s === "f" ? -0.241 : -0.302;
    var d = s === "f" ? 1.012 : 1;
    var egfr = 142 * Math.pow(Math.min(cr / k, 1), a1) * Math.pow(Math.max(cr / k, 1), -1.2) *
      Math.pow(0.9938, age) * d;
    return Math.round(egfr); // preventr rounds eGFR to a whole number
  }

  // ---- Robust A1c extraction --------------------------------------------
  // Epic @LASTLAB(A1C,...)@ prints a RESULT TABLE: a "Hemoglobin A1c" header, a
  // column header row, then a data row where the value sits beside a reference
  // range ("6.1 (H)  4.3 - 5.6 %") — and often a long diagnostic-cutoff comment
  // stuffed with other A1c numbers ("4.3% - 5.6% = normal ... >6.4% = diabetes").
  // A naive label scan grabs 4.3 (a range/cutoff bound) instead of 6.1. This
  // anchors on the A1c label, scans the next few contiguous lines (stopping at a
  // blank line or the comment), and rejects reference-range bounds.
  var A1C_ANCHOR = /\b(?:hb?a1c|hgba1c|hemoglobin\s+a1c|glyc\w*\s*(?:h[ae]mo\w*|hgb|hb)|glycohemoglobin|a1c)\b/i;
  var A1C_STOP = /cutoff|goal|\bnormal\b|increased\s+risk|diagnos|\bages?\b|guideline|individualize|\bcomment\b/i;
  function a1cValueInLine(line, start) {
    // blank out parentheticals (flags like "(H)"), dates and times so their
    // digits aren't mistaken for the result.
    var masked = line.replace(/\([^)]*\)/g, function (s) { return s.replace(/[^\n]/g, " "); })
                     .replace(/\d{1,2}\/\d{1,2}\/\d{2,4}/g, function (s) { return s.replace(/./g, " "); })
                     .replace(/\d{1,2}:\d{2}(?::\d{2})?/g, function (s) { return s.replace(/./g, " "); });
    var re = /\d{1,2}(?:\.\d+)?/g, m;
    while ((m = re.exec(masked)) !== null) {
      if (m.index < (start || 0)) continue;
      var val = parseFloat(m[0]);
      if (val < 3 || val > 20) continue;                       // physiologic A1c window
      var after = masked.slice(m.index + m[0].length, m.index + m[0].length + 6);
      var before = masked.slice(Math.max(0, m.index - 3), m.index);
      if (/^\s*[-–]\s*\d/.test(after)) continue;               // range LOW bound: "4.3 - 5.6"
      if (/[-–]\s*$/.test(before)) continue;                   // range HIGH bound: "4.3 - 5.6"
      return val;
    }
    return null;
  }
  function scanA1c(text) {
    var lines = text.split(/\n/);
    for (var i = 0; i < lines.length; i++) {
      var am = A1C_ANCHOR.exec(lines[i]);
      if (!am) continue;
      for (var j = i; j < Math.min(lines.length, i + 5); j++) {
        // Stay inside the result block: stop at a blank line, the diagnostic-cutoff
        // comment, or a medication line — "lisinopril 20 MG tablet" a few lines below
        // an A1c mentioned in a parenthetical would otherwise yield an "A1c" of 20.
        if (j > i && (lines[j].trim() === "" || A1C_STOP.test(lines[j]) ||
            /\b(?:mg|mcg|g|ml|tab(?:let)?s?|cap(?:sule)?s?|daily|bid|tid|qid|qhs|units?|po\b|prn)\b/i.test(lines[j]))) break;
        var v = a1cValueInLine(lines[j], j === i ? am.index + am[0].length : 0);
        if (v !== null) return v;
      }
    }
    return null;
  }

  // (ZIP-code scraping was intentionally removed — a 5-digit ZIP is a HIPAA
  // identifier / PHI. The app accepts an SDI decile directly instead.)

  // ---- Section-awareness utility ----------------------------------------
  // Returns the most recent standalone section header (a line ending with ":"
  // and no inline content) above a given text position. Used to scope drug
  // and diabetes detection so allergy/family-history sections don't trigger
  // false positives.
  // Section titles Epic prints WITHOUT a trailing colon. sectionAbove needs these
  // to know that "Family History" (bare) opens a section and "Patient Active
  // Problem List" (bare) closes it.
  var SECTION_TITLE_RE = /^(?:patient\s+)?(?:active\s+)?(?:family\s+(?:history|hx)|social\s+(?:history|hx)|problem\s+list|past\s+medical\s+history|medical\s+history|current\s+(?:outpatient\s+)?medications?|medications?|allergies|health\s+maintenance|resolved\s+problems?|inactive\s+problems?|discontinued\s+medications?|meds|ob\s+history|surgical\s+history|tobacco\s+use|substance\s+use|review\s+of\s+systems|assessment(?:\s+and\s+plan)?)$/i;

  function sectionAbove(text, pos) {
    // Only COMPLETE lines above the current one count: slicing mid-line would turn
    // the current line's own prefix ("  Father: ") into a bogus header and hide the
    // real section ("Family History:") above it.
    var chunk = text.slice(0, text.lastIndexOf("\n", pos - 1) + 1);
    var re = /(?:^|\n)[ \t]*([^\n]{1,60}?)[ \t]*(:)?[ \t]*(?=\n|$)/g;
    var last = null, m;
    while ((m = re.exec(chunk)) !== null) {
      var title = m[1].trim();
      // A header either ends with ":" ("Family History:") or is one of the
      // standard Epic section titles, which print with NO colon at all
      // ("Family History", "Patient Active Problem List"). Without the
      // colon-less form, a family-history TABLE looks like it has no section
      // and the relatives' diagnoses get read as the patient's.
      if (!m[2] && !SECTION_TITLE_RE.test(title)) continue;
      if (title) last = title.toLowerCase();
    }
    return last || "";
  }

  // Numbers that are not measurements OF THIS PATIENT: treatment targets
  // ("LDL goal <70", "BP goal <130/80", "Target BMI 24.9") and relatives' values in
  // a family history ("Mother: obesity, BMI 41"). Both used to land in the form as
  // real measurements for EVERY numeric field, which silently changes the risk.
  // The cue must sit BEFORE the number, so "BP 128/78, at goal" still parses.
  var TARGET_CUE = /\b(?:goals?|targets?|aim(?:ing)?\s+for|keep\s+(?:it\s+)?(?:under|below)|maintain|should\s+be|desired?|ideally)\b/i;
  // Masking is length-preserving so character offsets stay valid for the source
  // highlighter, which still shows these numbers (flagged, not silently dropped).
  function maskDisqualifiedLines(text) {
    var lines = text.split("\n"), pos = 0;
    for (var i = 0; i < lines.length; i++) {
      var ln = lines[i], d = ln.search(/\d/);
      if (d >= 0) {
        var fam = isFamilyContext(text, pos + d);
        // A new left-margin "Label: value" line ("Vitals: BMI 31.4") starts a new
        // topic and ends the family-history block, even though it is not a
        // standalone header. Indented rows and lines led by a relative's name
        // still belong to the relatives.
        if (fam && /^\S[^:\n]{0,30}:/.test(ln) && !RELATIVE_RE.test(ln.split(":")[0])) fam = false;
        if (fam) {
          lines[i] = ln.replace(/[^\n]/g, " ");
        } else {
          // Mask from the target word to end of line, not the whole line: a numbered
          // A/P item ("1. HLD: LDL goal < 70") puts a digit BEFORE the cue, and
          // "BP 128/78, at goal" puts a real reading before it. Everything after the
          // cue is the target.
          var probe = ln.replace(/goals?\s+of\s+care/gi, function (x) { return x.replace(/./g, " "); });
          var cue = probe.search(TARGET_CUE);
          if (cue >= 0 && /\d/.test(ln.slice(cue)))
            lines[i] = ln.slice(0, cue) + ln.slice(cue).replace(/[^\n]/g, " ");
        }
      }
      pos += ln.length + 1;
    }
    return lines.join("\n");
  }

  function scanClinical(text, out, found, thresholds) {
    // Every numeric scan below runs on the masked copy. Flag inference still gets
    // the ORIGINAL text, because detectDiabetes/detectSmoking need to see a
    // family-history line in order to recognise and skip it.
    text = maskDisqualifiedLines(text);
    function tryField(key, namePat, opts) {
      if (found[key] !== undefined) return;
      var result = scanField(text, namePat, opts);
      if (result !== null) {
        out[key] = result.value;
        found[key] = "scanned";
        if (result.threshold) thresholds[key] = result.threshold;
      }
    }
    if (found.sbp === undefined) { var s = scanSbp(text); if (s !== null) { out.sbp = s; found.sbp = "scanned"; } }
    // rejectRange stops "Obesity (BMI 30.0-34.9)" (a diagnosis category) from being
    // read as a measured BMI of 30.0.
    tryField("bmi", "(?:bmi|body\\s*mass\\s*index)", { min: 10, max: 80, allowNextLine: true, rejectRange: true, decimalComma: true });
    // @LASTBMI(n)@ dated reading list (BP-style) when a direct BMI isn't labeled.
    if (found.bmi === undefined) { var bmiList = scanBmiList(text); if (bmiList !== null) { out.bmi = bmiList; found.bmi = "scanned"; } }
    // No commaCut: labs are named with commas ("Cholesterol, Total,* 164"), and
    // firstNumIn already takes the first number after the label anyway. "\btc\b"
    // catches the "TC" abbreviation (bounded, so it won't match inside words).
    // LDL-C: not a PREVENT input, but the 2026 dyslipidemia guideline keys several
    // recommendations off it. "\bldl\b" won't match inside "VLDL" (no word boundary
    // between V and L), and rejectLine drops "LDL/HDL ratio" lines. A calculated LDL
    // is what Epic usually prints; "direct"/"calc" qualifiers are accepted.
    var TC_PAT = "(?:total[\\s,]*chol\\w*|chol\\w*[\\s,]*total|chol\\w*|\\btc\\b)";
    var HDL_PAT = "(?:hdl(?:[\\s-]?c)?(?:\\s*cholesterol)?|high[\\s-]?density\\s+lipoprotein)";
    var LDL_PAT = "(?:\\bldl(?:[\\s-]?c)?\\b(?:\\s*(?:chol\\w*|calc\\w*|direct))?|low[\\s-]?density\\s+lipoprotein)";
    var TC_OPTS = { badWords: ["hdl", "ldl", "vldl", "non"], rejectBetween: /hdl|ldl|non/i, noSlashAfter: true, allowNextLine: true, skipRange: true };
    var HDL_OPTS = { badWords: ["non"], noSlashBefore: true, allowNextLine: true, skipRange: true };
    var LDL_OPTS = { badWords: ["non"], rejectBetween: /\bhdl\b|non/i, noSlashBefore: true, noSlashAfter: true, rejectLine: /ratio/i, allowNextLine: true, skipRange: true };
    function ranged(o, min, max, extra) { var r = Object.assign({}, o, { min: min, max: max }); if (extra) Object.assign(r, extra); return r; }
    // Units: mg/dL first (the Epic default). If no mg/dL-magnitude total is labeled,
    // retry as an SI panel ("Total cholesterol: 5.4 mmol/L") — a small-magnitude
    // value is accepted ONLY when "mmol" is printed with it, never on magnitude
    // alone. The unit found is reported as chol_unit so the UI can flip its toggle;
    // the numbers themselves are never converted here (the engine converts).
    tryField("total_c", TC_PAT, ranged(TC_OPTS, 40, 500));
    var mmol = false;
    if (found.total_c === undefined) {
      tryField("total_c", TC_PAT, ranged(TC_OPTS, 1.5, 15, { requireUnit: /mmol/i }));
      mmol = found.total_c !== undefined;
    }
    if (found.total_c !== undefined) { out.chol_unit = mmol ? "mmol/L" : "mg/dL"; found.chol_unit = "scanned"; }
    tryField("hdl_c", HDL_PAT, mmol ? ranged(HDL_OPTS, 0.2, 5) : ranged(HDL_OPTS, 5, 150));
    tryField("ldl_c", LDL_PAT, mmol ? ranged(LDL_OPTS, 0.2, 12) : ranged(LDL_OPTS, 10, 500));
    // A1c: robust table-aware scan (ignores reference ranges + diagnostic comment).
    if (found.hba1c === undefined) { var a1c = scanA1c(text); if (a1c !== null) { out.hba1c = a1c; found.hba1c = "scanned"; } }
    tryField("egfr", "\\be?-?gfr(?:cr|cys|creat)?\\b", { min: 1, max: 200, allowNextLine: true, skipRange: true });
    // UACR: accept slash, space, or dash between albumin and creatinine
    tryField("uacr", "(?:uacr|(?:urine\\s+)?(?:micro)?album(?:in)?[/\\s-]+creat(?:inine)?(?:\\s+ratio)?|alb[/\\s-]+cr(?:eat)?|\\bacr\\b)", { thousands: true, min: 0.1, max: 25000 });
    // Fallback: eGFR from serum creatinine (only if eGFR wasn't found directly).
    // "\b after creat" rejects "creatine kinase"; lookahead rejects "creatinine
    // clearance"; rejectLine rejects albumin/ratio lines so "Microalbumin Creat
    // Ratio: 12" is never read as a serum creatinine of 12.
    if (found.egfr === undefined && out.age != null && out.sex) {
      // "\bs?cr\b" also matches the "SCr" (serum creatinine) shorthand.
      var crResult = scanField(text, "(?:creatinine|creat(?:inine)?\\b|\\bs?cr\\b)(?!\\s*(?:cl\\b|clearance))", { badWords: ["album", "alb", "urine", "uacr", "ratio", "micro"], rejectLine: /album|ratio|\buacr\b|urine|clearance|kinase|\baki\b|acute\s+kidney|baseline|resume\s+when|\bgoal\b|\btarget\b/i, noSlashBefore: true, min: 0.2, max: 15 });
      if (crResult !== null) {
        var e = ckdEpi2021(crResult.value, out.age, out.sex);
        if (e !== null) { out.egfr = e; found.egfr = "computed_from_cr"; }
      } else {
        // µmol/L (SI units): explicit unit required on the line; convert /88.4.
        // Line-scoped rather than a character window, because an SI result row puts
        // the unit in a REFERENCE-RANGE column ("Creatinine  97  44 - 106 umol/L
        // Final"). A character-window match there grabs 106 — the range's high
        // bound — and computes a confidently wrong eGFR; the same window also let
        // "Albumin/Creatinine Ratio 12 umol/mmol" produce an eGFR of 149. So: skip
        // ratio/urine/clearance lines, mask parentheticals, ranges, dates and times,
        // then take the FIRST surviving number, which is the reported result. The
        // unit is checked on the RAW line so a unit inside the label
        // ("Creatinine (umol/L): 88") still counts.
        var muLines = text.split(/\n/);
        for (var mi = 0; mi < muLines.length && found.egfr === undefined; mi++) {
          var rawLn = muLines[mi];
          if (!/(?:^|[^a-z\/])(?:creatinine|creat|s?cr)\b/i.test(rawLn)) continue;
          if (/album|ratio|urine|uacr|clearance|kinase|micro/i.test(rawLn)) continue;
          if (!/µmol|umol|μmol/i.test(rawLn)) continue;
          var mLn = rawLn.replace(/\([^)]*\)/g, " ")
                         .replace(/\d[\d.,]*\s*[-–]\s*\d[\d.,]*/g, " ")
                         .replace(/\d{1,2}\/\d{1,2}\/\d{2,4}/g, " ")
                         .replace(/\d{1,2}:\d{2}(?::\d{2})?/g, " ");
          var mNum = mLn.match(/\d{2,4}(?:\.\d+)?/);
          if (!mNum) continue;
          var mVal = parseFloat(mNum[0]);
          if (!(mVal >= 20 && mVal <= 1500)) continue;
          var e2 = ckdEpi2021(mVal, out.age, out.sex, "umol");
          if (e2 !== null) { out.egfr = e2; found.egfr = "computed_from_cr"; }
        }
      }
    }
  }

  // ---- Infer Yes/No flags from meds / problems / social history ----------
  // Positive-evidence only: sets a flag TRUE (or smoking FALSE for never/
  // former) when detected; NEVER assumes "No" from absence. Everything set
  // here is marked "inferred" so the UI can prompt verification and show the
  // matched evidence (a med/problem list can't always convey intent).
  var STATIN_RE = /\b(?:atorva|rosuva|simva|prava|lova|pitava|fluva)statin\b|\b(?:lipitor|crestor|zocor|pravachol|livalo|lescol|altoprev|altocor|mevacor|flolipid|zypitamag|ezallor|vytorin|caduet|roszet|simcor)\b/i;
  // Generic names first, then common US brand names — a med list may print either.
  var ANTIHTN_RE = /\b(?:lisinopril|enalapril|enalaprilat|ramipril|benazepril|captopril|quinapril|fosinopril|perindopril|trandolapril|moexipril|losartan|valsartan|olmesartan|irbesartan|candesartan|telmisartan|azilsartan|eprosartan|amlodipine|nifedipine|felodipine|nicardipine|isradipine|nisoldipine|diltiazem|verapamil|metoprolol|atenolol|carvedilol|bisoprolol|propranolol|labetalol|nebivolol|nadolol|betaxolol|hydrochlorothiazide|hctz|chlorthalidone|chlorothiazide|indapamide|metolazone|spironolactone|eplerenone|triamterene|amiloride|furosemide|torsemide|bumetanide|clonidine|hydralazine|minoxidil|methyldopa|doxazosin|terazosin|prazosin|aliskiren|guanfacine|norvasc|cozaar|hyzaar|diovan|benicar|micardis|avapro|atacand|teveten|edarbi|lopressor|toprol|tenormin|coreg|bystolic|corgard|sectral|cardizem|cartia|tiazac|calan|verelan|isoptin|covera|adalat|procardia|sular|plendil|cardene|lasix|microzide|aldactone|inspra|bumex|demadex|edecrin|zaroxolyn|lozol|catapres|lotrel|zestril|prinivil|vasotec|altace|accupril|monopril|mavik|aceon|univasc|lotensin|capoten|cardura|hytrin|minipress|aldomet|tekturna|apresoline|loniten|dyazide|maxzide|tenoretic|exforge|tribenzor|azor|twynsta|amturnide)\b/i;
  // Lines that mean a drug is NOT actually being taken.
  var DRUG_SKIP_LINE = /allerg|adverse|intoleran|discontinu|\bd\/?c(?:'?d|ed)?\b|stopped|inactive|no longer|\bhold(?:ing|s)?\b|\bheld\b|not\s+tak(?:ing|en)|hasn'?t\s+taken|ran\s+out|declined/i;
  // Narrower set for the NEXT-line check: only true discontinuation signals, NOT
  // "allerg"/"adverse" (those would false-trigger on an "Allergies:" header that
  // simply follows the last active med).
  var DISCON_NEXT = /discontinu|stopped|\bheld\b|inactive|no longer|not taking|\bd\/?c(?:'?d|ed)?\b/i;
  // Explicit "no meds" statements from focused SmartLinks — e.g. @HTNMEDS@ ->
  // "No current hypertension medications", @STATINS@ -> "No current hyperlipidemia
  // medications". These are affirmative negatives, so we can set the flag to false.
  // The filler between "no" and the drug class is limited to list qualifiers, so
  // "no CHANGES to HTN meds" and "no PROBLEMS with cholesterol medication" — both
  // of which describe an ACTIVE regimen — are not misread as an empty list.
  var NO_QUAL = "(?:\\s+(?:current|active|home|outpatient|prescribed|known|other|listed))*\\s+";
  var NO_HTN_MEDS = new RegExp("\\bno" + NO_QUAL + "(?:hypertension|htn|blood[- ]?pressure|anti-?hypertensive)\\s+(?:medication|meds\\b|agents?|drugs?|rx)", "i");
  var NO_LIPID_MEDS = new RegExp("\\bno" + NO_QUAL + "(?:hyperlipidemia|lipid|cholesterol|statin)\\s+(?:medication|meds\\b|agents?|drugs?|rx)", "i");
  // Epic's blanket empty-list print ("No current outpatient medications on file")
  // rules out BOTH an antihypertensive and a statin.
  var NO_MEDS_AT_ALL = new RegExp("\\bno" + NO_QUAL + "medications?\\b", "i");

  // Section headers used by detectDrug to skip allergy sections.
  var ALLERGY_HDR = /\b(?:allerg\w*|adverse\s+reaction|sensitivit\w*|intoleran\w*|discontinued|inactive|prior|previous|historical|past)\b/i;

  function detectDrug(text, re) {
    var lines = text.split(/\n/);
    var skipSection = false;
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      // Track section transitions. A header either ends with ":" ("Allergies:") or
      // is a standard Epic title printed bare ("Allergies", "Discontinued
      // Medications", "Meds") — without the colon-less form, an allergy TABLE never
      // ends and its allergens get read as active drugs.
      var bare = line.trim();
      if (/^[^\n:]{1,60}:$/.test(bare) || SECTION_TITLE_RE.test(bare.replace(/:$/, ""))) {
        skipSection = ALLERGY_HDR.test(bare); continue;
      }
      if (skipSection) continue;
      // A stop word inside a PARENTHETICAL describes a different, prior drug
      // ("rosuvastatin 10 mg daily (was on atorvastatin, stopped 2024)"), so the
      // line is judged — and the drug matched — on what sits outside the parens.
      var outside = line.replace(/\([^)]*\)/g, " ");
      if (DRUG_SKIP_LINE.test(outside)) continue;      // the line itself is inactive
      // Stop word ONLY inside the parens => it describes a prior drug, so match on
      // what's outside. Otherwise the parens may hold the active drug, so keep them.
      var m = (DRUG_SKIP_LINE.test(line) ? outside : line).match(re);
      if (m) {
        // Look one line ahead: if the next line is an indented discontinuation
        // note ("  Discontinued 2024-01-15"), this drug is not active — skip it.
        // Exclude section headers (ending in ":") so a following "Allergies:"
        // header doesn't get mistaken for a discontinuation of this drug.
        var nxt = lines[i + 1];
        if (nxt && !/:\s*$/.test(nxt) && DISCON_NEXT.test(nxt)) continue;
        return m[0].toLowerCase();
      }
    }
    return null;
  }

  // ---- Who does this mention belong to? ---------------------------------
  // A paste mixes the patient's diagnoses with relatives' (family history),
  // allergies, and resolved problems. Reading a relative's diabetes as the
  // patient's inflates the risk score and flips the guideline pathway, so every
  // diagnosis detector below is guarded by these.
  var RELATIVE_RE = /\b(?:mother|father|mom|dad|parents?|sisters?|brothers?|siblings?|sons?|daughters?|aunts?|uncles?|cousins?|grand(?:mother|father|parents?|ma|pa)|maternal|paternal|spouse|wife|husband|partner)\b/i;
  var FAMILY_CUE_RE = /\b(?:family\s*(?:history|hx|h\/o)|fhx|famhx|fam\s*hx)\b/i;

  // True when the mention at `idx` describes someone OTHER than the patient:
  // it sits in a family-history section, under a per-relative sub-header
  // ("Mother:"), or the same line names the family before it
  // ("FHx: T2DM (mother)", "Family History: Mother (alive, 78) - type 2 diabetes").
  function isFamilyContext(text, idx) {
    var sec = sectionAbove(text, idx);
    if (FAMILY_CUE_RE.test(sec) || RELATIVE_RE.test(sec)) return true;
    var lnStart = text.lastIndexOf("\n", idx - 1) + 1;
    var before = text.slice(lnStart, idx);
    if (FAMILY_CUE_RE.test(before)) return true;
    // "Father: lung cancer (smoker)" — a relative named earlier on the line, with a
    // separator after it, owns what follows.
    var rel = RELATIVE_RE.exec(before);
    if (rel && /[-:(,]/.test(before.slice(rel.index + rel[0].length))) return true;
    return false;
  }
  function lineAround(text, idx) {
    var s = text.lastIndexOf("\n", idx) + 1;
    var e = text.indexOf("\n", idx); if (e < 0) e = text.length;
    return text.slice(s, e);
  }

  // ---- Diabetes ----------------------------------------------------------
  // Negating words just BEFORE a mention. The tail allowance is 45 characters so
  // real phrasings fit ("No personal history of diabetes"); the old 18 cut off
  // mid-phrase and let the mention through as a diagnosis.
  var DM_NEG = /\b(?:no|not|denies|denied|without|negative\s+for|rule[d]?\s+out|r\/o|family\s+(?:history|hx)|fhx|gestational|borderline|impaired|screen\w*|risk\s+(?:of|for))\b[^.\n]{0,45}$/i;
  // NOT a current diagnosis of this patient — a confident No.
  var DM_NOTDX_LINE = /\bscreening\b|health\s+maintenance|diabetic[^a-z\n]{0,3}(?:diet|education|educator|teaching|supplies|foot\s+exam)|diabetes\s+education|\bgdm\b|gestational/i;
  // A PAST or MERELY POSSIBLE diagnosis. These make the answer ambiguous rather
  // than No: the field is left blank for the clinician instead of being asserted.
  var DM_AMBIG_LINE = /\bresolved\b|\bin\s+remission\b|\bremission\b|diabetic\s+range/i;

  // Returns { state: "yes"|"ambiguous"|"none", evidence }.
  function diabetesSignal(text) {
    var ambiguous = false;
    // Shared guards for one mention. Returns "skip", "ambiguous", or null (= keep).
    function guard(start, wordLen) {
      var pre = text.slice(Math.max(0, start - 60), start);
      var after = text.slice(start + wordLen);
      var line = lineAround(text, start);
      if (/pre-?\s*$/i.test(pre)) return "skip";                 // pre-diabetes / Pre-DM
      if (/\bnon-?\s*$/i.test(pre)) return "skip";               // non-diabetic
      if (/[=]\s*$/.test(pre)) return "skip";                    // legend ">6.4% = diabetes"
      if (DM_NEG.test(pre)) return "skip";
      if (/^\s*[:*?]/.test(after)) return "skip";                // "Diabetes:" label, "Diabetes?" form
      if (/^\s*(?:screen\w*|education|educator|teaching|supplies)/i.test(after)) return "skip";
      if (/^\s*(?:ruled?\s+out|r\/o)/i.test(after)) return "skip";
      if (/a1c|h[ae]moglobin/i.test(line) && /cutoff|diagnos|=\s*normal|increased\s+risk/i.test(line)) return "skip";
      if (isFamilyContext(text, start)) return "skip";
      if (/\b(?:allerg|adverse)/i.test(sectionAbove(text, start))) return "skip";
      if (DM_NOTDX_LINE.test(line)) return "skip";               // screening / diet / education / GDM
      if (DM_AMBIG_LINE.test(line) || /\bresolved\b|\binactive\b/i.test(sectionAbove(text, start))) return "ambiguous";
      return null;
    }
    function run(re, label) {
      var m;
      re.lastIndex = 0;
      while ((m = re.exec(text)) !== null) {
        if (m.index === re.lastIndex) re.lastIndex++;
        var g = guard(m.index, m[0].length);
        if (g === "ambiguous") { ambiguous = true; continue; }
        if (g) continue;
        var got = label(m, text.slice(m.index, m.index + 44).toLowerCase());
        if (got) return got;
      }
      return null;
    }
    // spelled out: "...diabet(es/ic)..."
    var hit = run(/\bdiabet\w*/gi, function (m, ctx) {
      if (/^diabet\w*\s*insipidus/.test(ctx)) return null;       // DI is not DM
      var scope = text.slice(Math.max(0, m.index - 60), m.index).toLowerCase() + " " + ctx;
      if (/type\s*2|type\s*ii\b|t2dm|dm\s*2/.test(scope)) return "Type 2 diabetes";
      if (/type\s*1|type\s*i\b|t1dm|dm\s*1/.test(scope)) return "Type 1 diabetes";
      if (/diabetic\s*(?:nephropathy|retinopathy|neuropathy|ketoacidosis|foot|ulcer)/.test(ctx)) return (ctx.match(/diabetic\s*\w+/) || ["diabetic"])[0];
      if (/mellitus/.test(ctx)) return "Diabetes mellitus";
      return "Diabetes";
    });
    // Abbreviations. Each loops over EVERY occurrence: a relative's "T2DM" early in
    // the paste must not suppress the patient's own diagnosis further down.
    if (!hit) hit = run(/\b(?:type\s*[12]\s*dm|dm\s*(?:type\s*)?[12]|t[12]dm)\b/gi,
      function (m) { return /1/.test(m[0]) ? "Type 1 diabetes" : "Type 2 diabetes"; });
    // NIDDM / IDDM / DMII — no "diabet" and no digit, so the loops above miss them.
    if (!hit) hit = run(/\b(?:niddm|iddm|dm\s*i{1,2}|dmi{1,2})\b/gi, function (m) {
      var tok = m[0].toLowerCase().replace(/\s+/g, "");
      if (tok === "niddm" || tok === "dmii") return "Type 2 diabetes";
      if (tok === "iddm" || tok === "dmi") return "Type 1 diabetes";
      return null;
    });
    // standalone uppercase DM (clinical shorthand) — case-sensitive on purpose.
    if (!hit) hit = run(/\bDM\b/g, function () { return "Diabetes (DM)"; });
    if (hit) return { state: "yes", evidence: hit };
    return { state: ambiguous ? "ambiguous" : "none", evidence: null };
  }
  // Back-compat wrapper: evidence string when the patient has diabetes, else null.
  function detectDiabetes(text) {
    var s = diabetesSignal(text);
    return s.state === "yes" ? s.evidence : null;
  }

  // ---- Smoking -----------------------------------------------------------
  // Negation immediately before a positive match ("not a current smoker").
  var SMOKE_NEG = /\b(?:not?|never|neither|deny|denies|denied|no longer|non|former|ex|passive|second-?hand|isn't|is\s+not|not\s+a|was\s+not|doesn't|does\s+not)-?\s*$/i;
  // Lines whose smoking words belong to something else: a different tobacco route,
  // someone else's smoke, or a non-tobacco substance.
  var SMOKE_OTHER_LINE = /smokeless|chew(?:ing|s)?|\bsnuff\b|\bdip\b|passive|second-?hand|marijuana|cannabis|\bthc\b|\bvap\w+|e-?cig|hookah|\bcigars?\b|other\s+tobacco\s+product|f17\.29/i;
  // Lines where the smoking words describe HISTORY, not current use.
  var SMOKE_PAST_LINE = /\bquit\b|\bformer\b|\bex-?\s*smok|in\s+the\s+past|pack-?\s*years?|\bhistory\s+of\b|\bh\/o\b|no\s+longer|\bremission\b|\bresolved\b/i;

  // An explicit cigarette-status line. When Epic prints one it is AUTHORITATIVE:
  // it outranks any stray "ppd" or "smoker" elsewhere in the paste (a spouse's
  // passive-exposure line, a relative's history, a former smoker's pack-year
  // detail). "Smokeless tobacco:" cannot match — it is a different axis.
  function smokingStatusLine(text) {
    var re = /\b(?:smoking\s+status|cigarette\s+(?:use|status)|tobacco\s+use\s+status)\b\s*[:?]?\s*([^\n]*)/gi, m;
    while ((m = re.exec(text)) !== null) {
      var val = (m[1] || "").trim();
      if (!val) continue;
      // "Never Assessed" / "Not Assessed" / "Smoker, Current Status Unknown" are
      // Epic's missing-data options. They are NOT a clinical answer, and because the
      // word "Never"/"Smoker" is right there they would otherwise be misread in both
      // directions — so they stop the search and leave the field blank.
      if (MISSING_DATA.test(val) || /\b(?:never|not)\s+assessed\b|\bunknown\b|\bnot\s+documented\b/i.test(val))
        return { value: null, evidence: m[0].trim() };
      if (/\b(?:never|former|quit|denies|none|no|non-?\s*smoker|passive)\b/i.test(val))
        return { value: false, evidence: m[0].trim() };
      if (/\b(?:current|every\s*day|some\s*day|daily|active|yes|smoker)\b/i.test(val))
        return { value: true, evidence: m[0].trim() };
    }
    return null;
  }

  function detectSmoking(text) {
    // 1) explicit status wins outright
    var st = smokingStatusLine(text);
    if (st) return st.value === null ? null : st;
    // 2) current-use signals, each guarded by its own line's context
    var curRe = /\b(?:every\s*day\s*smoker|some\s*day\s*smoker|current\s+every\s*day|current\s+some\s*day|currently\s+smok\w*|actively\s+smok\w*|active\s+tobacco\s+use|smoking\s+status\s*:?\s*current|tobacco\s*(?:use)?\s*:?\s*current|current\s+smoker(?!\s*[:*?])|[1-9]\d*\s*(?:cigarettes?|packs?)\s*(?:per|\/)\s*day|\bppd\b|smokers?\b(?!\s*[:*?])(?!['’]s))/gi;
    var cur, negatedEvidence = null;
    while ((cur = curRe.exec(text)) !== null) {
      var pre = text.slice(Math.max(0, cur.index - 25), cur.index);
      var line = lineAround(text, cur.index);
      if (SMOKE_NEG.test(pre)) { if (!negatedEvidence) negatedEvidence = cur[0].trim(); continue; }
      if (SMOKE_OTHER_LINE.test(line)) continue;          // smokeless / passive / marijuana / vaping
      if (SMOKE_PAST_LINE.test(line)) { if (!negatedEvidence) negatedEvidence = cur[0].trim(); continue; }
      if (/smokers?['’]s?\s+cough/i.test(line)) continue; // a symptom, not a status
      if (isFamilyContext(text, cur.index)) continue;     // the relative's habit
      if (/\b(?:allerg|adverse|resolved|inactive)/i.test(sectionAbove(text, cur.index))) continue;
      return { value: true, evidence: cur[0].trim() };
    }
    // 3) explicit non-smoking wording
    var non = text.match(/\b(?:never\s*smok\w*|former\s+(?:cigarette|tobacco|cigar)?\s*smoker|ex-?\s*smoker|non-?\s*smoker|non-?\s*tobacco|smoking\s+status\s*:?\s*(?:never|former|quit)|(?<!smokeless\s)tobacco(?:\s*use|\s*status)?\s*:?\s*(?:never|former|quit|no(?:ne)?)|quit\s+smoking|quit\s+(?:in\s+)?(?:19|20)\d{2}|denies\s+(?:tobacco|cigarettes?|smoking)|no\s+(?:current\s+)?tobacco|no\s+(?:\w+\s+){0,2}cigarettes?)\b/i);
    if (non) return { value: false, evidence: non[0].trim() };
    // 4) a negated positive ("not a current smoker", "1 ppd ... quit 2010")
    if (negatedEvidence) return { value: false, evidence: "negated: " + negatedEvidence };
    // 5) problem-list diagnoses (ICD-10 F17.2x / Z72.0). Checked LAST so an explicit
    //    social-history status outranks a possibly stale problem-list entry; skipped
    //    when the line or section says remission / history-of / resolved.
    var dxRe = /\b(?:nicotine\s+dependence|tobacco\s+(?:use\s+disorder|dependence|abuse))\b/gi, dx;
    while ((dx = dxRe.exec(text)) !== null) {
      var dline = lineAround(text, dx.index);
      if (SMOKE_PAST_LINE.test(dline) || /\bprior\b|\bpast\b/i.test(dline)) continue;
      if (SMOKE_OTHER_LINE.test(dline)) continue;
      if (isFamilyContext(text, dx.index)) continue;
      if (/\b(?:family|fhx|allerg|adverse|resolved|inactive)/i.test(sectionAbove(text, dx.index))) continue;
      return { value: true, evidence: dx[0].trim() };
    }
    return null;
  }

  // Is a real problem list present in the paste? (So absence of diabetes on it is
  // meaningful.) Requires an actual problem-list/PMH header or "Problems:" with
  // real content — an unresolved "Problems: @PROB@" template line does NOT count.
  function hasProblemList(text) {
    if (/\bproblem\s*list\b/i.test(text)) return true;
    if (/\bpast\s+medical\s+history\b|\bpmh\b/i.test(text)) return true;
    var m = text.match(/(?:^|\n)\s*(?:problems?|active\s+problems?)\s*:\s*(.+)/i);
    return !!(m && !/^@\w+@?\s*$/.test(m[1].trim()));
  }

  function inferFlags(text, out, found) {
    var inferred = {};
    if (found.statin === undefined && NO_MEDS_AT_ALL.test(text) && !detectDrug(text, STATIN_RE)) {
      out.statin = false; found.statin = "inferred"; inferred.statin = { value: false, evidence: "no medications on file" };
    }
    if (found.bp_tx === undefined && NO_MEDS_AT_ALL.test(text) && !detectDrug(text, ANTIHTN_RE)) {
      out.bp_tx = false; found.bp_tx = "inferred"; inferred.bp_tx = { value: false, evidence: "no medications on file" };
    }
    if (found.statin === undefined) {
      if (NO_LIPID_MEDS.test(text)) { out.statin = false; found.statin = "inferred"; inferred.statin = { value: false, evidence: "no lipid-lowering meds listed" }; }
      else { var s = detectDrug(text, STATIN_RE); if (s) { out.statin = true; found.statin = "inferred"; inferred.statin = { value: true, evidence: s }; } }
    }
    if (found.bp_tx === undefined) {
      if (NO_HTN_MEDS.test(text)) { out.bp_tx = false; found.bp_tx = "inferred"; inferred.bp_tx = { value: false, evidence: "no antihypertensive meds listed" }; }
      else { var h = detectDrug(text, ANTIHTN_RE); if (h) { out.bp_tx = true; found.bp_tx = "inferred"; inferred.bp_tx = { value: true, evidence: h }; } }
    }
    if (found.dm === undefined) {
      var sig = diabetesSignal(text);
      if (sig.state === "yes") { out.dm = true; found.dm = "inferred"; inferred.dm = { value: true, evidence: sig.evidence }; }
      // "ambiguous" = diabetes IS mentioned, but as a resolved/remission/possible
      // diagnosis ("Resolved Problems: Type 2 diabetes mellitus (resolved 2023)").
      // That is neither a Yes nor a No, so leave it blank for the clinician rather
      // than asserting "not on problem list" over the top of a real mention.
      else if (sig.state === "none" && hasProblemList(text)) { out.dm = false; found.dm = "inferred"; inferred.dm = { value: false, evidence: "not on problem list" }; }
    }
    if (found.smoking === undefined) { var sm = detectSmoking(text); if (sm) { out.smoking = sm.value; found.smoking = "inferred"; inferred.smoking = sm; } }
    return inferred;
  }

  // ---- Post-parse validation (cross-field + threshold warnings) ----------
  function validateParsed(out, thresholds) {
    var warnings = [];
    var LABELS = { egfr: "eGFR", hba1c: "HbA1c", uacr: "UACR", total_c: "Total cholesterol", hdl_c: "HDL", sbp: "SBP", bmi: "BMI" };
    Object.keys(thresholds).forEach(function (key) {
      var lbl = LABELS[key] || key;
      warnings.push(lbl + " was reported as \"" + thresholds[key] + out[key] + "\" — this is a threshold, not an exact measurement. Enter the actual value if known.");
    });
    if (out.total_c != null && out.hdl_c != null && out.total_c <= out.hdl_c) {
      warnings.push("Total cholesterol (" + out.total_c + ") ≤ HDL (" + out.hdl_c + ") — values may be swapped.");
    }
    return warnings;
  }

  // ---- Independent second parser (differential cross-check) --------------
  // A DELIBERATELY DIFFERENT algorithm from the primary parser. The primary is
  // label-anchored ("find eGFR, read the next number"). This one is a
  // units-and-magnitude number harvester classified by SAME-LINE context. It is
  // tuned for PRECISION over recall: it emits a value only when confident and
  // abstains otherwise, so a disagreement is meaningful (not alarm-fatigue noise).
  //
  // It is NOT the source of truth — the primary parser's values are always what's
  // used. This only flags fields where the two independent methods disagree, so
  // the user knows a parsing error is likely there and should double-check.
  function harvestNumbers(text) {
    // Mask reference ranges / parentheticals with equal-length blanks so their
    // numbers aren't harvested (e.g. "[125-200] 160" must not yield 125), while
    // keeping indices aligned with the original text for context slicing.
    var masked = text.replace(/\([^)]*\)/g, function (s) { return s.replace(/[^\n]/g, " "); })
                     .replace(/\[[^\]]*\]/g, function (s) { return s.replace(/[^\n]/g, " "); });
    var out = [], re = /([<>≤≥]?\s*)(\d[\d,]*(?:\.\d+)?)/g, m;
    while ((m = re.exec(masked)) !== null) {
      var numStart = m.index + m[1].length, numEnd = numStart + m[2].length;
      var lineStart = text.lastIndexOf("\n", m.index - 1) + 1;
      out.push({
        val: parseFloat(m[2].replace(/,/g, "")),                  // strip comma thousands
        beforeLine: text.slice(lineStart, m.index).toLowerCase(), // SAME-LINE context only
        after: text.slice(numEnd, numEnd + 12).toLowerCase(),
        idx: m.index, numStart: numStart, numEnd: numEnd,
      });
    }
    return out;
  }

  // ---- Source annotation ("show your work" highlighting) ----------------
  // Classify every number in the paste as: consumed (→ which field), a potential
  // MISS (looks like a PREVENT field whose form value is still empty), or neutral
  // (dates, doses, MRNs, non-PREVENT labs like LDL). Returns spans for the UI to
  // highlight, so silent misses become visible to the human.
  function annotateSource(text, res) {
    text = normalizeText(text);
    var values = res.values || {}, found = res.found || {};
    var nums = harvestNumbers(text);
    var consumed = {};
    var LABELRE = {
      age: /age/, sbp: /\bbp\b|pressure|systolic/, total_c: /chol|\btc\b/, hdl_c: /hdl|high[\s-]?density/,
      bmi: /bmi|body\s*mass/, egfr: /gfr/, hba1c: /a1c|glyc/, uacr: /acr|album|micro/,
      ldl_c: /\bldl\b|low[\s-]?density/,
    };
    var TOL = { age: 0.5, sbp: 0.5, total_c: 0.5, hdl_c: 0.5, bmi: 0.05, egfr: 0.5, hba1c: 0.05, uacr: 2, ldl_c: 0.5 };

    // BP: consume the systolic (= values.sbp) and its paired diastolic.
    if (values.sbp != null) {
      for (var i = 0; i < nums.length; i++) {
        if (consumed[i] != null || Math.abs(nums[i].val - values.sbp) >= 0.5) continue;
        var aft = text.slice(nums[i].numEnd, nums[i].numEnd + 6);
        if (LABELRE.sbp.test(nums[i].beforeLine) || /^\s*\/\s*\d/.test(aft)) {
          consumed[i] = "sbp";
          if (i + 1 < nums.length && /^\s*\/\s*$/.test(text.slice(nums[i].numEnd, nums[i + 1].numStart))) consumed[i + 1] = "_dia";
          break;
        }
      }
    }
    // Other numeric fields: value match, preferring a candidate whose line carries the label.
    ["age", "total_c", "hdl_c", "ldl_c", "bmi", "egfr", "hba1c", "uacr"].forEach(function (f) {
      if (values[f] == null) return;
      if (f === "egfr" && found.egfr === "computed_from_cr") return;
      var tol = TOL[f] || 0.5, best = -1;
      for (var i = 0; i < nums.length; i++) {
        if (consumed[i] == null && Math.abs(nums[i].val - values[f]) <= tol && LABELRE[f].test(nums[i].beforeLine)) { best = i; break; }
      }
      if (best < 0) for (var j = 0; j < nums.length; j++) {
        if (consumed[j] == null && Math.abs(nums[j].val - values[f]) <= tol) { best = j; break; }
      }
      if (best >= 0) consumed[best] = f;
    });
    // eGFR computed from creatinine: the consumed number is the creatinine.
    if (found.egfr === "computed_from_cr") {
      for (var i = 0; i < nums.length; i++) {
        if (consumed[i] != null) continue;
        var bl = nums[i].beforeLine;
        if (/alb|ratio|urine|clearance|kinase/.test(bl)) continue;
        if (/creat|scr|(?:^|[^a-z\/])cr\b/.test(bl)) { consumed[i] = "egfr_cr"; break; }
      }
    }

    // A number is a potential MISS only if it looks like a specific PREVENT field
    // whose form value is still empty — high signal, low noise (LDL/VLDL/date/dose
    // stay neutral).
    var MISS_RULES = [
      { f: "total_c", re: /total\s*chol|cholesterol|\bchol\b|\btc\b/, excl: /hdl|ldl|vldl|non|ratio/ },
      { f: "hdl_c", re: /hdl|high[\s-]?density/, excl: /non[\s-]?hdl|ldl/ },
      { f: "ldl_c", re: /\bldl\b|low[\s-]?density/, excl: /vldl|ratio/ },
      { f: "egfr", re: /gfr/, excl: /clearance/ },
      { f: "egfr", re: /creatinine|creat\b|scr|(?:^|[^a-z\/])cr\b/, excl: /alb|ratio|urine|clearance|kinase/ },
      { f: "hba1c", re: /a1c|glyc\w*\s*h[ae]mo/, excl: /trig/ },   // NOT "triglycerides"
      { f: "bmi", re: /bmi|body\s*mass/, excl: /never^/ },
      { f: "uacr", re: /uacr|\bacr\b|microalb|album\w*\s*\/?\s*creat/, excl: /never^/ },
      { f: "sbp", re: /\bbp\b|blood\s*pressure|systolic/, excl: /never^/ },
    ];
    var spans = nums.map(function (n, i) {
      var status = consumed[i] != null ? "consumed" : "neutral", field = consumed[i] || null;
      if (status === "neutral") {
        for (var r = 0; r < MISS_RULES.length; r++) {
          var rule = MISS_RULES[r];
          if (rule.re.test(n.beforeLine) && !rule.excl.test(n.beforeLine) && (values[rule.f] == null)) {
            status = "missed"; field = rule.f; break;
          }
        }
      }
      return { start: n.numStart, end: n.numEnd, val: n.val, status: status, field: field };
    });
    return spans;
  }

  function parseIndependent(text) {
    if (!text) return {};
    text = maskDisqualifiedLines(normalizeText(text));
    var V = {};

    // sex — word presence (independent of the primary's label pass)
    if (/\bfemale\b|\bwoman\b/i.test(text)) V.sex = "female";
    else if (/\bmale\b|\bman\b/i.test(text)) V.sex = "male";
    else { var sm = text.match(/\b(?:sex|gender)\b\s*[:=]?\s*([mf])\b/i); if (sm) V.sex = /f/i.test(sm[1]) ? "female" : "male"; }

    var nums = harvestNumbers(text);

    // age: 18–110 with "age" on the same line, or a year suffix (yo / y/o / years)
    nums.forEach(function (n) {
      if (V.age != null) return;
      if (n.val >= 18 && n.val <= 110 && (/(?:^|[^a-z])age\b/.test(n.beforeLine) || /^\s*(?:y\/?o|yo\b|years|yrs?\b)/.test(n.after))) V.age = n.val;
    });

    // sbp: first physiologic BP pair not part of a date, else "SBP n" / "n mmHg"
    var bpRe = /(\d{2,3})\s*(?:\/|over)\s*(\d{2,3})(?!\s*\/\s*\d)/g, bm;
    while ((bm = bpRe.exec(text)) !== null) {
      var s = +bm[1], d = +bm[2];
      if (s >= 70 && s <= 260 && d >= 30 && d <= 160) { V.sbp = s; break; }
    }
    if (V.sbp == null) nums.forEach(function (n) {
      if (V.sbp != null) return;
      if (n.val >= 70 && n.val <= 260 && (/\bsbp\b|systolic/.test(n.beforeLine) || /mm\s*hg/.test(n.after))) V.sbp = n.val;
    });

    // cholesterol family — classify by the number's OWN line (not a char window)
    nums.forEach(function (n) {
      var bl = n.beforeLine;
      if (!/chol|hdl|ldl|lipoprotein|\btc\b/.test(bl)) return;
      if (/non[\s-]?hdl|\bldl\b|vldl|trig|ratio/.test(bl)) return;      // distractor lines
      // a reference-range bound is not a result (see the creatinine harvest below)
      if (/[-–]\s*$/.test(bl) || /^\s*[-–]\s*\d/.test(n.after)) return;
      var si = /^\s*mmol/i.test(n.after);                                  // SI-unit panel
      if (/hdl|high[\s-]?density/.test(bl)) { if (V.hdl_c == null && (si ? (n.val >= 0.2 && n.val <= 5) : (n.val >= 5 && n.val <= 150))) V.hdl_c = n.val; return; }
      if (/total|\btc\b|chol/.test(bl)) { if (V.total_c == null && (si ? (n.val >= 1.5 && n.val <= 15) : (n.val >= 40 && n.val <= 500))) V.total_c = n.val; }
    });

    // bmi
    nums.forEach(function (n) { if (V.bmi == null && n.val >= 10 && n.val <= 80 && (/bmi|body\s*mass/.test(n.beforeLine) || /kg\/m/.test(n.after))) V.bmi = n.val; });
    // hba1c
    // hba1c: reject reference-range bounds and diagnostic-cutoff comment numbers,
    // so the second parser abstains (rather than confidently grabbing 4.3) on an
    // Epic @LASTLAB@ result table — avoiding a false conflict with the primary.
    nums.forEach(function (n) {
      if (V.hba1c != null || n.val < 3 || n.val > 20) return;
      if (!/a1c|glyc|glycohem/.test(n.beforeLine)) return;
      if (A1C_STOP.test(n.beforeLine)) return;                 // "cutoffs...normal...diabetes"
      if (/[-–]\s*$/.test(n.beforeLine) || /^\s*[-–]\s*\d/.test(n.after)) return; // range bound
      V.hba1c = n.val;
    });
    // uacr — requires both an albumin and a creatinine/ratio cue on the line
    nums.forEach(function (n) { if (V.uacr == null && /uacr|\bacr\b|album|microalb/.test(n.beforeLine) && /creat|\bcr\b|ratio/.test(n.beforeLine) && n.val >= 0.1 && n.val <= 25000) V.uacr = n.val; });
    // eGFR stated — "gfr" on the line, or an mL/min unit that is NOT a creatinine
    // CLEARANCE (95 mL/min) or other creatinine line.
    nums.forEach(function (n) { if (V.egfr == null && n.val >= 1 && n.val <= 140 && (/gfr/.test(n.beforeLine) || (/ml\/min/.test(n.after) && !/clearance|creat/.test(n.beforeLine)))) V.egfr = n.val; });

    // eGFR independently DERIVED from creatinine (a separate, strong cross-check
    // for the most dangerous field — kept apart from any stated eGFR). Reject
    // albumin/ratio lines ("Alb/Cr: 12" is a UACR, not a creatinine of 12) and a
    // "cr" cue that is a ratio denominator ("/cr").
    var crVal = null;
    nums.forEach(function (n) {
      if (crVal != null) return;
      var bl = n.beforeLine;
      if (/alb|ratio|urine|uacr|clearance|kinase|micro/.test(bl)) return;
      if (/\baki\b|acute\s+kidney|baseline|resume\s+when|\bgoal\b|\btarget\b/.test(bl)) return;
      if (!/(?:^|[^a-z\/])(?:creatinine|creat|scr|cr)\b/.test(bl)) return;
      // Reference-range bounds are not results. On an SI row ("Creatinine  97
      // 44 - 106 umol/L") the low bound 44 sits on a creatinine line with "umol"
      // right after it, so without these two guards the cross-check derives an
      // eGFR of 107 from it and raises a false conflict against a correct primary.
      if (/[-–]\s*$/.test(bl)) return;                       // high bound: "44 - |106|"
      if (/^\s*[-–]\s*\d/.test(n.after)) return;              // low bound:  "|44| - 106"
      // The unit may sit further along the row than the 12-char `after` window, so
      // fall back to the whole line for the SI check.
      var lnS = text.lastIndexOf("\n", n.numStart - 1) + 1;
      var lnE = text.indexOf("\n", n.numStart); if (lnE < 0) lnE = text.length;
      var si = /µmol|umol|μmol/i.test(text.slice(lnS, lnE));
      if (si && n.val >= 20 && n.val <= 1500) crVal = n.val / 88.4;
      else if (!si && n.val >= 0.2 && n.val <= 15) crVal = n.val;
    });
    if (crVal != null && V.age != null && V.sex) V.egfr_cr = ckdEpi2021(crVal, V.age, V.sex);

    return V;
  }

  // Compare the primary parser's values against the independent parser's.
  // Returns per-field status: "agree" | "conflict" | "unconfirmed" (second parser
  // abstained). Only fields the primary actually produced are reported.
  var XCHECK_TOL = { age: 0.5, sbp: 2, total_c: 1.5, hdl_c: 1.5, bmi: 0.2, egfr: 2, hba1c: 0.15, uacr: 2 };
  function crossCheck(primary, second) {
    var report = {};
    Object.keys(XCHECK_TOL).forEach(function (f) {
      var a = primary[f], b = second[f];
      if (a == null || isNaN(a)) return;                 // nothing to check
      if (b == null || isNaN(b)) { report[f] = "unconfirmed"; return; }
      var tol = f === "uacr" ? Math.max(2, 0.05 * Math.max(a, b)) : XCHECK_TOL[f];
      if ((f === "total_c" || f === "hdl_c") && primary.chol_unit === "mmol/L") tol = 0.05; // SI magnitudes
      report[f] = Math.abs(a - b) <= tol ? "agree" : "conflict";
    });
    if (primary.sex) report.sex = second.sex ? (primary.sex === second.sex ? "agree" : "conflict") : "unconfirmed";
    // Strong derived cross-check: stated eGFR vs. creatinine-implied eGFR.
    if (primary.egfr != null && second.egfr_cr != null) {
      var d = Math.abs(primary.egfr - second.egfr_cr);
      if (d > 15 && d / Math.max(primary.egfr, second.egfr_cr) > 0.2) report.egfr = "conflict";
      else if (!report.egfr || report.egfr === "unconfirmed") report.egfr = "agree";
    }
    return report;
  }

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
  var api = { parseText, selectModel, computeAll, RANGES, firstNumber, parseBool, parseSex, ckdEpi2021, scanField, scanSbp, detectDrug, detectDiabetes, diabetesSignal, detectSmoking, smokingStatusLine, isFamilyContext, extractNum, sectionAbove, normalizeText, parseIndependent, crossCheck, annotateSource, harvestNumbers };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (typeof window !== "undefined") window.PREVENT_APP = api;
})();
