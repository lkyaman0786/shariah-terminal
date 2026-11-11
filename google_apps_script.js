// =====================================================================
// SHARIAH SOFTWARE LICENSES & AUTHENTICATION WEBHOOK (v3.0)
// Safe Append, Robust Identity Match, No Overwrite, Full Field Sync
// =====================================================================

function doGet(e) {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = getLicensesSheet(ss);
    var param = (e && e.parameter) || {};
    var action = String(param.action || "ping").toLowerCase();

    if (action === "ping") {
      return responseJson({ status: "Online", message: "Shariyah License Webhook is Active", time: new Date().toISOString() });
    }

    if (action === "verify" || param.email || param.mobile || param.identifier) {
      return handleVerify(sheet, {
        email: param.email || param.identifier,
        mobile: param.mobile || param.phone || param.identifier,
        machine_id: param.machine_id
      });
    }

    if (action === "get_users") {
      return responseJson(fetchAllUsers(sheet));
    }

    return responseJson({ status: "Online" });
  } catch (err) {
    return responseJson({ success: false, error: err.toString() });
  }
}

function doPost(e) {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = getLicensesSheet(ss);
    var data = {};
    if (e && e.postData && e.postData.contents) {
      data = JSON.parse(e.postData.contents);
    }

    var colMap = getColumnMapping(sheet);
    var action = String(data.action || "verify").toLowerCase();

    var machineId = String(data.machine_id || "").trim();
    var clientName = String(data.client_name || data.name || data.computer_name || "").trim();
    var email = String(data.email || "").trim().toLowerCase();
    var mobile = String(data.mobile || data.phone || "").trim();
    var planType = String(data.plan_type || data.plan || "FREE TRIAL").trim();
    var expiryDate = String(data.expiry_date || "").trim();
    var status = normalizeStatus(data.status || "Pending");
    var nowFormatted = Utilities.formatDate(new Date(), "GMT+5:30", "yyyy-MM-dd HH:mm:ss");

    // ── 1. GET ALL USERS (POST) ──────────────────────────────────────
    if (action === "get_users") {
      return responseJson(fetchAllUsers(sheet));
    }

    // ── 2. VERIFY USER IDENTITY ──────────────────────────────────────
    if (action === "verify") {
      return handleVerify(sheet, {
        email: email,
        mobile: mobile,
        machine_id: machineId
      });
    }

    // Find user by Email / Mobile first (identity match), then MachineID
    var targetRow = findUserRow(sheet, colMap, email, mobile, machineId);

    // ── 3. USER LOGIN EVENT ──────────────────────────────────────────
    if (action === "login") {
      if (targetRow > 0) {
        // Update MachineID if empty or reset
        if (machineId) {
          var curMachine = String(sheet.getRange(targetRow, colMap.machine_id).getValue() || "").trim();
          if (!curMachine || curMachine !== machineId) {
            sheet.getRange(targetRow, colMap.machine_id).setValue(machineId);
          }
        }
        // Update ClientName if previously generic
        if (clientName) {
          var curName = String(sheet.getRange(targetRow, colMap.client_name).getValue() || "").trim();
          if (!curName || curName.startsWith("DESKTOP-") || curName.startsWith("WEB-")) {
            sheet.getRange(targetRow, colMap.client_name).setValue(clientName);
          }
        }
        // Update LastActive timestamp
        sheet.getRange(targetRow, colMap.last_active).setValue(nowFormatted);
        if (colMap.live_status) {
          sheet.getRange(targetRow, colMap.live_status).setValue("🟢 Online");
        }

        var curStatus = String(sheet.getRange(targetRow, colMap.status).getValue() || "Pending").trim();
        var curExpiry = String(sheet.getRange(targetRow, colMap.expiry_date).getValue() || "").trim();
        var curPlan = String(sheet.getRange(targetRow, colMap.plan_type).getValue() || planType).trim();
        var finalName = String(sheet.getRange(targetRow, colMap.client_name).getValue() || clientName).trim();
        var finalEmail = String(sheet.getRange(targetRow, colMap.email).getValue() || email).trim();
        var finalMobile = String(sheet.getRange(targetRow, colMap.mobile).getValue() || mobile).trim();

        return responseJson({
          success: true,
          found: true,
          status: curStatus,
          client_name: finalName,
          name: finalName,
          email: finalEmail,
          mobile: finalMobile,
          phone: finalMobile,
          plan_type: curPlan,
          expiry_date: curExpiry,
          last_active: nowFormatted,
          message: "Login successful"
        });
      } else {
        // User not found in sheet
        return responseJson({
          success: false,
          found: false,
          status: "NOT_FOUND",
          message: "User not found in license sheet"
        });
      }
    }

    // ── 4. ADMIN STATUS OVERRIDE ─────────────────────────────────────
    if (action === "update_status" && data.status) {
      if (targetRow > 0) {
        var newStatus = normalizeStatus(data.status);
        sheet.getRange(targetRow, colMap.status).setValue(newStatus);
        if (expiryDate) {
          sheet.getRange(targetRow, colMap.expiry_date).setValue(expiryDate);
        }
        return responseJson({ success: true, status: newStatus, message: "Status updated" });
      }
      return responseJson({ success: false, message: "User not found for status update" });
    }

    // ── 5. REGISTRATION (SAFE APPEND - NO OVERWRITE) ─────────────────
    if (targetRow > 0) {
      // User already exists! DO NOT overwrite status or clear data!
      var existingStatus = String(sheet.getRange(targetRow, colMap.status).getValue() || "Pending").trim();
      var existingExpiry = String(sheet.getRange(targetRow, colMap.expiry_date).getValue() || "").trim();
      var existingPlan = String(sheet.getRange(targetRow, colMap.plan_type).getValue() || planType).trim();
      var existingName = String(sheet.getRange(targetRow, colMap.client_name).getValue() || clientName).trim();

      // Only update MachineID if currently empty
      if (machineId) {
        var existingMachine = String(sheet.getRange(targetRow, colMap.machine_id).getValue() || "").trim();
        if (!existingMachine) {
          sheet.getRange(targetRow, colMap.machine_id).setValue(machineId);
        }
      }
      sheet.getRange(targetRow, colMap.last_active).setValue(nowFormatted);

      return responseJson({
        success: true,
        already_exists: true,
        found: true,
        status: existingStatus,
        expiry_date: existingExpiry,
        plan_type: existingPlan,
        client_name: existingName,
        message: "User already exists with status: " + existingStatus
      });

    } else {
      // NEW USER: Safely append at true last non-empty row
      if (!expiryDate) {
        var d = new Date();
        d.setDate(d.getDate() + 7);
        expiryDate = Utilities.formatDate(d, "GMT+5:30", "yyyy-MM-dd");
      }

      var maxCols = Math.max(sheet.getLastColumn(), 10);
      var newRow = [];
      for (var c = 1; c <= maxCols; c++) {
        if (c === colMap.machine_id) newRow.push(machineId);
        else if (c === colMap.client_name) newRow.push(clientName);
        else if (c === colMap.email) newRow.push(email);
        else if (c === colMap.mobile) newRow.push(mobile);
        else if (c === colMap.plan_type) newRow.push(planType);
        else if (c === colMap.expiry_date) newRow.push(expiryDate);
        else if (c === colMap.status) newRow.push(status);
        else if (c === colMap.last_active) newRow.push(nowFormatted);
        else if (c === colMap.live_status) newRow.push("⚪ Offline");
        else if (c === colMap.total_logins) newRow.push(0);
        else newRow.push("");
      }

      // Find true last row to prevent overwriting or appending after empty validation rows
      var trueLastRow = getTrueLastRow(sheet);
      var insertRow = trueLastRow + 1;
      sheet.getRange(insertRow, 1, 1, newRow.length).setValues([newRow]);

      return responseJson({
        success: true,
        found: true,
        row: insertRow,
        status: status,
        expiry_date: expiryDate,
        plan_type: planType,
        message: "New user safely registered at row " + insertRow
      });
    }

  } catch (err) {
    return responseJson({
      success: false,
      error: err.toString()
    });
  }
}

