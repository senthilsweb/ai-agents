import { defineEval } from "eve/evals";
import { equals } from "eve/evals/expect";

import { normalizeLabel } from "shared/lib/taxonomy.js";

// Pure unit check — no t.send, no model call. Covers both free-text LLM
// phrasing and Presidio's native entity-type vocabulary, since one alias
// table normalizes both (shared/config/label_aliases.yaml).
export default defineEval({
  description:
    "Representative aliases from both label families (LLM free text and " +
    "Presidio's native vocabulary) normalize to their declared canonical " +
    "type; an unrecognized label falls back to UNKNOWN.",
  async test(t) {
    const cases: Array<[raw: string, expected: string]> = [
      ["ssn", "GOVERNMENT_ID_SSN"],
      ["US_SSN", "GOVERNMENT_ID_SSN"],
      ["email", "EMAIL_ADDRESS"],
      ["EMAIL_ADDRESS", "EMAIL_ADDRESS"],
      ["PERSON", "PERSON_NAME"],
      ["full name", "PERSON_NAME"],
      ["MEDICAL_LICENSE", "HEALTH_RECORD_ID"],
      ["IBAN_CODE", "IBAN"],
      ["dob", "DATE_OF_BIRTH"],
      ["NRP", "RACE_ETHNICITY"],
    ];

    for (const [raw, expected] of cases) {
      t.check(normalizeLabel(raw), equals(expected));
    }

    t.check(normalizeLabel("something-totally-unrecognized-xyz"), equals("UNKNOWN"));
  },
});
