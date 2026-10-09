import type { Issue } from "./model.js";
export function issueCategory(issue: Issue): "conflict" | "missing" | "review" {
  if (issue.category) return issue.category;
  if (/^(field-|goods-total|cif-total|math-|qty-|material-)/.test(issue.id))
    return "conflict";
  if (
    /^(required-|hts-|mid-|reporting-|origin-missing-|value-missing-|no-lines|invoice-count|missing-)/.test(
      issue.id,
    )
  )
    return "missing";
  return "review";
}
export function conflictGroups(
  issues: Issue[],
): { id: string; title: string; issues: Issue[] }[] {
  const groups = new Map<
    string,
    { id: string; title: string; issues: Issue[] }
  >();
  for (const issue of issues.filter((i) => issueCategory(i) === "conflict")) {
    const id = issue.group ?? issue.id;
    if (!groups.has(id))
      groups.set(id, {
        id,
        title:
          id === "invoice-pricing"
            ? "Invoice pricing and subtotal disagree"
            : issue.title,
        issues: [],
      });
    groups.get(id)!.issues.push(issue);
  }
  return [...groups.values()];
}
