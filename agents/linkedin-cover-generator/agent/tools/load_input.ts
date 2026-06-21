import { defineTool } from "eve/tools";
import { z } from "zod";
import matter from "gray-matter";
import { Readability } from "@mozilla/readability";
import { JSDOM } from "jsdom";

export default defineTool({
  description: "Load article content from a local path, remote URL, or inline text.",
  inputSchema: z.object({ input: z.string(), max_chars: z.number().int().default(60000) }),
  async execute({ input, max_chars }, ctx) {
    let text = "", title: string | undefined, kind: "file"|"url"|"text" = "text";
    if (/^https?:\/\//i.test(input)) {
      kind = "url";
      const res = await fetch(input, { headers: { "user-agent": "linkedin-cover-generator/0.1" } });
      if (!res.ok) throw new Error(`URL fetch failed: ${res.status} ${res.statusText}`);
      const html = await res.text();
      const dom = new JSDOM(html, { url: input });
      const parsed = new Readability(dom.window.document).parse();
      title = parsed?.title ?? dom.window.document.title;
      text = parsed?.textContent ?? dom.window.document.body.textContent ?? "";
    } else if (input.includes("\n") || input.length > 400) {
      text = input;
    } else {
      kind = "file";
      const sandbox = await ctx.getSandbox();
      const raw = await sandbox.readTextFile({ path: input });
      if (raw === null) throw new Error(`File not found in sandbox: ${input}`);
      const parsed = matter(raw);
      title = typeof parsed.data.title === "string" ? parsed.data.title : undefined;
      text = parsed.content;
    }
    text = text.replace(/\s+/g, " ").trim().slice(0, max_chars);
    if (!text) throw new Error("No readable article content found.");
    return { kind, source: input, title, text, chars: text.length };
  }
});
