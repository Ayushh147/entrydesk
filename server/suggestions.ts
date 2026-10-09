import { readFileSync } from "node:fs";
import { country } from "./parser.js";
import type { Data, Document, SourceSuggestion } from "../shared/model.js";
const ports = JSON.parse(
  readFileSync(
    new URL("../docs/reference/ports.json", import.meta.url),
    "utf8",
  ),
) as { source: string; ports: { name: string; code: string }[] };
const normalized = (s: string) =>
  s
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .trim();
export function suggestFields(
  documents: Document[],
  shipment: Data,
): SourceSuggestion[] {
  const suggestions: SourceSuggestion[] = [];
  const add = (
    key: string,
    value: string,
    explanation: string,
    sources: string[],
    reference?: string,
  ) =>
    suggestions.push({
      key,
      value,
      explanation,
      sources,
      ...(reference ? { reference } : {}),
    });
  const loading = documents.filter((d) => d.data.portOfLoading);
  const exportCountries = [
    ...new Set(
      loading
        .map((d) => country(d.data.portOfLoading!.split(",").at(-1)!.trim()))
        .filter((s): s is string => !!s),
    ),
  ];
  if (exportCountries.length === 1)
    add(
      "countryOfExport",
      exportCountries[0],
      "Country code printed in the port-of-loading address. This is separate from each item’s manufacturing origin.",
      loading.map((d) => d.name),
    );
  const discharge = documents.find((d) => d.data.portOfDischarge);
  if (discharge) {
    const name = normalized(discharge.data.portOfDischarge!);
    const matches = ports.ports.filter((p) => {
      const n = normalized(p.name);
      return name === n || name.startsWith(n + " ");
    });
    if (matches.length === 1)
      add(
        "unladingPort",
        matches[0].code,
        `${discharge.data.portOfDischarge} maps to ${matches[0].name} in the official Schedule D port directory. Entry and processing ports remain broker decisions.`,
        [discharge.name],
        ports.source,
      );
  }
  const vesselDocs = documents.filter((d) => d.data.vessel);
  const containerDocs = documents.filter((d) =>
    /\bCONTAINER|\b20['’°]?\s*GP|\b40['’°]?\s*HC/i.test(d.rawText),
  );
  if (vesselDocs.length && containerDocs.length)
    add(
      "modeTransportation",
      "11",
      "The transport documents describe an ocean vessel and containerized cargo.",
      [...new Set([...vesselDocs, ...containerDocs].map((d) => d.name))],
      "https://www.cbp.gov/sites/default/files/2024-11/ACE%20CATAIR%20Appendix%20B_15Oct2024_508_0.pdf",
    );
  const invoice = documents.find((d) => d.kind === "invoice");
  if (invoice) {
    const lines = invoice.rawText.split("\n"),
      at = lines.findIndex((l) => /SHIP TO|DELIVER TO/i.test(l));
    if (at >= 0) {
      const states = lines
        .slice(at + 1, at + 5)
        .map((l) =>
          l
            .trim()
            .split(/\s{2,}/)
            .at(-1)!,
        )
        .flatMap((l) =>
          [...l.matchAll(/\b([A-Z]{2})\s+\d{5}(?:-\d{4})?\b/g)].map(
            (m) => m[1],
          ),
        );
      const unique = [...new Set(states)];
      if (unique.length === 1)
        add(
          "stateDestination",
          unique[0],
          "State in the invoice’s ship-to address, rather than the buyer’s billing address.",
          [invoice.name],
        );
    }
  }
  return suggestions;
}
