import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildDownloadPredicate, buildDownloadRequest,
  parseOccurrenceCsv, groupByIndividual,
} from "../lib/sources/gbif-download";

test("buildDownloadPredicate enforces commercial-safe licenses by default", () => {
  const p = buildDownloadPredicate({ taxonKey: "212" }) as any;
  assert.equal(p.type, "and");
  const licPred = p.predicates.find((x: any) => x.key === "LICENSE");
  assert.deepEqual(licPred.values, ["CC0_1_0", "CC_BY_4_0"]);
  assert.ok(p.predicates.find((x: any) => x.key === "TAXON_KEY" && x.value === "212"));
  assert.ok(p.predicates.find((x: any) => x.key === "OCCURRENCE_STATUS" && x.value === "PRESENT"));
  assert.ok(p.predicates.find((x: any) => x.key === "HAS_COORDINATE"));
});

test("buildDownloadPredicate adds country and WKT when given", () => {
  const p = buildDownloadPredicate({ country: "NL", wkt: "POLYGON((0 0,1 0,1 1,0 1,0 0))" }) as any;
  assert.ok(p.predicates.find((x: any) => x.key === "COUNTRY" && x.value === "NL"));
  assert.ok(p.predicates.find((x: any) => x.type === "within"));
});

test("buildDownloadRequest wraps predicate with creator + notification", () => {
  const req = buildDownloadRequest({
    creator: "u", email: "e@x.com", predicate: { type: "and", predicates: [] }, format: "DWCA",
  }) as any;
  assert.equal(req.creator, "u");
  assert.deepEqual(req.notificationAddresses, ["e@x.com"]);
  assert.equal(req.format, "DWCA");
  assert.equal(req.sendNotification, false);
});

test("parseOccurrenceCsv reads tab-separated rows and normalizes license", () => {
  const csv = [
    "organismID\tspecies\tdecimalLatitude\tdecimalLongitude\teventDate\tlicense",
    "B6918\tPlatalea leucorodia\t52.4\t4.6\t2024-01-01\thttp://creativecommons.org/publicdomain/zero/1.0/legalcode",
    "B6918\tPlatalea leucorodia\t41.2\t-8.1\t2024-03-15\thttp://creativecommons.org/publicdomain/zero/1.0/legalcode",
    "Y0089\tPlatalea leucorodia\t50.0\t3.0\t2024-02-01\thttp://creativecommons.org/licenses/by/4.0/",
  ].join("\n");
  const rows = parseOccurrenceCsv(csv);
  assert.equal(rows.length, 3);
  assert.equal(rows[0].organismID, "B6918");
  assert.equal(rows[0].lat, 52.4);
  assert.equal(rows[0].license, "CC0_1_0");
  assert.equal(rows[2].license, "CC_BY_4_0");

  const grouped = groupByIndividual(rows);
  assert.equal(grouped.size, 2);
  assert.equal(grouped.get("B6918")!.length, 2);
});
