import express from "express";
import cors from "cors";
import bodyParser from "body-parser";
import africastalking from "africastalking";

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

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
  // Example logic:
  // - Identify tenant by 'to' (shortcode or longcode) or USSD serviceCode
  // - Return senderId, reply template, language, etc.
  // TODO: replace with SELECT ... FROM tenants WHERE shortcode = $1
  return {
    tenantId: "tenant-001",
    senderId: process.env.AT_DEFAULT_SENDER || undefined, // set approved sender id in prod
    locale: "en",
    replyTemplate: (text) => `Hajambo! You said: "${text ?? ""}"`,
  };
}

async function getUserPrefsByPhone(phone) {
  // Example user lookup:
  // TODO: replace with SELECT ... FROM users WHERE phone = $1
  return {
    userId: "user-xyz",
    blocked: false,
    locale: "en",
  };
}

// Utility: robust send
async function sendSms({ to, message, from }) {
  // AT expects an array for 'to'
  return SMS.send({ to: Array.isArray(to) ? to : [to], message, from });
}

// ---------------------------
// Health
// ---------------------------
app.get("/", (_req, res) => res.send("Hajambo Backend is running ✅"));

// ---------------------------
// Inbound SMS → dynamic reply via AT
// ---------------------------
app.post("/webhooks/sms", requireWebhookToken, async (req, res) => {
  try {
    // AT posts form-encoded fields: from, to, text, date, id, linkId, networkCode...
    const { from, to, text, id, linkId } = req.body;

    // 1) Identify tenant based on 'to' (shortcode/longcode)
    const tenant = await getTenantConfigByDestination(to);

    // 2) Identify user preferences
    const user = await getUserPrefsByPhone(from);
    if (user?.blocked) {
      // Acknowledge but do not reply
      console.log("Blocked user:", from);
      return res.status(200).send("OK");
    }

    // 3) Craft dynamic reply
    const reply = tenant.replyTemplate(text);

    // 4) Send SMS back to sender using tenant's senderId if available
    await sendSms({ to: from, message: reply, from: tenant.senderId });

    // 5) (Optional) Persist inbound/outbound to DB for audit/analytics
    // await db.insertInbound({ id, from, to, text, linkId, tenantId: tenant.tenantId });
    // await db.insertOutbound({ to: from, message: reply, tenantId: tenant.tenantId });

    // Always 200 to avoid retries
    res.status(200).send("OK");
  } catch (err) {
    console.error("Inbound SMS error:", err?.message || err);
    // Still 200 to prevent webhook retries storm; log & monitor
    res.status(200).send("OK");
  }
});

// ---------------------------
// Delivery Reports (DLR) → update status in DB (later)
// ---------------------------
app.post("/webhooks/sms/dlr", requireWebhookToken, async (req, res) => {
  try {
    // Typical fields: status, messageId, phoneNumber, networkCode, failureReason...
    const dlr = req.body;
    console.log("Delivery Report:", dlr);

    // TODO: db.updateMessageStatus(dlr.messageId, dlr.status, dlr);

    res.status(200).send("OK");
  } catch (err) {
    console.error("DLR error:", err?.message || err);
    res.status(200).send("OK");
  }
});

// ---------------------------
// USSD (dynamic flow by session text)
// ---------------------------
app.post("/webhooks/ussd", requireWebhookToken, (req, res) => {
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

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
