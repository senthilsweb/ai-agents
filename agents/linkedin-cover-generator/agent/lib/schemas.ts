import { z } from "zod";

export const SizeSchema = z.object({ width: z.number().int().min(256), height: z.number().int().min(256), preset: z.string() });
export const CoverSpecSchema = z.object({
  source: z.object({ kind: z.enum(["file", "url", "text"]), value: z.string(), title: z.string().optional() }),
  canvas: SizeSchema,
  badge: z.string().max(52).optional(),
  title: z.string().min(3).max(72),
  subtitle: z.string().max(110).optional(),
  supportLine: z.string().max(120).optional(),
  palette: z.string(),
  layout: z.enum(["editorial-left-visual-right", "centered-minimal", "split-balanced"]),
  visualConcept: z.string().max(320),
  density: z.enum(["minimal", "balanced"]),
  style: z.string(),
  includeBrands: z.boolean().default(false),
  forbiddenTerms: z.array(z.string()).default([]),
  footer: z.array(z.string()).max(2).default([]),
  referenceImage: z.string().optional(),
  safeMarginPx: z.number().int().min(32).max(160).default(64),
});
export type CoverSpec = z.infer<typeof CoverSpecSchema>;
