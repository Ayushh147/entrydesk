import { z } from "zod";
const text = z.string().max(4000).nullable();
const num = z.number().finite().nonnegative().nullable();
export const lineSchema = z.object({
  sku: z.string().max(100),
  description: text,
  material: text,
  hsCode: text,
  origin: text,
  quantity: num,
  unit: text,
  unitPrice: num,
  amount: num,
  cartons: num,
  netWeight: num,
  grossWeight: num,
  assist: num,
  sample: z.boolean(),
});
export const dataSchema = z.object({
  invoiceNumber: text,
  invoiceDate: text,
  purchaseOrder: text,
  currency: text,
  seller: text,
  manufacturer: text,
  buyer: text,
  consignee: text,
  countryOfOrigin: text,
  countryOfExport: text,
  portOfLoading: text,
  portOfDischarge: text,
  vessel: text,
  voyage: text,
  houseBill: text,
  masterBill: text,
  carrierScac: text,
  container: text,
  seal: text,
  departureDate: text,
  arrivalDate: text,
  incoterms: text,
  invoiceTotal: num,
  goodsTotal: num,
  freight: num,
  insurance: num,
  packages: num,
  quantity: num,
  netWeight: num,
  grossWeight: num,
  volume: num,
  lines: z.array(lineSchema).max(500),
  notes: z.array(z.string().max(5000)).max(100),
});
export const documentSchema = z.object({
  id: z.string(),
  name: z.string().max(255),
  sha256: z.string(),
  kind: z.enum(["invoice", "packing_list", "bill_of_lading", "unknown"]),
  method: z.enum(["text", "ocr", "ai"]),
  pages: z.number().int().min(1).max(30),
  rawText: z.string().max(400000),
  tables: z
    .array(
      z.object({
        page: z.number().int(),
        cells: z.array(z.array(z.string())),
        confidence: z.array(z.array(z.number())),
      }),
    )
    .optional(),
  data: dataSchema,
});
export type Line = z.infer<typeof lineSchema>;
export type Data = z.infer<typeof dataSchema>;
export type Document = z.infer<typeof documentSchema>;
export type Issue = {
  id: string;
  severity: "blocker" | "warning";
  title: string;
  detail: string;
  action: string;
  sources: string[];
  category?: "conflict" | "missing" | "review";
  group?: string;
};
export type SourceSuggestion = {
  key: string;
  value: string;
  explanation: string;
  sources: string[];
  reference?: string;
};
export type ExtractedTable = NonNullable<Document["tables"]>[number];
export const overridesSchema = z.record(
  z.string().max(200),
  z.string().max(4000),
);
export type Overrides = z.infer<typeof overridesSchema>;
export type Result = {
  documents: Document[];
  shipment: Data;
  issues: Issue[];
  xml: string;
  ready: boolean;
  contractVerified: boolean;
  validation?: { valid: boolean; available: boolean; errors: string[] };
  valuation: {
    goods: number;
    assists: number;
    samples: number;
    proposed: number;
    currency: string | null;
  };
  overrides: Overrides;
  suggestions?: SourceSuggestion[];
};
export function emptyData(): Data {
  return dataSchema.parse(
    Object.fromEntries(
      Object.keys(dataSchema.shape).map((k) => [
        k,
        k === "lines" || k === "notes" ? [] : null,
      ]),
    ),
  );
}
export function emptyLine(sku: string): Line {
  return lineSchema.parse(
    Object.fromEntries(
      Object.keys(lineSchema.shape).map((k) => [
        k,
        k === "sku" ? sku : k === "sample" ? false : null,
      ]),
    ),
  );
}
