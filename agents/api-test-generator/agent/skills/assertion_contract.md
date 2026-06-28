---
description: The exact pm.test() assertion pattern every request must follow. No deviations.
---

# Skill: Assertion Contract

Load this skill when reviewing generated assertion scripts or passing context
to the Assertion Writer subagent. Every request in the collection must follow
this contract exactly — downstream parsers depend on the exact key names.

## Mandatory three-block pattern

Every request's test event script must contain these three `pm.test()` blocks
in this order:

```javascript
// ── Block 1: Status code ──────────────────────────────────────────────────
var respCode            = pm.iterationData.get("responseCodeFor<RequestSuffix>");
var expectedText        = pm.iterationData.get("responseTextFor<RequestSuffix>");
var expectedContentType = pm.iterationData.get("contentTypeFor<RequestSuffix>");

pm.test("Status code", function () {
  pm.response.to.have.status(parseInt(respCode));
});

// ── Block 2: Content-Type header ──────────────────────────────────────────
pm.test("Content-Type header validation", function () {
  var actualContentType = pm.response.headers.get("Content-Type");
  if (!expectedContentType) {
    pm.expect(actualContentType).to.be.oneOf([undefined, null]);
  } else {
    pm.expect(actualContentType, "Content-Type header missing").to.exist;
    var actualBase   = actualContentType.split(";")[0].trim().toLowerCase();
    var expectedBase = expectedContentType.trim().toLowerCase();
    pm.expect(actualBase).to.eql(expectedBase);
  }
});

// ── Block 3: Response body ────────────────────────────────────────────────
pm.test("Response body validation", function () {
  // Branch A — 4xx/5xx or text/html (e.g. 401 Unauthorized)
  if (parseInt(respCode) >= 400 || (expectedContentType && expectedContentType.includes("text/html"))) {
    var bodyText = pm.response.text();
    if (expectedText) {
      pm.expect(bodyText).to.include(expectedText);
    }
    return;
  }

  // Branch B — JSON response
  if (expectedContentType && expectedContentType.includes("application/json")) {
    pm.response.to.be.json;
    if (expectedText) {
      pm.expect(pm.response.text()).to.include(expectedText);
    }
    // JSON schema validation (request-specific, generated per endpoint)
    // var jsonSchema = { "type": "object", "required": [...], "properties": {...} };
    // pm.response.to.have.jsonSchema(jsonSchema);
    return;
  }

  // Branch C — XML response
  if (expectedContentType && expectedContentType.includes("xml")) {
    if (expectedText) {
      pm.expect(pm.response.text()).to.include(expectedText);
    }
    return;
  }

  // Branch D — fallback
  if (expectedText) {
    pm.expect(pm.response.text()).to.include(expectedText);
  }
});
```

## Rules (hard constraints)

1. **No expected values inside the script.** Everything comes from
   `pm.iterationData.get(...)`. Violation = test that can't be parameterized.
2. The `var` declarations must appear **before** the first `pm.test()` block.
3. Request suffix must match the naming-rules convention exactly:
   `"List Pets"` → suffix = `"ListPets"`.
4. The 401/HTML branch must be explicit — the framework relies on it for RBAC
   `-ve` iterations.
5. If the endpoint returns a well-defined JSON schema, add a `jsonSchema` const
   and call `pm.response.to.have.jsonSchema(jsonSchema)` in Branch B.
6. **Do not** add a `pm.test()` block that is not one of the three mandatory ones
   unless there is a specific business rule that cannot be expressed through the
   data file.

## Data file contract (keys that must exist per request)

For a request named `List Pets`:
```
responseCodeForListPets   → integer HTTP status (200, 201, 400, 401, 404…)
responseTextForListPets   → expected substring in response body (or null)
contentTypeForListPets    → expected Content-Type base value (or null)
```

For a request named `Create Pet`:
```
responseCodeForCreatePet
responseTextForCreatePet
contentTypeForCreatePet
```

All three keys must be present in **every** iteration row. Downstream
parsers join assertions by key name — a missing key means that assertion
silently never runs.

## Assertion Writer instructions

When delegating to the Assertion Writer, pass:
- The list of request names and their response shape (from named endpoint model).
- The auth profile (basic/bearer/apikey) — determines which credential keys to use.
- Any JSON schema for 2xx responses from the OpenAPI spec.
- Sample iteration rows so the writer can infer the expected body substrings.

The Assertion Writer must return one script string per request name. The script
must be a single multi-line JavaScript string (newline-joined).
