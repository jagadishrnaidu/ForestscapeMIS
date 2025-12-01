import express from "express";
import { google } from "googleapis";
import cors from "cors";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 8080;

// ====== CONFIG ======
const SHEET_ID =
  process.env.SHEET_ID ||
  "1aXx2vuHjQ3uAfvt1zy9CzviygKBbenKHIp_d76GkhTA"; // your sheet ID
const GOOGLE_SERVICE_KEY = process.env.GOOGLE_SERVICE_KEY;

// change this to EXACT tab name in your sheet (e.g. "Sheet1", "Bookings", etc.)
const SHEET_NAME = process.env.SHEET_NAME || "Sheet1";

if (!GOOGLE_SERVICE_KEY) {
  console.warn("⚠️ GOOGLE_SERVICE_KEY is not set. Make sure it's in your .env");
}

// column names in your Google Sheet (header row)
const COLS = {
  CLUSTER: "Cluster",
  SL_NO: "Sl No.",
  BOOKING_DATE: "Booking Date",
  UNIT_NO: "Unit No.",
  SOLD_STATUS: "SOLD/UNSOLD",
  MODEL: "Model",
  UNIT_TYPE: "Unit Type",
  SBA: "SBA",
  TERRACE_AREA: "Terrace Area",
  SOURCE: "Source",
  TALLY_CUSTOMER_NAME: "Tally Customer Name",
  CUSTOMER_NAME: "Customer name",
  MOBILE: "Mobile Number",
  EMAIL: "Email Id",
  SALE_PRICE: "Sale Price",
  CONSTRUCTION_AGREEMENT: "Construction Agreement",
  SALE_AGREEMENT: "Sale Agreement",
  GROSS_SALE_VALUE_NO_GST: "Gross Sale Value without GST",
  GST_PERCENT: "GST %",
  INTERIORS: "Interiors",
  CAR_PARKING: "Car Parking",
  DOWN_PAYMENT: "Down Payment/ Agreement",
  SCHEME: "Scheme",
  CASHBACK_8: "Cashback @ 8%",
  SA_GROSS_DL1: "Sale Agreement Gross ( Demand Letter 1)",
  DATE_OF_AGREEMENT: "Date of Agreement",
  PRE_BOOKING: "Pre Booking",
  PAYMENT1: "Booking Received ( Payment 1 )",
  PAYMENT2: "Payment 2",
  PAYMENT3: "Payment 3",
  REF_OF_DEMAND: "Ref of Demand",
  DATE_OF_DEMAND: "Date of Demand",
  AMOUNT: "Amount",
  DATE_OF_RECEIPT: "Date of Receipt",
  BANK_ACCOUNT_NAME: "Bank Account Name",
  TX_REF_NO: "Transaction reference Number",
  PAYMENT5: "Payment 5",
  PAYMENT6: "Payment 6",
  PAYMENT7: "Payment 7",
  PAYMENT8: "Payment 8",
  PAYMENT9: "Payment 9",
  PAYMENT10: "Payment 10",
  PAYMENT11: "Payment 11",
  PAYMENT12: "Payment 12",
  PAYMENT13: "Payment 13",
  PAYMENT14: "Payment 14",
  PAYMENT15: "Payment 15",
  GROSS_AMOUNT_RECEIVED: "Gross Amount Received",
  SALE_AGREEMENT_STATUS: "Sale Agreement Status",
  DEMAND_PERCENT: "Demand as on Date (%)",
  DEMAND_VALUE: "Demand as on Date (Value)",
  PENDING_DEMAND: "Pending Demand",
  RECEIVABLES: "Receivables",
  HOME_LOAN_FINANCED_BY: "Home Loan Financed by",
  LOAN_STATUS: "Loan Status"
};

// ====== HELPERS ======

const getSheets = async () => {
  const auth = new google.auth.GoogleAuth({
    credentials: JSON.parse(GOOGLE_SERVICE_KEY),
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"]
  });
  return google.sheets({ version: "v4", auth });
};

const getRows = async () => {
  const sheets = await getSheets();
  const result = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: `'${SHEET_NAME}'!A:AZ`
  });

  const rows = result.data.values || [];
  if (rows.length === 0) return [];

  const headers = rows[0].map((h) => (h || "").trim());
  return rows.slice(1).map((r) =>
    Object.fromEntries(headers.map((h, i) => [h, (r[i] || "").trim()]))
  );
};

// Parse numbers like "1,23,456.78", "₹ 50,000", "50,000-" etc.
const parseNumber = (value) => {
  if (!value) return 0;
  const cleaned = String(value).replace(/[^0-9.\-]/g, "");
  const n = Number(cleaned);
  return isNaN(n) ? 0 : n;
};

