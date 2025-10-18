import express from "express";
import pool from "../db.js";

const router = express.Router();

function cut(s, n) { return (s || "").replace(/\s+/g, " ").slice(0, n); }

async function getUssdUser(phone) {
  const r = await pool.query("SELECT * FROM ussd_user WHERE phone=$1", [phone]);
  return r.rows[0] || null;
}

async function createUssdUser(phone, name) {
  const r = await pool.query(
    "INSERT INTO ussd_user (phone, display_name, language) VALUES ($1,$2,'en') RETURNING *",
    [phone, name || "User"]
  );
  return r.rows[0];
}

router.post("/", async (req, res) => {
  res.set("Content-Type", "text/plain");
  const { phoneNumber, text } = req.body || {};
  const parts = (text || "").split("*").filter(Boolean);
  let u = await getUssdUser(phoneNumber);

  if (!u) {
    if (parts.length === 0) {
      return res.send("CON Enter your name (<=20)\n0. Exit");
    }
    if (parts[0] === "0") {
      return res.send("END Bye");
    }
    const name = cut(parts[0], 20);
    u = await createUssdUser(phoneNumber, name);
    return res.send("CON Hajambo\n1. Post\n2. Feed\n3. My posts\n0. Exit");
  }

  if (parts.length === 0) {
    return res.send("CON Hajambo\n1. Post\n2. Feed\n3. My posts\n0. Exit");
  }

  const root = parts[0];

  if (root === "0") {
    return res.send("END Bye");
  }

  if (root === "1") {
    if (parts.length === 1) {
      return res.send("CON Type your post (<=240)\n0. Back");
    }
    if (parts[1] === "0") {
      return res.send("CON Hajambo\n1. Post\n2. Feed\n3. My posts\n0. Exit");
    }
    const content = cut(parts.slice(1).join("*"), 240);
    if (!content) {
      return res.send("CON Type your post (<=240)\n0. Back");
    }
    await pool.query(
      "INSERT INTO post (ussd_user_id, type, content, created_at) VALUES ($1,'post',$2,now())",
      [u.id, content]
    );
    return res.send("CON Posted!\n9. Home\n0. Back");
  }

  if (root === "2") {
    const page = (parts[1] ? parseInt(parts[1], 10) : 1) || 1;
    const pageSize = 3;
    const offset = (page - 1) * pageSize;
    const r = await pool.query(
      `SELECT p.id, p.content, p.created_at,
              COALESCE(au.display_name, uu.display_name, au.username, 'User') AS author
         FROM post p
         LEFT JOIN app_user au ON au.id = p.user_id
         LEFT JOIN ussd_user uu ON uu.id = p.ussd_user_id
        ORDER BY p.created_at DESC
        LIMIT $1 OFFSET $2`,
      [pageSize, offset]
    );
    if (r.rowCount === 0) {
      return res.send("CON Feed\n(No posts)\n0. Back\n9. Home");
    }
    const lines = r.rows.map((row, i) => `${i + 1}. ${cut(row.author,18)}: ${cut(row.content, 82)}`);
    lines.push("7. Next\n0. Back\n9. Home");
    return res.send("CON " + ["Feed"].concat(lines).join("\n"));
  }

  if (root === "3") {
    const r = await pool.query(
      "SELECT id, content FROM post WHERE ussd_user_id=$1 ORDER BY created_at DESC LIMIT 3",
      [u.id]
    );
    if (r.rowCount === 0) {
      return res.send("CON My posts\n(None)\n0. Back\n9. Home");
    }
    const lines = r.rows.map((row, i) => `${i + 1}. ${cut(row.content, 96)}`);
    lines.push("0. Back\n9. Home");
    return res.send("CON " + ["My posts"].concat(lines).join("\n"));
  }

  if (root === "7") {
    const prev = Number(parts[1] || "1");
    const next = isNaN(prev) ? 2 : prev + 1;
    return res.send(`CON Loading...\n2*${next}`);
  }

  if (root === "9") {
    return res.send("CON Hajambo\n1. Post\n2. Feed\n3. My posts\n0. Exit");
  }

  return res.send("CON Hajambo\n1. Post\n2. Feed\n3. My posts\n0. Exit");
});

export default router;
