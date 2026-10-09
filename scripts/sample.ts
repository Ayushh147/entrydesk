import { mkdir, readFile, writeFile } from "node:fs/promises";
import { extract } from "../server/extract.js";
import { reconcile } from "../server/reconcile.js";
import { validateXml } from "../server/validate.js";
const names = [
  "KBAS-NB-26-0912_Commercial_Invoice.pdf",
  "SPG-PL-2609-117_Packing_List.pdf",
  "BMLVHCM26090418_House_BL.pdf",
];
await mkdir("output", { recursive: true });
const docs = [];
for (const name of names) {
  console.log("Reading", name);
  docs.push(await extract(name, await readFile(name)));
}
const result = reconcile(docs);
result.validation = await validateXml(result.xml);
await writeFile("output/sample-entry-draft.xml", result.xml);
await writeFile("output/sample-review.json", JSON.stringify(result, null, 2));
console.log(
  "Generated output/sample-entry-draft.xml and output/sample-review.json",
);
console.log(
  `Provisional value: ${result.valuation.currency} ${result.valuation.proposed}; ${result.issues.length} unresolved review issues. Schema valid: ${result.validation.valid}.`,
);
