process.chdir(__dirname); // run from anywhere
const fs = require("fs");
const { PREVENT_COEFFS } = require("../coeffs.js");
const P = require("../prevent.js");

const sdiMap = JSON.parse(fs.readFileSync("../sdi_deciles.json", "utf8"));
const lines = fs.readFileSync("./grid.jsonl", "utf8").trim().split("\n");

const OC = ["total_cvd", "ascvd", "heart_failure", "chd", "stroke"];
let n = 0, fails = 0, maxAbs = 0;
const failSamples = [];

for (const line of lines) {
  const c = JSON.parse(line);
  const inp = {
    age: c.age, sex: c.sex, sbp: c.sbp, bp_tx: c.bp_tx, total_c: c.total_c,
    hdl_c: c.hdl_c, statin: c.statin, dm: c.dm, smoking: c.smoking,
    egfr: c.egfr, bmi: c.bmi, chol_unit: "mg/dL",
  };
  if (c.hba1c !== null) inp.hba1c = c.hba1c;
  if (c.uacr !== null) inp.uacr = c.uacr;
  if (c.zip !== null) {
    const d = sdiMap[String(c.zip).padStart(5, "0")];
    inp.sdi = d === undefined ? NaN : d;
  }

  const got = P.estimate(inp, c.model, PREVENT_COEFFS, 3);
  const check = (horizon, prefix) => {
    for (const oc of OC) {
      const exp = c[prefix + ocKey(oc)];
      if (exp === null || exp === undefined) continue;
      const g = got[horizon][oc];
      const diff = Math.abs(g - exp);
      if (diff > maxAbs) maxAbs = diff;
      n++;
      if (diff > 5e-4) {
        fails++;
        if (failSamples.length < 15)
          failSamples.push({ model: c.model, sex: c.sex, horizon, oc, exp, got: g, diff, inp });
      }
    }
  };
  check("r10", "r10_");
  check("r30", "r30_");
}

function ocKey(oc) {
  return oc === "heart_failure" ? "hf" : oc; // grid uses r10_hf etc.
}

console.log(`Compared ${n} outcome-values across ${lines.length} cases.`);
console.log(`Mismatches (>5e-4): ${fails}`);
console.log(`Max abs diff: ${maxAbs.toExponential(3)}`);
if (failSamples.length) {
  console.log("\nFirst mismatches:");
  for (const f of failSamples) console.log(JSON.stringify(f));
  process.exit(1);
} else {
  console.log("ALL PASS ✓");
}
