// routes/ussd.js
import express from "express";
import pool from "../db.js";
import bcrypt from "bcrypt";
import crypto from "crypto";

const router = express.Router();
// LOG: every POST hit to this router
router.use((req, _res, next) => {
  if (req.method === "POST") {
    console.log("[USSD HIT]", {
      phone: req.body?.phoneNumber,
      text: req.body?.text
    });
  }
  next();
});

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
    chooseLanguage: "Choose language:\n1. English\n2. Swahili\n3. Luganda\n4. Runyankore–Rukiga\n5. Runyoro–Rutooro\n6. Acholi\n7. Ateso\n0. Exit",
    welcome: "Welcome to Hajambo!",
    askName: "Enter your name (<=20)\n0. Exit",
    mainMenu: "Hajambo\n1. Post\n2. Feed\n3. My posts\n4. Language\n0. Exit",
    langMenu: "Choose language:\n1. English\n2. Swahili\n3. Luganda\n4. Runyankore–Rukiga\n5. Runyoro–Rutooro\n6. Acholi\n7. Ateso\n00. Home  0. Exit",
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
  chooseLanguage: "Chagua lugha:\n1. Kiingereza\n2. Kiswahili\n3. Luganda\n4. Runyankore–Rukiga\n5. Runyoro–Rutooro\n6. Acholi\n7. Ateso\n0. Toka",
  welcome: "Karibu Hajambo!",
  askName: "Weka jina lako (<=20)\n0. Toka",
  mainMenu: "Hajambo\n1. Chapisha\n2. Mkusanyiko\n3. Machapisho yangu\n4. Lugha\n0. Toka",
  langMenu: "Chagua lugha:\n1. Kiingereza\n2. Kiswahili\n3. Luganda\n4. Runyankore–Rukiga\n5. Runyoro–Rutooro\n6. Acholi\n7. Ateso\n00. Mwanzo  0. Toka",
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

messages.lg = {
  // Onboarding & navigation
  chooseLanguage: "Londa olulimi:\n1. Lungereza\n2. Kiswahili\n3. Luganda\n4. Runyankore–Rukiga\n5. Runyoro–Rutooro\n6. Acholi\n7. Ateso\n0. Ffuluma",
  welcome: "Tukwanirizza ku Hajambo!",
  askName: "Wandika linnya lyo (<=20)\n0. Ffuluma",
  mainMenu: "Hajambo\n1. Wandiika\n2. Ebipya\n3. Obubaka bwange\n4. Olulimi\n0. Ffuluma",
  langMenu: "Londa olulimi:\n1. Lungereza\n2. Kiswahili\n3. Luganda\n4. Runyankore–Rukiga\n5. Runyoro–Rutooro\n6. Acholi\n7. Ateso\n00. Ewaka  0. Ffuluma",
  langChanged: "Olulimi lukoleddwa.",
  goodbye: "Weeraba!",

  // Posting
  enterPost: "Wandiika obubaka (<=160)\n0. Ffuluma",
  posted: "Obubaka buteekeddwa! Webale okusangiza.",

  // Feed / My posts
  feedTitle: "Ebipya",
  feedEmpty: "Tewali bubaka kati. Tandika ggwe!",
  myPostsTitle: "Obubaka bwo",
  myPostsEmpty: "Tonna wandiika bubaka.",
  navFooter: "8. Mabega  9. Mumaaso\n00. Ewaka  0. Ffuluma",
  detailFooter: "8. Mabega\n00. Ewaka  0. Ffuluma",
  noMoreNext: "Tewali bya mumaaso.",
  noMorePrev: "Tewali bya mabega.",

  // General
  invalid: "Ky’owadde si kituufu.",
  internalError: "Ensobi mu sisitemu",
};

