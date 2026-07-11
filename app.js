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
    zip: ["zip", "zip code", "zipcode", "postal code"],
    sdi: ["sdi", "sdi decile", "social deprivation index"],
  };

  // Labeled pass handles the explicit/non-lab fields. Numeric lab & vital
  // values (sbp, bmi, total_c, hdl_c, egfr, hba1c, uacr) are handled by
  // scanClinical(), which also works on unstructured lab dumps.
  var MATCH_ORDER = ["age", "sex", "zip", "sdi", "bp_tx", "statin", "dm", "smoking"];
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

  var TRUE_WORDS = /\b(yes|y|true|positive|pos|present|current|active|on|1|\+)\b/i;
  var FALSE_WORDS = /\b(no|n|false|negative|neg|none|never|former|quit|denies|absent|off|0)\b/i;

  function parseBool(s) {
    if (s == null) return null;
    var t = String(s).trim();
    if (t === "") return null;
    if (MISSING_DATA.test(t)) return null;
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

  // ---- Text normalization ------------------------------------------------
  // Epic output can contain non-breaking spaces, smart quotes, en/em-dashes,
  // and tabs. Normalizing before parsing prevents subtle match failures.
  function normalizeText(text) {
    return text
      .replace(/ /g, " ")
      .replace(/–/g, "-")
      .replace(/—/g, " - ")
      .replace(/[‘’]/g, "'")
      .replace(/[“”]/g, '"')
      .replace(/\r\n/g, "\n")
      .replace(/\t/g, "  ");
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
          if (BOOL_FIELDS[field] && !/^\s*[:=]/.test(after)) break;
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
    return { values: out, found: found, inferred: inferred, thresholds: thresholds, warnings: warnings };
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

  // ---- Number extraction with threshold detection ------------------------
  // Returns { value, threshold } where threshold is "<", ">", etc. or null.
  // Many labs report values as ">60" or "<0.5" — the threshold operator is
  // clinically significant (the real value could be very different) and must
  // be surfaced to the user.
  function extractNum(s, allowThousands) {
    if (!s) return null;
    s = String(s).replace(/\([^)]*\)/g, " "); // drop parentheticals: ref ranges, dates, eAG
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
      var pre = text.slice(Math.max(0, m.index - 6), m.index).toLowerCase();
      if (opts.badWords && opts.badWords.some(function (w) { return pre.indexOf(w) >= 0; })) continue;
      // ratio guard: reject "X/HDL" (slash immediately before) or "Chol/HDL" (slash immediately after name)
      if (opts.noSlashBefore && /\/\s*$/.test(text.slice(Math.max(0, m.index - 2), m.index))) continue;
      var rawAfter = text.slice(m.index + m[0].length);
      if (opts.noSlashAfter && /^\s*\//.test(rawAfter)) continue;
      var after = lineAfter(text, m.index + m[0].length);
      if (opts.commaCut) { var c = after.indexOf(","); if (c >= 0) after = after.slice(0, c); }
      var result = extractNum(after, opts.thousands);
      if (result === null) continue;
      var n = result.value;
      if ((opts.min != null && n < opts.min) || (opts.max != null && n > opts.max)) continue;
      return { value: n, threshold: result.threshold };
    }
    return null;
  }
  function scanSbp(text) {
    // 1) explicit "BP 148/86", "148/86 mmHg", "SBP 148"
    var pats = [
      /\b(?:bp|blood\s*pressure)\b[^\d\n]{0,10}(\d{2,3})\s*\/\s*\d{2,3}/i,
      /(\d{2,3})\s*\/\s*\d{2,3}\s*mm\s*hg/i,
      /\b(?:sbp|systolic(?:\s*(?:bp|blood\s*pressure))?)\b[^\d\n]{0,12}(\d{2,3})/i,
    ];
    for (var i = 0; i < pats.length; i++) {
      var m = text.match(pats[i]);
      if (m) { var v = parseFloat(m[1]); if (v >= 70 && v <= 260) return v; }
    }
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

  // ZIP from a city/state/zip string (e.g. @CTYSTZIP@ -> "San Francisco, CA 94110").
  // Requires a valid 2-letter US state before the 5 digits so it can't grab a lab
  // value, MRN, or date.
  var US_STATES = new Set(("AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD " +
    "MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY").split(" "));
  function scanZip(text) {
    var re = /\b([A-Za-z]{2})\.?\s+(\d{5})(?:-\d{4})?(?!\d)/g, m;
    while ((m = re.exec(text)) !== null) {
      if (US_STATES.has(m[1].toUpperCase())) return m[2];
    }
    return null;
  }

  // ---- Section-awareness utility ----------------------------------------
  // Returns the most recent standalone section header (a line ending with ":"
  // and no inline content) above a given text position. Used to scope drug
  // and diabetes detection so allergy/family-history sections don't trigger
  // false positives.
  function sectionAbove(text, pos) {
    var chunk = text.slice(0, pos);
    var re = /(?:^|\n)[ \t]*([^\n:]{1,60})\s*:\s*$/gm;
    var last = null, m;
    while ((m = re.exec(chunk)) !== null) last = m[1].trim().toLowerCase();
    return last || "";
  }

  function scanClinical(text, out, found, thresholds) {
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
    if (found.zip === undefined) { var z = scanZip(text); if (z) { out.zip = z; found.zip = "scanned"; } }
    tryField("bmi", "bmi", { min: 10, max: 80 });
    // No commaCut: labs are named with commas ("Cholesterol, Total,* 164"), and
    // firstNumIn already takes the first number after the label anyway.
    tryField("total_c", "(?:total[\\s,]*chol\\w*|chol\\w*[\\s,]*total|chol\\w*)", { badWords: ["hdl", "ldl", "vldl", "non"], noSlashAfter: true, min: 40, max: 500 });
    tryField("hdl_c", "hdl(?:[\\s-]?c)?(?:\\s*cholesterol)?", { badWords: ["non"], noSlashBefore: true, min: 5, max: 150 });
    tryField("hba1c", "(?:hb?a1c|hgba1c|a1c|glyc\\w*\\s*h[ae]moglobin|glycohemoglobin)", { min: 3, max: 20 });
    tryField("egfr", "\\be?-?gfr\\b", { min: 1, max: 200 });
    // UACR: accept slash, space, or dash between albumin and creatinine
    tryField("uacr", "(?:uacr|(?:urine\\s+)?(?:micro)?album(?:in)?[/\\s-]+creat(?:inine)?(?:\\s+ratio)?|alb[/\\s-]+cr(?:eat)?|\\bacr\\b)", { thousands: true, min: 0.1, max: 25000 });
    // Fallback: eGFR from serum creatinine (only if eGFR wasn't found directly).
    // Tightened pattern: \b after "creat" rejects "creatine kinase"; negative
    // lookahead rejects "creatinine clearance".
    if (found.egfr === undefined && out.age != null && out.sex) {
      var crResult = scanField(text, "(?:creatinine|creat(?:inine)?\\b)(?!\\s*(?:cl|clearance))", { badWords: ["album", "alb", "urine", "uacr", "ratio"], noSlashBefore: true, min: 0.2, max: 15 });
      if (crResult !== null) {
        var e = ckdEpi2021(crResult.value, out.age, out.sex);
        if (e !== null) { out.egfr = e; found.egfr = "computed_from_cr"; }
      }
    }
  }

  // ---- Infer Yes/No flags from meds / problems / social history ----------
  // Positive-evidence only: sets a flag TRUE (or smoking FALSE for never/
  // former) when detected; NEVER assumes "No" from absence. Everything set
  // here is marked "inferred" so the UI can prompt verification and show the
  // matched evidence (a med/problem list can't always convey intent).
  var STATIN_RE = /\b(?:atorva|rosuva|simva|prava|lova|pitava|fluva)statin\b|\b(?:lipitor|crestor|zocor|pravachol|livalo|lescol|altoprev|ezallor|vytorin|caduet|roszet|simcor)\b/i;
  var ANTIHTN_RE = /\b(?:lisinopril|enalapril|enalaprilat|ramipril|benazepril|captopril|quinapril|fosinopril|perindopril|trandolapril|moexipril|losartan|valsartan|olmesartan|irbesartan|candesartan|telmisartan|azilsartan|eprosartan|amlodipine|nifedipine|felodipine|nicardipine|isradipine|nisoldipine|diltiazem|verapamil|metoprolol|atenolol|carvedilol|bisoprolol|propranolol|labetalol|nebivolol|nadolol|betaxolol|hydrochlorothiazide|hctz|chlorthalidone|chlorothiazide|indapamide|metolazone|spironolactone|eplerenone|triamterene|amiloride|furosemide|torsemide|bumetanide|clonidine|hydralazine|minoxidil|methyldopa|doxazosin|terazosin|prazosin|aliskiren|guanfacine)\b/i;
  // Lines that mean a drug is NOT actually being taken.
  var DRUG_SKIP_LINE = /allerg|adverse|intoleran|discontinu|\bd\/?c(?:'?d|ed)?\b|stopped|inactive|no longer|held\b|not taking|declined/i;
  // Explicit "no meds" statements from focused SmartLinks — e.g. @HTNMEDS@ ->
  // "No current hypertension medications", @STATINS@ -> "No current hyperlipidemia
  // medications". These are affirmative negatives, so we can set the flag to false.
  var NO_HTN_MEDS = /\bno\b[^.\n]{0,28}(?:hypertension|htn|blood[- ]?pressure|anti-?hypertensive)[^.\n]{0,18}(?:medication|meds\b|agents?|drugs?|rx)/i;
  var NO_LIPID_MEDS = /\bno\b[^.\n]{0,28}(?:hyperlipidemia|lipid|cholesterol|statin)[^.\n]{0,18}(?:medication|meds\b|agents?|drugs?|rx)/i;

  // Section headers used by detectDrug to skip allergy sections.
  var ALLERGY_HDR = /\b(?:allerg|adverse\s+reaction|sensitivit|intolerance)/i;

  function detectDrug(text, re) {
    var lines = text.split(/\n/);
    var inAllergySection = false;
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      // Track section transitions from standalone headers ("Allergies:", "Medications:")
      if (/^\s*[^\n:]{1,60}\s*:\s*$/.test(line)) {
        var header = line.replace(/^\s+/, "");
        if (ALLERGY_HDR.test(header)) { inAllergySection = true; continue; }
        else { inAllergySection = false; }
      }
      if (inAllergySection) continue;
      if (DRUG_SKIP_LINE.test(line)) continue;
      var m = line.match(re);
      if (m) {
        // Look one line ahead: if the next line has a discontinuation/allergy
        // signal, this drug is not active — skip it.
        if (i + 1 < lines.length && DRUG_SKIP_LINE.test(lines[i + 1])) continue;
        return m[0].toLowerCase();
      }
    }
    return null;
  }

  var DM_NEG = /\b(?:no|denies|denied|without|negative for|rule[d]? out|r\/o|family (?:history|hx)|fhx|gestational|borderline|impaired|screen\w*|risk of)\b[^.\n]{0,18}$/;
  function detectDiabetes(text) {
    // spelled out: "...diabet(es/ic)..."
    var re = /\bdiabet\w*/gi, m;
    while ((m = re.exec(text)) !== null) {
      var start = m.index, word = m[0];
      var ctx = text.slice(start, start + 44).toLowerCase();
      if (/^diabet\w*\s*insipidus/.test(ctx)) continue;             // DI is not DM
      if (/^[:*]/.test(text.slice(start + word.length).replace(/^\s+/, ""))) continue; // "Diabetes:" label
      // Extended lookback (60 chars) catches "Family History: Mother had diabetes"
      var pre = text.slice(Math.max(0, start - 60), start).toLowerCase();
      if (/pre-?\s*$/.test(pre)) continue;                          // pre-diabetes
      if (DM_NEG.test(pre)) continue;
      // Section awareness: skip family history and allergy sections
      var section = sectionAbove(text, start);
      if (/\b(?:family|fhx|allerg|adverse)/i.test(section)) continue;
      var scope = pre + " " + ctx;
      if (/type\s*2|type\s*ii\b|t2dm|dm\s*2/.test(scope)) return "Type 2 diabetes";
      if (/type\s*1|type\s*i\b|t1dm|dm\s*1/.test(scope)) return "Type 1 diabetes";
      if (/diabetic\s*(?:nephropathy|retinopathy|neuropathy|ketoacidosis|foot|ulcer)/.test(ctx)) return (ctx.match(/diabetic\s*\w+/) || ["diabetic"])[0];
      if (/mellitus/.test(ctx)) return "Diabetes mellitus";
      return "Diabetes";
    }
    // abbreviations: T2DM, DM2, "type 2 DM"
    var a = text.match(/\b(?:type\s*[12]\s*dm|dm\s*(?:type\s*)?[12]|t[12]dm)\b/i);
    if (a) {
      var aPre = text.slice(Math.max(0, a.index - 60), a.index).toLowerCase();
      if (!DM_NEG.test(aPre)) {
        var aSec = sectionAbove(text, a.index);
        if (!/\b(?:family|fhx|allerg|adverse)/i.test(aSec))
          return /1/.test(a[0]) ? "Type 1 diabetes" : "Type 2 diabetes";
      }
    }
    // standalone uppercase DM (clinical shorthand)
    var d = text.match(/\bDM\b/);
    if (d && text.charAt(d.index + 2) !== ":") {
      var dPre = text.slice(Math.max(0, d.index - 60), d.index).toLowerCase();
      if (!DM_NEG.test(dPre)) {
        var dSec = sectionAbove(text, d.index);
        if (!/\b(?:family|fhx|allerg|adverse)/i.test(dSec))
          return "Diabetes (DM)";
      }
    }
    return null;
  }

  // Negation context: these words immediately before a positive smoking match
  // mean the match is negated ("not a current smoker", "denies smoking").
  var SMOKE_NEG = /\b(?:not?|never|neither|deny|denies|denied|no longer|non|former|ex|isn't|is\s+not|not\s+a|was\s+not|doesn't|does\s+not)\s*$/i;

  function detectSmoking(text) {
    // Iterate all positive matches — skip any that are negated in context.
    var curRe = /\b(?:every\s*day\s*smoker|some\s*day\s*smoker|current\s+every\s*day|current\s+some\s*day|currently\s+smok\w*|actively\s+smok\w*|active\s+tobacco\s+use|smoking\s+status\s*:?\s*current|tobacco\s*(?:use)?\s*:?\s*current|current\s+smoker(?!\s*[:*])|[1-9]\d*\s*(?:cigarettes?|packs?)\s*(?:per|\/)\s*day|\bppd\b)/gi;
    var cur, negatedEvidence = null;
    while ((cur = curRe.exec(text)) !== null) {
      var pre = text.slice(Math.max(0, cur.index - 25), cur.index);
      if (SMOKE_NEG.test(pre)) {
        if (!negatedEvidence) negatedEvidence = cur[0].trim();
        continue;
      }
      return { value: true, evidence: cur[0].trim() };
    }
    var non = text.match(/\b(?:never\s*smok\w*|former\s*smoker|ex-?\s*smoker|non-?\s*smoker|smoking\s+status\s*:?\s*(?:never|former|quit)|quit\s+smoking|former\s+tobacco|denies\s+tobacco|no\s+tobacco)\b/i);
    if (non) return { value: false, evidence: non[0].trim() };
    // A negated positive ("not a current smoker") is evidence of non-smoking
    if (negatedEvidence) return { value: false, evidence: "negated: " + negatedEvidence };
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
    if (found.statin === undefined) {
      if (NO_LIPID_MEDS.test(text)) { out.statin = false; found.statin = "inferred"; inferred.statin = { value: false, evidence: "no lipid-lowering meds listed" }; }
      else { var s = detectDrug(text, STATIN_RE); if (s) { out.statin = true; found.statin = "inferred"; inferred.statin = { value: true, evidence: s }; } }
    }
    if (found.bp_tx === undefined) {
      if (NO_HTN_MEDS.test(text)) { out.bp_tx = false; found.bp_tx = "inferred"; inferred.bp_tx = { value: false, evidence: "no antihypertensive meds listed" }; }
      else { var h = detectDrug(text, ANTIHTN_RE); if (h) { out.bp_tx = true; found.bp_tx = "inferred"; inferred.bp_tx = { value: true, evidence: h }; } }
    }
    if (found.dm === undefined) {
      var d = detectDiabetes(text);
      if (d) { out.dm = true; found.dm = "inferred"; inferred.dm = { value: true, evidence: d }; }
      // No diabetes found, but a real problem list is present -> assume No, flag to verify.
      // (If there's no problem list to rule it out, leave dm unset for the user.)
      else if (hasProblemList(text)) { out.dm = false; found.dm = "inferred"; inferred.dm = { value: false, evidence: "not on problem list" }; }
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
  var api = { parseText, selectModel, computeAll, RANGES, firstNumber, parseBool, parseSex, ckdEpi2021, scanField, scanSbp, scanZip, detectDrug, detectDiabetes, detectSmoking, extractNum, sectionAbove, normalizeText };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (typeof window !== "undefined") window.PREVENT_APP = api;
})();