// Robust date parser for "Booking Date", "Date of Agreement" etc.
const parseDate = (value) => {
  if (!value) return null;

  // Accept: DD/MM/YYYY, MM/DD/YYYY, DD-MM-YYYY, YYYY-MM-DD, etc.
  const clean = String(value).trim();
  if (!clean) return null;

  // Try simple Date first
  const direct = new Date(clean);
  if (!isNaN(direct.getTime())) return direct;

  // Manual fallback
  const parts = clean.split(/[\/\-\s:]+/);
  if (parts.length < 3) return null;

  let [a, b, c] = parts;
  a = a.trim();
  b = b.trim();
  c = c.trim();

  let day, month, year;

  // If 4-digit year appears first
  if (c.length === 4 && Number(c) > 1900 && Number(c) < 3000) {
    // assume a/b/c = DD/MM/YYYY or MM/DD/YYYY, decide by first part
    if (parseInt(a, 10) > 12) {
      // DD/MM/YYYY
      day = parseInt(a, 10);
      month = parseInt(b, 10);
    } else {
      // MM/DD/YYYY (or DD/MM/YYYY for small days, both ok)
      month = parseInt(a, 10);
      day = parseInt(b, 10);
    }
    year = parseInt(c, 10);
  } else if (a.length === 4 && Number(a) > 1900) {
    // YYYY-MM-DD
    year = parseInt(a, 10);
    month = parseInt(b, 10);
    day = parseInt(c, 10);
  } else {
    // Assume DD/MM/YYYY if first > 12, otherwise MM/DD/YYYY
    if (parseInt(a, 10) > 12) {
      day = parseInt(a, 10);
      month = parseInt(b, 10);
      year = parseInt(c, 10);
    } else {
      month = parseInt(a, 10);
      day = parseInt(b, 10);
      year = parseInt(c, 10);
    }
  }

  if (!day || !month || !year) return null;

  const iso = `${year}-${String(month).padStart(2, "0")}-${String(
    day
  ).padStart(2, "0")}T00:00:00`;
  const d = new Date(iso);
  return isNaN(d.getTime()) ? null : d;
};

const filterByPeriod = (data, period, dateColumn = COLS.BOOKING_DATE) => {
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const endOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);

  const oneWeekAgo = new Date(now);
  oneWeekAgo.setDate(now.getDate() - 7);

  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);

  return data.filter((row) => {
    const d = parseDate(row[dateColumn]);
    if (!d) return false;

    switch (period) {
      case "today":
        return d >= startOfToday && d < endOfToday;
      case "this_week":
        return d >= oneWeekAgo && d <= now;
      case "this_month":
        return d >= startOfMonth && d < endOfMonth;
      default:
        return true;
    }
  });
};

const groupCount = (data, key) => {
  const counts = {};
  data.forEach((row) => {
    const val = (row[key] || "Unknown").trim() || "Unknown";
    counts[val] = (counts[val] || 0) + 1;
  });
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .map(([label, count]) => ({ label, count }));
};

// ====== ROUTES ======

// Health
app.get("/health", (req, res) => {
  res.send("✅ Aiikya Village Booking API running fine!");
});

// 1. Bookings summary (today/this_week/this_month)
app.get("/bookings/summary", async (req, res) => {
  try {
    const { period = "this_month" } = req.query; // today | this_week | this_month
    const data = await getRows();
    const filtered = filterByPeriod(data, period, COLS.BOOKING_DATE);

    const total = filtered.length;
    const sold = filtered.filter(
      (r) => (r[COLS.SOLD_STATUS] || "").toUpperCase().includes("SOLD")
    ).length;
    const unsold = filtered.filter(
      (r) => (r[COLS.SOLD_STATUS] || "").toUpperCase().includes("UNSOLD")
    ).length;

    const byCluster = groupCount(filtered, COLS.CLUSTER);

    res.json({
      period,
      total_bookings: total,
      sold,
      unsold,
      by_cluster: byCluster
    });
  } catch (error) {
    console.error("Error in /bookings/summary:", error);
    res.status(500).json({ error: "Failed to get bookings summary" });
  }
});