messages.rnk = {
  // Onboarding & navigation
  chooseLanguage: "Hitamo orurimi:\n1. English\n2. Kiswahili\n3. Luganda\n4. Runyankore–Rukiga\n5. Runyoro–Rutooro\n6. Acholi\n7. Ateso\n0. Kuvaho",
  welcome: "Tukakuhingiriza ku Hajambo!",
  askName: "Wandika erinya ryawe (<=20)\n0. Kuvaho",
  mainMenu: "Hajambo\n1. Wandika\n2. Ebipya\n3. Ebiwandikire byawe\n4. Orurimi\n0. Kuvaho",
  langMenu: "Hitamo orurimi:\n1. English\n2. Kiswahili\n3. Luganda\n4. Runyankore–Rukiga\n5. Runyoro–Rutooro\n6. Acholi\n7. Ateso\n00. Ahotandikiire  0. Kuvaho",
  langChanged: "Orurimi rurahinduwe.",
  goodbye: "Kare!",

  // Posting
  enterPost: "Wandika ekiragiro (<=160)\n0. Kuvaho",
  posted: "Ekiragiro kyateerwaho. Webare okuhangayo.",

  // Feed / My posts
  feedTitle: "Ebipya",
  feedEmpty: "Tihariho kyateerwaho. Tangira we!",
  myPostsTitle: "Ebiwandikire byawe",
  myPostsEmpty: "Otariwandikaho kyawe.",
  navFooter: "8. Emyuma  9. Ehareyo\n00. Ahotandikiire  0. Kuvaho",
  detailFooter: "8. Emyuma\n00. Ahotandikiire  0. Kuvaho",
  noMoreNext: "Tihariho ebindi.",
  noMorePrev: "Tihariho eby’emabega.",

  // General
  invalid: "Ekihitamo tekirukwata.",
  internalError: "Ensobi ya munda",
};
messages.nyr = {
  // Onboarding & navigation
  chooseLanguage: "Hitamu orurimi:\n1. English\n2. Kiswahili\n3. Luganda\n4. Runyankore–Rukiga\n5. Runyoro–Rutooro\n6. Acholi\n7. Ateso\n0. Kuvaho",
  welcome: "Tukakwasa ku Hajambo!",
  askName: "Wandika erinya ryaawe (<=20)\n0. Kuvaho",
  mainMenu: "Hajambo\n1. Wandika\n2. Ebipya\n3. Ebiwandikire byange\n4. Orurimi\n0. Kuvaho",
  langMenu: "Hitamu orurimi:\n1. English\n2. Kiswahili\n3. Luganda\n4. Runyankore–Rukiga\n5. Runyoro–Rutooro\n6. Acholi\n7. Ateso\n00. Eka  0. Kuvaho",
  langChanged: "Orurimi rurakyusibwa.",
  goodbye: "Kare ntya!",

  // Posting
  enterPost: "Wandika obubaka (<=160)\n0. Kuvaho",
  posted: "Obubaka bwateerwaho. Webale kusangiza.",

  // Feed / My posts
  feedTitle: "Ebipya",
  feedEmpty: "Tihariho bubaka. Tangira we!",
  myPostsTitle: "Ebiwandikire byawe",
  myPostsEmpty: "Tihariho by’owandikire.",
  navFooter: "8. Emyuma  9. Ehareyo\n00. Eka  0. Kuvaho",
  detailFooter: "8. Emyuma\n00. Eka  0. Kuvaho",
  noMoreNext: "Tihariho ebindi.",
  noMorePrev: "Tihariho eby’emabega.",

  // General
  invalid: "Ekihitamu si kya mazima.",
  internalError: "Ensobi ya munda",
};
messages.ach = {
  // Onboarding & navigation
  chooseLanguage: "Yer leb:\n1. English\n2. Kiswahili\n3. Luganda\n4. Runyankore–Rukiga\n5. Runyoro–Rutooro\n6. Acholi\n7. Ateso\n0. Wek",
  welcome: "Itye maber i Hajambo!",
  askName: "Coyo nying mii (<=20)\n0. Wek",
  mainMenu: "Hajambo\n1. Coyo\n2. Gin manyen\n3. Gin ma in ocoyo\n4. Leb\n0. Wek",
  langMenu: "Yer leb:\n1. English\n2. Kiswahili\n3. Luganda\n4. Runyankore–Rukiga\n5. Runyoro–Rutooro\n6. Acholi\n7. Ateso\n00. Gang  0. Wek",
  langChanged: "Leb ocuke.",
  goodbye: "Wot maber!",

  // Posting
  enterPost: "Coyo lok me post (<=160)\n0. Wek",
  posted: "Post otingo! Erokamano.",

  // Feed / My posts
  feedTitle: "Gin manyen",
  feedEmpty: "Pe tye gin kombedi. Cak in!",
  myPostsTitle: "Post me in",
  myPostsEmpty: "Pe itye ki post.",
  navFooter: "8. Cen  9. Anyim\n00. Gang  0. Wek",
  detailFooter: "8. Cen\n00. Gang  0. Wek",
  noMoreNext: "Pe tye anyim.",
  noMorePrev: "Pe tye cen.",

  // General
  invalid: "Ayera pe tye atir.",
  internalError: "Bal i wang jami",
};
messages.teo = {
  // Onboarding & navigation
  chooseLanguage: "Kainet aŋasetetei:\n1. English\n2. Kiswahili\n3. Luganda\n4. Runyankore–Rukiga\n5. Runyoro–Rutooro\n6. Acholi\n7. Ateso\n0. Erukut",
  welcome: "Ejokai a Hajambo!",
  askName: "Itai etelei ijo (<=20)\n0. Erukut",
  mainMenu: "Hajambo\n1. Aikipore\n2. Ejakait loŋon\n3. Aikipore akwap\n4. Aŋasetetei\n0. Erukut",
  langMenu: "Kainet aŋasetetei:\n1. English\n2. Kiswahili\n3. Luganda\n4. Runyankore–Rukiga\n5. Runyoro–Rutooro\n6. Acholi\n7. Ateso\n00. Eitunga  0. Erukut",
  langChanged: "Aŋasetetei akokinos.",
  goodbye: "Ejai!",

  // Posting
  enterPost: "Aikipore etelei (<=160)\n0. Erukut",
  posted: "Etelei ekone! Ape " + "apena.", // "Ape apena" = thanks (best-effort)

  // Feed / My posts
  feedTitle: "Ejakait loŋon",
  feedEmpty: "Ainakin kaɲei. Akiŋori in!",
  myPostsTitle: "Etelei akwap",
  myPostsEmpty: "Ijo pe aikipore.",
  navFooter: "8. Ebong  9. Eyauni\n00. Eitunga  0. Erukut",
  detailFooter: "8. Ebong\n00. Eitunga  0. Erukut",
  noMoreNext: "Pe iyai eyauni.",
  noMorePrev: "Pe iyai ebong.",

  // General
  invalid: "Akapo itunga aiyai.",
  internalError: "Kekiro iŋomu",
};

    const LANG_OPTIONS = {
  "1": "en",
  "2": "sw",
  "3": "lg",
  "4": "rnk",
  "5": "nyr",
  "6": "ach",
  "7": "teo",
};

