// Test script for: Update Patient
// This file is a read-only reference.
// Edit the collection JSON or re-generate to change these scripts.

var respCode            = pm.iterationData.get("responseCodeForUpdatePatient");
var expectedText        = pm.iterationData.get("responseTextForUpdatePatient");
var expectedContentType = pm.iterationData.get("contentTypeForUpdatePatient");

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

// Business: Echo firstName
pm.test("Echo: firstName matches request", function () {
  var sentValue = pm.iterationData.get("expectEcho_firstName");
  if (!sentValue) return;
  if (pm.response.code !== 200) return;
  pm.expect(pm.response.json().firstName).to.eql(sentValue);
});

// Business: Echo status
pm.test("Echo: status matches request", function () {
  var sentValue = pm.iterationData.get("expectEcho_status");
  if (!sentValue) return;
  if (pm.response.code !== 200) return;
  pm.expect(pm.response.json().status).to.eql(sentValue);
});

// Business: Echo dateOfBirth
pm.test("Echo: dateOfBirth matches request", function () {
  var sentValue = pm.iterationData.get("expectEcho_dateOfBirth");
  if (!sentValue) return;
  if (pm.response.code !== 200) return;
  pm.expect(pm.response.json().dateOfBirth).to.eql(sentValue);
});
