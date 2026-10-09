import { PDFDocument, StandardFonts } from "pdf-lib";
import assert from "node:assert/strict";
import { createCanvas } from "@napi-rs/canvas";
import { conflictGroups, issueCategory } from "../shared/review.js";
import { mkdir, writeFile } from "node:fs/promises";
async function pdf(lines: string[]) {
  const d = await PDFDocument.create();
  const p = d.addPage([720, 600]);
  const font = await d.embedFont(StandardFonts.Helvetica);
  lines.forEach((text, i) =>
    p.drawText(text, { x: 30, y: 550 - i * 22, size: 11, font }),
  );
  return await d.save();
}
const invoice = await pdf([
  "ACME METAL EXPORTS LIMITED",
  "COMMERCIAL INVOICE",
  "Invoice Number: ACME-2026-15",
  "Invoice Date: 2026-10-01",
  "Currency: USD",
  "Country of Origin: CHINA",
  "Total Packages: 5 CARTONS",
  "Total Quantity: 20 PCS",
  "1 ACM-999 STEEL BRACKETS 7326.90 20 EA 10.00 200.00",
  "TOTAL FOB VALUE: 200.00",
  "Ocean Freight: 20.00",
  "Marine Insurance Premium: 5.00",
  "Grand Total: 225.00",
]);
const packing = await pdf([
  "PACKING LIST",
  "Ref. Invoice: ACME-2026-15",
  "Total Packages: 5 CARTONS",
  "Total Quantity: 20 PCS",
  "TOTAL N.W.: 10.00 KGS",
  "TOTAL G.W.: 12.00 KGS",
]);
const bl = await pdf([
  "BILL OF LADING",
  "B/L No.: TEST12345678",
  "MBL: TESTCN12345678",
  "CARRIER: TEST LINES (TEST)",
  "Total Packages: 5 CARTONS",
  "12.000 KGS",
]);
const form = new FormData();
form.append(
  "documents",
  new Blob([invoice as BlobPart], { type: "application/pdf" }),
  "different-invoice.pdf",
);
form.append(
  "documents",
  new Blob([packing as BlobPart], { type: "application/pdf" }),
  "different-packing.pdf",
);
form.append(
  "documents",
  new Blob([bl as BlobPart], { type: "application/pdf" }),
  "different-bill.pdf",
);
const response = await fetch("http://127.0.0.1:3001/api/shipments", {
  method: "POST",
  body: form,
});
const result = await response.json();
assert(response.ok, JSON.stringify(result));
assert.equal(result.shipment.invoiceNumber, "ACME-2026-15");
assert.equal(result.shipment.lines[0].sku, "ACM-999");
assert.equal(result.valuation.proposed, 200);
assert(result.xml.includes("<value>200.00</value>"));
assert.equal(result.ready, false);
assert.equal(result.documents.length, 3);
const overrides: Record<string, string> = {
  importerTaxId: "12-123456700",
  consigneeTaxId: "98-765432100",
  processingPort: "3002",
  entryPort: "3002",
  entryDate: "2026-10-09",
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
  "line.ACM-999.hts": "7326908688",
  "line.ACM-999.manufacturerId": "CNTEST123",
  "line.ACM-999.quantity1": "20",
  "line.ACM-999.unit1": "NO",
};
for (const issue of result.issues)
  if (
    !issue.id.startsWith("required-") &&
    !issue.id.startsWith("hts-") &&
    !issue.id.startsWith("mid-") &&
    !issue.id.startsWith("reporting-")
  )
    overrides["resolution." + issue.id] =
      "Synthetic test fixture: all facts verified for test only.";
const reviewedResponse = await fetch("http://127.0.0.1:3001/api/review", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ jobId: result.jobId, overrides }),
});
const reviewed = await reviewedResponse.json();
assert(reviewedResponse.ok, JSON.stringify(reviewed));
assert.equal(
  reviewed.validation.valid,
  true,
  JSON.stringify(reviewed.validation),
);
assert.equal(reviewed.ready, true, JSON.stringify(reviewed.issues));
const badResponse = await fetch("http://127.0.0.1:3001/api/review", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    jobId: result.jobId,
    overrides: { ...overrides, "line.ACM-999.amount": "-10" },
  }),
});
assert.equal(badResponse.status, 400);
const invalid = new FormData();
invalid.append("documents", new Blob(["not PDF"]), "bad.pdf");
const invalidResponse = await fetch("http://127.0.0.1:3001/api/shipments", {
  method: "POST",
  body: invalid,
});
assert.equal(invalidResponse.status, 400);
await mkdir("tmp/integration", { recursive: true });
await writeFile("tmp/integration/other-shipment.xml", reviewed.xml);
console.log(
  "PASS: different PDF shipment -> upload -> correct extraction -> review -> valid vendor XSD -> ready export; negative amounts and invalid PDFs rejected.",
);
// A second, unseen fixture is a raster PDF with a different ruled-table layout.
const image = createCanvas(2000, 1000),
  context = image.getContext("2d");
context.fillStyle = "white";
context.fillRect(0, 0, 2000, 1000);
context.fillStyle = "black";
context.font = "bold 42px Arial";
context.fillText("PACKING LIST", 70, 100);
const table = [
  [
    "Carton No.",
    "Style",
    "Description",
    "Ctns",
    "Pcs/Ctn",
    "Total Pcs",
    "Total N.W. (kg)",
    "Total G.W. (kg)",
  ],
  ["1 - 2", "QQ-451", "STEEL CLIPS", "2", "10", "20", "4.00", "6.00"],
  ["3 - 5", "RR-702", "BRASS FITTINGS", "3", "15", "45", "3.60", "4.50"],
  ["GRAND TOTAL", "", "", "5", "", "65", "7.60", "10.50"],
];
const xs = [70, 280, 460, 960, 1080, 1260, 1460, 1670, 1880],
  ys = [200, 280, 420, 560, 660];
