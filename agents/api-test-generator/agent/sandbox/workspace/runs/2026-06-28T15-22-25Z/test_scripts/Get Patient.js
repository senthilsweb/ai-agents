// Test script for: Get Patient
// This file is a read-only reference.
// Edit the collection JSON or re-generate to change these scripts.

var respCode            = pm.iterationData.get("responseCodeForGetPatient");
var expectedText        = pm.iterationData.get("responseTextForGetPatient");
var expectedContentType = pm.iterationData.get("contentTypeForGetPatient");

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
  if (parseInt(respCode) >= 400 || (expectedContentType && expectedContentType.includes("text/html"))) {
    if (expectedText) pm.expect(pm.response.text()).to.include(expectedText);
    return;
  }
  if (expectedContentType && expectedContentType.includes("application/json")) {
    pm.response.to.be.json;
    if (expectedText) pm.expect(pm.response.text()).to.include(expectedText);
    var jsonSchema = {
      "type": "object",
      "required": ["id", "firstName", "lastName", "status", "orgId"],
      "properties": {
        "id":          { "type": "string" },
        "firstName":   { "type": "string" },
        "lastName":    { "type": "string" },
        "status":      { "type": "string", "enum": ["active", "inactive", "deceased"] },
        "orgId":       { "type": "string" },
        "dateOfBirth": { "type": "string" }
      }
    };
    pm.response.to.have.jsonSchema(jsonSchema);
    return;
  }
  if (expectedContentType && expectedContentType.includes("xml")) {
    if (expectedText) pm.expect(pm.response.text()).to.include(expectedText);
    return;
  }
  if (expectedText) pm.expect(pm.response.text()).to.include(expectedText);
});

pm.test("Echo: response id matches requested patientId", function () {
  var expectedPatientId = pm.iterationData.get("expectedPatientIdForGetPatient");
  if (!expectedPatientId) return;
  if (pm.response.code !== 200) return;
  pm.expect(pm.response.json().id).to.eql(expectedPatientId);
});
