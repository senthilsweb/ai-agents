export const SIZE_PRESETS = {
  "linkedin-article": { width: 1280, height: 720, preset: "linkedin-article" },
  "linkedin-profile": { width: 1584, height: 400, preset: "linkedin-profile" },
  "linkedin-post": { width: 1200, height: 624, preset: "linkedin-post" },
  "carousel": { width: 1088, height: 1344, preset: "carousel" },
  "square": { width: 1088, height: 1088, preset: "square" },
} as const;

export function resolveSize(value?: string) {
  if (!value) return SIZE_PRESETS["linkedin-article"];
  if (value in SIZE_PRESETS) return SIZE_PRESETS[value as keyof typeof SIZE_PRESETS];
  const m = value.match(/^(\d{3,4})x(\d{3,4})$/i);
  if (!m) throw new Error(`Unknown size '${value}'. Use a preset or WIDTHxHEIGHT.`);
  return { width: Number(m[1]), height: Number(m[2]), preset: "custom" };
}
