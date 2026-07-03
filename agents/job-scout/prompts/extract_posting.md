# Task prompt: posting extraction

Given the fetched text of a single job posting, return one JSON object:
{title, company, req_id, req_id_type, location, work_mode, base_min,
 base_max, ote_notes, app_deadline, visa_sponsorship, evidence}
- visa_sponsorship: "no" only if the posting explicitly excludes sponsorship;
  "yes" only if explicitly offered; otherwise "verify".
- evidence: quote fragment (<15 words) supporting visa_sponsorship and salary.
- If the page indicates the job is closed, return {"status": "closed"} only.
