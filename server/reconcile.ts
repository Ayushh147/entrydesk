import {
  emptyData,
  type Data,
  type Document,
  type Issue,
  type Overrides,
  type Result,
} from "../shared/model.js";
import { generateXml } from "./xml.js";
import { suggestFields } from "./suggestions.js";
import { issueCategory } from "../shared/review.js";
const cents = (n: number) => Math.round(n * 100);
const money = (n: number) => n.toFixed(2);
export function reconcile(
  documents: Document[],
  userOverrides: Overrides = {},
): Result {
  const shipment = emptyData();
  const issues: Issue[] = [];
  let overrides = { ...userOverrides };
  const add = (
    id: string,
    title: string,
    detail: string,
    action: string,
    sources: string[] = [],
    severity: Issue["severity"] = "blocker",
    group?: string,
  ) => {
    if (
      !overrides[`resolution.${id}`]?.trim() &&
      !(group && overrides[`resolution.${group}`]?.trim())
    )
      issues.push({
        id,
        title,
        detail,
        action,
        sources,
        severity,
        ...(group ? { group } : {}),
      });
  };
  const invoices = documents.filter((d) => d.kind === "invoice");
  const packing = documents.filter((d) => d.kind === "packing_list");
  const bills = documents.filter((d) => d.kind === "bill_of_lading");
  for (const kind of ["invoice", "packing_list", "bill_of_lading"] as const)
    if (!documents.some((d) => d.kind === kind))
      issues.push({
        id: `missing-${kind}`,
        title: `Missing ${kind.replaceAll("_", " ")}`,
        detail: "This document type was not recognized in the upload.",
        action:
          "Upload this document or correct its extracted document type in a future extraction pass.",
        severity: "blocker",
        sources: [],
      });
  if (invoices.length !== 1)
    issues.push({
      id: "invoice-count",
      title: "A single shipment invoice is required",
      detail: `Found ${invoices.length} invoices. Multi-invoice grouping is not implemented.`,
      action: "Upload one invoice with its packing list and bill of lading.",
      severity: "blocker",
      sources: invoices.map((d) => d.name),
    });
  for (const d of documents) {
    if (d.kind === "unknown")
      add(
        `unknown-${d.id}`,
        "Unrecognized document",
        d.name,
        "Inspect extracted text and check the shipment documents.",
        [d.name],
      );
    if (d.method === "ocr")
      add(
        `ocr-${d.id}`,
        "Verify scanned document",
        "OCR can misread digits, handwritten edits and table columns.",
        "Compare the source PDF with extracted evidence, especially identifiers and row totals.",
        [d.name],
        "warning",
      );
  }
  const ordered = [...invoices, ...bills, ...packing];
  for (const key of Object.keys(shipment) as (keyof Data)[]) {
    if (key === "lines" || key === "notes") continue;
    const observations = ordered
      .filter((d) => d.data[key] !== null)
      .map((d) => ({ value: d.data[key], name: d.name }));
    const unique = new Set(observations.map((v) => JSON.stringify(v.value)));
    (shipment as Record<string, unknown>)[key] = observations[0]?.value ?? null;
    if (unique.size > 1)
      add(
        `field-${key}`,
        `${key.replace(/([A-Z])/g, " $1")} differs across documents`,
        observations.map((v) => `${v.name}: ${v.value}`).join("; "),
        "Obtain confirmation and enter the corrected value. Record your resolution.",
        observations.map((v) => v.name),
      );
  }
  shipment.lines = structuredClone(invoices[0]?.data.lines ?? []);
  shipment.notes = documents.flatMap((d) => d.data.notes);
  const suggestions = suggestFields(documents, shipment);
  overrides = {
    ...Object.fromEntries(suggestions.map((s) => [s.key, s.value])),
    ...userOverrides,
  };
  const printedGoods =
    shipment.lines
      .filter((l) => !l.sample)
      .reduce((sum, l) => sum + cents(l.amount ?? 0), 0) / 100;
  const arithmeticErrors = shipment.lines.filter(
    (l) =>
      l.quantity !== null &&
      l.unitPrice !== null &&
      l.amount !== null &&
      cents(l.quantity * l.unitPrice) !== cents(l.amount),
  );
  const singleError =
    arithmeticErrors.length === 1 ? arithmeticErrors[0] : undefined;
  const pricingGroup =
    singleError &&
    shipment.goodsTotal !== null &&
    cents(shipment.goodsTotal - printedGoods) ===
      cents(
        singleError.quantity! * singleError.unitPrice! - singleError.amount!,
      )
      ? "invoice-pricing"
      : undefined;
  if (
    shipment.goodsTotal !== null &&
    cents(printedGoods) !== cents(shipment.goodsTotal)
  )
    add(
      "goods-total",
      "Invoice subtotal does not match line amounts",
      `Commercial line amounts total ${money(printedGoods)}; printed goods subtotal is ${money(shipment.goodsTotal)}. Difference: ${money(shipment.goodsTotal - printedGoods)}.`,
      "Request a corrected invoice. The valuation bridge uses stated line amounts until confirmed.",
      invoices.map((d) => d.name),
      "blocker",
      pricingGroup,
    );
  if (
    shipment.goodsTotal !== null &&
    shipment.invoiceTotal !== null &&
    cents(
      shipment.goodsTotal + (shipment.freight ?? 0) + (shipment.insurance ?? 0),
    ) !== cents(shipment.invoiceTotal)
  )
    add(
      "cif-total",
      "Invoice total does not reconcile",
      "Goods subtotal plus freight and insurance does not match the invoice total.",
      "Confirm corrected subtotal, charges and invoice total.",
      invoices.map((d) => d.name),
    );
  if (shipment.lines.length === 0)
    issues.push({
      id: "no-lines",
      severity: "blocker",
      title: "No invoice lines extracted",
      detail: "The local parser could not recognize the invoice table.",
      action:
        "Use optional AI extraction or the JSON editor to enter and verify invoice lines.",
      sources: invoices.map((d) => d.name),
    });
  for (const line of shipment.lines) {
    const peers = packing.flatMap((d) =>
      d.data.lines
        .filter((l) => l.sku.toUpperCase() === line.sku.toUpperCase())
        .map((l) => ({ line: l, name: d.name })),
    );
    for (const peer of peers) {
      if (peer.line.quantity !== null && peer.line.quantity !== line.quantity)
        add(
          `qty-${line.sku}`,
          `${line.sku}: quantity conflict`,
          `Invoice: ${line.quantity}; packing list: ${peer.line.quantity}.`,
          "Confirm actual shipped quantity and corrected invoice amount; enter reviewed quantity and value.",
          [invoices[0].name, peer.name],
        );
      for (const field of ["cartons", "netWeight", "grossWeight"] as const)
        if (line[field] === null) line[field] = peer.line[field];
      if (line.material && peer.line.material) {
        const a = line.material
          .match(/\d+%/g)
          ?.map((x) => Number(x.replace("%", "")));
        const b = peer.line.material.match(/(?:TC\s*)?(\d+)\/(\d+)/i);
        if (a && b && a.join("/") !== `${b[1]}/${b[2]}`)
          add(
            `material-${line.sku}`,
            `${line.sku}: fabric composition conflict`,
            `Invoice: ${line.material}; packing list: ${peer.line.material}.`,
            "Get factory confirmation of fiber content before HTS classification.",
            [invoices[0].name, peer.name],
          );
      }
    }
    if (
      line.quantity !== null &&
      line.unitPrice !== null &&
      line.amount !== null &&
      cents(line.quantity * line.unitPrice) !== cents(line.amount)
    )
      add(
        `math-${line.sku}`,
        `${line.sku}: invoice arithmetic conflict`,
        `${line.quantity} × ${line.unitPrice} = ${money(line.quantity * line.unitPrice)}, but stated amount is ${money(line.amount)}.`,
        "Request a corrected invoice; do not silently replace the price or amount.",
        invoices.map((d) => d.name),
        "blocker",
        pricingGroup && singleError?.sku === line.sku
          ? pricingGroup
          : undefined,
      );
    if ((line.assist ?? 0) > 0)
      add(
        `assist-${line.sku}`,
        `${line.sku}: buyer-supplied assist`,
        `${money(line.assist!)} of buyer-supplied materials is excluded from the invoice. The proposed value adds it to this line.`,
        "Confirm assist cost, transport to factory, and allocation to this shipment.",
        invoices.map((d) => d.name),
      );
    if (line.sample)
      add(
        `sample-${line.sku}`,
        `${line.sku}: free samples need valuation`,
        `The document states a customs-only amount of ${line.amount ?? "unknown"} and origin ${line.origin ?? "unknown"}.`,
        "Confirm valuation basis and actual manufacturer; free of charge does not mean zero customs value.",
        documents
          .filter((d) => d.data.notes.some((n) => /sample/i.test(n)))
          .map((d) => d.name),
      );
    if (
      line.origin &&
      shipment.countryOfOrigin &&
      line.origin !== shipment.countryOfOrigin
    )
      add(
        `origin-${line.sku}`,
        `${line.sku}: different country of origin`,
        `Line origin is ${line.origin}; blanket shipment origin is ${shipment.countryOfOrigin}. The XML preserves line origin.`,
        "Confirm line-specific origin and marking; do not use the blanket declaration.",
        invoices.map((d) => d.name),
      );
    const prefix = `line.${line.sku}.`;
    for (const k of [
      "quantity",
      "unitPrice",
      "amount",
      "assist",
      "netWeight",
      "grossWeight",
      "cartons",
    ] as const)
      if (overrides[prefix + k]?.trim())
        line[k] = Number(overrides[prefix + k]);
    for (const k of ["origin", "material", "description"] as const)
      if (overrides[prefix + k]?.trim()) line[k] = overrides[prefix + k];
    const hts = (overrides[prefix + "hts"] ?? line.hsCode ?? "").replaceAll(
      ".",
      "",
    );
    if (!/^\d{10}$/.test(hts))
      issues.push({
        id: `hts-${line.sku}`,
        title: `${line.sku}: full US HTS required`,
        detail: `Document HS: ${line.hsCode ?? "not supplied"}. No 10-digit classification is assumed.`,
        action:
          "Enter a broker-reviewed 10-digit HTS and its reporting quantities/units.",
        severity: "blocker",
        sources: invoices.map((d) => d.name),
      });
    if (!line.origin)
      issues.push({
        id: `origin-missing-${line.sku}`,
        title: `${line.sku}: origin missing`,
        detail: "No origin was extracted.",
        action: "Enter a confirmed two-letter country code.",
        severity: "blocker",
        sources: [],
      });
    if (line.amount === null)
      issues.push({
        id: `value-missing-${line.sku}`,
        title: `${line.sku}: value missing`,
        detail: "No line value was extracted.",
        action: "Enter confirmed line value.",
        severity: "blocker",
        sources: [],
      });
    if (!overrides[prefix + "manufacturerId"])
      issues.push({
        id: `mid-${line.sku}`,
        title: `${line.sku}: manufacturer ID required`,
        detail:
          "The seller and factory may differ; no manufacturer ID is fabricated.",
        action: "Enter the actual producer’s CBP manufacturer ID.",
        sources: packing.map((d) => d.name),
        severity: "blocker",
      });
    if (!overrides[prefix + "quantity1"] || !overrides[prefix + "unit1"])
      issues.push({
        id: `reporting-${line.sku}`,
        title: `${line.sku}: tariff reporting quantities needed`,
        detail:
          "Invoice pieces are not automatically used as HTS reporting units.",
        action:
          "Enter the classified tariff’s first reporting quantity/unit and additional quantities where required.",
        sources: [],
        severity: "blocker",
      });
  }
  for (const d of packing)
    if (
      shipment.lines.some(
        (l) =>
          !d.data.lines.some(
            (p) => p.sku.toUpperCase() === l.sku.toUpperCase(),
          ),
      )
    )
      add(
        `table-${d.id}`,
        "Packing table extraction needs review",
        `Read ${d.data.lines.length} packing rows for ${shipment.lines.length} invoice lines.`,
        "Review the source table and enter missing row quantities/weights in extracted data.",
        [d.name],
      );
  for (const [key, value] of Object.entries(overrides))
    if (
      Object.hasOwn(shipment, key) &&
      key !== "lines" &&
      key !== "notes" &&
      value.trim()
    ) {
      const numeric = [
        "invoiceTotal",
        "goodsTotal",
        "freight",
        "insurance",
        "packages",
        "quantity",
        "netWeight",
        "grossWeight",
        "volume",
      ];
      (shipment as Record<string, unknown>)[key] = numeric.includes(key)
        ? Number(value)
        : value;
    }
  const required: Record<string, string> = {
    importerTaxId: "Importer tax ID",
    consigneeTaxId: "Ultimate consignee tax ID",
    processingPort: "Processing port",
    entryPort: "Entry port",
    entryDate: "Entry date",
    entryType: "Entry type",
    bondType: "Bond type",
    suretyCode: "Surety code",
    paymentType: "Payment type",
    locationOfGoods: "FIRMS location",
    modeTransportation: "Mode of transportation",
    unladingPort: "Unlading port",
    countryOfExport: "Country of export",
    stateDestination: "State of destination",
    relatedParty: "Related-party determination",
  };
  for (const [key, label] of Object.entries(required))
    if (!overrides[key]?.trim())
      issues.push({
        id: `required-${key}`,
        title: `${label} needed`,
        detail:
          "This operational filing information is absent from the source documents.",
        action: `Enter ${label.toLowerCase()} from the broker/importer.`,
        severity: "blocker",
        sources: [],
      });
  if (overrides.bondType === "09" && !overrides.bondProducerAccountNo?.trim())
    issues.push({
      id: "required-bondProducerAccountNo",
      title: "Single-transaction bond account needed",
      detail:
        "NetCHB requires the bond producer account number for bond type 09.",
      action: "Obtain the bond producer account number from the broker/surety.",
      severity: "blocker",
      sources: [],
    });
  if (
    overrides.paymentType &&
    overrides.paymentType !== "1" &&
    !overrides.statementDate
  )
    issues.push({
      id: "statement-date",
      title: "Statement date required",
      detail: "Payment type is not 1.",
      action: "Enter the broker statement date.",
      severity: "blocker",
      sources: [],
    });
  add(
    "broker-review",
    "Broker compliance review",
    "Duty rates, Chapter 99 remedies, PGA requirements, bond/POA and ISF status are not established by these documents.",
    "Verify current requirements on the actual entry date and review all classifications, quantities, valuation and parties.",
  );
  if (shipment.currency !== "USD")
    add(
      "currency",
      "USD valuation required",
      `Invoice currency: ${shipment.currency ?? "unknown"}.`,
      "Confirm the applicable CBP exchange rate and supply USD line values.",
    );
  if (shipment.freight !== null || shipment.insurance !== null)
    add(
      "freight-proof",
      "Verify actual freight and insurance costs",
      `Excluded from proposed goods value: freight ${shipment.freight ?? 0}, insurance ${shipment.insurance ?? 0}.`,
      "Obtain actual carrier/insurance cost evidence supporting these exclusions.",
      invoices.map((d) => d.name),
    );
  const goods = shipment.lines
    .filter((l) => !l.sample)
    .reduce((a, l) => a + (l.amount ?? 0), 0);
  const samples = shipment.lines
    .filter((l) => l.sample)
    .reduce((a, l) => a + (l.amount ?? 0), 0);
  const assists = shipment.lines.reduce((a, l) => a + (l.assist ?? 0), 0);
  const result: Result = {
    documents,
    shipment,
    issues,
    overrides,
    suggestions,
    valuation: {
      goods,
      assists,
      samples,
      proposed: (cents(goods) + cents(assists) + cents(samples)) / 100,
      currency: shipment.currency,
    },
    xml: "",
    ready: false,
    contractVerified: true,
  };
  result.issues = result.issues.map((i) => ({
    ...i,
    category: issueCategory(i),
  }));
  result.xml = generateXml(result);
  return result;
}
