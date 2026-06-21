import { defineTool } from "eve/tools";
import { z } from "zod";

// Lucide renamed several icons; resolve old names to current ones.
const RENAMED: Record<string, string> = {
  "pie-chart": "chart-pie",
  "line-chart": "chart-line",
  "bar-chart-3": "chart-column",
  "bar-chart": "chart-column-big",
  "arrow-up-circle": "circle-arrow-up",
  "arrow-down-circle": "circle-arrow-down",
  "arrow-right-circle": "circle-arrow-right",
  "arrow-left-circle": "circle-arrow-left",
  waves: "droplets",
};

const RAW_BASE =
  "https://raw.githubusercontent.com/lucide-icons/lucide/main/icons/";

function innerShapes(svg: string): string | null {
  // Strip the outer <svg ...> wrapper, keep the inner shapes.
  const open = svg.indexOf(">");
  if (open === -1) return null;
  const close = svg.lastIndexOf("</svg>");
  if (close === -1) return null;
  return svg.slice(open + 1, close).trim();
}

export default defineTool({
  description:
    "Fetch a Lucide icon and return its inner SVG shapes (the contents you inline " +
    "inside your own <svg class='ic' viewBox='0 0 24 24' ...>). Automatically " +
    "resolves renamed icons (e.g. pie-chart -> chart-pie). Returns the shapes and " +
    "the resolved icon name, or an error if the icon could not be found.",
  inputSchema: z.object({
    name: z
      .string()
      .min(1)
      .describe("The Lucide icon name, e.g. 'database', 'pie-chart', 'waves'."),
  }),
  async execute({ name }) {
    const resolved = RENAMED[name] ?? name;
    const url = `${RAW_BASE}${resolved}.svg`;
    const res = await fetch(url, { redirect: "follow" });
    if (res.status === 404) {
      return {
        ok: false,
        error: `Icon '${name}' not found (tried resolved name '${resolved}').`,
      };
    }
    if (!res.ok) {
      return { ok: false, error: `Fetch failed: ${res.status} ${res.statusText}` };
    }
    const svg = await res.text();
    const inner = innerShapes(svg);
    if (!inner) {
      return { ok: false, error: `Could not parse SVG for '${name}'.` };
    }
    return { ok: true, name, resolved, inner };
  },
});
