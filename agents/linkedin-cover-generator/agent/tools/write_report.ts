import { defineTool } from "eve/tools";
import { z } from "zod";
export default defineTool({
  description: "Write deterministic markdown and JSON run reports.",
  inputSchema: z.object({ run_dir:z.string(), spec:z.record(z.string(),z.unknown()), prompt:z.string(), output_path:z.string(), validation:z.record(z.string(),z.unknown()) }),
  async execute({ run_dir, spec, prompt, output_path, validation }, ctx) {
    const sandbox=await ctx.getSandbox();
    const summary={ output_path, validation, spec, completed_at:new Date().toISOString() };
    const report=`# LinkedIn Cover Run\n\n- Output: \`${output_path}\`\n- Canvas: \`${(spec as any).canvas?.width}x${(spec as any).canvas?.height}\`\n- Palette: \`${(spec as any).palette}\`\n- Validation: **${(validation as any).passed?"PASS":"FAIL"}**\n\n## Prompt\n\n\`\`\`text\n${prompt}\n\`\`\`\n`;
    await sandbox.writeTextFile({path:`${run_dir}/report.md`,content:report});
    await sandbox.writeTextFile({path:`${run_dir}/summary.json`,content:JSON.stringify(summary,null,2)+"\n"});
    // Sync the run folder from the sandbox back to the local workspace so
    // artifacts (cover.png, report.md, summary.json) are visible on the host.
    try {
      const localWorkspace = `${process.cwd()}/agent/sandbox/workspace`;
      await sandbox.run({
        command: `mkdir -p "${localWorkspace}/${run_dir}" && cp -r /workspace/${run_dir}/* "${localWorkspace}/${run_dir}/" 2>/dev/null; true`,
      });
    } catch { /* sync is best-effort */ }
    return { report_path:`${run_dir}/report.md`, summary_path:`${run_dir}/summary.json` };
  }
});
