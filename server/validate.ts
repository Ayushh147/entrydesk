import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
const exec = promisify(execFile);
export async function validateXml(xml: string) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "entrydesk-xsd-"));
  try {
    const original = await readFile("docs/netchb/entry.xsd", "utf8");
    await writeFile(
      path.join(dir, "entry.xsd"),
      original.replace(
        "https://www.netchb.com/xml/data/data_type.xsd",
        "data_type.xsd",
      ),
    );
    await writeFile(
      path.join(dir, "data_type.xsd"),
      await readFile("docs/netchb/data_type.xsd"),
    );
    await writeFile(path.join(dir, "entry.xml"), xml);
    await exec(
      "xmllint",
      [
        "--nonet",
        "--noout",
        "--schema",
        path.join(dir, "entry.xsd"),
        path.join(dir, "entry.xml"),
      ],
      { timeout: 10000, maxBuffer: 100000 },
    );
    return { available: true, valid: true, errors: [] };
  } catch (e) {
    const err = e as {
      code?: string | number;
      stderr?: string;
      message: string;
    };
    return {
      available: err.code !== "ENOENT",
      valid: false,
      errors: (err.stderr ?? err.message)
        .replaceAll(dir, "")
        .split("\n")
        .filter(Boolean)
        .slice(0, 20),
    };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
