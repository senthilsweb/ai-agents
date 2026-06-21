import { defineTool } from "eve/tools";
import { z } from "zod";
import { CoverSpecSchema } from "#lib/schemas.js";
import { buildImagePrompt } from "#lib/prompt-builder.js";
export default defineTool({
  description: "Validate a Cover Spec and deterministically build the image prompt.",
  inputSchema: z.object({ spec: CoverSpecSchema }),
  async execute({ spec }) { return { prompt: buildImagePrompt(spec), spec: CoverSpecSchema.parse(spec) }; }
});
