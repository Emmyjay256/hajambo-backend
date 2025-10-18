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

/**
 * Ensure a row exists in ussd_user for this phone.
 * Returns { id, phone, username }.
 */
async function ensureUssdUser(phone, name = null) {
  const found = await pool.query(
    "SELECT id, phone, username FROM ussd_user WHERE phone=$1 LIMIT 1",
    [phone]
  );
  if (found.rowCount > 0) return found.rows[0];

  const safePhone = phone || "";
  const uname =
    (name && name.trim().slice(0, 20)) ||
    `user_${safePhone.slice(-4) || Math.floor(Math.random() * 10000)
      .toString()
      .padStart(4, "0")}`;

  const ins = await pool.query(
    `INSERT INTO ussd_user (phone, username)
     VALUES ($1, $2)
     ON CONFLICT (phone) DO UPDATE SET username = EXCLUDED.username
     RETURNING id, phone, username`,
    [phone, uname]
  );
  return ins.rows[0];
}

/**
 * Create (once) a shadow app_user for a given ussd_user,
 * so app feeds keep using post.user_id → app_user.id.
 * Returns the shadow app_user.id.
 */
async function ensureShadowAppUserForUssd(ussd) {
  const existing = await pool.query(
    "SELECT id FROM app_user WHERE ussd_user_id=$1 LIMIT 1",
    [ussd.id]
  );
  if (existing.rowCount > 0) return existing.rows[0].id;

  const base = (ussd.username || `user_${(ussd.phone || "").slice(-4)}`)
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, "_")
    .slice(0, 20);
  const username = `${base}_${ussd.id}`; // avoid collisions

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

/**
 * Insert a post into public.post, writing BOTH:
 *   - user_id       → shadow app_user.id (what the app expects)
 *   - ussd_user_id  → ussd_user.id (for provenance/analytics)
 */
async function savePost(appUserId, ussdUserId, text) {
  const trimmed = (text || "").slice(0, 160);
  await pool.query(
    `INSERT INTO post (user_id, ussd_user_id, type, content, created_at)
     VALUES ($1, $2, 'post', $3, NOW())`,
    [appUserId, ussdUserId, trimmed]
  );
}

/** Latest feed: prefer USSD username, then app username, else “Someone”. */
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

/** Caller’s posts (works for both ussd_user.id and shadow app_user.id). */
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
    // First screen: ask for name if first-time, else main menu
    if (parts.length === 0) {
      const exists = await pool.query(
        "SELECT id FROM ussd_user WHERE phone=$1 LIMIT 1",
        [phoneNumber]
      );
      const first = exists.rowCount === 0;
      const screen = first ? messages[lang].askName : messages[lang].mainMenu;
      res.set("Content-Type", "text/plain");
      return res.send(`CON ${screen}`);
    }

    // Name capture
    if (parts.length === 1) {
      const name = (parts[0] || "").trim().slice(0, 20);
      if (name === "0") return res.send("END Bye!");
      await ensureUssdUser(phoneNumber, name);
      res.set("Content-Type", "text/plain");
      return res.send(`CON ${messages[lang].mainMenu}`);
    }

    // Past first step → ensure user present
    const ussd = await ensureUssdUser(phoneNumber);
    const choice = parts[1];

    if (parts.length === 2) {
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

    // Posting flow: parts === 3 and choice === "1"
    if (parts.length === 3 && choice === "1") {
      const postText = parts[2] || "";
      const appUserId = await ensureShadowAppUserForUssd(ussd);
      await savePost(appUserId, ussd.id, postText);
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
