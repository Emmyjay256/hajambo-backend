import express from "express";
import cors from "cors";
import bodyParser from "body-parser";

const app = express();
const PORT = process.env.PORT || 3000;

// Accept both JSON & x-www-form-urlencoded (AT uses form)
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// simple shared auth (optional but recommended)
const AT_WEBHOOK_TOKEN = process.env.AT_WEBHOOK_TOKEN ?? null;
function requireWebhookToken(req, res, next) {
  if (!AT_WEBHOOK_TOKEN) return next(); // skip if not set
  const token = req.query.token || req.headers["x-webhook-token"];
  if (token !== AT_WEBHOOK_TOKEN) return res.status(401).send("Unauthorized");
  next();
}

// Health
app.get("/", (_, res) => res.send("Hajambo Backend is running ✅"));

// Inbound SMS (AT will POST form fields like text, from, to, date, id, linkId)
app.post("/webhooks/sms", requireWebhookToken, (req, res) => {
  const payload = req.body;
  console.log("Inbound SMS:", payload);
  // TODO: persist or route this into your unified DB/workflows
  res.status(200).send("OK");
});

// Delivery Reports (AT posts messageId, status, phoneNumber, networkCode, ...)
app.post("/webhooks/sms/dlr", requireWebhookToken, (req, res) => {
  const payload = req.body;
  console.log("Delivery Report:", payload);
  // TODO: update message status in DB
  res.status(200).send("OK");
});

// USSD (must respond text/plain; prepend CON or END)
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
