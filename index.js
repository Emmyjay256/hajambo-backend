import express from "express";
import cors from "cors";
import bodyParser from "body-parser";

const app = express();
const PORT = process.env.PORT || 3000;

// middleware
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// health check
app.get("/", (req, res) => {
  res.send("Hajambo Backend is running ✅");
});

// webhooks (placeholders)
app.post("/webhooks/sms", (req, res) => {
  console.log("Inbound SMS:", req.body);
  res.status(200).send("OK");
});

app.post("/webhooks/sms/dlr", (req, res) => {
  console.log("Delivery Report:", req.body);
  res.status(200).send("OK");
});

app.post("/webhooks/ussd", (req, res) => {
  console.log("USSD Request:", req.body);
  // sample USSD menu
  const response = "CON Welcome to Hajambo!\n1. Register\n2. About Us";
  res.set("Content-Type", "text/plain");
  res.send(response);
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
