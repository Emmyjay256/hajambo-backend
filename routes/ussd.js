// routes/ussd.js
import express from "express";
import pool from "../db.js";
import bcrypt from "bcrypt";
import crypto from "crypto";

const router = express.Router();

const messages = {
  en: {
    welcome: "Welcome to Hajambo!",
    askName: "Enter your name (<=20)\n0. Exit",
    mainMenu: "Hajambo\n1. Post\n2. Feed\n3. My posts\n0. Exit",
    enterPost: "Type your post text (<=160)\n0. Exit",
    posted: "Post saved! Thanks for sharing.",
    feedEmpty: "No posts yet. Be the first to post!",
    feedEntry: (p) => `${p.username}: ${p.content.slice(0, 50)}...`,
    myPostsEmpty: "You haven’t posted anything yet.",
    invalid: "Invalid choice.",
  },
};

/** Ensure a ussd_user row */
async function ensureUssdUser(phone, name = null) {
  const found = await pool.query(
    "SELECT id, phone, username FROM ussd_user WHERE phone=$1 LIMIT 1",
    [phone]
  );
  if (found.rowCount > 0) return found.rows[0];

  const base =
    (name && name.trim().slice(0, 20)) ||
    `user_${(phone || "").slice(-4).padStart(4, "0")}`;

  const ins = await pool.query(
    `INSERT INTO ussd_user (phone, username)
     VALUES ($1, $2)
     ON CONFLICT (phone) DO UPDATE SET username = EXCLUDED.username
     RETURNING id, phone, username`,
    [phone, base]
  );
  return ins.rows[0];
}

/** Make (once) a shadow app_user so app feeds keep working unchanged */
async function ensureShadowAppUserForUssd(ussd) {
  const existing = await pool.query(
    "SELECT id FROM app_user WHERE ussd_user_id=$1 LIMIT 1",
    [ussd.id]
  );
  if (existing.rowCount > 0) return existing.rows[0].id;

  const unameBase = (ussd.username || `user_${(ussd.phone || "").slice(-4)}`)
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, "_")
    .slice(0, 20);
  const username = `${unameBase}_${ussd.id}`;

  const randomPass = crypto.randomBytes(16).toString("hex");
  const hash = await bcrypt.hash(randomPass, 10);

  const ins = await pool.query(
    `INSERT INTO app_user (username, password_hash, email, phone, ussd_user_id, source)
     VALUES ($1,$2,$3,$4,$5,'ussd')
     RETURNING id`,
    [username, hash, null, ussd.phone || null, ussd.id]
  );
  return ins.rows[0].id;
}

/** Save a post into public.post with BOTH user_id and ussd_user_id */
// 1) Replace savePost with this:
async function savePost(appUserId, text) {
  const trimmed = (text || "").slice(0, 160);
  await pool.query(
    `INSERT INTO post (user_id, type, content, created_at)
     VALUES ($1, 'post', $2, NOW())`,
    [appUserId, trimmed]
  );
}

/** Latest feed */
async function getFeed(limit = 3) {
  const r = await pool.query(
    `SELECT p.content,
            COALESCE(u1.username, u2.username, 'Someone') AS username
     FROM post p
     LEFT JOIN ussd_user u1 ON u1.id = p.ussd_user_id
     LEFT JOIN app_user  u2 ON u2.id = p.user_id
     WHERE p.type='post'
     ORDER BY p.created_at DESC
     LIMIT $1`,
    [limit]
  );
  return r.rows;
}

/** Caller’s posts (works for both ussd_user and its shadow app_user) */
async function getMyPosts(ussdUserId, limit = 3) {
  const r = await pool.query(
    `SELECT content
     FROM post
     WHERE (ussd_user_id = $1 OR user_id IN (
              SELECT id FROM app_user WHERE ussd_user_id = $1
           ))
       AND type='post'
     ORDER BY created_at DESC
     LIMIT $2`,
    [ussdUserId, limit]
  );
  return r.rows;
}

router.post("/", async (req, res) => {
  const { phoneNumber, text } = req.body;
  const parts = (text || "").split("*").filter(Boolean);
  const lang = "en";

  try {
    // Do we already know this user?
    const exists = await pool.query(
      "SELECT id FROM ussd_user WHERE phone=$1 LIMIT 1",
      [phoneNumber]
    );
    const firstTime = exists.rowCount === 0;

    // 0) First screen
    if (parts.length === 0) {
      const screen = firstTime ? messages[lang].askName : messages[lang].mainMenu;
      res.set("Content-Type", "text/plain");
      return res.send(`CON ${screen}`);
    }

    // 1) Name capture (first-time only)
    if (firstTime && parts.length === 1) {
      const name = parts[0].trim().slice(0, 20);
      if (name === "0") return res.send("END Bye!");
      await ensureUssdUser(phoneNumber, name);
      res.set("Content-Type", "text/plain");
      return res.send(`CON ${messages[lang].mainMenu}`);
    }

    // After here: user exists for sure
    const ussd = firstTime
      ? await ensureUssdUser(phoneNumber, parts[0])
      : await ensureUssdUser(phoneNumber);

    // Dynamic offset:
    // - firstTime session flow accumulates: "Name*1*Hello" → offset=1 (choice at parts[1])
    // - returning user flow: "1*Hello" → offset=0 (choice at parts[0])
    const offset = firstTime ? 1 : 0;

    const choice = parts[offset] || "";
    const hasOnlyChoice = parts.length === offset + 1;

    if (hasOnlyChoice) {
      if (choice === "1") {
        res.set("Content-Type", "text/plain");
        return res.send(`CON ${messages[lang].enterPost}`);
      } else if (choice === "2") {
        const feed = await getFeed();
        const out =
          feed.length === 0
            ? `END ${messages[lang].feedEmpty}`
            : `END Latest:\n${feed.map(messages[lang].feedEntry).join("\n")}`;
        res.set("Content-Type", "text/plain");
        return res.send(out);
      } else if (choice === "3") {
        const mine = await getMyPosts(ussd.id);
        const out =
          mine.length === 0
            ? `END ${messages[lang].myPostsEmpty}`
            : `END Your posts:\n${mine
                .map((p, i) => `${i + 1}. ${p.content.slice(0, 50)}...`)
                .join("\n")}`;
        res.set("Content-Type", "text/plain");
        return res.send(out);
      } else if (choice === "0") {
        return res.send("END Bye!");
      } else {
        return res.send(`END ${messages[lang].invalid}`);
      }
    }

    // Posting step: needs 2 segments after offset → choice + postText
    // 2) In the posting branch, change the call:
if (choice === "1" && parts.length === offset + 2) {
  const postText = parts[offset + 1] || "";
  const appUserId = await ensureShadowAppUserForUssd(ussd);
  await savePost(appUserId, postText);   // <-- only user_id now
  res.set("Content-Type", "text/plain");
  return res.send(`END ${messages[lang].posted}`);
}

    res.set("Content-Type", "text/plain");
    return res.send(`END ${messages[lang].invalid}`);
  } catch (err) {
    console.error("USSD error:", err);
    res.status(200).send("END Internal error");
  }
});

export default router;