// ── VERIFY HANDLER ───────────────────────────────────────────────────
function handleVerify(sheet, query) {
  var colMap = getColumnMapping(sheet);
  var row = findUserRow(sheet, colMap, query.email, query.mobile, query.machine_id);
  if (row > 0) {
    var status = String(sheet.getRange(row, colMap.status).getValue() || "Pending").trim();
    var expiry = String(sheet.getRange(row, colMap.expiry_date).getValue() || "").trim();
    var plan = String(sheet.getRange(row, colMap.plan_type).getValue() || "FREE TRIAL").trim();
    var name = String(sheet.getRange(row, colMap.client_name).getValue() || "").trim();
    var email = String(sheet.getRange(row, colMap.email).getValue() || "").trim();
    var mobile = String(sheet.getRange(row, colMap.mobile).getValue() || "").trim();
    var machineId = String(sheet.getRange(row, colMap.machine_id).getValue() || "").trim();

    return responseJson({
      success: true,
      found: true,
      row: row,
      status: status,
      client_name: name,
      name: name,
      email: email,
      mobile: mobile,
      phone: mobile,
      machine_id: machineId,
      plan_type: plan,
      expiry_date: expiry
    });
  }
  return responseJson({
    success: false,
    found: false,
    status: "NOT_FOUND",
    message: "No user found matching identifier"
  });
}

