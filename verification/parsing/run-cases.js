/* Case runner: scores a JSON file of parser test cases against app.js.
 *
 *   node verification/parsing/run-cases.js cases.json            # human summary
 *   node verification/parsing/run-cases.js cases.json --json     # machine-readable
 *   node verification/parsing/run-cases.js a.json b.json --fail-only
 *
 * A cases file is an array (or {cases:[...]}) of:
 *   { name: "short id", text: "the paste, with \n newlines",
 *     want: { age: 58, sex: "male", sbp: 138, total_c: 210, hdl_c: 45, ldl_c: 130,
 *             bmi: 27, egfr: 80, hba1c: 7.2, uacr: 30, dm: true, smoking: false,
 *             bp_tx: true, statin: null, chol_unit: "mmol/L" },   // null = MUST be blank
 *     wantThreshold: { egfr: ">" },                                // thresholds[field]
 *     wantFound: { egfr: "computed_from_cr" },                     // found[field] marker
 *     wantConflict: { egfr: "conflict" },                          // "agree"|"conflict"|"unconfirmed"
 *     wantAnnotate: { "5.4": "missed", "150": "neutral" },         // status of a number in the source map
 *     note: "why a clinician would read it this way" }
 * Only the keys present in want* are checked. Numbers match within 0.05.
 */
var APP = require("../../app.js");
var fs = require("fs");
var files = process.argv.slice(2).filter(function (a) { return a[0] !== "-" ; });
var asJson = process.argv.indexOf("--json") >= 0, failOnly = process.argv.indexOf("--fail-only") >= 0;
if (!files.length) { console.error("usage: run-cases.js cases.json [...] [--json] [--fail-only]"); process.exit(2); }

function annStatus(text, numText, res) {
  var norm = APP.normalizeText(text);
  var spans = APP.annotateSource(text, res);
  var idx = norm.indexOf(numText);
  if (idx < 0) return { status: "not-in-text" };
  var sp = spans.filter(function (s) { return s.start <= idx && s.end >= idx + numText.length; })[0]
        || spans.filter(function (s) { return s.start === idx; })[0];
  return sp ? { status: sp.status, field: sp.field } : { status: "no-span" };
}

var results = [], total = 0, passed = 0;
files.forEach(function (file) {
  var cases = JSON.parse(fs.readFileSync(file, "utf8"));
  if (!Array.isArray(cases)) cases = cases.cases;
  cases.forEach(function (c) {
    total++;
    var r;
    try { r = APP.parseText(c.text); }
    catch (e) { results.push({ file: file, name: c.name, pass: false, crash: String(e && e.stack || e), fails: [] }); return; }
    var v = r.values || {}, fails = [];
    Object.keys(c.want || {}).forEach(function (k) {
      var w = c.want[k], got = v[k], ok;
      if (w === null) ok = (got === undefined || got === null);
      else if (typeof w === "number") ok = (typeof got === "number" && Math.abs(got - w) < 0.05);
      else ok = (got === w);
      if (!ok) fails.push({ field: k, want: w, got: got === undefined ? null : got });
    });
    Object.keys(c.wantThreshold || {}).forEach(function (k) {
      var got = r.thresholds && r.thresholds[k];
      if (got !== c.wantThreshold[k]) fails.push({ field: "threshold:" + k, want: c.wantThreshold[k], got: got || null });
    });
    Object.keys(c.wantFound || {}).forEach(function (k) {
      var got = r.found && r.found[k];
      if (got !== c.wantFound[k]) fails.push({ field: "found:" + k, want: c.wantFound[k], got: got === undefined ? null : got });
    });
    Object.keys(c.wantConflict || {}).forEach(function (k) {
      var got = r.conflicts && r.conflicts[k];
      if (got !== c.wantConflict[k]) fails.push({ field: "conflict:" + k, want: c.wantConflict[k], got: got === undefined ? null : got });
    });
    Object.keys(c.wantAnnotate || {}).forEach(function (k) {
      var got = annStatus(c.text, k, r);
      if (got.status !== c.wantAnnotate[k]) fails.push({ field: "annotate:" + k, want: c.wantAnnotate[k], got: got.status + (got.field ? "(" + got.field + ")" : "") });
    });
    var pass = fails.length === 0;
    if (pass) passed++;
    results.push({ file: file, name: c.name, pass: pass, fails: fails, values: v, found: r.found, conflicts: r.conflicts, warnings: r.warnings, inferred: r.inferred, note: c.note, text: c.text });
  });
});
var failed = results.filter(function (x) { return !x.pass; });
if (asJson) {
  console.log(JSON.stringify({ total: total, passed: passed, failed: failed.length, results: failOnly ? failed : results }, null, 1));
} else {
  results.forEach(function (x) {
    if (x.pass && failOnly) return;
    if (x.pass) console.log("  ✓ " + x.name);
    else if (x.crash) console.log("  ✗ " + x.name + "  CRASH: " + x.crash.split("\n")[0]);
    else console.log("  ✗ " + x.name + "  [" + x.fails.map(function (f) { return f.field + ": want " + JSON.stringify(f.want) + ", got " + JSON.stringify(f.got); }).join("; ") + "]");
  });
  console.log("\n" + passed + " passed, " + failed.length + " failed (of " + total + ")");
}
process.exit(failed.length ? 1 : 0);
