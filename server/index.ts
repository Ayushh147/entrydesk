import "dotenv/config";
import express from "express";
import multer from "multer";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { dataSchema, overridesSchema, type Document } from "../shared/model.js";
import { extract } from "./extract.js";
import { reconcile } from "./reconcile.js";
import { validateXml } from "./validate.js";
export const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "2mb" }));
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 8, fields: 2 },
});
const jobs = new Map<string, { documents: Document[]; created: number }>();
let busy = false;
app.get("/api/health", (_req, res) =>
  res.json({
    status: "ok",
    aiConfigured: Boolean(process.env.OPENAI_API_KEY),
    contract: "NetCHB entry.xsd",
    localOCR: true,
  }),
);
async function analyze(
  files: { name: string; buffer: Buffer }[],
  useAI = false,
) {
  if (busy)
    throw Object.assign(
      new Error("Another extraction is in progress. Please retry shortly."),
      { status: 429 },
    );
  if (files.reduce((s, f) => s + f.buffer.length, 0) > 30 * 1024 * 1024)
    throw new Error("Shipment upload exceeds the 30 MB total limit.");
  busy = true;
  const documents: Document[] = [];
  try {
    for (const f of files) {
      const d = await extract(f.name, f.buffer, useAI);
      if (!documents.some((x) => x.sha256 === d.sha256)) documents.push(d);
    }
  } finally {
    busy = false;
  }
  for (const [id, job] of jobs)
    if (Date.now() - job.created > 30 * 60 * 1000) jobs.delete(id);
  if (jobs.size >= 15) jobs.delete(jobs.keys().next().value!);
  const jobId = randomUUID();
  jobs.set(jobId, { documents, created: Date.now() });
  const result = reconcile(documents);
  result.validation = await validateXml(result.xml);
  return { jobId, ...result };
}
app.post("/api/shipments", upload.array("documents", 8), async (req, res) => {
  const files = req.files as Express.Multer.File[] | undefined;
  if (!files?.length) {
    res.status(400).json({ error: "Upload at least one PDF." });
    return;
  }
  const result = await analyze(
    files.map((f) => ({
      name: path.basename(f.originalname),
      buffer: f.buffer,
    })),
    req.body?.mode === "ai",
  );
  res.json(result);
});
app.post("/api/sample", async (_req, res) => {
  const names = [
    "KBAS-NB-26-0912_Commercial_Invoice.pdf",
    "SPG-PL-2609-117_Packing_List.pdf",
    "BMLVHCM26090418_House_BL.pdf",
  ];
  const files = await Promise.all(
    names.map(async (name) => ({ name, buffer: await readFile(name) })),
  );
  res.json(await analyze(files));
});
app.get("/api/sample-files/:name", (req, res) => {
  const allowed = [
    "KBAS-NB-26-0912_Commercial_Invoice.pdf",
    "SPG-PL-2609-117_Packing_List.pdf",
    "BMLVHCM26090418_House_BL.pdf",
  ];
  if (!allowed.includes(req.params.name)) {
    res.status(404).json({ error: "Document not found." });
    return;
  }
  res.sendFile(path.resolve(req.params.name));
});
const reviewSchema = z.object({
  jobId: z.string().uuid(),
  overrides: overridesSchema,
  corrections: z
    .array(
      z.object({
        id: z.string(),
        kind: z.enum(["invoice", "packing_list", "bill_of_lading", "unknown"]),
        data: dataSchema,
      }),
    )
    .max(8)
    .optional(),
});
app.post("/api/review", async (req, res) => {
  const { jobId, overrides, corrections } = reviewSchema.parse(req.body);
  const job = jobs.get(jobId);
  if (!job || Date.now() - job.created > 30 * 60 * 1000) {
    res
      .status(404)
      .json({ error: "Review session expired. Upload the PDFs again." });
    return;
  }
  for (const [key, value] of Object.entries(overrides)) {
    if (!value.trim()) continue;
    if (
      /^(grossWeight|netWeight|packages|quantity|invoiceTotal|goodsTotal|freight|insurance|volume)$|^line\..+\.(quantity|unitPrice|amount|assist|netWeight|grossWeight|cartons|quantity[123])$/.test(
        key,
      ) &&
      (!Number.isFinite(Number(value)) || Number(value) < 0)
    )
      throw new Error(`${key} must be a nonnegative number.`);
  }
  const documents = job.documents.map((d) => {
    const c = corrections?.find((c) => c.id === d.id);
    return c ? { ...d, kind: c.kind, data: c.data } : d;
  });
  const result = reconcile(documents, overrides);
  result.validation = await validateXml(result.xml);
  result.ready =
    result.validation.valid &&
    !result.issues.some((i) => i.severity === "blocker");
  res.json({ jobId, ...result, originalDocuments: job.documents });
});
app.use(express.static("dist"));
app.get("/{*path}", (_req, res) =>
  res.sendFile(path.resolve("dist/index.html")),
);
app.use(
  (
    err: unknown,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction,
  ) => {
    if (err instanceof z.ZodError) {
      res
        .status(400)
        .json({ error: "Invalid review data.", details: err.issues });
      return;
    }
    const e = err as Error & { status?: number };
    // Avoid returning upstream SDK details, request payloads or secrets.
    const message = /api key|authorization|authentication/i.test(e.message)
      ? "AI authentication failed. Check server configuration."
      : e.message;
    res
      .status(e.status ?? 400)
      .json({ error: message ?? "Unable to process shipment." });
  },
);
if (process.env.NODE_ENV !== "test")
  app.listen(Number(process.env.PORT ?? 3001), "127.0.0.1", () =>
    console.log(
      "Entrydesk API listening on http://127.0.0.1:" +
        (process.env.PORT ?? 3001),
    ),
  );
