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
    chooseLanguage: "Choose language:\n1. English\n2. Swahili\n0. Exit",
    welcome: "Welcome to Hajambo!",
    askName: "Enter your name (<=20)\n0. Exit",
    mainMenu: "Hajambo\n1. Post\n2. Feed\n3. My posts\n4. Language\n0. Exit",
    langMenu: "Choose language:\n1. English\n2. Swahili\n00. Home  0. Exit",
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
    // Detail view footer (Back to list without ending the session)
    detailFooter: "8. Back\n00. Home  0. Exit",
    noMoreNext: "No more items.",
    noMorePrev: "No previous page.",

    // General
    invalid: "Invalid choice.",
    internalError: "Internal error",
  },
  
  // Future locales go here (e.g., sw, lg) with identical keys
};

messages.sw = {
  // Uboreshaji & urambazaji
  chooseLanguage: "Chagua lugha:\n1. Kiingereza\n2. Kiswahili\n0. Toka",
  welcome: "Karibu Hajambo!",
  askName: "Weka jina lako (<=20)\n0. Toka",
  mainMenu: "Hajambo\n1. Chapisha\n2. Mkusanyiko\n3. Machapisho yangu\n4. Lugha\n0. Toka",
  langMenu: "Chagua lugha:\n1. Kiingereza\n2. Kiswahili\n00. Mwanzo  0. Toka",
  langChanged: "Lugha imesasishwa.",
  goodbye: "Kwa heri!",

  // Uchapishaji
  enterPost: "Andika maandishi ya chapisho (<=160)\n0. Toka",
  posted: "Chapisho limehifadhiwa! Asante kwa kushiriki.",

  // Mkusanyiko / Chapisho langu
  feedTitle: "Mkusanyiko Mpya",
  feedEmpty: "Bado hakuna chapisho. Anza wewe!",
  myPostsTitle: "Machapisho yako",
  myPostsEmpty: "Bado hujaposti chochote.",
  navFooter: "8. Nyuma  9. Ifuatayo\n00. Mwanzo  0. Toka",
  detailFooter: "8. Nyuma\n00. Mwanzo  0. Toka",
  noMoreNext: "Hakuna zaidi.",
  noMorePrev: "Hakuna ukurasa wa nyuma.",

  // Jumla
  invalid: "Chaguo si sahihi.",
  internalError: "Hitilafu ya ndani",
};

/** Utility: safe access to locale (fallback to 'en' if missing) */
function t(lang, key) {
  const loc = messages[lang] || messages.en;
  return (loc && loc[key]) || messages.en[key];
}

/** Utility: preview text with ellipsis only if truncated */
function preview(text, n = 50) {
  if (!text) return "";
  const s = String(text);
  return s.length > n ? s.slice(0, n) + "..." : s;
}

/** Utility: list size per page */
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

/** Ensure a ussd_user row (with language) */
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

/** Save a post into public.post (user_id only) — unchanged */
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

/** Parse navigation segments to a page number and slot selection */
function derivePageAndAction(segments) {
  let page = 1;
  let openSlot = null;

  for (const s of segments) {
    if (s === "9") page += 1;
    else if (s === "8") page = Math.max(1, page - 1);
    else if (["1", "2", "3"].includes(s)) openSlot = Number(s);
  }
  return { page, openSlot };
}

/** Find the first slot token index within segments */
function findSlotIndex(segments) {
  const i = segments.findIndex((s) => ["1", "2", "3"].includes(s));
  return i >= 0 ? i : null;
}

/** FIRST-TIME: language selection (English only for now) */
function resolveFirstTimeLanguage(parts) {
  if (!parts.length) return null;
  const choice = parts[0];
  if (choice === "1") return "en";
  if (choice === "2") return "sw";   // ← add this
  if (choice === "0") return "EXIT";
  return "INVALID";
}

/** Compose list screen with footer */
function buildListScreen(header, lines, footer) {
  const content = [header, ...lines, footer].filter(Boolean).join("\n");
  return content;
}

