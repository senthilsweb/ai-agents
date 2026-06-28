---
description: The exact pm.test() assertion pattern you must follow for every request. No deviations.
---

# Skill: Assertion Contract (Assertion Writer copy)

Every request's test event script must follow this pattern exactly. The suffix
is derived from the request name by stripping spaces and capitalizing each word.

## Pattern

```javascript
var respCode            = pm.iterationData.get("responseCodeFor<Suffix>");
var expectedText        = pm.iterationData.get("responseTextFor<Suffix>");
var expectedContentType = pm.iterationData.get("contentTypeFor<Suffix>");

pm.test("Status code", function () {
  pm.response.to.have.status(parseInt(respCode));
});

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

pm.test("Response body validation", function () {
  // Branch A — error or HTML
  if (parseInt(respCode) >= 400 || (expectedContentType && expectedContentType.includes("text/html"))) {
    if (expectedText) pm.expect(pm.response.text()).to.include(expectedText);
    return;
  }
  // Branch B — JSON
  if (expectedContentType && expectedContentType.includes("application/json")) {
    pm.response.to.be.json;
    if (expectedText) pm.expect(pm.response.text()).to.include(expectedText);
    // ADD jsonSchema validation here if a schema is available
    return;
  }
  // Branch C — XML
  if (expectedContentType && expectedContentType.includes("xml")) {
    if (expectedText) pm.expect(pm.response.text()).to.include(expectedText);
    return;
  }
  // Branch D — fallback
  if (expectedText) pm.expect(pm.response.text()).to.include(expectedText);
});
```

## Suffix derivation

| Request name | Suffix |
|---|---|
| `List Pets` | `ListPets` |
| `Create Pet` | `CreatePet` |
| `Get Pet By Id` | `GetPetById` |
| `Update Pet Status` | `UpdatePetStatus` |

Algorithm: split on whitespace, capitalize first letter of each word, join.

## JSON schema block (insert in Branch B when schema available)

```javascript
var jsonSchema = {
  "type": "object",
  "required": ["id", "name"],
  "properties": {
    "id":   { "type": "integer" },
    "name": { "type": "string" },
    "tag":  { "type": "string" }
  }
};
pm.response.to.have.jsonSchema(jsonSchema);
```

## Hard rules

1. All expected values come from `pm.iterationData.get(...)` — never hardcoded.
2. `var` declarations before the first `pm.test()`.
3. Branch A (error/HTML) must handle 401 Unauthorized explicitly — `parseInt(respCode) >= 400`.
4. Do not add a 4th `pm.test()` unless a specific business rule requires it.
5. Script must be returned as a newline-joined string (no outer array brackets).
