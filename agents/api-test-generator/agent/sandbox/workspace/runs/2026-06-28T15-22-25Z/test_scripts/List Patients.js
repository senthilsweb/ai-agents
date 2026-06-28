// Test script for: List Patients
// This file is a read-only reference.
// Edit the collection JSON or re-generate to change these scripts.

var respCode            = pm.iterationData.get("responseCodeForListPatients");
var expectedText        = pm.iterationData.get("responseTextForListPatients");
var expectedContentType = pm.iterationData.get("contentTypeForListPatients");

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
      "required": ["patients", "total", "limit", "offset"],
      "properties": {
        "patients": { "type": "array" },
        "total":    { "type": "integer" },
        "limit":    { "type": "integer" },
        "offset":   { "type": "integer" }
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

pm.test("Filter: all patients match requested status", function () {
  var expectedFilter = pm.iterationData.get("expectFilterValue");
  if (!expectedFilter) return;
  if (pm.response.code !== 200) return;
  var body = pm.response.json();
  var items = body.patients;
  if (!Array.isArray(items)) return;
  items.forEach(function (item) {
    pm.expect(item.status).to.eql(expectedFilter);
  });
});

pm.test("Pagination: response length respects limit", function () {
  var maxItems = pm.iterationData.get("expectMaxItems");
  if (!maxItems) return;
  if (pm.response.code !== 200) return;
  var body = pm.response.json();
  var items = body.patients;
  if (!Array.isArray(items)) return;
  pm.expect(items.length).to.be.at.most(parseInt(maxItems));
});

pm.test("Offset: empty array when offset >= total", function () {
  var expectEmpty = pm.iterationData.get("expectEmptyForOffset");
  if (!expectEmpty) return;
  if (pm.response.code !== 200) return;
  var body = pm.response.json();
  pm.expect(body.patients).to.be.an("array").that.is.empty;
});

pm.test("OrgId filter: all patients belong to requested orgId", function () {
  var expectedOrgId = pm.iterationData.get("expectOrgId");
  if (!expectedOrgId) return;
  if (pm.response.code !== 200) return;
  var body = pm.response.json();
  var items = body.patients;
  if (!Array.isArray(items)) return;
  items.forEach(function (item) {
    pm.expect(item.orgId).to.eql(expectedOrgId);
  });
});

pm.test("Schema: required fields present on each patient", function () {
  if (pm.response.code !== 200) return;
  var body = pm.response.json();
  var items = body.patients;
  if (!Array.isArray(items)) return;
  items.forEach(function (item) {
    pm.expect(item).to.have.property("id");
    pm.expect(item).to.have.property("firstName");
    pm.expect(item).to.have.property("lastName");
    pm.expect(item).to.have.property("status");
    pm.expect(item).to.have.property("orgId");
  });
});
