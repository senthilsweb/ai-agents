# Job Hunting Is a Data Problem. I Treated It Like One.

![](/api/files/019f27f3-8527-7758-9eda-7bed3f2778de/job-hunt-is-a-data-problem.png)

Every job posting is a row of data. Recently I had reason to read a lot of them, and within two days I noticed something familiar. Stale postings. Missing requisition IDs. Salary bands hidden in footnotes. Rankings living in my head instead of in a table.

That is a data quality problem. I deal with those every day. So I stopped browsing and started modeling.

**The data model came first.**

Five tables in DuckDB: `company`, job_posting, compensation, fit_assessment, referral. Later I added conference, sponsorship, contact, and a crawl log. Two design choices did most of the work.

![](/api/files/019f27f6-4b84-77bd-afa0-00d534acbb52/job-scout-dbmodel.png)

First, **requisition IDs** are stored as text with a type column. **Workday** uses **JR numbers**. **Ashby** uses **UUIDs**. **Greenhouse** uses **integers**. One schema handles all of them, and the type column tells my referrer what to expect. Req IDs matter more than people think. _An employee submitting a referral needs the exact ID, and they usually need it before you apply_.

Second, my personal fit scores live in a separate table from the posting facts. The core model stays generic. This tool is not just for me. Anyone can drop in their own resume, targets, and weights.

**Then the scoring.**

_Gut feel became a formula:_ weighted domain fit, compensation against a target band, a bonus for my preferred industries, a penalty for locations outside my preference, and a hard gate for postings that exclude visa sponsorship. That gate mattered. One company was my best domain match on paper and scored zero because of a single sentence in the posting. Better to learn that from a query than after three interviews.

**Then a better source.**

_Job boards are noisy._ Conference sponsor lists are curated. The **Databricks Data + AI Summit 2026** had **240+ sponsors**, and every one of them is a company investing in my field right now. I classified them (**established**, **growth startup**, **frontier AI**, **boutique SI**) and worked through them with a pipeline status per company. Two findings I would have missed on a job board: a vendor that just launched a direct competitor to my product area, and a fresh merger of two companies whose tools I use daily.

**Why deterministic first?**

![Article content](https://media.licdn.com/dms/image/v2/D5612AQEgFFRBrsKE8Q/article-inline_image-shrink_1500_2232/B56Z8n_yVqGcAQ-/0/1783082460791?e=1784764800&v=beta&t=WjEtXT702Foho8zJmTsZILHprwCbfbggHxKHIPNEh3s)

I keep seeing teams reach for **GenAI** on problems a **for-loop solves**. **Query generation** here is **string templates** from a YAML config. **Scoring** is **SQL**. **Deduplication** is a **hash lookup** against a crawl log with an expiry window. None of that needs a model, so none of it uses one. The result is reproducible, auditable, and nearly free to run.

This is not a personal quirk. **It is how my team ships every day**: spec first, typed tools for the deterministic work, Python and TypeScript and SQL doing the heavy lifting, and models only where judgment is genuinely required. **Automation is in our DNA**. We were automating before it was called **RPA**, and the rule survived the rebrand: if the logic is knowable, write it down. Do not ask a model to guess it.

**The agentic layer is one switch.**

![Article content](https://media.licdn.com/dms/image/v2/D5612AQENuegiAoN_Gg/article-inline_image-shrink_1500_2232/B56Z8oAxu7GsAU-/0/1783082720522?e=1784764800&v=beta&t=ETqNVlyG4u44mfGUPczoVE9vJ3UVRzQnUmKQ45SkXdE)

When judgment is needed, **agentic mode** turns on with a single toggle in the config. My resume becomes the matching context. The agent executes only the queries the deterministic planner generated, verifies each posting is still open, and returns structured rows. It cannot invent a req ID or a salary. Unknown stays null. Prompts and skills live in versioned files next to the specs, not buried in code. The **model** **coordinates**. The **tools** do the **work**.

**What I learned.**

Postings go stale fast. Verify before you invest. Referral-first beats apply-first. And the habits we build for governing enterprise data work on a spreadsheet-sized problem too, as long as you respect the same rules: verify sources, keep provenance, never fabricate.

**And it is open source.**

The code lives in my ai-agents monorepo on GitHub (https://github.com/senthilsweb/ai-agents), joining the other agents I have been publishing there. The rest of the collection runs on the eve framework; this one is deliberately a self-contained Python stack, marimo, DuckDB, and YAML, so anyone can run it without adopting a framework. Swap in your own resume and targets. It was never meant to be just for me.

And the honest part: I am open to new roles in data governance, privacy engineering, and data and AI platform leadership. If your team works on these problems, **my inbox is open**.

The search continues. The pipeline runs.