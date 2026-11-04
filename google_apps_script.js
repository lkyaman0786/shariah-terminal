// =====================================================================
// SHARIAH SOFTWARE LICENSES & REGISTRATION WEBHOOK (Google Apps Script)
// Paste this code into: Google Sheets -> Extensions -> Apps Script -> Code.gs
// =====================================================================

function doPost(e) {
  try {
    var sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
    var data = {};
    if (e && e.postData && e.postData.contents) {
      data = JSON.parse(e.postData.contents);
    }
    
    var colMap = getColumnMapping(sheet);
    var action = String(data.action || "").toLowerCase();
    var machineId = String(data.machine_id || "").trim();
    var clientName = String(data.name || data.client_name || data.computer_name || "").trim();
    var email = String(data.email || "").trim().toLowerCase();
    var mobile = String(data.phone || data.mobile || "").trim();
    var planType = String(data.plan_type || data.plan || "Free Trial").trim();
    var status = String(data.status || "Pending").trim();
    var nowFormatted = Utilities.formatDate(new Date(), "GMT+5:30", "MM/dd/yyyy HH:mm:ss");

    var lastRow = sheet.getLastRow();
    var targetRow = -1;

    // Search for existing user/machine
    if (lastRow > 1) {
      var dataRange = sheet.getRange(2, 1, lastRow - 1, Math.max(sheet.getLastColumn(), 8)).getValues();
      for (var i = 0; i < dataRange.length; i++) {
        var row = dataRange[i];
        var rowMachine = String(row[colMap.machine_id - 1] || "").trim();
        var rowEmail = String(row[colMap.email - 1] || "").trim().toLowerCase();
        var rowMobile = String(row[colMap.mobile - 1] || "").trim();
        
        if ((email && rowEmail === email) ||
            (mobile && rowMobile === mobile) ||
            (machineId && rowMachine === machineId)) {
          targetRow = i + 2;
          break;
        }
      }
    }

    if (targetRow > 0) {
      // ── EXISTING USER / MACHINE: UPDATE RECORD ──────────────────────
      if (machineId) sheet.getRange(targetRow, colMap.machine_id).setValue(machineId);
      
      var curName = sheet.getRange(targetRow, colMap.client_name).getValue();
      if (clientName && (!curName || String(curName).startsWith("DESKTOP-"))) {
        sheet.getRange(targetRow, colMap.client_name).setValue(clientName);
      }
      
      var curEmail = sheet.getRange(targetRow, colMap.email).getValue();
      if (email && (!curEmail || String(curEmail).toLowerCase() === "active")) {
        sheet.getRange(targetRow, colMap.email).setValue(email);
      }
      
      var curMobile = sheet.getRange(targetRow, colMap.mobile).getValue();
      if (mobile && (!curMobile || String(curMobile).includes(":"))) {
        sheet.getRange(targetRow, colMap.mobile).setValue(mobile);
      }
      
      if (planType && !sheet.getRange(targetRow, colMap.plan_type).getValue()) {
        sheet.getRange(targetRow, colMap.plan_type).setValue(planType);
      }

      if (data.expiry_date) {
        sheet.getRange(targetRow, colMap.expiry_date).setValue(data.expiry_date);
      }
      
      // Update LastActive timestamp
      sheet.getRange(targetRow, colMap.last_active).setValue(nowFormatted);

      // If explicit admin action to update status
      if (action === "update_status" && data.status) {
        sheet.getRange(targetRow, colMap.status).setValue(data.status);
        return responseJson({ success: true, status: data.status, message: "Status updated" });
      }

      // Read current status from Column G
      var currentStatus = String(sheet.getRange(targetRow, colMap.status).getValue() || "").trim();
      if (!currentStatus) {
        currentStatus = "Pending";
        sheet.getRange(targetRow, colMap.status).setValue("Pending");
      }

      return responseJson({
        success: true,
        status: currentStatus,
        message: "Existing record found"
      });

    } else {
      // ── NEW USER REGISTRATION: APPEND NEW ROW ──────────────────────
      var expiryFormatted = String(data.expiry_date || "").trim();
      if (!expiryFormatted) {
        var expiryDate = new Date();
        expiryDate.setDate(expiryDate.getDate() + 7);
        expiryFormatted = Utilities.formatDate(expiryDate, "GMT+5:30", "MM/dd/yyyy");
      }

      var maxCols = Math.max(sheet.getLastColumn(), 8);
      var newRow = [];
      for (var c = 1; c <= maxCols; c++) {
        if (c === colMap.machine_id) newRow.push(machineId);
        else if (c === colMap.client_name) newRow.push(clientName);
        else if (c === colMap.email) newRow.push(email);
        else if (c === colMap.mobile) newRow.push(mobile);
        else if (c === colMap.plan_type) newRow.push(planType);
        else if (c === colMap.expiry_date) newRow.push(expiryFormatted);
        else if (c === colMap.status) newRow.push(status || "Pending");
        else if (c === colMap.last_active) newRow.push(nowFormatted);
        else newRow.push("");
      }

      sheet.appendRow(newRow);

      return responseJson({
        success: true,
        status: status || "Pending",
        message: "New user registered"
      });
    }

  } catch (err) {
    return responseJson({ success: false, error: err.toString() });
  }
}

// Map column positions dynamically based on header names
function getColumnMapping(sheet) {
  var headers = sheet.getRange(1, 1, 1, Math.max(sheet.getLastColumn(), 8)).getValues()[0];
  var map = {
    machine_id: 1,
    client_name: 2,
    email: 3,
    mobile: 4,
    plan_type: 5,
    expiry_date: 6,
    status: 7,
    last_active: 8
  };
  
  for (var i = 0; i < headers.length; i++) {
    var h = String(headers[i] || "").toLowerCase().replace(/[^a-z0-9]/g, "");
    if (h.includes("machine")) map.machine_id = i + 1;
    else if (h.includes("client") || h.includes("name")) map.client_name = i + 1;
    else if (h.includes("email") || h.includes("mail")) map.email = i + 1;
    else if (h.includes("mobile") || h.includes("phone")) map.mobile = i + 1;
    else if (h.includes("plan")) map.plan_type = i + 1;
    else if (h.includes("expir")) map.expiry_date = i + 1;
    else if (h.includes("status")) map.status = i + 1;
    else if (h.includes("active") || h.includes("last")) map.last_active = i + 1;
  }
  return map;
}

function responseJson(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function doGet(e) {
  return responseJson({ status: "Online", message: "Shariyah License Webhook is Active" });
}

