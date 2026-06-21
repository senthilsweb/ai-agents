import { defineTool } from "eve/tools";
import { z } from "zod";

// Headless self-verify: render the generated HTML at 2x and capture a full-page
// screenshot the renderer inspects for layout problems. Runs inside the sandbox.
// Requires a headless browser; the sandbox bootstrap installs Playwright + Chromium.

const SCREENSHOT_SCRIPT = (htmlPath: string, pngPath: string, w: number, h: number) => `
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
const html = ${JSON.stringify(htmlPath)};
const png  = ${JSON.stringify(pngPath)};
const W = ${w}, H = ${h};
const shot = spawnSync("npx", ["playwright", "screenshot",
  "--viewport-size", W + "x" + H,
  "--full-page",
  "--wait-for-timeout", "1800",
  "file://" + html, png], { encoding: "utf8" });
const out = { status: shot.status, stdout: shot.stdout, stderr: shot.stderr,
              png, pngExists: existsSync(png) };
process.stdout.write(JSON.stringify(out));
`;

export default defineTool({
  description:
    "Render an HTML file headless at 2x and capture a full-page screenshot for " +
    "self-verification (the renderer inspects it for empty icon chips, overflow, " +
    "misrouted arrows, overlaps, weak contrast, and reference fidelity). Returns " +
    "the preview png path. Requires Playwright + Chromium in the sandbox " +
    "(installed by the sandbox bootstrap).",
  inputSchema: z.object({
    html_path: z
      .string()
      .describe("Path to the html file relative to the workspace, e.g. 'runs/<id>/diagram-dark.html'."),
    png_path: z
      .string()
      .describe("Path for the preview png relative to the workspace. Defaults to the html path with .preview.png."),
    width: z.number().int().positive().default(1560).describe("Viewport width."),
    height: z.number().int().positive().default(1500).describe("Viewport height."),
  }),
  async execute({ html_path, png_path, width, height }, ctx) {
    const sandbox = await ctx.getSandbox();
    const png = png_path || html_path.replace(/\.html$/i, ".preview.png");
    const scriptPath = `${html_path}.shot.mjs`;
    await sandbox.writeTextFile({
      path: scriptPath,
      content: SCREENSHOT_SCRIPT(html_path, png, width, height),
    });
    const nodeRes = await sandbox.run({ command: `node ${scriptPath}` });
    let result: { png: string; pngExists?: boolean; status?: number | null; stderr?: string; stdout?: string };
    try {
      result = JSON.parse(nodeRes.stdout.trim().split("\n").pop() || "{}");
    } catch {
      result = {
        png,
        pngExists: false,
        status: nodeRes.exitCode,
        stderr: nodeRes.stderr,
        stdout: nodeRes.stdout,
      };
    }
    return {
      html: html_path,
      preview: png,
      png_exists: result.pngExists === true,
      ...(result.pngExists
        ? {}
        : { error: "Screenshot failed — is Playwright + Chromium installed in the sandbox?", stderr: result.stderr }),
    };
  },
});