// ── FIND TRUE LAST NON-EMPTY ROW ─────────────────────────────────────
function getTrueLastRow(sheet) {
  var lastRow = sheet.getLastRow();
  if (lastRow <= 1) return 1;
  var colMap = getColumnMapping(sheet);
  // Check main columns (ClientName, Email, Mobile, MachineID)
  var data = sheet.getRange(1, 1, lastRow, Math.max(sheet.getLastColumn(), 8)).getValues();
  for (var r = data.length - 1; r >= 1; r--) {
    var row = data[r];
    var mId = String(row[colMap.machine_id - 1] || "").trim();
    var name = String(row[colMap.client_name - 1] || "").trim();
    var email = String(row[colMap.email - 1] || "").trim();
    var mobile = String(row[colMap.mobile - 1] || "").trim();
    if (mId || name || email || mobile) {
      return r + 1; // 1-based row index
    }
  }
  return 1;
}

// ── ROBUST USER ROW SEARCH ───────────────────────────────────────────
function findUserRow(sheet, colMap, email, mobile, machineId) {
  var trueLast = getTrueLastRow(sheet);
  if (trueLast <= 1) return -1;
  var maxCols = Math.max(sheet.getLastColumn(), 10);
  var data = sheet.getRange(2, 1, trueLast - 1, maxCols).getValues();

  var cleanEmail = String(email || "").trim().toLowerCase();
  var rawMobile = String(mobile || "").trim();
  var cleanMobileDigits = rawMobile.replace(/[^0-9]/g, "");
  var cleanMachine = String(machineId || "").trim();

  // PASS 1: Exact Email Match (case-insensitive)
  if (cleanEmail && cleanEmail.includes("@")) {
    for (var i = 0; i < data.length; i++) {
      var rowEmail = String(data[i][colMap.email - 1] || "").trim().toLowerCase();
      if (rowEmail === cleanEmail) {
        return i + 2;
      }
    }
  }

  // PASS 2: Mobile Digits Match (last 10 digits)
  if (cleanMobileDigits && cleanMobileDigits.length >= 7) {
    var checkDigits = cleanMobileDigits.slice(-10);
    for (var j = 0; j < data.length; j++) {
      var rowMobile = String(data[j][colMap.mobile - 1] || "").replace(/[^0-9]/g, "");
      if (rowMobile && (rowMobile.slice(-10) === checkDigits || rowMobile === cleanMobileDigits)) {
        return j + 2;
      }
    }
  }

  // PASS 3: MachineID Match (ONLY if cleanMachine is provided and not generic)
  if (cleanMachine && !cleanMachine.startsWith("WEB-") && cleanMachine.length > 5) {
    for (var k = 0; k < data.length; k++) {
      var rowMachine = String(data[k][colMap.machine_id - 1] || "").trim();
      if (rowMachine && rowMachine === cleanMachine) {
        return k + 2;
      }
    }
  }

  return -1;
}

