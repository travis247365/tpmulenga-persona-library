/** Markdown renderer for a pack. The plainest of the three, and the one that
 *  survives being pasted anywhere. */
export function toMarkdown(pack) {
  const out = [`# ${pack.title}`, "", `_${pack.subtitle}_`, ""];
  for (const b of pack.blocks) {
    switch (b.t) {
      case "h1": out.push(`# ${b.text}`, ""); break;
      case "h2": out.push(`## ${b.text}`, ""); break;
      case "h3": out.push(`### ${b.text}`, ""); break;
      case "p":  out.push(b.text, ""); break;
      case "small": out.push(`**${b.text}**`, ""); break;
      case "ul": out.push(...b.items.map((i) => `- ${i}`), ""); break;
      case "kv": out.push(...b.items.map((i) => `**${i.k}:** ${i.v}`), ""); break;
      case "rule": out.push("---", ""); break;
      default: break;
    }
  }
  // The h1 from the pack duplicates the title line above it; drop the second.
  return out.join("\n").replace(/^# Job Pack\n\n_(.*)_\n\n# Job Pack\n/, "# Job Pack\n\n_$1_\n");
}
