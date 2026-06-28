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
    return;
  }
  if (expectedContentType && expectedContentType.includes("xml")) {
    if (expectedText) pm.expect(pm.response.text()).to.include(expectedText);
    return;
  }
  if (expectedText) pm.expect(pm.response.text()).to.include(expectedText);
});