// ── NORMALIZE STATUS TO MATCH DATA VALIDATION DROPDOWN ────────────────
function normalizeStatus(st) {
  var s = String(st || "Pending").trim().toLowerCase();
  if (s === "active") return "Active";
  if (s === "blocked" || s === "expired") return "Blocked";
  return "Pending";
}

// ── DYNAMIC COLUMN MAPPING ───────────────────────────────────────────
function getColumnMapping(sheet) {
  var lastCol = Math.max(sheet.getLastColumn(), 10);
  var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  var map = {
    machine_id: 1,
    client_name: 2,
    email: 3,
    mobile: 4,
    plan_type: 5,
    expiry_date: 6,
    status: 7,
    last_active: 8,
    live_status: 9,
    total_logins: 10
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
    else if (h.includes("last") || (h.includes("active") && !h.includes("live"))) map.last_active = i + 1;
    else if (h.includes("live") || h.includes("online")) map.live_status = i + 1;
    else if (h.includes("login") || h.includes("count")) map.total_logins = i + 1;
  }
  return map;
}

// ── FETCH ALL USERS ──────────────────────────────────────────────────
function fetchAllUsers(sheet) {
  var colMap = getColumnMapping(sheet);
  var trueLast = getTrueLastRow(sheet);
  var users = [];
  if (trueLast > 1) {
    var maxCols = Math.max(sheet.getLastColumn(), 10);
    var data = sheet.getRange(2, 1, trueLast - 1, maxCols).getValues();
    for (var i = 0; i < data.length; i++) {
      var row = data[i];
      var email = String(row[colMap.email - 1] || "").trim().toLowerCase();
      var mobile = String(row[colMap.mobile - 1] || "").trim();
      var machineId = String(row[colMap.machine_id - 1] || "").trim();
      var clientName = String(row[colMap.client_name - 1] || "").trim();
      var plan = String(row[colMap.plan_type - 1] || "FREE TRIAL").trim();
      var expiry = String(row[colMap.expiry_date - 1] || "").trim();
      var status = String(row[colMap.status - 1] || "Pending").trim();
      var lastActive = String(row[colMap.last_active - 1] || "").trim();

      if (email || mobile || machineId || clientName) {
        users.push({
          row: i + 2,
          machine_id: machineId,
          client_name: clientName,
          name: clientName,
          email: email,
          mobile: mobile,
          phone: mobile,
          plan_type: plan,
          expiry_date: expiry,
          status: status,
          last_active: lastActive
        });
      }
    }
  }
  return { success: true, count: users.length, users: users };
}

// ── SHEET ACQUISITION ────────────────────────────────────────────────
function getLicensesSheet(ss) {
  var sheet = ss.getSheetByName("Shariyah Software Licenses") ||
              ss.getSheetByName("Licenses") ||
              ss.getSheetByName("Sheet1") ||
              ss.getSheets()[0];
  ensureLicenseHeaders(sheet);
  return sheet;
}

function ensureLicenseHeaders(sheet) {
  var lastCol = sheet.getLastColumn();
  if (lastCol === 0) {
    sheet.appendRow(["MachineID", "ClientName", "Email", "Mobile", "PlanType", "ExpiryDate", "Status", "LastActive"]);
    var headerRange = sheet.getRange(1, 1, 1, 8);
    headerRange.setFontWeight("bold");
    headerRange.setBackground("#0f172a");
    headerRange.setFontColor("#f8fafc");
    sheet.setFrozenRows(1);
  }
}

function responseJson(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
