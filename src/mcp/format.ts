import type { Money } from "../severa/types";

export function toText(text: string) {
  return { content: [{ type: "text" as const, text }] };
}

export function toJsonBlock(label: string, obj: unknown) {
  return toText(`${label}\n\`\`\`json\n${JSON.stringify(obj, null, 2)}\n\`\`\``);
}

export function formatMoney(m?: Money): string {
  if (!m || m.amount == null) return "—";
  return `${m.amount.toLocaleString("sv-FI")} ${m.currencyCode}`;
}

export function mdTable(headers: string[], rows: (string | number | undefined)[][]): string {
  const sep = headers.map(() => "---").join(" | ");
  const body = rows
    .map((r) => r.map((c) => (c === undefined || c === null ? "" : String(c))).join(" | "))
    .join("\n");
  return `| ${headers.join(" | ")} |\n| ${sep} |\n| ${body.replaceAll("\n", " |\n| ")} |`;
}
