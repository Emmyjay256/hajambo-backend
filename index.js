import 'dotenv/config';
import express from "express";
import cors from "cors";
import africastalking from "africastalking";
import pool from "./db.js";
import authRouter from "./routes/auth.js";
import usersRouter from "./routes/users.js";
import postsRouter from "./routes/posts.js";
import messagesRouter from "./routes/messages.js";
import ussdRouter from "./routes/ussd.js";
import conversationsRouter from "./routes/conversations.js";
import multer from "multer";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { requireAuth } from "./middleware/auth.js";

const app = express();
const PORT = process.env.PORT || 3000;

// ✅ global middleware FIRST
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// (optional) debug to confirm body parsing
app.post("/__debug_body", (req, res) => res.json({ body: req.body }));

// ✅ then mount routers
app.use("/auth", authRouter);
app.use("/posts", postsRouter);
app.use("/messages", messagesRouter);
app.use("/webhooks/ussd", ussdRouter);
app.use("/users", usersRouter);
app.use("/conversations", conversationsRouter);

// ====== Uploads / Static ======
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Where to store files on disk
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, "uploads");
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// Multer storage: unique file names
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname || "");
    const name = `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`;
    cb(null, name);
  },
});
const upload = multer({ storage });

// Serve the files back
app.use("/uploads", express.static(UPLOAD_DIR, { maxAge: "30d", immutable: true }));

// Public base (Cloudflare tunnel)
const PUBLIC_BASE = (process.env.PUBLIC_BASE || "").replace(/\/+$/, "");

// POST /upload (auth required)
app.post("/upload", requireAuth, upload.single("file"), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "Missing file" });
  const rel = `/uploads/${req.file.filename}`;
  const url = PUBLIC_BASE ? `${PUBLIC_BASE}${rel}` : rel;
  res.json({ url, path: rel });
});


// --- Africa's Talking client (no hardcoded creds) ---
const at = africastalking({
  username: process.env.AT_USERNAME || "sandbox",
  apiKey: process.env.AT_API_KEY,
});
const SMS = at.SMS;

// --- Optional webhook token guard ---
const AT_WEBHOOK_TOKEN = process.env.AT_WEBHOOK_TOKEN || null;
function requireWebhookToken(req, res, next) {
  if (!AT_WEBHOOK_TOKEN) return next();
  const token = req.query.token || req.headers["x-webhook-token"];
  if (token !== AT_WEBHOOK_TOKEN) return res.status(401).send("Unauthorized");
  next();
}

// ---------------------------
// DB LOOKUPS (stubbed for now)
// Replace these with real DB queries later.
// ---------------------------
async function getTenantConfigByDestination(toNumberOrShortcode) {
  return {
    tenantId: "tenant-001",
    senderId: process.env.AT_DEFAULT_SENDER || undefined, // approved sender in prod
    locale: "en",
    replyTemplate: (text) => `Hajambo! You said: "${text ?? ""}"`,
  };
}

async function getUserPrefsByPhone(phone) {
  return {
    userId: "user-xyz",
    blocked: false,
    locale: "en",
  };
}

// Utility: robust send via SDK
async function sendSms({ to, message, from, enqueue }) {
  const payload = {
    to: Array.isArray(to) ? to : [to],
    message,
    ...(from ? { from } : {}),
    ...(typeof enqueue !== "undefined" ? { enqueue } : {}),
  };
  return SMS.send(payload);
}

// ---------------------------
// Health
// ---------------------------
app.get("/", (_req, res) => res.send("Hajambo Backend is running ✅"));



// ---------------------------
// Db init
// ---------------------------
app.get("/test-db", async (_req, res) => {
  try {
    const r = await pool.query("SELECT NOW() AS now");
    res.json({ ok: true, now: r.rows[0].now });
  } catch (e) {
    console.error("DB error:", e.message);
    res.status(500).json({ ok: false, error: e.message });
  }
});



// ---------------------------
// Inbound SMS → dynamic auto-reply via AT (SDK send)
// ---------------------------
app.post("/webhooks/sms", requireWebhookToken, async (req, res) => {
  try {
    const { from, to, text, id, linkId } = req.body;

    const tenant = await getTenantConfigByDestination(to);
    const user = await getUserPrefsByPhone(from);
    if (user?.blocked) {
      console.log("Blocked user:", from);
      return res.status(200).send("OK");
    }

    const reply = tenant.replyTemplate(text);

    // IMPORTANT: enqueue must be a BOOLEAN for the SDK
    await sendSms({
      to: from,
      message: reply,
      from: tenant.senderId,
      enqueue: true, // ✅ boolean (fixes "enqueue must be a boolean")
    });

    // TODO: persist inbound/outbound records
    // await db.insertInbound({ id, from, to, text, linkId, tenantId: tenant.tenantId });
    // await db.insertOutbound({ to: from, message: reply, tenantId: tenant.tenantId });

    res.status(200).send("OK");
  } catch (err) {
    console.error("Inbound SMS error:", err?.message || err);
    res.status(200).send("OK");
  }
});

