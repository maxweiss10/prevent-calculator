// PREVENT risk engine — faithful JS port of CRAN preventr v0.11.0 (estimate_risk.R).
// AHA PREVENT equations: Khan SS et al. Circulation. 2024;149(6):430-449.
//
// Inputs (units): age yr; sex "female"|"male"; sbp mmHg; total_c/hdl_c mg/dL (default)
// or mmol/L; egfr mL/min/1.73m2; bmi kg/m2; hba1c %; uacr mg/g; sdi decile 1-10.
// Binary flags (bp_tx, statin, dm, smoking): 0/1 or false/true.

(function (root) {
  const CHOL_TO_MMOL = 0.02586; // mg/dL -> mmol/L (preventr convert_chol_to_mmol)
  const HALF_UP_EPS = Math.sqrt(Number.EPSILON); // matches R sqrt(.Machine$double.eps)

  function bin(v) {
    if (v === true) return 1;
    if (v === false) return 0;
    const n = Number(v);
    if (n === 0 || n === 1) return n;
    throw new Error("binary field must be 0/1/true/false, got: " + v);
  }

  // R preventr round_half_up (used to reproduce its 3-dp rounding exactly)
  function roundHalfUp(val, digits) {
    if (!isFinite(val)) return val;
    const s = Math.sign(val);
    let res = Math.abs(val) * Math.pow(10, digits);
    res = res + 0.5 + HALF_UP_EPS;
    res = Math.trunc(res);
    res = res / Math.pow(10, digits);
    return res * s;
  }

  // Build the full transformed-term map (matches prep_terms() transmute + mutate).
  // chol_unit: "mg/dL" (default) or "mmol/L".
  function buildTerms(inp, chol_unit) {
    const mgdl = (chol_unit || "mg/dL") === "mg/dL";
    const age0 = inp.age;
    const sbp = inp.sbp, bmi = inp.bmi, egfr = inp.egfr;
    const dm = bin(inp.dm), smoking = bin(inp.smoking);
    const bp_tx = bin(inp.bp_tx), statin = bin(inp.statin);

    const age = (age0 - 55) / 10;
    const non_hdl_c = mgdl
      ? (inp.total_c - inp.hdl_c) * CHOL_TO_MMOL - 3.5
      : (inp.total_c - inp.hdl_c) - 3.5;
    const hdl_c = mgdl
      ? (inp.hdl_c * CHOL_TO_MMOL - 1.3) / 0.3
      : (inp.hdl_c - 1.3) / 0.3;
    const sbp_gte_110 = (Math.max(sbp, 110) - 130) / 20;

    const t = {
      age: age,
      age_squared: age * age,
      non_hdl_c: non_hdl_c,
      hdl_c: hdl_c,
      sbp_lt_110: (Math.min(sbp, 110) - 110) / 20,
      sbp_gte_110: sbp_gte_110,
      dm: dm,
      smoking: smoking,
      bmi_lt_30: (Math.min(bmi, 30) - 25) / 5,
      bmi_gte_30: (Math.max(bmi, 30) - 30) / 5,
      egfr_lt_60: (Math.min(egfr, 60) - 60) / -15,
      egfr_gte_60: (Math.max(egfr, 60) - 90) / -15,
      bp_tx: bp_tx,
      statin: statin,
      bp_tx_sbp_gte_110: bp_tx * sbp_gte_110,
      statin_non_hdl_c: statin * non_hdl_c,
      age_non_hdl_c: age * non_hdl_c,
      age_hdl_c: age * hdl_c,
      age_sbp_gte_110: age * sbp_gte_110,
      age_dm: age * dm,
      age_smoking: age * smoking,
      age_bmi_gte_30: age * ((Math.max(bmi, 30) - 30) / 5),
      age_egfr_lt_60: age * ((Math.min(egfr, 60) - 60) / -15),
      constant: 1,
    };

    // Optional predictors for enhanced models.
    // SDI decile: provided directly (inp.sdi) or NaN when unavailable/invalid ZIP.
    const sdi = (inp.sdi === undefined || inp.sdi === null || Number.isNaN(inp.sdi))
      ? NaN : Number(inp.sdi);
    const hasSdi = !Number.isNaN(sdi);
    t.sdi_4_to_6 = (hasSdi && sdi >= 4 && sdi <= 6) ? 1 : 0;
    t.sdi_7_to_10 = (hasSdi && sdi >= 7 && sdi <= 10) ? 1 : 0;
    t.missing_sdi = hasSdi ? 0 : 1;

    const hasUacr = inp.uacr !== undefined && inp.uacr !== null && !Number.isNaN(inp.uacr);
    t.ln_uacr = hasUacr ? Math.log(inp.uacr) : 0;
    t.missing_uacr = hasUacr ? 0 : 1;

    const hasHba1c = inp.hba1c !== undefined && inp.hba1c !== null && !Number.isNaN(inp.hba1c);
    t.hba1c_dm = (hasHba1c && dm === 1) ? (inp.hba1c - 5.3) : 0;
    t.hba1c_no_dm = (hasHba1c && dm === 0) ? (inp.hba1c - 5.3) : 0;
    t.missing_hba1c = hasHba1c ? 0 : 1;

    return t;
  }

  const OUTCOMES = ["total_cvd", "ascvd", "heart_failure", "chd", "stroke"];

  // Compute risk for one model ("base"|"uacr"|"hba1c"|"sdi"|"full") and one
  // horizon ("10yr"|"30yr"). Returns { total_cvd, ascvd, heart_failure, chd,
  // stroke } as probabilities (0-1), rounded half-up to `dp` decimals (dp=null
  // -> unrounded). Requires PREVENT_COEFFS in scope.
  function riskFor(inp, model, time, coeffs, dp) {
    const table = coeffs[model + "_" + time];
    if (!table) throw new Error("no coeff table for " + model + "_" + time);
    const terms = buildTerms(inp, inp.chol_unit);
    const sex = inp.sex === "male" || inp.sex === "m" ? "male" : "female";
    const out = {};
    for (const oc of OUTCOMES) {
      const col = table.cols[sex + "_" + oc];
      let lp = 0;
      for (let i = 0; i < table.terms.length; i++) {
        const key = table.terms[i];
        const pv = terms[key];
        lp += col[i] * pv;
      }
      let risk = Math.exp(lp) / (1 + Math.exp(lp));
      if (dp !== null && dp !== undefined) risk = roundHalfUp(risk, dp);
      out[oc] = risk;
    }
    return out;
  }

  // Convenience: compute both horizons for a model.
  function estimate(inp, model, coeffs, dp) {
    return {
      r10: riskFor(inp, model, "10yr", coeffs, dp),
      r30: riskFor(inp, model, "30yr", coeffs, dp),
    };
  }

  const api = { buildTerms, riskFor, estimate, roundHalfUp, OUTCOMES, CHOL_TO_MMOL };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.PREVENT = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
