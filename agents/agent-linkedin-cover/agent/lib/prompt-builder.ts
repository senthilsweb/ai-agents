import type { CoverSpec } from "./schemas.js";
import { PALETTES } from "./palettes.js";

export function buildImagePrompt(spec: CoverSpec): string {
  const colors = PALETTES[spec.palette as keyof typeof PALETTES] ?? PALETTES["navy-cyan-violet"];
  return `Create a polished LinkedIn article cover image at EXACTLY ${spec.canvas.width} x ${spec.canvas.height} pixels.
Composition: ${spec.layout}. Keep every important element at least ${spec.safeMarginPx}px from all edges. Do not crop text, badges, footer, or illustration.
Style: ${spec.style}. Density: ${spec.density}. Premium editorial technology visual, clear hierarchy, balanced negative space, highly legible at feed-preview scale.
Palette: ${spec.palette}; use ${colors.join(", ")} harmoniously.
Required text (spell exactly):
${spec.badge ? `Badge: ${spec.badge}` : "No badge."}
Title: ${spec.title}
${spec.subtitle ? `Subtitle: ${spec.subtitle}` : ""}
${spec.supportLine ? `Support line: ${spec.supportLine}` : ""}
${spec.footer.length ? `Footer, small but readable: ${spec.footer.join(" | ")}` : "No footer."}
Right-side or supporting visual concept: ${spec.visualConcept}
Do not add extra product names, logos, company names, URLs, labels, or claims. ${spec.forbiddenTerms.length ? `Never include these terms: ${spec.forbiddenTerms.join(", ")}.` : ""}
Avoid tiny text, dense diagrams, UI clutter, malformed words, watermarks, and edge-to-edge text. Use abstract visual metaphors unless the spec explicitly requests architecture detail.`;
}
