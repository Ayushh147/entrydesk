import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { parseText, normalizeDate } from "../server/parser.js";
import { emptyData, emptyLine, type Document } from "../shared/model.js";
import { reconcile } from "../server/reconcile.js";
import { validateXml } from "../server/validate.js";
import { readPdf } from "../server/pdf.js";
import { conflictGroups, issueCategory } from "../shared/review.js";
import { parsePackingTables } from "../server/parser.js";
test("single-transaction bond requires its producer account", () => {
  assert(
    reconcile([], { bondType: "09" }).issues.some(
      (i) => i.id === "required-bondProducerAccountNo",
    ),
  );
  assert(
    !reconcile([], { bondType: "08" }).issues.some(
      (i) => i.id === "required-bondProducerAccountNo",
    ),
  );
});
function doc(kind: Document["kind"], data = emptyData()): Document {
  return {
    id: kind,
    name: kind + ".pdf",
    sha256: "test",
    kind,
    data,
    rawText: "test evidence",
    method: "text",
    pages: 1,
  };
}
function shipment() {
  const invoice = emptyData();
  Object.assign(invoice, {
    invoiceNumber: "NEW-123",
    currency: "USD",
    countryOfOrigin: "CN",
    packages: 3,
    freight: 20,
    insurance: 5,
    goodsTotal: 200,
    invoiceTotal: 225,
  });
  const l = emptyLine("OTHER-99");
  Object.assign(l, {
    description: "Example & <quoted> product",
    quantity: 10,
    unit: "PCS",
    unitPrice: 20,
    amount: 200,
    origin: "CN",
    hsCode: "1234.56",
  });
  invoice.lines = [l];
  return [doc("invoice", invoice), doc("packing_list"), doc("bill_of_lading")];
}
test("unseen invoice parses values without matching assignment names", () => {
  const r = parseText(
    `OTHER EXPORTER LIMITED\nCOMMERCIAL INVOICE\nInvoice Number: NEW-777\nInvoice Date: 2026-01-08\nCurrency: EUR\nCountry of Origin: CHINA\n1 OTHER-99 STEEL ASSEMBLY 7326.90 10 EA 12.50 125.00\nGrand Total: 125.00`,
  );
  assert.equal(r.kind, "invoice");
  assert.equal(r.data.invoiceNumber, "NEW-777");
  assert.equal(r.data.currency, "EUR");
  assert.equal(r.data.lines[0].sku, "OTHER-99");
  assert.equal(r.data.lines[0].amount, 125);
});
test("calendar dates reject impossible and unsupported formats", () => {
  assert.equal(normalizeDate("31/02/2026"), null);
  assert.equal(normalizeDate("24-SEP-2026"), "2026-09-24");
  assert.equal(normalizeDate("12/09/2026"), "2026-09-12");
  assert.equal(normalizeDate("2026-02-31"), null);
  assert.equal(normalizeDate("2026-13-01"), null);
});
test("related pricing evidence shares one resolution without hiding either check", () => {
  const docs = shipment();
  docs[0].data.lines[0].amount = 180;
  const result = reconcile(docs);
  const group = conflictGroups(result.issues).find(
    (g) => g.id === "invoice-pricing",
  );
  assert.equal(group?.issues.length, 2);
  const reviewed = reconcile(docs, {
    "resolution.invoice-pricing": "Corrected invoice obtained and reviewed.",
  });
  assert(
    !reviewed.issues.some(
      (i) => i.id === "goods-total" || i.id === "math-OTHER-99",
    ),
  );
  assert(reviewed.issues.some((i) => i.id === "hts-OTHER-99"));
  docs[0].data.goodsTotal = 250;
  assert(
    !conflictGroups(reconcile(docs).issues).some(
      (g) => g.id === "invoice-pricing",
    ),
  );
});
test("document-backed defaults are specific, traced and overridable", () => {
  const docs = shipment();
  Object.assign(docs[0].data, {
    portOfLoading: "SHANGHAI, CN",
    portOfDischarge: "TACOMA, WA, USA",
    vessel: "TEST VESSEL",
  });
  docs[0].rawText =
    "SHIP TO / DELIVER TO:\nDESTINATION COMPANY\n10 TEST STREET\nKent, WA 98032\n1 X 20 GP CONTAINER";
  const result = reconcile(docs);
  assert.equal(result.overrides.countryOfExport, "CN");
  assert.equal(result.overrides.unladingPort, "3002");
  assert.equal(result.overrides.modeTransportation, "11");
  assert.equal(result.overrides.stateDestination, "WA");
  assert(result.suggestions?.every((s) => s.sources.length));
  assert(result.xml.includes("<unlading-port>3002</unlading-port>"));
  assert.equal(result.overrides.entryPort, undefined);
  assert.equal(result.overrides.processingPort, undefined);
  assert.equal(result.overrides.importerTaxId, undefined);
  const edited = reconcile(docs, { unladingPort: "2704", countryOfExport: "" });
  assert.equal(edited.overrides.unladingPort, "2704");
  assert(edited.issues.some((i) => i.id === "required-countryOfExport"));
});
test("ambiguous ports, missing export evidence, and truck BOLs are not inferred", () => {
  const docs = shipment();
  Object.assign(docs[0].data, {
    portOfLoading: null,
    portOfDischarge: "PORTLAND",
    vessel: null,
  });
  docs[2].rawText = "BILL OF LADING\nCONTAINER TRANSPORT BY TRUCK";
  const result = reconcile(docs);
  assert.equal(result.overrides.countryOfExport, undefined);
  assert.equal(result.overrides.unladingPort, undefined);
  assert.equal(result.overrides.modeTransportation, undefined);
});
test("packing cells support reordered columns and preserve unfamiliar SKUs", () => {
  const cells = [
    [
      "Style",
      "Total G.W. (kg)",
      "Description",
      "Ctns",
      "Total Pcs",
      "Total N.W. (kg)",
      "Carton No.",
    ],
    ["ZZ-703", "11.25", "MIXED METAL FASTENERS", "3", "1.200", "9.60", "7 - 9"],
    ["YY-22", "5.80", "SAMPLES FOC", "1", "24", "5.10", "10"],
  ];
  const lines = parsePackingTables(
    [{ page: 1, cells, confidence: cells.map((r) => r.map(() => 95)) }],
    "",
  );
  assert.equal(lines.length, 2);
  assert.equal(lines[0].sku, "ZZ-703");
  assert.equal(lines[0].quantity, 1200);
  assert.equal(lines[0].grossWeight, 11.25);
  assert.equal(lines[1].sample, true);
  assert.equal(lines[1].netWeight, 5.1);
});
test("matching carton rows resolve OCR prefixes without confusing real B/8 variants", () => {
  const cells = [
    ["Carton No.", "Style", "Description", "Total Pcs"],
    ["1-2", "NBE-T101", "100% COTTON TEE", "20"],
    ["3-4", "W-B220", "100% POLY BLOUSE", "10"],
  ];
  const lines = parsePackingTables(
    [{ page: 1, cells, confidence: [] }],
    "1-2 NB-T101 TEE\n3-4 W-8220 BLOUSE\nStyle W-B220 buyer-supplied fabric",
  );
  assert.equal(lines[0].sku, "NB-T101");
  assert.equal(lines[1].sku, "W-B220");
});
test("OCR advisories stay visible without being mislabeled as conflicts", () => {
  const docs = shipment();
  docs[1].method = "ocr";
  const issue = reconcile(docs).issues.find((i) => i.id === "ocr-packing_list");
  assert(issue);
  assert.equal(issue.severity, "warning");
  assert.equal(issueCategory(issue), "review");
});
test("empty uploads never produce a ready shipment", () => {
  const r = reconcile([]);
  assert.equal(r.ready, false);
  assert(r.issues.some((i) => i.id === "no-lines"));
  assert(r.issues.some((i) => i.id === "missing-invoice"));
});
test("quantity, fabric, weight and origin conflicts stay visible", () => {
  const docs = shipment();
  const packed = structuredClone(docs[0].data.lines[0]);
  Object.assign(packed, { quantity: 9, material: "TC 65/35 fleece" });
  docs[1].data.lines = [packed];
  docs[0].data.lines[0].material = "60% Cotton 40% Polyester";
  docs[0].data.grossWeight = 100;
  docs[1].data.grossWeight = 90;
  docs[0].data.lines[0].origin = "BD";
  const ids = reconcile(docs).issues.map((i) => i.id);
  for (const id of [
    "qty-OTHER-99",
    "material-OTHER-99",
    "field-grossWeight",
    "origin-OTHER-99",
  ])
    assert(ids.includes(id), id);
});
test("arithmetic and printed subtotal are independent blockers", () => {
  const docs = shipment();
  docs[0].data.lines[0].amount = 180;
  const ids = reconcile(docs).issues.map((i) => i.id);
  assert(ids.includes("math-OTHER-99"));
  assert(ids.includes("goods-total"));
  assert.equal(docs[0].data.lines[0].amount, 180);
});
test("assist and free sample are added once; freight is excluded", () => {
  const docs = shipment();
  docs[0].data.lines[0].assist = 50;
  const sample = emptyLine("SAMPLE-1");
  Object.assign(sample, { sample: true, amount: 4, origin: "BD", quantity: 4 });
  docs[0].data.lines.push(sample);
  const r = reconcile(docs);
  assert.deepEqual(r.valuation, {
    goods: 200,
    assists: 50,
    samples: 4,
    proposed: 254,
    currency: "USD",
  });
  assert(r.xml.includes("<value>250.00</value>"));
  assert(r.xml.includes("<value>4.00</value>"));
});
test("XML escapes arbitrary document content and uses vendor namespace", () => {
  const r = reconcile(shipment());
  assert(r.xml.includes("&amp; &lt;quoted&gt;"));
  assert(r.xml.includes('xmlns="http://www.netchb.com/xml/entry"'));
  assert(!r.xml.includes("<transmit"));
  assert(!r.xml.includes("<precalculated"));
  assert(!r.xml.includes("<line-no>"));
  assert(!r.xml.includes("<tariff-description>"));
});
test("six-digit HS passes some XSD patterns but never satisfies full HTS review", () => {
  const r = reconcile(shipment(), { "resolution.hts-OTHER-99": "approved" });
  assert(r.issues.some((i) => i.id === "hts-OTHER-99"));
});
test("changing one line never overwrites another line’s origin", () => {
  const docs = shipment();
  const second = structuredClone(docs[0].data.lines[0]);
  second.sku = "SECOND-1";
  second.origin = "BD";
  docs[0].data.lines.push(second);
  const r = reconcile(docs, { "line.OTHER-99.origin": "VN" });
  assert.equal(r.shipment.lines[0].origin, "VN");
  assert.equal(r.shipment.lines[1].origin, "BD");
  assert.equal(docs[0].data.lines[0].origin, "CN");
});
test("ETA is not silently exported as actual arrival", () => {
  const docs = shipment();
  docs[0].data.arrivalDate = "2026-10-14";
  assert(!reconcile(docs).xml.includes("<arrival-date>"));
  assert(
    reconcile(docs, { confirmedArrivalDate: "2026-10-15" }).xml.includes(
      "<arrival-date>2026-10-15</arrival-date>",
    ),
  );
});
test("missing required headers fail actual vendor XSD validation", async () => {
  const r = await validateXml(reconcile(shipment()).xml);
  assert(r.available, "Install xmllint to run XSD tests");
  assert.equal(r.valid, false);
  assert(r.errors.some((x) => x.includes("header")));
});
test("a completed synthetic entry validates against actual vendor XSD", async () => {
  const result = reconcile(shipment(), {
    importerTaxId: "12-123456700",
    consigneeTaxId: "98-765432100",
    processingPort: "3002",
    entryPort: "3002",
    entryDate: "2026-10-14",
    entryType: "01",
    bondType: "08",
    suretyCode: "123",
    paymentType: "1",
    locationOfGoods: "W123",
    modeTransportation: "11",
    unladingPort: "3002",
    stateDestination: "WA",
    countryOfExport: "CN",
    relatedParty: "N",
    "line.OTHER-99.hts": "7326908688",
    "line.OTHER-99.manufacturerId": "CNTEST123",
    "line.OTHER-99.quantity1": "10",
    "line.OTHER-99.unit1": "NO",
  });
  const validation = await validateXml(result.xml);
  assert.equal(validation.valid, true, validation.errors.join("\n"));
});
test("actual two-page invoice extracts samples and assist without leaking adjacent rows", async () => {
  const raw = await readPdf(
    await readFile("KBAS-NB-26-0912_Commercial_Invoice.pdf"),
  );
  const r = parseText(raw.text);
  assert.equal(r.data.lines.length, 5);
  assert.equal(r.data.lines[3].assist, 4180);
  assert.equal(r.data.lines[3].sample, false);
  assert.equal(r.data.lines[4].origin, "BD");
  const check = reconcile([doc("invoice", r.data)]);
  assert.equal(check.valuation.proposed, 27079);
  assert(check.issues.some((i) => i.id === "goods-total"));
  assert(check.issues.some((i) => i.id === "math-NB-T101"));
});
