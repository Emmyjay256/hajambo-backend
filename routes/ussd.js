// routes/ussd.js
import express from "express";
import pool from "../db.js";
import bcrypt from "bcrypt";
import crypto from "crypto";

const router = express.Router();

/**
 * MESSAGE CATALOG
 * ---------------
 * Add new languages by copying the `en` keys and translating.
 * Keys must remain identical across locales.
 * Keep strings short (USSD limits ~160-182 chars including CON/END).
 */
const messages = {
  en: {
    // Onboarding & navigation
    chooseLanguage: "Choose language:\n1. English\n0. Exit",
    welcome: "Welcome to Hajambo!",
    askName: "Enter your name (<=20)\n0. Exit",
    mainMenu: "Hajambo\n1. Post\n2. Feed\n3. My posts\n4. Language\n0. Exit",
    langMenu: "Choose language:\n1. English\n00. Home  0. Exit",
    langChanged: "Language updated.",
    goodbye: "Bye!",

    // Posting
    enterPost: "Type your post text (<=160)\n0. Exit",
    posted: "Post saved! Thanks for sharing.",

    // Feed / My posts
    feedTitle: "Latest",
    feedEmpty: "No posts yet. Be the first to post!",
    myPostsTitle: "Your posts",
    myPostsEmpty: "You haven’t posted anything yet.",
    navFooter: "8. Prev  9. Next\n00. Home  0. Exit",
    noMoreNext: "No more items.",
    noMorePrev: "No previous page.",

    // General
    invalid: "Invalid choice.",
    internalError: "Internal error",
  },
  // Add other locales later, e.g.:
  // sw: { ... }, lg: { ... }
};

/** Utility: safe access to locale (fallback to 'en' if missing) */
function t(lang, key) {
  const loc = messages[lang] || messages.en;
  return (loc && loc[key]) || messages.en[key];
}

/** Utility: preview text with ellipsis only if truncated */
function preview(text, n = 50) {
  if (!text) return "";
  const trimmed = String(text);
  return trimmed.length > n ? trimmed.slice(0, n) + "..." : trimmed;
}

/** Utility: per-page size for list screens */
const PAGE_SIZE = 3;

/** Normalize username for shadow account */
function normalizeUsernameBase(username, phone) {
  const base =
    (username || `user_${(phone || "").slice(-4)}`)
      .toLowerCase()
      .replace(/[^a-z0-9_]/g, "_")
      .slice(0, 20) || "user";
  return base;
}

/** Ensure a ussd_user row (now with language) */
async function ensureUssdUser(phone, name = null, language = "en") {
  const found = await pool.query(
    "SELECT id, phone, username, language FROM ussd_user WHERE phone=$1 LIMIT 1",
    [phone]
  );
  if (found.rowCount > 0) return found.rows[0];

  const base =
    (name && name.trim().slice(0, 20)) ||
    `user_${(phone || "").slice(-4).padStart(4, "0")}`;

  const ins = await pool.query(
    `INSERT INTO ussd_user (phone, username, language)
     VALUES ($1, $2, $3)
     ON CONFLICT (phone) DO UPDATE
       SET username = EXCLUDED.username,
           language = EXCLUDED.language
     RETURNING id, phone, username, language`,
    [phone, base, language || "en"]
  );
  return ins.rows[0];
}

/** Update language for an existing ussd_user */
async function setUssdLanguage(ussdId, language = "en") {
  const r = await pool.query(
    `UPDATE ussd_user SET language=$2 WHERE id=$1 RETURNING id, language`,
    [ussdId, language || "en"]
  );
  return r.rows[0];
}