/** MAIN ROUTE */
router.post("/", async (req, res) => {
  const { phoneNumber, text } = req.body || {};
  const rawParts = (text || "").split("*").filter(Boolean);

  res.set("Content-Type", "text/plain");

  try {
    const existing = await pool.query(
      "SELECT id, phone, username, language FROM ussd_user WHERE phone=$1 LIMIT 1",
      [phoneNumber]
    );
    const userExists = existing.rowCount > 0;

    // 0) First screen
    if (rawParts.length === 0) {
      if (!userExists) {
        return res.send(`CON ${t("en", "chooseLanguage")}`);
      } else {
        const ussd = existing.rows[0];
        const lang = ussd.language || "en";
        return res.send(`CON ${t(lang, "mainMenu")}`);
      }
    }

    // First-time flow: Language -> Name -> Menu
    if (!userExists) {
      const langRes = resolveFirstTimeLanguage(rawParts);
      if (langRes === "EXIT") return res.send(`END ${t("en", "goodbye")}`);
      if (langRes === "INVALID" || langRes === null) {
        return res.send(`CON ${t("en", "invalid")}\n${t("en", "chooseLanguage")}`);
      }
      const chosenLang = langRes; // 'en' today
      if (rawParts.length === 1) {
        return res.send(`CON ${t(chosenLang, "askName")}`);
      }
      // Name capture
      if (rawParts.length >= 2) {
        const name = (rawParts[1] || "").trim().slice(0, 20);
        if (name === "0") return res.send(`END ${t(chosenLang, "goodbye")}`);
        await ensureUssdUser(phoneNumber, name, chosenLang);
        return res.send(`CON ${t(chosenLang, "mainMenu")}`);
      }
    }

    // Returning user
    const ussd = existing.rows[0];
    const lang = (ussd && ussd.language) || "en";

    // Offset heuristic for same-session long path (language + name)
    let offset = 0;
    if (rawParts[0] === "1" && rawParts.length >= 2) offset = 2;

    const parts = rawParts;
    const choice = parts[offset] || "";
    const hasOnlyChoice = parts.length === offset + 1;

    // Global exits/homes
    if (choice === "0" && hasOnlyChoice) return res.send(`END ${t(lang, "goodbye")}`);
    if (choice === "00" && hasOnlyChoice) return res.send(`CON ${t(lang, "mainMenu")}`);

    // Main menu options
    if (hasOnlyChoice) {
      if (choice === "1") {
        return res.send(`CON ${t(lang, "enterPost")}`);
      } else if (choice === "2") {
        const { items } = await getFeedPage(1);
        if (items.length === 0) return res.send(`END ${t(lang, "feedEmpty")}`);
        const lines = items.map(
          (p, idx) => `${idx + 1}) ${p.username}: ${preview(p.content, 50)}`
        );
        const screen = buildListScreen(t(lang, "feedTitle"), lines, t(lang, "navFooter"));
        return res.send(`CON ${screen}`);
      } else if (choice === "3") {
        const { items } = await getMyPostsPage(ussd.id, 1);
        if (items.length === 0) return res.send(`END ${t(lang, "myPostsEmpty")}`);
        const lines = items.map((p, idx) => `${idx + 1}) ${preview(p.content, 50)}`);
        const screen = buildListScreen(t(lang, "myPostsTitle"), lines, t(lang, "navFooter"));
        return res.send(`CON ${screen}`);
      } else if (choice === "4") {
        return res.send(`CON ${t(lang, "langMenu")}`);
      } else {
        return res.send(`CON ${t(lang, "invalid")}\n${t(lang, "mainMenu")}`);
      }
    }

    // Posting flow
    if (choice === "1" && parts.length === offset + 2) {
      const postText = (parts[offset + 1] || "").trim();
      if (postText === "0") return res.send(`END ${t(lang, "goodbye")}`);
      const appUserId = await ensureShadowAppUserForUssd(ussd);
      await savePost(appUserId, postText);
      return res.send(`END ${t(lang, "posted")}`);
    }

    // FEED (paged + detail with Back)
    if (choice === "2") {
      const tail = parts.slice(offset + 1);

      // Home/Exit short-circuit anywhere in tail
      if (tail.includes("00")) return res.send(`CON ${t(lang, "mainMenu")}`);
      if (tail.includes("0")) return res.send(`END ${t(lang, "goodbye")}`);

      const { page, openSlot } = derivePageAndAction(tail);
      const slotIdx = findSlotIndex(tail); // index of 1|2|3 within tail
      const afterSlot = slotIdx != null ? tail.slice(slotIdx + 1) : [];
      const postAction = afterSlot[0] || null; // first action after opening detail

      const { items } = await getFeedPage(page);

      // If no items for computed page, step back gracefully
      if ((items || []).length === 0) {
        const { items: backItems } = await getFeedPage(Math.max(1, page - 1));
        if (backItems.length === 0) return res.send(`END ${t(lang, "feedEmpty")}`);
        const lines = backItems.map(
          (p, idx) => `${idx + 1}) ${p.username}: ${preview(p.content, 50)}`
        );
        const screen = buildListScreen(
          `${t(lang, "feedTitle")}\n${t(lang, "noMoreNext")}`,
          lines,
          t(lang, "navFooter")
        );
        return res.send(`CON ${screen}`);
      }

      // DETAIL VIEW with Back
      if (openSlot && openSlot >= 1 && openSlot <= Math.min(PAGE_SIZE, items.length)) {
        // If user immediately pressed an action after opening detail:
        if (postAction === "8") {
          // Back to SAME PAGE list
          const { items: listItems } = await getFeedPage(page);
          const lines = listItems.map(
            (p, idx) => `${idx + 1}) ${p.username}: ${preview(p.content, 50)}`
          );
          const screen = buildListScreen(t(lang, "feedTitle"), lines, t(lang, "navFooter"));
          return res.send(`CON ${screen}`);
        } else if (postAction === "9") {
          // Jump to NEXT PAGE list
          const { items: nextItems } = await getFeedPage(page + 1);
          if (nextItems.length === 0) {
            const { items: listItems } = await getFeedPage(page);
            const lines = listItems.map(
              (p, idx) => `${idx + 1}) ${p.username}: ${preview(p.content, 50)}`
            );
            const screen = buildListScreen(
              `${t(lang, "feedTitle")}\n${t(lang, "noMoreNext")}`,
              lines,
              t(lang, "navFooter")
            );
            return res.send(`CON ${screen}`);
          }
          const lines = nextItems.map(
            (p, idx) => `${idx + 1}) ${p.username}: ${preview(p.content, 50)}`
          );
          const screen = buildListScreen(t(lang, "feedTitle"), lines, t(lang, "navFooter"));
          return res.send(`CON ${screen}`);
        } else if (postAction === "00") {
          return res.send(`CON ${t(lang, "mainMenu")}`);
        } else if (postAction === "0") {
          return res.send(`END ${t(lang, "goodbye")}`);
        }

        // Show the detail screen (CON) with Back option
        const idx = openSlot - 1;
        const item = items[idx];
        const body = `${item.username}\n"${item.content}"\n${t(lang, "detailFooter")}`;
        return res.send(`CON ${body}`);
      }

      // LIST VIEW
      const lines = items.map(
        (p, idx) => `${idx + 1}) ${p.username}: ${preview(p.content, 50)}`
      );
      const screen = buildListScreen(t(lang, "feedTitle"), lines, t(lang, "navFooter"));
      return res.send(`CON ${screen}`);
    }

    // MY POSTS (paged + detail with Back)
    if (choice === "3") {
      const tail = parts.slice(offset + 1);
      if (tail.includes("00")) return res.send(`CON ${t(lang, "mainMenu")}`);
      if (tail.includes("0")) return res.send(`END ${t(lang, "goodbye")}`);

      const { page, openSlot } = derivePageAndAction(tail);
      const slotIdx = findSlotIndex(tail);
      const afterSlot = slotIdx != null ? tail.slice(slotIdx + 1) : [];
      const postAction = afterSlot[0] || null;

      const { items } = await getMyPostsPage(ussd.id, page);

      if ((items || []).length === 0) {
        const { items: backItems } = await getMyPostsPage(ussd.id, Math.max(1, page - 1));
        if (backItems.length === 0) return res.send(`END ${t(lang, "myPostsEmpty")}`);
        const lines = backItems.map((p, idx) => `${idx + 1}) ${preview(p.content, 50)}`);
        const screen = buildListScreen(
          `${t(lang, "myPostsTitle")}\n${t(lang, "noMoreNext")}`,
          lines,
          t(lang, "navFooter")
        );
        return res.send(`CON ${screen}`);
      }

      // DETAIL VIEW with Back
      if (openSlot && openSlot >= 1 && openSlot <= Math.min(PAGE_SIZE, items.length)) {
        if (postAction === "8") {
          const { items: listItems } = await getMyPostsPage(ussd.id, page);
          const lines = listItems.map((p, idx) => `${idx + 1}) ${preview(p.content, 50)}`);
          const screen = buildListScreen(t(lang, "myPostsTitle"), lines, t(lang, "navFooter"));
          return res.send(`CON ${screen}`);
        } else if (postAction === "9") {
          const { items: nextItems } = await getMyPostsPage(ussd.id, page + 1);
          if (nextItems.length === 0) {
            const { items: listItems } = await getMyPostsPage(ussd.id, page);
            const lines = listItems.map((p, idx) => `${idx + 1}) ${preview(p.content, 50)}`);
            const screen = buildListScreen(
              `${t(lang, "myPostsTitle")}\n${t(lang, "noMoreNext")}`,
              lines,
              t(lang, "navFooter")
            );
            return res.send(`CON ${screen}`);
          }
          const lines = nextItems.map((p, idx) => `${idx + 1}) ${preview(p.content, 50)}`);
          const screen = buildListScreen(t(lang, "myPostsTitle"), lines, t(lang, "navFooter"));
          return res.send(`CON ${screen}`);
        } else if (postAction === "00") {
          return res.send(`CON ${t(lang, "mainMenu")}`);
        } else if (postAction === "0") {
          return res.send(`END ${t(lang, "goodbye")}`);
        }

        const idx = openSlot - 1;
        const item = items[idx];
        const body = `"${item.content}"\n${t(lang, "detailFooter")}`;
        return res.send(`CON ${body}`);
      }

      // LIST VIEW
      const lines = items.map((p, idx) => `${idx + 1}) ${preview(p.content, 50)}`);
      const screen = buildListScreen(t(lang, "myPostsTitle"), lines, t(lang, "navFooter"));
      return res.send(`CON ${screen}`);
    }

    // LANGUAGE CHANGE
    if (choice === "4") {
      const tail = parts.slice(offset + 1);
      if (tail.includes("00")) return res.send(`CON ${t(lang, "mainMenu")}`);
      if (tail.includes("0")) return res.send(`END ${t(lang, "goodbye")}`);

      const sel = tail[0];
      if (!sel) return res.send(`CON ${t(lang, "langMenu")}`);
      if (sel === "1") {
  await setUssdLanguage(ussd.id, "en");
  return res.send(`END ${t("en", "langChanged")}`);
}
if (sel === "2") {                     // ← add this
  await setUssdLanguage(ussd.id, "sw");
  return res.send(`END ${t("sw", "langChanged")}`);
}
      return res.send(`CON ${t(lang, "invalid")}\n${t(lang, "langMenu")}`);
    }

    // Fallback
    return res.send(`CON ${t(lang, "invalid")}\n${t(lang, "mainMenu")}`);
  } catch (err) {
    console.error("USSD error:", err);
    return res.status(200).send(`END ${messages.en.internalError}`);
  }
});

export default router;