/** Utility: safe access to locale (fallback to 'en' if missing) */
function t(lang, key) {
  const loc = messages[lang] || messages.en;
  return (loc && loc[key]) || messages.en[key];
}

// helper (place near other helpers)
function normalizeDigitToken(s) {
  // Trim spaces; preserve "00" (Home). Otherwise strip leading zeros, keep last digit.
  const v = (s || "").trim();
  if (v === "00") return "00";
  // common cases: "3", " 3", "03" -> "3"
  const m = v.match(/^\s*0*([1-9])\s*$/);
  return m ? m[1] : v;  // if it looks like a single 1..9 digit (with/without leading 0), return that digit
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
  const first = normalizeDigitToken(parts[0]);
  if (first === "0")  return "EXIT";
  return LANG_OPTIONS[first] || "INVALID";
}

/** Compose list screen with footer */
function buildListScreen(header, lines, footer) {
  const content = [header, ...lines, footer].filter(Boolean).join("\n");
  return content;
}

/** MAIN ROUTE */
router.post("/", async (req, res) => {
  const { phoneNumber, text } = req.body || {};
  // (optional but recommended) trim each segment
const rawParts = (text || "")
  .split("*")
  .map(s => (s || "").trim())
  .filter(Boolean);

// LOG: what we parsed from the gateway text
console.log("[USSD PARTS]", { rawParts });
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
    console.warn("[FIRSTTIME_INVALID]", {
      rawParts,
      normalizedFirst: normalizeDigitToken(rawParts[0] || ""),
      resolved: langRes
    });
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
if (LANG_OPTIONS[rawParts[0]] && rawParts.length >= 2) {
  offset = 2;
}
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
    // LANGUAGE CHANGE
// LANGUAGE CHANGE
if (choice === "4") {
  const tail = parts.slice(offset + 1);

  // normalize tokens first
  const tokens = tail.map(normalizeDigitToken);

  // LOG: show tokens before we interpret
  console.log("[LANG_CHANGE]", {
    rawTail: tail,
    normTail: tokens
  });

  if (tokens.includes("00")) return res.send(`CON ${t(lang, "mainMenu")}`);
  if (tokens.includes("0"))  return res.send(`END ${t(lang, "goodbye")}`);

  const selRaw = tokens[0];
  if (!selRaw) return res.send(`CON ${t(lang, "langMenu")}`);

  const sel = normalizeDigitToken(selRaw);     // final guard
  const target = LANG_OPTIONS[sel];

  if (!target) {
    // LOG: this is the exact spot where INVALID is returned by JS in the lang menu
    console.warn("[LANG_INVALID]", {
      phone: phoneNumber,
      selRaw,
      sel,
      tokens,
      lang,
      LANG_OPTIONS
    });
    return res.send(`CON ${t(lang, "invalid")}\n${t(lang, "langMenu")}`);
  }

  await setUssdLanguage(ussd.id, target);
  return res.send(`END ${t(target, "langChanged")}`);
}

    // Fallback
    // LOG: final fallback before returning INVALID
console.warn("[FALLBACK_INVALID]", {
  phone: phoneNumber,
  lang,
  choice,
  offset,
  parts
});
    return res.send(`CON ${t(lang, "invalid")}\n${t(lang, "mainMenu")}`);
  } catch (err) {
    console.error("USSD error:", err);
    return res.status(200).send(`END ${messages.en.internalError}`);
  }
});

export default router;
