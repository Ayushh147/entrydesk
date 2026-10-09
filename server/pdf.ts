import { createCanvas, DOMMatrix, ImageData, Path2D } from "@napi-rs/canvas";
import { createWorker, PSM } from "tesseract.js";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { readGrid } from "./table-ocr.js";
import type { ExtractedTable } from "../shared/model.js";

Object.assign(globalThis, { DOMMatrix, ImageData, Path2D });

// Use bundled English language data; extraction never requires an external service.
export async function readPdf(buffer: Buffer): Promise<{
  text: string;
  pages: number;
  ocr: boolean;
  tables: ExtractedTable[];
}> {
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const task = getDocument({
    data: new Uint8Array(buffer),
    useSystemFonts: true,
  });
  const pdf = await task.promise;
  let worker: Awaited<ReturnType<typeof createWorker>> | undefined;
  let ocr = false;
  const texts: string[] = [];
  const tables: ExtractedTable[] = [];
  try {
    if (pdf.numPages > 30)
      throw new Error("Use PDFs with at most 30 pages each.");
    for (let n = 1; n <= pdf.numPages; n++) {
      const page = await pdf.getPage(n);
      const content = await page.getTextContent();
      const rows = new Map<number, { x: number; text: string }[]>();
      for (const item of content.items) {
        if (!("str" in item)) continue;
        const y = Math.round(item.transform[5] / 3) * 3;
        rows.set(y, [
          ...(rows.get(y) ?? []),
          { x: item.transform[4], text: item.str },
        ]);
      }
      let text = [...rows]
        .sort((a, b) => b[0] - a[0])
        .map(([, row]) =>
          row
            .sort((a, b) => a.x - b.x)
            .map((i) => i.text)
            .join("  "),
        )
        .join("\n");
      if (text.replace(/\s/g, "").length < 80) {
        ocr = true;
        const base = page.getViewport({ scale: 1 });
        const viewport = page.getViewport({
          scale: Math.min(
            4,
            3200 / base.width,
            Math.sqrt(12_000_000 / (base.width * base.height)),
          ),
        });
        const canvas = createCanvas(
          Math.ceil(viewport.width),
          Math.ceil(viewport.height),
        );
        await page.render({
          canvas: canvas as never,
          canvasContext: canvas.getContext("2d") as never,
          viewport,
        }).promise;
        if (!worker) {
          await mkdir(".cache/ocr", { recursive: true });
          worker = await createWorker("eng", 1, {
            langPath: path.resolve(
              "node_modules/@tesseract.js-data/eng/4.0.0_best_int",
            ),
            cachePath: ".cache/ocr",
            gzip: true,
          });
        }
        await worker.setParameters({ tessedit_pageseg_mode: PSM.AUTO });
        const plain = (await worker.recognize(canvas.toBuffer("image/png")))
          .data.text;
        // Threshold and deskew scans so ruled tables do not hide numeric columns.
        const small = createCanvas(
          1000,
          Math.round((canvas.height * 1000) / canvas.width),
        );
        const sc = small.getContext("2d");
        sc.drawImage(canvas, 0, 0, small.width, small.height);
        const pixels = sc.getImageData(0, 0, small.width, small.height).data;
        let bestSlope = 0,
          bestScore = 0;
        for (let slope = -0.03; slope <= 0.03; slope += 0.002) {
          const hist = new Uint32Array(small.height + 60);
          for (let y = 0; y < small.height; y += 2)
            for (let x = 0; x < small.width; x += 2) {
              const p = (y * small.width + x) * 4;
              if ((pixels[p] + pixels[p + 1] + pixels[p + 2]) / 3 < 110)
                hist[Math.round(y - slope * (x - 500)) + 30]++;
            }
          const score = hist.reduce((sum, n) => sum + n * n, 0);
          if (score > bestScore) {
            bestScore = score;
            bestSlope = slope;
          }
        }
        const cleaned = createCanvas(canvas.width, canvas.height);
        const cc = cleaned.getContext("2d");
        cc.fillStyle = "white";
        cc.fillRect(0, 0, cleaned.width, cleaned.height);
        cc.translate(cleaned.width / 2, cleaned.height / 2);
        cc.rotate(-Math.atan(bestSlope));
        cc.drawImage(canvas, -canvas.width / 2, -canvas.height / 2);
        cc.resetTransform();
        const binary = cc.getImageData(0, 0, cleaned.width, cleaned.height);
        for (let p = 0; p < binary.data.length; p += 4) {
          const v =
            (binary.data[p] + binary.data[p + 1] + binary.data[p + 2]) / 3 < 140
              ? 0
              : 255;
          binary.data[p] = binary.data[p + 1] = binary.data[p + 2] = v;
        }
        cc.putImageData(binary, 0, 0);
        // Cell OCR recovers numeric columns and row identity lost by whole-page segmentation.
        if (/PACKING\s+LIST/i.test(plain))
          tables.push(...(await readGrid(cleaned, worker, n)));
        await worker.setParameters({ tessedit_pageseg_mode: PSM.SPARSE_TEXT });
        const recognized = (
          await worker.recognize(
            cleaned.toBuffer("image/png"),
            {},
            { tsv: true },
          )
        ).data;
        const words = (recognized.tsv ?? "")
          .split("\n")
          .slice(1)
          .map((row) => row.split("\t"))
          .filter((v) => v[0] === "5" && v[11]?.trim())
          .map((v) => ({
            x: Number(v[6]),
            y: Number(v[7]) + Number(v[9]) / 2,
            h: Number(v[9]),
            text: v[11],
          }))
          .sort((a, b) => a.y - b.y);
        const lines: (typeof words)[] = [];
        for (const w of words) {
          const row = lines.find(
            (row) => Math.abs(row[0].y - w.y) < Math.max(10, w.h * 0.65),
          );
          if (row) row.push(w);
          else lines.push([w]);
        }
        text =
          plain +
          "\n--- TABLE / SPARSE OCR PASS ---\n" +
          lines
            .map((row) =>
              row
                .sort((a, b) => a.x - b.x)
                .map((w) => w.text)
                .join("  "),
            )
            .join("\n");
      }
      texts.push(`--- PAGE ${n} ---\n${text}`);
      page.cleanup();
    }
    return { text: texts.join("\n\n"), pages: pdf.numPages, ocr, tables };
  } finally {
    await worker?.terminate();
    await task.destroy();
  }
}