// 2. List bookings with filters
//    /bookings?cluster=A&status=SOLD&period=this_month
app.get("/bookings", async (req, res) => {
  try {
    const { cluster, status, period } = req.query;
    let data = await getRows();

    if (period) {
      data = filterByPeriod(data, period, COLS.BOOKING_DATE);
    }

    if (cluster) {
      data = data.filter(
        (r) => (r[COLS.CLUSTER] || "").toLowerCase() === cluster.toLowerCase()
      );
    }

    if (status) {
      data = data.filter((r) =>
        (r[COLS.SOLD_STATUS] || "")
          .toLowerCase()
          .includes(status.toLowerCase())
      );
    }

    res.json({
      count: data.length,
      bookings: data
    });
  } catch (error) {
    console.error("Error in /bookings:", error);
    res.status(500).json({ error: "Failed to list bookings" });
  }
});

// 3. Revenue & demand summary
app.get("/revenue/summary", async (req, res) => {
  try {
    const { period } = req.query; // optional: today | this_week | this_month
    let data = await getRows();
    if (period) {
      data = filterByPeriod(data, period, COLS.BOOKING_DATE);
    }

    let totalSalePrice = 0;
    let totalGrossValueNoGst = 0;
    let totalReceived = 0;
    let totalPendingDemand = 0;
    let totalReceivables = 0;

    data.forEach((r) => {
      totalSalePrice += parseNumber(r[COLS.SALE_PRICE]);
      totalGrossValueNoGst += parseNumber(r[COLS.GROSS_SALE_VALUE_NO_GST]);
      totalReceived += parseNumber(r[COLS.GROSS_AMOUNT_RECEIVED]);
      totalPendingDemand += parseNumber(r[COLS.PENDING_DEMAND]);
      totalReceivables += parseNumber(r[COLS.RECEIVABLES]);
    });

    res.json({
      period: period || "all",
      total_records: data.length,
      total_sale_price: totalSalePrice,
      total_gross_sale_value_without_gst: totalGrossValueNoGst,
      total_gross_amount_received: totalReceived,
      total_pending_demand: totalPendingDemand,
      total_receivables: totalReceivables
    });
  } catch (error) {
    console.error("Error in /revenue/summary:", error);
    res.status(500).json({ error: "Failed to get revenue summary" });
  }
});

// 4. Loan status breakdown
app.get("/loan-status", async (req, res) => {
  try {
    const data = await getRows();

    const financedBy = groupCount(data, COLS.HOME_LOAN_FINANCED_BY);
    const status = groupCount(data, COLS.LOAN_STATUS);

    res.json({
      total_records: data.length,
      financed_by: financedBy,
      loan_status: status
    });
  } catch (error) {
    console.error("Error in /loan-status:", error);
    res.status(500).json({ error: "Failed to get loan status" });
  }
});

// 5. Demand details per booking (basic view)
app.get("/demand/details", async (req, res) => {
  try {
    const data = await getRows();

    const rows = data.map((r) => ({
      cluster: r[COLS.CLUSTER],
      unit_no: r[COLS.UNIT_NO],
      customer_name: r[COLS.CUSTOMER_NAME],
      booking_date: r[COLS.BOOKING_DATE],
      sale_agreement_status: r[COLS.SALE_AGREEMENT_STATUS],
      demand_percent: r[COLS.DEMAND_PERCENT],
      demand_value: r[COLS.DEMAND_VALUE],
      pending_demand: r[COLS.PENDING_DEMAND],
      receivables: r[COLS.RECEIVABLES]
    }));

    res.json({
      count: rows.length,
      entries: rows
    });
  } catch (error) {
    console.error("Error in /demand/details:", error);
    res.status(500).json({ error: "Failed to get demand details" });
  }
});

// 6. Customer lookup by mobile or unit
//    /customer?mobile=9xxxx OR /customer?unit=101
app.get("/customer", async (req, res) => {
  try {
    const { mobile, unit } = req.query;
    if (!mobile && !unit) {
      return res.status(400).json({ error: "Provide mobile or unit query" });
    }

    const data = await getRows();
    let filtered = data;

    if (mobile) {
      const m = mobile.replace(/\D/g, "");
      filtered = filtered.filter((r) =>
        String(r[COLS.MOBILE] || "").replace(/\D/g, "").includes(m)
      );
    }

    if (unit) {
      filtered = filtered.filter(
        (r) => (r[COLS.UNIT_NO] || "").toLowerCase() === unit.toLowerCase()
      );
    }

    res.json({
      count: filtered.length,
      customers: filtered
    });
  } catch (error) {
    console.error("Error in /customer:", error);
    res.status(500).json({ error: "Failed to lookup customer" });
  }
});

// Root
app.get("/", (req, res) => {
  res.send(
    "🌿 Aiikya Village Booking API live.\n" +
      "Endpoints: /health, /bookings/summary, /bookings, /revenue/summary, /loan-status, /demand/details, /customer"
  );
});

app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
});
