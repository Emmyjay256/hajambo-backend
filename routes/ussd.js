import express from "express";
import pool from "../db.js";

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

async function ensureUser(phone, name = null) {
  const found = await pool.query(
    "SELECT id, username FROM ussd_user WHERE phone=$1 LIMIT 1",
    [phone]
  );
  if (found.rowCount > 0) return found.rows[0];

  const uname = name || `user_${phone.slice(-4)}`;
  const ins = await pool.query(
    `INSERT INTO ussd_user (phone, username)
     VALUES ($1, $2)
     ON CONFLICT (phone) DO UPDATE SET username = EXCLUDED.username
     RETURNING id, username`,
    [phone, uname]
  );
  return ins.rows[0];
}

// savePost: write into public.post and fill BOTH user_id and ussd_user_id
async function savePost(userId, text) {
  const trimmed = (text || "").slice(0, 160);
  await pool.query(
    `INSERT INTO post (user_id, ussd_user_id, type, content, created_at)
     VALUES ($1, $1, 'post', $2, NOW())`,
    [userId, trimmed]
  );
}

// getFeed: read from public.post; prefer ussd_user.username then app_user.username
async function getFeed(limit = 3) {
  const r = await pool.query(
    `SELECT p.content,
            COALESCE(u1.username, u2.username, 'Someone') AS username
     FROM post p
     LEFT JOIN ussd_user u1 ON u1.id = p.ussd_user_id
     LEFT JOIN app_user  u2 ON u2.id = p.user_id
     WHERE p.type = 'post'
     ORDER BY p.created_at DESC
     LIMIT $1`,
    [limit]
  );
  return r.rows;
}

// getMyPosts: allow either ussd_user_id or user_id to match the caller
async function getMyPosts(userId, limit = 3) {
  const r = await pool.query(
    `SELECT content
     FROM post
     WHERE (ussd_user_id = $1 OR user_id = $1) AND type = 'post'
     ORDER BY created_at DESC
     LIMIT $2`,
    [userId, limit]
  );
  return r.rows;
}
router.post("/", async (req, res) => {
  const { phoneNumber, text } = req.body;
  const parts = (text || "").split("*").filter(Boolean);
  const lang = "en";
  let response = "";

  try {
    if (parts.length === 0) {
      const exists = await pool.query(
        "SELECT id FROM ussd_user WHERE phone=$1 LIMIT 1",
        [phoneNumber]
      );
      response =
        exists.rowCount === 0
          ? `CON ${messages[lang].askName}`
          : `CON ${messages[lang].mainMenu}`;
      res.set("Content-Type", "text/plain");
      return res.send(response);
    }

    if (parts.length === 1) {
      const name = parts[0].trim();
      if (name === "0") return res.send("END Bye!");
      await ensureUser(phoneNumber, name);
      res.set("Content-Type", "text/plain");
      return res.send(`CON ${messages[lang].mainMenu}`);
    }

    const user = await ensureUser(phoneNumber);
    const choice = parts[1];

    if (parts.length === 2) {
      if (choice === "1") {
        response = `CON ${messages[lang].enterPost}`;
      } else if (choice === "2") {
        const feed = await getFeed();
        response =
          feed.length === 0
            ? `END ${messages[lang].feedEmpty}`
            : `END Latest:\n${feed.map(messages[lang].feedEntry).join("\n")}`;
      } else if (choice === "3") {
        const mine = await getMyPosts(user.id);
        response =
          mine.length === 0
            ? `END ${messages[lang].myPostsEmpty}`
            : `END Your posts:\n${mine
                .map((p, i) => `${i + 1}. ${p.content.slice(0, 50)}...`)
                .join("\n")}`;
      } else if (choice === "0") {
        response = "END Bye!";
      } else {
        response = `END ${messages[lang].invalid}`;
      }
    } else if (parts.length === 3 && choice === "1") {
      const postText = parts[2] || "";
      await savePost(user.id, postText);
      response = `END ${messages[lang].posted}`;
    } else {
      response = `END ${messages[lang].invalid}`;
    }

    res.set("Content-Type", "text/plain");
    res.send(response);
  } catch (err) {
    console.error("USSD error:", err);
    res.status(200).send("END Internal error");
  }
});

export default router;
