
const express = require("express");
const session = require("express-session");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

// Environment variables
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const SESSION_SECRET = process.env.SESSION_SECRET;
const GOOGLE_SCRIPT_URL = process.env.GOOGLE_SCRIPT_URL;
const API_SECRET = process.env.API_SECRET;

// Middleware
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));

app.use(
  session({
    name: "vajyayudam.sid",
    secret: SESSION_SECRET || "change-this-secret-before-deployment",
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 1000 * 60 * 60 * 4
    }
  })
);

// Static files
app.use(express.static(path.join(__dirname, "public")));

// Homepage
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// Admin page
app.get("/admin", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "admin.html"));
});

// Health check
app.get("/api/health", (req, res) => {
  res.json({
    success: true,
    message: "VAJYAYUDAM server is running"
  });
});

// Google Apps Script communication
async function sheetsRequest(action, data = {}) {
  if (!GOOGLE_SCRIPT_URL || !API_SECRET) {
    throw new Error("Google Sheets configuration is missing");
  }

  const response = await fetch(GOOGLE_SCRIPT_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      action,
      secret: API_SECRET,
      ...data
    })
  });

  const result = await response.json();

  if (!response.ok || result.success === false) {
    throw new Error(result.message || "Google Sheets request failed");
  }

  return result;
}

// Basic input validation
function requiredFields(body, fields) {
  return fields.every(field => {
    return typeof body[field] === "string" &&
      body[field].trim().length > 0;
  });
}

// Membership registration
app.post("/api/membership", async (req, res) => {
  try {
    const fields = ["name", "mobile", "address", "role"];

    if (!requiredFields(req.body, fields)) {
      return res.status(400).json({
        success: false,
        message: "Please fill all required membership fields"
      });
    }

    const mobile = req.body.mobile.trim();

    if (!/^[6-9]\d{9}$/.test(mobile)) {
      return res.status(400).json({
        success: false,
        message: "Enter a valid 10-digit Indian mobile number"
      });
    }

    const result = await sheetsRequest("saveMembership", {
      name: req.body.name.trim(),
      mobile,
      email: (req.body.email || "").trim(),
      address: req.body.address.trim(),
      role: req.body.role.trim()
    });

    res.status(201).json(result);

  } catch (error) {
    console.error("Membership error:", error.message);
    res.status(500).json({
      success: false,
      message: "Unable to save membership. Please try again."
    });
  }
});

// Complaint submission
app.post("/api/complaint", async (req, res) => {
  try {
    const fields = ["name", "mobile", "category", "description"];

    if (!requiredFields(req.body, fields)) {
      return res.status(400).json({
        success: false,
        message: "Please fill all complaint fields"
      });
    }

    const mobile = req.body.mobile.trim();

    if (!/^[6-9]\d{9}$/.test(mobile)) {
      return res.status(400).json({
        success: false,
        message: "Enter a valid 10-digit Indian mobile number"
      });
    }

    const result = await sheetsRequest("saveComplaint", {
      name: req.body.name.trim(),
      mobile,
      category: req.body.category.trim(),
      description: req.body.description.trim()
    });

    res.status(201).json(result);

  } catch (error) {
    console.error("Complaint error:", error.message);
    res.status(500).json({
      success: false,
      message: "Unable to submit complaint. Please try again."
    });
  }
});

// Administrator login
app.post("/api/admin/login", (req, res) => {
  if (!ADMIN_PASSWORD) {
    return res.status(500).json({
      success: false,
      message: "Admin password is not configured"
    });
  }

  const password = req.body.password;

  if (typeof password !== "string" || password !== ADMIN_PASSWORD) {
    return res.status(401).json({
      success: false,
      message: "Incorrect administrator password"
    });
  }

  req.session.isAdmin = true;

  res.json({
    success: true,
    message: "Login successful"
  });
});

// Administrator authentication middleware
function requireAdmin(req, res, next) {
  if (!req.session || req.session.isAdmin !== true) {
    return res.status(401).json({
      success: false,
      message: "Administrator login required"
    });
  }

  next();
}

// Administrator logout
app.post("/api/admin/logout", requireAdmin, (req, res) => {
  req.session.destroy(error => {
    if (error) {
      return res.status(500).json({
        success: false,
        message: "Logout failed"
      });
    }

    res.clearCookie("vajyayudam.sid");

    res.json({
      success: true,
      message: "Logged out successfully"
    });
  });
});

// Get memberships
app.get("/api/admin/memberships", requireAdmin, async (req, res) => {
  try {
    const result = await sheetsRequest("getMemberships");
    res.json(result.records || []);
  } catch (error) {
    console.error(error.message);
    res.status(500).json({
      success: false,
      message: "Unable to retrieve memberships"
    });
  }
});

// Get complaints
app.get("/api/admin/complaints", requireAdmin, async (req, res) => {
  try {
    const result = await sheetsRequest("getComplaints");
    res.json(result.records || []);
  } catch (error) {
    console.error(error.message);
    res.status(500).json({
      success: false,
      message: "Unable to retrieve complaints"
    });
  }
});

// Update record status
app.post("/api/admin/status", requireAdmin, async (req, res) => {
  try {
    const { type, id, status } = req.body;

    const allowedTypes = ["memberships", "complaints"];
    const allowedStatuses = [
      "New",
      "Pending",
      "Approved",
      "Resolved",
      "Rejected"
    ];

    if (
      !allowedTypes.includes(type) ||
      typeof id !== "string" ||
      !allowedStatuses.includes(status)
    ) {
      return res.status(400).json({
        success: false,
        message: "Invalid status update"
      });
    }

    const result = await sheetsRequest("updateStatus", {
      type,
      id,
      status
    });

    res.json(result);

  } catch (error) {
    console.error(error.message);
    res.status(500).json({
      success: false,
      message: "Unable to update status"
    });
  }
});

// CSV export
app.get("/api/admin/export", requireAdmin, async (req, res) => {
  try {
    const type = req.query.type;

    let result;

    if (type === "memberships") {
      result = await sheetsRequest("getMemberships");
    } else if (type === "complaints") {
      result = await sheetsRequest("getComplaints");
    } else {
      return res.status(400).send("Invalid export type");
    }

    const records = result.records || [];

    if (!records.length) {
      return res.status(404).send("No records available");
    }

    const columns = Object.keys(records[0]);

    function csvValue(value) {
      let text = value == null ? "" : String(value);

      // Prevent CSV formula injection
      if (/^[=+\-@]/.test(text)) {
        text = "'" + text;
      }

      return '"' + text.replace(/"/g, '""') + '"';
    }

    const lines = [
      columns.map(csvValue).join(","),
      ...records.map(record =>
        columns.map(column => csvValue(record[column])).join(",")
      )
    ];

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="vajyayudam-${type}.csv"`
    );

    res.send("\uFEFF" + lines.join("\r\n"));

  } catch (error) {
    console.error(error.message);
    res.status(500).send("Export failed");
  }
});

// Error handler
app.use((error, req, res, next) => {
  console.error("Server error:", error.message);

  res.status(500).json({
    success: false,
    message: "Internal server error"
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`VAJYAYUDAM running on port ${PORT}`);
});
