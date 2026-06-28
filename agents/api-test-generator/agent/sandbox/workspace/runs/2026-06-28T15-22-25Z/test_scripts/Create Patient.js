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

pm.test("Schema: id is a valid UUID on successful create", function () {
  if (pm.response.code !== 201) return;
  var id = pm.response.json().id;
  pm.expect(id).to.be.a("string").and.not.empty;
  pm.expect(id).to.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
});

pm.test("Echo: firstName matches request", function () {
  var sentValue = pm.iterationData.get("expectEcho_firstName");
  if (!sentValue) return;
  if (pm.response.code !== 201) return;
  pm.expect(pm.response.json().firstName).to.eql(sentValue);
});

pm.test("Echo: lastName matches request", function () {
  var sentValue = pm.iterationData.get("expectEcho_lastName");
  if (!sentValue) return;
  if (pm.response.code !== 201) return;
  pm.expect(pm.response.json().lastName).to.eql(sentValue);
});

pm.test("Echo: orgId matches request", function () {
  var sentValue = pm.iterationData.get("expectEcho_orgId");
  if (!sentValue) return;
  if (pm.response.code !== 201) return;
  pm.expect(pm.response.json().orgId).to.eql(sentValue);
});

pm.test("Default status: active when not specified", function () {
  var sentStatus = pm.iterationData.get("status");
  if (sentStatus && sentStatus !== "omit") return;
  if (pm.response.code !== 201) return;
  pm.expect(pm.response.json().status).to.eql("active");
});

pm.test("Echo: status matches request when specified", function () {
  var sentStatus = pm.iterationData.get("expectEcho_status");
  if (!sentStatus) return;
  if (pm.response.code !== 201) return;
  pm.expect(pm.response.json().status).to.eql(sentStatus);
});

pm.test("Echo: dateOfBirth matches request when specified", function () {
  var sentValue = pm.iterationData.get("expectEcho_dateOfBirth");
  if (!sentValue) return;
  if (pm.response.code !== 201) return;
  pm.expect(pm.response.json().dateOfBirth).to.eql(sentValue);
});
