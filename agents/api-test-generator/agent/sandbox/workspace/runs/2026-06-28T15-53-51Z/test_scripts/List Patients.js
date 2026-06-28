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
  // Branch C — XML
  if (expectedContentType && expectedContentType.includes("xml")) {
    if (expectedText) pm.expect(pm.response.text()).to.include(expectedText);
    return;
  }
  // Branch D — fallback
  if (expectedText) pm.expect(pm.response.text()).to.include(expectedText);
});

// Business: Filter — all returned patients match requested status
pm.test("Filter: all patients match requested status", function () {
  var expectedFilter = pm.iterationData.get("expectFilterValue");
  if (!expectedFilter) return;
  if (pm.response.code !== 200) return;
  var body = pm.response.json();
  var items = body.patients;
  items.forEach(function (item) {
    pm.expect(item.status).to.eql(expectedFilter);
  });
});

// Business: Pagination — response length respects limit
pm.test("Pagination: response length respects limit", function () {
  var maxItems = pm.iterationData.get("expectMaxItems");
  if (!maxItems) return;
  if (pm.response.code !== 200) return;
  var body = pm.response.json();
  var items = body.patients;
  pm.expect(items.length).to.be.at.most(parseInt(maxItems));
});

// Business: orgId — all returned patients belong to requested orgId
pm.test("Filter: all patients belong to requested orgId", function () {
  var expectedOrgId = pm.iterationData.get("expectOrgId");
  if (!expectedOrgId) return;
  if (pm.response.code !== 200) return;
  var body = pm.response.json();
  var items = body.patients;
  items.forEach(function (item) {
    pm.expect(item.orgId).to.eql(expectedOrgId);
  });
});

// Business: Schema — required fields present on each patient
pm.test("Schema: required fields present on each patient", function () {
  if (pm.response.code !== 200) return;
  var body = pm.response.json();
  var items = body.patients;
  items.forEach(function (item) {
    pm.expect(item).to.have.property("id");
    pm.expect(item).to.have.property("firstName");
    pm.expect(item).to.have.property("lastName");
    pm.expect(item).to.have.property("status");
    pm.expect(item).to.have.property("orgId");
  });
});
