import { XMLBuilder } from "fast-xml-parser";
import type { Result } from "../shared/model.js";
export function generateXml(result: Result): string {
  const d = result.shipment,
    o = result.overrides;
  const h: Record<string, unknown> = {};
  const mappings: Record<string, string> = {
    importerTaxId: "importer-tax-id",
    processingPort: "processing-port",
    entryPort: "entry-port",
    entryDate: "entry-date",
    entryType: "entry-type",
    bondType: "bond-type",
    suretyCode: "surety-code",
    paymentType: "payment-type",
    statementDate: "statement-date",
    modeTransportation: "mode-transportation",
    unladingPort: "unlading-port",
    locationOfGoods: "location-of-goods",
    stateDestination: "state-destination",
    bondProducerAccountNo: "bond-producer-account-no",
    bondAmount: "bond-amount",
  };
  for (const [key, tag] of Object.entries(mappings))
    if (o[key]) h[tag] = o[key];
  // Party names belong to account trade-partner profiles, never synthesize IDs from addresses.
  if (o.consigneeTaxId)
    h["ultimate-consignee"] = { "tax-id": o.consigneeTaxId };
  if (d.freight !== null || d.insurance !== null)
    h.charges = Math.round((d.freight ?? 0) + (d.insurance ?? 0));
  if (d.grossWeight !== null) h["gross-weight"] = Math.round(d.grossWeight);
  if (d.vessel) h["vessel-name"] = d.vessel;
  if (d.voyage) h["voyage-no"] = d.voyage;
  if (d.carrierScac) h["carrier-code"] = d.carrierScac;
  if (d.purchaseOrder) h["customer-reference-no"] = d.purchaseOrder;
  // ETA is displayed for review; arrival-date is exported only after explicit confirmation.
  if (o.confirmedArrivalDate) h["arrival-date"] = o.confirmedArrivalDate;
  const manifest: Record<string, unknown> = {};
  if (d.packages !== null)
    manifest["bill-of-lading"] = {
      ...(d.masterBill ? { "master-bill": d.masterBill } : {}),
      ...(o.masterScac ? { "master-scac": o.masterScac } : {}),
      ...(d.houseBill ? { "house-bill": d.houseBill } : {}),
      ...(o.houseScac ? { "house-scac": o.houseScac } : {}),
      quantity: d.packages,
      unit: o.manifestUnit || "CTN",
    };
  const invoiceNo = o.invoiceNumberXml ?? d.invoiceNumber?.replaceAll("/", "-");
  const invoice: Record<string, unknown> = {
    ...(invoiceNo ? { "invoice-no": invoiceNo } : {}),
    "line-items": {
      "line-item": d.lines.map((l) => {
        const prefix = `line.${l.sku}.`;
        const tariff: Record<string, unknown> = {};
        const hts = (o[prefix + "hts"] ?? l.hsCode ?? "").replaceAll(".", "");
        if (hts) tariff["tariff-no"] = hts;
        // NetCHB tariff values are USD. Keep non-USD amounts in review evidence until converted.
        if (l.amount !== null && d.currency === "USD")
          tariff.value = (l.amount + (l.assist ?? 0)).toFixed(2);
        for (const n of [1, 2, 3]) {
          if (o[prefix + `quantity${n}`])
            tariff[`quantity${n}`] = o[prefix + `quantity${n}`];
          if (o[prefix + `unit${n}`])
            tariff[`unit-of-measure${n}`] = o[prefix + `unit${n}`];
        }
        return {
          ...(d.departureDate ? { "export-date": d.departureDate } : {}),
          ...(l.origin ? { "country-origin": l.origin } : {}),
          ...(o[prefix + "manufacturerId"]
            ? { "manufacturer-id": o[prefix + "manufacturerId"] }
            : {}),
          ...(o.relatedParty ? { "related-party": o.relatedParty } : {}),
          tariffs: { tariff },
          ...(o.countryOfExport ? { "country-export": o.countryOfExport } : {}),
          ...(l.grossWeight !== null
            ? { "gross-weight": Math.round(l.grossWeight) }
            : {}),
          "commercial-description": `${l.sku}: ${l.description ?? ""}${l.material ? "; " + l.material : ""}`,
          ...(l.quantity !== null ? { "invoice-quantity": l.quantity } : {}),
          "part-number": l.sku,
        };
      }),
    },
  };
  const entry = {
    "@_xmlns": "http://www.netchb.com/xml/entry",
    "@_xmlns:xsi": "http://www.w3.org/2001/XMLSchema-instance",
    "@_xsi:schemaLocation":
      "http://www.netchb.com/xml/entry https://www.netchb.com/xml/entry/entry.xsd",
    "entry-no": { "system-generated": "" },
    ...(d.invoiceNumber
      ? { "external-reference-number": d.invoiceNumber }
      : {}),
    header: h,
    manifest,
    invoices: { invoice },
  };
  const note = result.issues.some((i) => i.severity === "blocker")
    ? "DRAFT - unresolved issues remain. Some required fields are omitted; six-digit HS codes are not full US classifications."
    : "Broker-reviewed draft. Validate in NetCHB; schema validation does not establish CBP acceptance.";
  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n<!-- ${note} No automatic customs transmission is requested. -->\n` +
    new XMLBuilder({
      ignoreAttributes: false,
      format: true,
      suppressEmptyNode: true,
    }).build({ entry })
  );
}