context.strokeStyle = "black";
context.lineWidth = 3;
for (const y of ys) {
  context.beginPath();
  context.moveTo(xs[0], y);
  context.lineTo(xs.at(-1)!, y);
  context.stroke();
}
for (const x of xs) {
  context.beginPath();
  context.moveTo(x, ys[0]);
  context.lineTo(x, ys.at(-1)!);
  context.stroke();
}
context.font = "27px Arial";
for (let r = 0; r < table.length; r++)
  for (let c = 0; c < table[r].length; c++)
    context.fillText(table[r][c], xs[c] + 12, ys[r] + 50);
const scanPdf = await PDFDocument.create(),
  scanImage = await scanPdf.embedPng(image.toBuffer("image/png"));
scanPdf
  .addPage([1000, 500])
  .drawImage(scanImage, { x: 0, y: 0, width: 1000, height: 500 });
const scanInvoice = await pdf([
  "OTHER SUPPLIER LIMITED",
  "COMMERCIAL INVOICE",
  "Invoice Number: GRID-2026-01",
  "Currency: USD",
  "Country of Origin: CHINA",
  "Total Packages: 5 CARTONS",
  "1 QQ-451 STEEL CLIPS 7326.90 20 EA 10.00 200.00",
  "2 RR-702 BRASS FITTINGS 7412.20 45 EA 5.00 225.00",
  "TOTAL FOB VALUE: 425.00",
]);
const scanForm = new FormData();
scanForm.append(
  "documents",
  new Blob([scanInvoice as BlobPart]),
  "grid-invoice.pdf",
);
scanForm.append(
  "documents",
  new Blob([(await scanPdf.save()) as BlobPart]),
  "unseen-scanned-packing.pdf",
);
scanForm.append("documents", new Blob([bl as BlobPart]), "grid-bill.pdf");
const scanResponse = await fetch("http://127.0.0.1:3001/api/shipments", {
  method: "POST",
  body: scanForm,
  signal: AbortSignal.timeout(120000),
});
const scanResult = await scanResponse.json();
assert(scanResponse.ok, JSON.stringify(scanResult));
const scanDoc = scanResult.documents.find(
  (d: { kind: string }) => d.kind === "packing_list",
);
assert.equal(scanDoc.method, "ocr");
assert.deepEqual(
  scanDoc.data.lines.map(
    (l: { sku: string; quantity: number; grossWeight: number }) => [
      l.sku,
      l.quantity,
      l.grossWeight,
    ],
  ),
  [
    ["QQ-451", 20, 6],
    ["RR-702", 45, 4.5],
  ],
);
assert.equal(scanDoc.data.netWeight, 7.6);
assert.equal(scanDoc.data.grossWeight, 10.5);
assert(
  !scanResult.issues.some((i: { id: string }) => i.id.startsWith("table-")),
);
console.log(
  "PASS: unseen scanned packing PDF -> detected grid -> correct styles, quantities, row weights and totals.",
);
const sampleResponse = await fetch("http://127.0.0.1:3001/api/sample", {
  method: "POST",
  signal: AbortSignal.timeout(120000),
});
const sample = await sampleResponse.json();
assert(sampleResponse.ok, JSON.stringify(sample));
assert.equal(sample.valuation.proposed, 27079);
const pack = sample.documents.find(
  (d: { kind: string }) => d.kind === "packing_list",
);
assert.deepEqual(
  pack.data.lines.map(
    (l: {
      sku: string;
      quantity: number;
      netWeight: number;
      grossWeight: number;
    }) => [l.sku, l.quantity, l.netWeight, l.grossWeight],
  ),
  [
    ["NB-T101", 2400, 432, 480],
    ["NB-H205", 1176, 715.4, 774.2],
    ["NB-C330", 900, 486, 522],
    ["W-B220", 600, 96, 106],
    ["NB-P118S", 24, 5.1, 5.8],
  ],
);
assert.equal(conflictGroups(sample.issues).length, 4);
assert.equal(
  sample.issues.filter(
    (i: Parameters<typeof issueCategory>[0]) => issueCategory(i) === "missing",
  ).length,
  26,
);
assert(!sample.issues.some((i: { id: string }) => i.id.startsWith("table-")));
assert.equal(sample.overrides.countryOfExport, "VN");
assert.equal(sample.overrides.unladingPort, "3002");
assert.equal(sample.overrides.modeTransportation, "11");
assert.equal(sample.overrides.stateDestination, "WA");
assert.equal(
  sample.documents.find((d: { kind: string }) => d.kind === "bill_of_lading")
    .data.grossWeight,
  1930,
);
for (const id of [
  "goods-total",
  "math-NB-T101",
  "qty-NB-H205",
  "material-NB-H205",
  "field-grossWeight",
  "assist-W-B220",
  "sample-NB-P118S",
  "origin-NB-P118S",
])
  assert(
    sample.issues.some((i: { id: string }) => i.id === id),
    id,
  );
console.log(
  "PASS: supplied shipment identifies arithmetic, subtotal, quantity, material, gross weight, assist, sample and origin issues.",
);
