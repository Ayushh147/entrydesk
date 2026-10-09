import {
  emptyData,
  emptyLine,
  type Data,
  type Document,
  type Line,
  type ExtractedTable,
} from "../shared/model.js";
const amount = (s: string | undefined): number | null =>
  s ? Number(s.replace(/[,$()*\s]/g, "")) : null;
const match = (t: string, r: RegExp) => t.match(r)?.[1]?.trim() ?? null;
const number = (t: string, r: RegExp) => amount(match(t, r) ?? undefined);
const money = "[\\d,]+\\.\\d{2}";
export function normalizeDate(input: string | null): string | null {
  if (!input) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(input)) {
    const date = new Date(input);
    return Number.isFinite(date.getTime()) &&
      date.toISOString().slice(0, 10) === input
      ? input
      : null;
  }
  const m = input.match(/^(\d{1,2})[-/ ]([A-Za-z]{3}|\d{1,2})[-/ ](\d{4})$/);
  if (!m) return null;
  const month = /^\d+$/.test(m[2])
    ? Number(m[2])
    : [
        "JAN",
        "FEB",
        "MAR",
        "APR",
        "MAY",
        "JUN",
        "JUL",
        "AUG",
        "SEP",
        "OCT",
        "NOV",
        "DEC",
      ].indexOf(m[2].toUpperCase()) + 1;
  if (month < 1 || month > 12 || Number(m[1]) < 1 || Number(m[1]) > 31)
    return null;
  const result = `${m[3]}-${String(month).padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  return new Date(result).toISOString().slice(0, 10) === result ? result : null;
}
export function country(value: string | null): string | null {
  if (!value) return null;
  const c = value.trim().toUpperCase();
  return (
    (
      {
        VIETNAM: "VN",
        "VIET NAM": "VN",
        BANGLADESH: "BD",
        CHINA: "CN",
        INDIA: "IN",
        "HONG KONG": "HK",
        MEXICO: "MX",
        CANADA: "CA",
        USA: "US",
        "UNITED STATES": "US",
        "UNITED KINGDOM": "GB",
        GERMANY: "DE",
        JAPAN: "JP",
        TAIWAN: "TW",
      } as Record<string, string>
    )[c] ?? (/^[A-Z]{2}$/.test(c) ? c : null)
  );
}
function party(t: string, label: string): string | null {
  const lines = t.split("\n");
  const at = lines.findIndex((l) => new RegExp(label, "i").test(l));
  if (at < 0) return null;
  return lines[at + 1]?.split(/\s{3,}/)[0]?.trim() || null;
}
export function parseText(
  t: string,
  tables: ExtractedTable[] = [],
): { kind: Document["kind"]; data: Data } {
  const d = emptyData();
  const kind: Document["kind"] = /COMMERCIAL\s+INVOICE/i.test(t)
    ? "invoice"
    : /PACKING\s+LIST/i.test(t)
      ? "packing_list"
      : /BILL\s+OF\s+LADING|B\/L\s+No/i.test(t)
        ? "bill_of_lading"
        : "unknown";
  d.invoiceNumber = match(
    t,
    /(?:Invoice\s*(?:No\.?|Number|#)|Ref\.\s*Invoice|INV\s*NO\.?)[\s:]+([^\s]+)/i,
  );
  d.purchaseOrder = match(
    t,
    /(?:Buyer's\s*P\.?O\.?|Buyer\s*P\.?O\.?|P\.?O\.?\s*(?:NO\.?|#))[\s:]+([A-Z0-9/-]+)/i,
  );
  d.currency =
    match(t, /Currency\s*:\s*([A-Z]{3})/i) ??
    (/\bUSD\b/.test(t) ? "USD" : /\bEUR\b/.test(t) ? "EUR" : null);
  d.invoiceDate = normalizeDate(
    match(
      t,
      /Invoice\s*Date\s*:\s*(\d{4}-\d{2}-\d{2}|\d{1,2}[-/ ](?:\d{1,2}|[A-Za-z]{3})[-/ ]\d{4})/i,
    ),
  );
  d.countryOfOrigin = country(
    match(t, /Country\s+of\s+Origin\s*:\s*([A-Z ]+?)(?:\s{2}|\n|$)/i),
  );
  d.portOfLoading = match(t, /Port\s+of\s+Loading\s*:\s*(.+?)(?:\s{3}|\n|$)/i);
  d.portOfDischarge = match(
    t,
    /Port\s+of\s+Discharge\s*:\s*(.+?)(?:\s{3}|\n|$)/i,
  );
  d.incoterms = match(t, /Incoterms\s*:\s*(.+?)(?:\s{3}|\n|$)/i);
  d.houseBill =
    match(t, /B\/L\s*No\.?\s*:\s*([A-Z0-9]+)/i) ??
    match(t, /B\/L No\.?\s*\n\s*([A-Z0-9]+)/i);
  d.masterBill = match(t, /MBL\s*:\s*([A-Z]{4,8}\d{5,})/i);
  d.carrierScac = match(t, /CARRIER\s*:.+?\(([A-Z]{4})[)}]/i);
  d.container = match(t, /\b([A-Z]{4}\s?\d{7})\b/);
  d.seal = match(t, /SEAL\s*:\s*([A-Z0-9]+)/i);
  const vessel = t.match(
    /Vessel\s*\/\s*Voyage\s*:\s*(.+?)\s*\/\s*([A-Z0-9]+)/i,
  );
  if (vessel) {
    d.vessel = vessel[1].trim();
    d.voyage = vessel[2];
  }
  const dates = t.match(/ETD\s*\/\s*ETA\s*:\s*([\w-]+)\s*\/\s*([\w-]+)/i);
  if (dates) {
    d.departureDate = normalizeDate(dates[1]);
    d.arrivalDate = normalizeDate(dates[2]);
  }
  d.packages =
    number(t, /(?:Total\s+Packages|GRAND\s+TOTAL)\s*:?\s*([\d,]+)/i) ??
    number(t, /\b(\d+)\s*\n?\s*CARTONS\b/i);
  d.quantity =
    number(t, /Total\s+Quantity\s*:\s*([\d,]+)/i) ??
    number(t, /GRAND\s+TOTAL\s+[\d,]+\s+([\d,]+)/i);
  d.goodsTotal = number(
    t,
    new RegExp(`TOTAL\\s+FOB\\s+VALUE[^\\n]*?(${money})`, "i"),
  );
  d.invoiceTotal = number(
    t,
    new RegExp(
      `(?:TOTAL\\s+CIF[^\\n]*?|Grand\\s+Total\\s*:?\\s*)(${money})`,
      "i",
    ),
  );
  d.freight = number(t, new RegExp(`Ocean\\s+Freight[^\\n]*?(${money})`, "i"));
  d.insurance = number(
    t,
    new RegExp(`(?:Marine\\s+)?Insurance\\s+Premium[^\\n]*?(${money})`, "i"),
  );
  d.netWeight = number(t, /TOTAL\s+N\.?W\.?\s*:\s*([\d,.]+)/i);
  d.grossWeight =
    number(t, /TOTAL\s+G\.?W\.?\s*:\s*([\d,.]+)/i) ??
    number(t, /([\d,]+\.\d{3})[^\n]*(?:\n[^\n]{0,120})?\bKGS?\b/i);
  d.volume = number(t, /(?:TOTAL\s+MEAS\.?\s*:\s*)?([\d.]+)\s*CBM/i);
  if (kind === "invoice") {
    d.seller =
      t
        .split("\n")
        .map((x) => x.trim())
        .find((x) => /LIMITED|\bLTD\b|CORPORATION/.test(x)) ?? null;
    d.buyer = party(t, "SOLD TO|BILL TO");
    const labelLine = t
      .split("\n")
      .findIndex((x) => /SHIP TO|DELIVER TO/i.test(x));
    if (labelLine >= 0)
      d.consignee =
        t
          .split("\n")
          [labelLine + 1]?.split(/\s{3,}/)[1]
          ?.trim() ?? null;
    const rows = t.split("\n");
    for (let i = 0; i < rows.length; i++) {
      const m = rows[i].match(
        /^\s*\d+\s+([\w-]+)\s+(.+?)\s+(\d{4}\.\d{2}(?:\.\d{2,4})?)\s+([\d,]+)\s+(PCS|PC|EA|KG|KGS|SET|SETS)\s+\(?([\d,.]+)\)?\s*\*?\s+\(?([\d,.]+)\)?\s*$/i,
      );
      if (!m) continue;
      const l = emptyLine(m[1]);
      Object.assign(l, {
        description: m[2].trim(),
        hsCode: m[3],
        quantity: amount(m[4]),
        unit: m[5].toUpperCase(),
        unitPrice: amount(m[6]),
        amount: amount(m[7]),
        origin: d.countryOfOrigin,
      });
      let end = i + 1;
      while (
        end < rows.length &&
        end < i + 7 &&
        !/^\s*\d+\s+[\w-]+\s+/.test(rows[end])
      )
        end++;
      const details = rows.slice(i + 1, end).join(" ");
      l.material = match(
        details,
        /((?:\d+%\s*[A-Za-z]+\s*)+[^\n]*?(?:knitted|woven))/i,
      );
      const origin = match(details, /Origin\s*:\s*([A-Za-z ]+)\)/i);
      if (origin) l.origin = country(origin);
      l.sample = /SAMPLES|NO COMMERCIAL VALUE|FOC/i.test(m[2] + " " + details);
      d.lines.push(l);
    }
    // Link a separately stated assist to the referenced SKU, never spread it across unrelated goods.
    const assist = t.match(
      new RegExp(
        `Style\\s+([\\w-]+):[\\s\\S]*?supplied free of charge[\\s\\S]*?value\\s+USD\\s+(${money})`,
        "i",
      ),
    );
    if (assist) {
      const l = d.lines.find((l) => l.sku === assist[1]);
      if (l) l.assist = amount(assist[2]);
    }
  }
  if (kind === "packing_list") {
    d.manufacturer =
      t
        .split("\n")
        .find((x) => /JOINT\s+STOCK\s+COMPANY/i.test(x))
        ?.trim()
        .replace(/\s+/g, " ") ?? party(t, "SHIPPER");
    const rows = t.split("\n");
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const sku = match(row, /\b([A-Z]{1,4}-[A-Z]?\d{2,5}[A-Z]?)\b/i);
      if (!sku) continue;
      const m = row.match(
        /\b(\d+)\s+(\d+(?:[,.]\d{3})*)\s+(\d+\.\d{2})\s+(\d+\.\d{2})\s+([\d,]+\.\d{2})\s+([\d,]+\.\d{2})\b/,
      );
      if (!m) continue;
      const l = emptyLine(sku.toUpperCase());
      const range = row.match(/(\d+)\s*-\s*(\d+)/);
      Object.assign(l, {
        description: row.slice(0, m.index),
        cartons: range ? Number(range[2]) - Number(range[1]) + 1 : null,
        quantity: Number(m[2].replaceAll(",", "").replaceAll(".", "")),
        netWeight: amount(m[5]),
        grossWeight: amount(m[6]),
        unit: "PCS",
        sample: /SAMPLES|FOC/i.test(row),
      });
      l.material = match(
        rows[i + 1] ?? "",
        /(TC\s*\d+\/\d+[^\n]*|\d+%\s*COTTON[^\n]*|\d+\/\d+\s*COTTON[^\n]*|\d+%\s*POLY[^\n]*)/i,
      );
      const prior = d.lines.findIndex((x) => x.sku === l.sku);
      if (prior >= 0) d.lines[prior] = l;
      else d.lines.push(l);
    }
    const cellLines = parsePackingTables(tables, t);
    if (cellLines.length) d.lines = cellLines;
    for (const table of tables) {
      const at = table.cells.findIndex((r) =>
        r.some((c) => /^style$/i.test(c)),
      );
      if (at < 0) continue;
      const headers = table.cells[at];
      const total = table.cells
        .slice(at + 1)
        .find((r) => /^GRAND|^TOTAL$/i.test(r[0] ?? ""));
      if (!total) continue;
      for (const [key, pattern, integer] of [
        ["quantity", /^total\s*(pcs|pieces|qty)/i, true],
        ["packages", /^ctns|^cartons$/i, true],
        ["netWeight", /^total\s*N[.\s]*W/i, false],
        ["grossWeight", /^total\s*G[.\s]*W/i, false],
      ] as const) {
        const value = cellNumber(
          total[headers.findIndex((c) => pattern.test(c))],
          integer,
        );
        if (value !== null) d[key] = value;
      }
    }
  }
  d.notes = t
    .split("\n")
    .filter((l) =>
      /FOC|NO COMMERCIAL|CMT|supplied free|Bangladesh|TC 65|ISF FILED|hand.carried/i.test(
        l,
      ),
    )
    .map((x) => x.trim());
  return { kind, data: d };
}

export function parsePackingTables(
  tables: ExtractedTable[],
  text: string,
): Line[] {
  const results: Line[] = [];
  for (const table of tables) {
    const headerIndex = table.cells.findIndex(
      (row) =>
        row.some((c) =>
          /^(style|sku|item(?: no)?|part(?: no)?)[.\s]*$/i.test(c),
        ) && row.some((c) => /description/i.test(c)),
    );
    if (headerIndex < 0) continue;
    const headers = table.cells[headerIndex].map((c) =>
      c.replace(/\s+/g, " ").trim(),
    );
    const column = (r: RegExp) => headers.findIndex((c) => r.test(c));
    const skuCol = column(/^(style|sku|item|part)/i),
      descCol = column(/description/i),
      quantityCol = column(
        /^(?:total\s*(?:pcs|pieces|qty|quantity)|quantity|qty)[.\s]*$/i,
      ),
      cartonsCol = column(/^(ctns|cartons|carton count)[.\s]*$/i),
      rangeCol = column(/^carton\s*(no|number)/i),
      nwCol = column(/^total\s*N[.\s]*W|^net\s*weight/i),
      gwCol = column(/^total\s*G[.\s]*W|^gross\s*weight/i);
    if (skuCol < 0 || quantityCol < 0) continue;
    for (const row of table.cells.slice(headerIndex + 1)) {
      let sku = row[skuCol]
        ?.toUpperCase()
        .match(/\b[A-Z0-9]{1,5}[-.][A-Z0-9]{2,12}\b/)?.[0]
        ?.replace(".", "-");
      if (!sku) continue;
      const range = row[rangeCol]?.match(/(\d+)\s*-\s*(\d+)/);
      if (range) {
        const sameCartons = new RegExp(`\\b${range[1]}\\s*-\\s*${range[2]}\\b`);
        const aliases = [
          ...new Set(
            text
              .split("\n")
              .filter((l) => sameCartons.test(l))
              .flatMap(
                (l) =>
                  l
                    .toUpperCase()
                    .match(/\b[A-Z0-9]{1,5}[-.][A-Z0-9]{2,12}\b/g) ?? [],
              )
              .map((s) => s.replace(".", "-"))
              .filter(
                (s) =>
                  ocrIdentity(s) === ocrIdentity(sku!) ||
                  (s.split("-")[1] === sku!.split("-")[1] &&
                    (s.split("-")[0].startsWith(sku!.split("-")[0]) ||
                      sku!.split("-")[0].startsWith(s.split("-")[0]))),
              ),
          ),
        ];
        // A second reading of the same printed carton row can resolve a B/8-style OCR error.
        const printed = new Set(
          text.toUpperCase().match(/\b[A-Z0-9]{1,5}[-.][A-Z0-9]{2,12}\b/g) ??
            [],
        );
        if (!printed.has(sku) && aliases.length === 1) sku = aliases[0];
      }
      const l = emptyLine(sku);
      l.description = row[descCol] ?? null;
      l.material =
        match(l.description ?? "", /(\d+%\s*[A-Z].+)/i) ??
        match(
          l.description ?? "",
          /(TC\s*\d+\/\d+.+|\d+\/\d+\s*(?:COTTON|POLY|WOOL).+)/i,
        );
      if (
        l.material &&
        [...l.material.matchAll(/(\d+)%/g)].some((m) => Number(m[1]) > 100)
      )
        l.material = null;
      l.quantity = cellNumber(row[quantityCol], true);
      l.cartons =
        cellNumber(row[cartonsCol], true) ??
        (range ? Number(range[2]) - Number(range[1]) + 1 : null);
      l.netWeight = cellNumber(row[nwCol]);
      l.grossWeight = cellNumber(row[gwCol]);
      l.unit = "PCS";
      l.sample = /SAMPLES|FOC/i.test(l.description ?? "");
      if (l.quantity === null) continue;
      const previous = results.findIndex((r) => r.sku === l.sku);
      if (previous < 0) results.push(l);
      else results[previous] = l;
    }
  }
  return results;
}
function ocrIdentity(value: string): string {
  return value
    .replace(/[B8]/g, "8")
    .replace(/[O0]/g, "0")
    .replace(/[S5]/g, "5")
    .replace(/[I1]/g, "1");
}
function cellNumber(value: string | undefined, integer = false): number | null {
  const token = value?.match(/\d+(?:[,.]\d+)*\b/)?.[0];
  if (!token) return null;
  if (integer)
    return /^\d+(?:[,.]\d{3})*$/.test(token)
      ? Number(token.replace(/[,.]/g, ""))
      : null;
  const decimal = token.match(/[,.]\d{1,2}$/);
  return decimal
    ? Number(
        token.slice(0, decimal.index).replace(/[,.]/g, "") +
          "." +
          token.slice(decimal.index! + 1),
      )
    : Number(token.replace(/,/g, ""));
}
