import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeLicense, isCommercialSafe } from "../lib/licenses";

test("normalizeLicense maps source strings to the enum", () => {
  assert.equal(normalizeLicense("http://creativecommons.org/publicdomain/zero/1.0/legalcode"), "CC0_1_0");
  assert.equal(normalizeLicense("http://creativecommons.org/licenses/by/4.0/"), "CC_BY_4_0");
  assert.equal(normalizeLicense("http://creativecommons.org/licenses/by-nc/4.0/"), "CC_BY_NC_4_0");
  assert.equal(normalizeLicense("CC_BY_4_0"), "CC_BY_4_0");
  assert.equal(normalizeLicense("CC_BY_NC_4_0"), "CC_BY_NC_4_0");
  // Zenodo hyphenated forms
  assert.equal(normalizeLicense("cc-zero"), "CC0_1_0");
  assert.equal(normalizeLicense("cc-by-4.0"), "CC_BY_4_0");
  assert.equal(normalizeLicense("cc-by-nc-4.0"), "CC_BY_NC_4_0");
  assert.equal(normalizeLicense("some proprietary terms"), "OTHER");
  assert.equal(normalizeLicense(undefined), "OTHER");
});

test("isCommercialSafe: CC0 and CC BY always safe; OTHER never", () => {
  assert.equal(isCommercialSafe("CC0_1_0"), true);
  assert.equal(isCommercialSafe("CC_BY_4_0"), true);
  assert.equal(isCommercialSafe("OTHER"), false);
});

test("isCommercialSafe: CC BY-NC gated behind ALLOW_NC", () => {
  const prev = process.env.ALLOW_NC;
  process.env.ALLOW_NC = "false";
  assert.equal(isCommercialSafe("CC_BY_NC_4_0"), false);
  process.env.ALLOW_NC = "true";
  assert.equal(isCommercialSafe("CC_BY_NC_4_0"), true);
  process.env.ALLOW_NC = prev;
});
