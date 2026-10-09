import { readFile, writeFile, mkdir } from "node:fs/promises";
const input = process.argv[2];
if (!input)
  throw new Error(
    "Usage: npm run export-chat -- /absolute/path/to/rollout-session.jsonl",
  );
const events = (await readFile(input, "utf8"))
  .split("\n")
  .filter(Boolean)
  .map((line) => JSON.parse(line));
const visible = [];
for (const event of events) {
  if (event.type !== "response_item") continue;
  const p = event.payload;
  if (
    p.type === "message" &&
    ["user", "assistant"].includes(p.role) &&
    p.channel !== "analysis"
  )
    visible.push({
      timestamp: event.timestamp,
      role: p.role,
      channel: p.channel ?? null,
      content: p.content,
    });
  if (
    [
      "function_call",
      "function_call_output",
      "custom_tool_call",
      "custom_tool_call_output",
    ].includes(p.type)
  )
    visible.push({
      timestamp: event.timestamp,
      role: p.type.includes("output") ? "tool" : "assistant",
      ...p,
    });
}
const exportedAt = new Date().toISOString();
const metadata = {
  exportedAt,
  note: "User-visible conversation and tool activity through this export. Private reasoning and system/developer instructions are excluded. Rerun after the final response and any later work.",
  eventCount: visible.length,
};
const redact = (s: string) =>
  s.replace(/\bsk-[A-Za-z0-9_-]{20,}\b/g, "[REDACTED_API_KEY]");
await mkdir("output", { recursive: true });
await writeFile(
  "output/ai-chat-history-full.json",
  redact(JSON.stringify({ metadata, events: visible }, null, 2)),
);
let md = `# AI chat history\n\nExported ${exportedAt}.\n\n${metadata.note}\n\n`;
for (const event of visible) {
  const e = event as Record<string, unknown>;
  md += `## ${String(e.role).toUpperCase()} · ${e.timestamp}\n\n`;
  if (e.type === "message" || e.content) {
    for (const block of (e.content ?? []) as { type: string; text?: string }[])
      if (block.text) md += block.text + "\n\n";
  } else md += "```json\n" + JSON.stringify(e, null, 2) + "\n```\n\n";
}
await writeFile("output/ai-chat-history-full.md", redact(md));
console.log(
  `Exported ${visible.length} user-visible events. Rerun after the conversation ends to include its final response.`,
);