/** Create (once) a shadow app_user so app feeds keep working unchanged */
async function ensureShadowAppUserForUssd(ussd) {
  const existing = await pool.query(
    "SELECT id FROM app_user WHERE ussd_user_id=$1 LIMIT 1",
    [ussd.id]
  );
  if (existing.rowCount > 0) return existing.rows[0].id;

  const unameBase = normalizeUsernameBase(ussd.username, ussd.phone);
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

/** Save a post into public.post (user_id only) — unchanged by request */
async function savePost(appUserId, text) {
  const trimmed = (text || "").slice(0, 160);
  await pool.query(
    `INSERT INTO post (user_id, type, content, created_at)
     VALUES ($1, 'post', $2, NOW())`,
    [appUserId, trimmed]
  );
}

/**
 * FEED (paged): fetch PAGE_SIZE+1 to detect "hasNext" without counting
 * Returns { items: [ {username, content} ], hasNext }
 */
async function getFeedPage(page = 1) {
  const offset = Math.max(0, (page - 1) * PAGE_SIZE);
  const r = await pool.query(
    `
    SELECT p.content,
           COALESCE(u2.username, u1.username, 'Someone') AS username
    FROM post p
    LEFT JOIN app_user  u2 ON u2.id = p.user_id
    LEFT JOIN ussd_user u1 ON u1.id = p.ussd_user_id
    WHERE p.type='post'
    ORDER BY p.created_at DESC
    LIMIT $1 OFFSET $2
    `,
    [PAGE_SIZE + 1, offset]
  );
  const rows = r.rows || [];
  const hasNext = rows.length > PAGE_SIZE;
  const items = hasNext ? rows.slice(0, PAGE_SIZE) : rows;
  return { items, hasNext };
}

/**
 * MY POSTS (paged): fetch PAGE_SIZE+1 to detect "hasNext"
 * Returns { items: [ {content} ], hasNext }
 */
async function getMyPostsPage(ussdUserId, page = 1) {
  const offset = Math.max(0, (page - 1) * PAGE_SIZE);
  const r = await pool.query(
    `
    SELECT content
    FROM post
    WHERE (ussd_user_id = $1 OR user_id IN (
            SELECT id FROM app_user WHERE ussd_user_id = $1
          ))
      AND type='post'
    ORDER BY created_at DESC
    LIMIT $2 OFFSET $3
    `,
    [ussdUserId, PAGE_SIZE + 1, offset]
  );
  const rows = r.rows || [];
  const hasNext = rows.length > PAGE_SIZE;
  const items = hasNext ? rows.slice(0, PAGE_SIZE) : rows;
  return { items, hasNext };
}

/** NAVIGATION: interpret tail segments into a page number and action */
function derivePageAndAction(segments) {
  // segments: array after entering a section root ("2" for Feed, "3" for My posts)
  // Recognized: "9"=next, "8"=prev, "00"=home, "1|2|3"=open item on current page
  let page = 1;
  let openSlot = null;
  let wantsHome = false;

  for (const s of segments) {
    if (s === "9") {
      page += 1;
    } else if (s === "8") {
      page = Math.max(1, page - 1);
    } else if (s === "00") {
      wantsHome = true;
    } else if (["1", "2", "3"].includes(s)) {
      openSlot = Number(s); // 1..3
    } else if (s === "0") {
      // Exit handled at higher level
      // no-op here
    } else {
      // Unknown tokens are ignored at this level; caller shows "Invalid choice."
    }
  }

  return { page, openSlot, wantsHome };
}

/** FIRST-TIME FLOW: language selection (only English enabled today) */
function resolveFirstTimeLanguage(parts) {
  // parts[0] should be language selection ("1" for English)
  if (!parts.length) return null;
  const langChoice = parts[0];
  if (langChoice === "1") return "en";
  if (langChoice === "0") return "EXIT";
  return "INVALID";
}

/** Build a consistent list screen with nav footer */
function buildListScreen(header, lines, footer) {
  const content = [header, ...lines, footer].filter(Boolean).join("\n");
  return content;
}

/** MAIN ROUTE */
router.post("/", async (req, res) => {
  const { phoneNumber, text } = req.body || {};
  const rawParts = (text || "").split("*").filter(Boolean);

  // Always respond in text/plain
  res.set("Content-Type", "text/plain");

  try {
    // Does this user already exist?
    const existing = await pool.query(
      "SELECT id, phone, username, language FROM ussd_user WHERE phone=$1 LIMIT 1",
      [phoneNumber]
    );
    const userExists = existing.rowCount > 0;

    // --------------------------
    // 0) FIRST SCREEN (no input)
    // --------------------------
    if (rawParts.length === 0) {
      if (!userExists) {
        // First-time → Language selection (English only for now)
        return res.send(`CON ${t("en", "chooseLanguage")}`);
      } else {
        const ussd = existing.rows[0];
        const lang = ussd.language || "en";
        return res.send(`CON ${t(lang, "mainMenu")}`);
      }
    }

    // ---------------------------------------
    // FIRST-TIME USER: Language → Name → Menu
    // ---------------------------------------
    if (!userExists) {
      // Step 1: Language selection
      // parts[0] = "1" (English) or "0" (Exit) or invalid
      const langRes = resolveFirstTimeLanguage(rawParts);

      if (langRes === "EXIT") {
        return res.send(`END ${t("en", "goodbye")}`);
      }
      if (langRes === "INVALID" || langRes === null) {
        // Re-show language screen with invalid note
        return res.send(
          `CON ${t("en", "invalid")}\n${t("en", "chooseLanguage")}`
        );
      }

      // From here: language chosen; parts may be:
      // ["1"]                  → askName
      // ["1", "<name>"]        → create user, show main menu
      const chosenLang = langRes; // 'en' today

      if (rawParts.length === 1) {
        // Ask for name in chosen language
        return res.send(`CON ${t(chosenLang, "askName")}`);
      }

      // Name capture
      if (rawParts.length >= 2) {
        const name = (rawParts[1] || "").trim().slice(0, 20);
        if (name === "0") return res.send(`END ${t(chosenLang, "goodbye")}`);

        // Create user with chosen language
        await ensureUssdUser(phoneNumber, name, chosenLang);
        // Show main menu in chosen language
        return res.send(`CON ${t(chosenLang, "mainMenu")}`);
      }
    }

    // ------------------------------------
    // RETURNING USER (or post-onboarding)
    // ------------------------------------
    const ussd = existing.rows[0]; // present by here
    const lang = (ussd && ussd.language) || "en";

    // OFFSET logic:
    // - First-time session accumulates "1*Name*<choice>*..." → offset=2
    // - Returning user flow: "<choice>*..." → offset=0
    // Detect if this looks like a first-time long path within the same USSD session:
    // If the first token is a language choice ("1") and second is a name (any non-empty not "0")
    // but the user now continues with choices, treat offset=2.
    let offset = 0;
    if (rawParts[0] === "1" && rawParts.length >= 2) {
      offset = 2;
    }

    const parts = rawParts;
    const choice = parts[offset] || "";
    const hasOnlyChoice = parts.length === offset + 1;

    // Universal hard exits / home when given as the only segment
    if (choice === "0" && hasOnlyChoice) {
      return res.send(`END ${t(lang, "goodbye")}`);
    }
    if (choice === "00" && hasOnlyChoice) {
      return res.send(`CON ${t(lang, "mainMenu")}`);
    }

    // ----------------
    // MAIN MENU ROUTES
    // ----------------
    if (hasOnlyChoice) {
      if (choice === "1") {
        // Post
        return res.send(`CON ${t(lang, "enterPost")}`);
      } else if (choice === "2") {
        // Feed page 1
        const { items, hasNext } = await getFeedPage(1);
        if (items.length === 0) {
          return res.send(`END ${t(lang, "feedEmpty")}`);
        }
        const lines = items.map(
          (p, idx) => `${idx + 1}) ${p.username}: ${preview(p.content, 50)}`
        );
        const footer = t(lang, "navFooter");
        const screen = buildListScreen(t(lang, "feedTitle"), lines, footer);
        return res.send(`CON ${screen}`);
      } else if (choice === "3") {
        // My posts page 1
        const { items, hasNext } = await getMyPostsPage(ussd.id, 1);
        if (items.length === 0) {
          return res.send(`END ${t(lang, "myPostsEmpty")}`);
        }
        const lines = items.map(
          (p, idx) => `${idx + 1}) ${preview(p.content, 50)}`
        );
        const footer = t(lang, "navFooter");
        const screen = buildListScreen(t(lang, "myPostsTitle"), lines, footer);
        return res.send(`CON ${screen}`);
      } else if (choice === "4") {
        // Language change menu (English only for now)
        return res.send(`CON ${t(lang, "langMenu")}`);
      } else {
        return res.send(`CON ${t(lang, "invalid")}\n${t(lang, "mainMenu")}`);
      }
    }

    // -----------------
    // POSTING BRANCH
    // -----------------
    if (choice === "1" && parts.length === offset + 2) {
      const postText = (parts[offset + 1] || "").trim();
      if (postText === "0") {
        // Exit during enterPost
        return res.send(`END ${t(lang, "goodbye")}`);
      }
      const appUserId = await ensureShadowAppUserForUssd(ussd);
      await savePost(appUserId, postText);
      return res.send(`END ${t(lang, "posted")}`);
    }

    // -----------------
    // FEED (PAGED) BRANCH
    // Root = "2"; everything after it is nav
    // -----------------
    if (choice === "2") {
      const tail = parts.slice(offset + 1);
      // Home/Exit short-circuit
      if (tail.includes("00")) return res.send(`CON ${t(lang, "mainMenu")}`);
      if (tail.includes("0")) return res.send(`END ${t(lang, "goodbye")}`);

      const { page, openSlot } = derivePageAndAction(tail);
      const { items, hasNext } = await getFeedPage(page);

      if ((items || []).length === 0) {
        // If user navigated past the end, step back to nearest valid page
        const { items: backItems } = await getFeedPage(Math.max(1, page - 1));
        if (backItems.length === 0) {
          return res.send(`END ${t(lang, "feedEmpty")}`);
        } else {
          const lines = backItems.map(
            (p, idx) => `${idx + 1}) ${p.username}: ${preview(p.content, 50)}`
          );
          const top = page > 1 ? t(lang, "noMoreNext") : "";
          const screen = buildListScreen(
            `${t(lang, "feedTitle")}${top ? `\n${top}` : ""}`,
            lines,
            t(lang, "navFooter")
          );
          return res.send(`CON ${screen}`);
        }
      }

      // Open a specific item (1..3) on the current page
      if (openSlot && openSlot >= 1 && openSlot <= Math.min(PAGE_SIZE, items.length)) {
        const idx = openSlot - 1;
        const item = items[idx];
        const body = `${item.username}\n"${item.content}"\n00. Home`;
        return res.send(`END ${body}`);
      }

      // Re-render the list page with footer
      const lines = items.map(
        (p, idx) => `${idx + 1}) ${p.username}: ${preview(p.content, 50)}`
      );

      // If user tried prev on first page or next beyond last, prepend a small note.
      // We can’t perfectly detect their exact last action without storing more,
      // but we keep UX pleasant by showing page content regardless.
      const screen = buildListScreen(t(lang, "feedTitle"), lines, t(lang, "navFooter"));
      return res.send(`CON ${screen}`);
    }

    // -----------------
    // MY POSTS (PAGED) BRANCH
    // Root = "3"; everything after it is nav
    // -----------------
    if (choice === "3") {
      const tail = parts.slice(offset + 1);
      if (tail.includes("00")) return res.send(`CON ${t(lang, "mainMenu")}`);
      if (tail.includes("0")) return res.send(`END ${t(lang, "goodbye")}`);

      const { page, openSlot } = derivePageAndAction(tail);
      const { items, hasNext } = await getMyPostsPage(ussd.id, page);

      if ((items || []).length === 0) {
        const { items: backItems } = await getMyPostsPage(ussd.id, Math.max(1, page - 1));
        if (backItems.length === 0) {
          return res.send(`END ${t(lang, "myPostsEmpty")}`);
        } else {
          const lines = backItems.map((p, idx) => `${idx + 1}) ${preview(p.content, 50)}`);
          const top = page > 1 ? t(lang, "noMoreNext") : "";
          const screen = buildListScreen(
            `${t(lang, "myPostsTitle")}${top ? `\n${top}` : ""}`,
            lines,
            t(lang, "navFooter")
          );
          return res.send(`CON ${screen}`);
        }
      }

      if (openSlot && openSlot >= 1 && openSlot <= Math.min(PAGE_SIZE, items.length)) {
        const idx = openSlot - 1;
        const item = items[idx];
        const body = `"${item.content}"\n00. Home`;
        return res.send(`END ${body}`);
      }

      const lines = items.map((p, idx) => `${idx + 1}) ${preview(p.content, 50)}`);
      const screen = buildListScreen(t(lang, "myPostsTitle"), lines, t(lang, "navFooter"));
      return res.send(`CON ${screen}`);
    }

    // -----------------
    // LANGUAGE CHANGE BRANCH
    // Root = "4"
    // -----------------
    if (choice === "4") {
      const tail = parts.slice(offset + 1);
      if (tail.includes("00")) return res.send(`CON ${t(lang, "mainMenu")}`);
      if (tail.includes("0")) return res.send(`END ${t(lang, "goodbye")}`);

      // Only English is available now
      const sel = tail[0];
      if (!sel) {
        return res.send(`CON ${t(lang, "langMenu")}`);
      }
      if (sel === "1") {
        await setUssdLanguage(ussd.id, "en");
        return res.send(`END ${t("en", "langChanged")}`);
      }

      // Any other input → show menu again with invalid
      return res.send(`CON ${t(lang, "invalid")}\n${t(lang, "langMenu")}`);
    }

    // Fallback
    return res.send(`CON ${t(lang, "invalid")}\n${t(lang, "mainMenu")}`);
  } catch (err) {
    console.error("USSD error:", err);
    // Reply 200 with END for USSD gateways
    return res.status(200).send(`END ${messages.en.internalError}`);
  }
});

export default router;
