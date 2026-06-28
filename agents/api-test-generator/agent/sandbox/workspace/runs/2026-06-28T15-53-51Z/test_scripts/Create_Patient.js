// Test script for: Create Patient
// This file is a read-only reference.
// Edit the collection JSON or re-generate to change these scripts.

var respCode            = pm.iterationData.get("responseCodeForCreatePatient");
var expectedText        = pm.iterationData.get("responseTextForCreatePatient");
var expectedContentType = pm.iterationData.get("contentTypeForCreatePatient");

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
    var jsonSchema = {
      "type": "object",
      "required": ["id", "firstName", "lastName", "status", "orgId"],
      "properties": {
        "id":        { "type": "string", "format": "uuid" },
        "firstName": { "type": "string" },
        "lastName":  { "type": "string" },
        "status":    { "type": "string", "enum": ["active", "inactive", "deceased"] },
        "orgId":     { "type": "string" }
      }
    };
    pm.response.to.have.jsonSchema(jsonSchema);
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

// Business: UUID — id must be a non-empty string
pm.test("Schema: id is a non-empty string (UUID)", function () {
  if (pm.response.code !== 201) return;
  pm.expect(pm.response.json().id).to.be.a("string").and.not.empty;
});

// Business: Echo firstName
pm.test("Echo: firstName matches request", function () {
  var sentValue = pm.iterationData.get("expectEcho_firstName");
  if (!sentValue) return;
  if (pm.response.code !== 201) return;
  pm.expect(pm.response.json().firstName).to.eql(sentValue);
});

// Business: Echo lastName
pm.test("Echo: lastName matches request", function () {
  var sentValue = pm.iterationData.get("expectEcho_lastName");
  if (!sentValue) return;
  if (pm.response.code !== 201) return;
  pm.expect(pm.response.json().lastName).to.eql(sentValue);
});

// Business: Default status is active when status omitted
pm.test("Default status: active when not specified", function () {
  var sentStatus = pm.iterationData.get("status");
  if (sentStatus && sentStatus !== "omit") return;
  if (pm.response.code !== 201) return;
  pm.expect(pm.response.json().status).to.eql("active");
});
