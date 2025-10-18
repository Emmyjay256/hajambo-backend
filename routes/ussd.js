import express from "express";
import pool from "../db.js";

const router = express.Router();

// -----------------------------
// i18n setup (English only for now)
// -----------------------------
const messages = {
  en: {
    welcome: "Welcome to Hajambo!",
    menu: "Hajambo\n1. Post\n2. Feed\n3. My posts\n0. Exit",
    enterName: "Enter your name (<=20)\n0. Exit",
    thanksName: (name) => `Thanks ${name}! You are registered.`,
    enterPost: "Type your post text (<=160)\n0. Exit",
    posted: "Post saved! Thanks for sharing.",
    feedEmpty: "No posts yet. Be the first to post!",
    feedEntry: (p) => `${p.username}: ${p.content.slice(0, 50)}...`,
    myPostsEmpty: "You haven’t posted anything yet.",
    invalid: "Invalid choice.",
  },
};

// -----------------------------
// Helpers
// -----------------------------
async function getOrCreateUser(phone, name = null, lang = "en") {
  const found = await pool.query(
    "SELECT id, username, lang FROM ussd_user WHERE phone=$1 LIMIT 1",
    [phone]
  );
  if (found.rowCount > 0) return found.rows[0];

  const uname = name || `user_${phone.slice(-4)}`;
  const ins = await pool.query(
    `INSERT INTO ussd_user (phone, username, lang)
     VALUES ($1,$2,$3)
     RETURNING id, username, lang`,
    [phone, uname, lang]
  );
  return ins.rows[0];
}

async function savePost(userId, text) {
  await pool.query(
    `INSERT INTO posts (user_id, type, content, created_at)
     VALUES ($1, 'post', $2, NOW())`,
    [userId, text]
  );
}

async function getFeed(limit = 3) {
  const r = await pool.query(
    `SELECT p.content, u.username
     FROM posts p
     JOIN app_user u ON u.id=p.user_id
     WHERE p.type='post'
     ORDER BY p.created_at DESC
     LIMIT $1`,
    [limit]
  );
  return r.rows;
}

async function getUserPosts(userId, limit = 3) {
  const r = await pool.query(
    `SELECT content FROM posts
     WHERE user_id=$1 AND type='post'
     ORDER BY created_at DESC
     LIMIT $2`,
    [userId, limit]
  );
  return r.rows;
}

// -----------------------------
// Main USSD handler
// -----------------------------
router.post("/", async (req, res) => {
  const { sessionId, phoneNumber, text } = req.body;
  const parts = text.split("*").filter((x) => x.length > 0);

  let response = "";
  let lang = "en";

  try {
    // Handle flow
    if (parts.length === 0) {
      response = `CON ${messages[lang].enterName}`;
    } else if (parts.length === 1) {
      const name = parts[0].trim();
      if (name === "0") return res.send("END Bye!");
      await getOrCreateUser(phoneNumber, name, lang);
      response = `CON ${messages[lang].menu}`;
    } else if (parts.length === 2) {
      const [name, choice] = parts;
      const user = await getOrCreateUser(phoneNumber, name, lang);

      switch (choice) {
        case "1":
          response = `CON ${messages[lang].enterPost}`;
          break;
        case "2": {
          const feed = await getFeed();
          if (feed.length === 0)
            response = `END ${messages[lang].feedEmpty}`;
          else {
            const formatted = feed.map(messages[lang].feedEntry).join("\n");
            response = `END Latest:\n${formatted}`;
          }
          break;
        }
        case "3": {
          const myPosts = await getUserPosts(user.id);
          if (myPosts.length === 0)
            response = `END ${messages[lang].myPostsEmpty}`;
          else {
            const formatted = myPosts
              .map((p, i) => `${i + 1}. ${p.content.slice(0, 50)}...`)
              .join("\n");
            response = `END Your posts:\n${formatted}`;
          }
          break;
        }
        case "0":
          response = "END Bye!";
          break;
        default:
          response = `END ${messages[lang].invalid}`;
      }
    } else if (parts.length === 3) {
      const [name, choice, data] = parts;
      const user = await getOrCreateUser(phoneNumber, name, lang);

      if (choice === "1") {
        await savePost(user.id, data);
        response = `END ${messages[lang].posted}`;
      } else {
        response = `END ${messages[lang].invalid}`;
      }
    } else {
      response = `END ${messages[lang].invalid}`;
    }

    res.set("Content-Type", "text/plain");
    res.send(response);
  } catch (err) {
    console.error("USSD error:", err.message);
    res.status(200).send("END Internal error");
  }
});

export default router;
