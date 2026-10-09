import { createCanvas, type Canvas } from "@napi-rs/canvas";
import { PSM, type Worker } from "tesseract.js";
import type { ExtractedTable } from "../shared/model.js";
function clusters(values: number[], gap = 5): number[] {
  const groups: number[][] = [];
  for (const n of values) {
    const last = groups.at(-1);
    if (last && n - last.at(-1)! < gap) last.push(n);
    else groups.push([n]);
  }
  return groups.map((g) => Math.round((g[0] + g.at(-1)!) / 2));
}
// Discover ruled tables from image geometry, without known document coordinates or SKUs.
export async function readGrid(
  canvas: Canvas,
  worker: Worker,
  page: number,
): Promise<ExtractedTable[]> {
  const w = canvas.width,
    h = canvas.height,
    pixels = canvas.getContext("2d").getImageData(0, 0, w, h).data;
  const horizontal: number[] = [];
  for (let y = 0; y < h; y++) {
    let n = 0;
    for (let x = 0; x < w; x++) if (pixels[(y * w + x) * 4] < 100) n++;
    if (n > w * 0.6) horizontal.push(y);
  }
  const ys = clusters(horizontal);
  if (ys.length < 4 || ys.length > 60) return [];
  let best: { xs: number[]; ys: number[]; score: number } | undefined;
  for (let a = 0; a < ys.length - 3; a++) {
    const counts = new Uint32Array(w);
    let previous = ys[a];
    for (let b = a + 1; b < ys.length; b++) {
      for (let y = previous; y < ys[b]; y++)
        for (let x = 0; x < w; x++)
          if (pixels[(y * w + x) * 4] < 100) counts[x]++;
      previous = ys[b];
      if (b - a < 3) continue;
      const span = ys[b] - ys[a];
      const xs = clusters(
        [...counts].flatMap((n, x) => (n > span * 0.7 ? [x] : [])),
      );
      if (xs.length < 5 || xs.length > 18 || (xs.length - 1) * (b - a) > 140)
        continue;
      const gaps = ys.slice(a + 1, b + 1).map((y, i) => y - ys[a + i]);
      const mean = span / gaps.length;
      if (Math.max(...gaps) > mean * 2) continue;
      const score = (xs.length - 1) * (b - a);
      if (!best || score > best.score)
        best = { xs, ys: ys.slice(a, b + 1), score };
    }
  }
  if (!best) return [];
  await worker.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_BLOCK });
  const cells: string[][] = [],
    confidence: number[][] = [];
  for (let row = 0; row < best.ys.length - 1; row++) {
    const textRow: string[] = [],
      confRow: number[] = [];
    for (let col = 0; col < best.xs.length - 1; col++) {
      const left = best.xs[col],
        top = best.ys[row],
        cw = best.xs[col + 1] - left,
        ch = best.ys[row + 1] - top;
      if (cw < 12 || ch < 12) {
        textRow.push("");
        confRow.push(0);
        continue;
      }
      const pad = 4,
        scale = 1.4;
      const crop = createCanvas(
          Math.ceil(cw * scale) + 16,
          Math.ceil(ch * scale) + 16,
        ),
        cc = crop.getContext("2d");
      cc.fillStyle = "white";
      cc.fillRect(0, 0, crop.width, crop.height);
      cc.drawImage(
        canvas,
        left + pad,
        top + pad,
        cw - pad * 2,
        ch - pad * 2,
        8,
        8,
        (cw - pad * 2) * scale,
        (ch - pad * 2) * scale,
      );
      const result = (await worker.recognize(crop.toBuffer("image/png"))).data;
      textRow.push(result.text.replace(/\s+/g, " ").trim());
      confRow.push(result.confidence);
    }
    cells.push(textRow);
    confidence.push(confRow);
  }
  return [{ page, cells, confidence }];
}