// ---------------------------
// Delivery Reports (DLR)
// ---------------------------
app.post("/webhooks/sms/dlr", requireWebhookToken, async (req, res) => {
  try {
    const dlr = req.body; // status, messageId, phoneNumber, networkCode...
    console.log("Delivery Report:", dlr);
    // TODO: db.updateMessageStatus(dlr.messageId, dlr.status, dlr);
    res.status(200).send("OK");
  } catch (err) {
    console.error("DLR error:", err?.message || err);
    res.status(200).send("OK");
  }
});

// ---------------------------
// USSD (CON/END, text/plain)
// ---------------------------
app.post("/webhooks/ussd_legacy", requireWebhookToken, (req, res) => {
  const { sessionId, phoneNumber, text, serviceCode } = req.body;
  console.log("USSD Request:", { sessionId, phoneNumber, serviceCode, text });

  let reply;
  if (!text || text === "") {
    reply = "CON Welcome to Hajambo!\n1. Register\n2. About Us";
  } else if (text === "1") {
    reply = "CON Enter your name:";
  } else if (text.startsWith("1*")) {
    const name = text.split("*")[1] ?? "";
    // TODO: db.saveUser({ phoneNumber, name })
    reply = `END Thanks ${name}! You are registered.`;
  } else if (text === "2") {
    reply = "END Hajambo — community reels & messaging.";
  } else {
    reply = "END Invalid choice.";
  }

  res.set("Content-Type", "text/plain");
  res.send(reply);
});

// ===================================================
// BULK SEND (SDK)  — mirrors AT response structure
// POST /api/sms/send
// Body: { phoneNumbers: ["+256..."], message: "Hi", senderId?: "Hajambo", enqueue?: 1|0 }
// ===================================================
app.post("/api/sms/send", async (req, res) => {
  try {
    const { phoneNumbers, message, senderId, enqueue } = req.body;

    if (!Array.isArray(phoneNumbers) || phoneNumbers.length === 0) {
      return res.status(400).json({ error: "phoneNumbers must be a non-empty array." });
    }
    if (!message) {
      return res.status(400).json({ error: "message is required." });
    }

    // preserve your behavior; pass through enqueue as provided
    const from = senderId || process.env.AT_DEFAULT_SENDER; // optional in sandbox
    const result = await sendSms({ to: phoneNumbers, message, from, enqueue });
    // result already shaped as { SMSMessageData: { Message, Recipients: [...] } }
    return res.status(200).json(result);
  } catch (err) {
    console.error("Bulk send (SDK) error:", err?.response?.data || err?.message || err);
    return res.status(500).json({ error: "Failed to send SMS", detail: err?.message || String(err) });
  }
});

// ===================================================
// BULK SEND (RAW HTTP) — mirrors docs exactly
// POST /api/sms/send-http
// Body: { phoneNumbers: ["+256..."], message: "Hi", senderId?: "Hajambo", enqueue?: 1|0 }
// ===================================================
app.post("/api/sms/send-http", async (req, res) => {
  try {
    const { phoneNumbers, message, senderId, enqueue = 1 } = req.body;
    if (!Array.isArray(phoneNumbers) || phoneNumbers.length === 0) {
      return res.status(400).json({ error: "phoneNumbers must be a non-empty array." });
    }
    if (!message) {
      return res.status(400).json({ error: "message is required." });
    }

    const isSandbox = (process.env.AT_ENV || "sandbox") === "sandbox";
    const base = isSandbox
      ? "https://api.sandbox.africastalking.com"
      : "https://api.africastalking.com";

    const url = `${base}/version1/messaging/bulk`;

    const body = {
      username: process.env.AT_USERNAME || "sandbox",
      message,
      phoneNumbers,
      ...(senderId ? { senderId } : {}),
      enqueue, // 1 or 0 (raw HTTP API accepts numeric flag)
    };

    const r = await fetch(url, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        apiKey: process.env.AT_API_KEY,
      },
      body: JSON.stringify(body),
    });

    const data = await r.json();
    return res.status(r.ok ? 200 : r.status).json(data);
  } catch (err) {
    console.error("Bulk send (HTTP) error:", err?.message || err);
    return res.status(500).json({ error: "Failed to send via HTTP", detail: err?.message || String(err) });
  }
});

// ===================================================
// FETCH INBOX (polling) — GET /api/sms/fetch?lastReceivedId=0
// ===================================================
app.get("/api/sms/fetch", async (req, res) => {
  try {
    const lastReceivedId = req.query.lastReceivedId || "0";
    const isSandbox = (process.env.AT_ENV || "sandbox") === "sandbox";
    const base = isSandbox
      ? "https://api.sandbox.africastalking.com"
      : "https://api.africastalking.com";

    const url = `${base}/version1/messaging?username=${encodeURIComponent(
      process.env.AT_USERNAME || "sandbox"
    )}&lastReceivedId=${encodeURIComponent(lastReceivedId)}`;

    const r = await fetch(url, {
      method: "GET",
      headers: { Accept: "application/json", apiKey: process.env.AT_API_KEY },
    });

    const data = await r.json();
    return res.status(r.ok ? 200 : r.status).json(data);
  } catch (e) {
    console.error("Fetch inbox error:", e?.message || e);
    return res.status(500).json({ error: "Failed to fetch inbox" });
  }
});

app.listen(PORT, "0.0.0.0", () => console.log(`Server running on port ${PORT}`));
