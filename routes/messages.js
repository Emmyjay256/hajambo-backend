// routes/messages.js
import express from "express";
import { body, validationResult } from "express-validator";
import pool from "../db.js";
import { requireAuth } from "../middleware/auth.js";

const router = express.Router();

/** Helper: ensure/find a direct conversation between self & other */
async function ensureDirect(selfId, otherId, title = null) {
  // 1) Try to find existing 1:1 conversation
  const q = await pool.query(
    `
    SELECT cp1.conversation_id AS id
    FROM conversation_participant cp1
    JOIN conversation_participant cp2 ON cp1.conversation_id = cp2.conversation_id
    JOIN conversation c ON c.id = cp1.conversation_id
    WHERE c.is_group = false
      AND cp1.user_id = $1
      AND cp2.user_id = $2
    LIMIT 1
    `,
    [selfId, otherId]
  );
  if (q.rowCount > 0) return q.rows[0].id;

  // 2) Create new conversation + participants
  const c = await pool.query(
    "INSERT INTO conversation (title, is_group) VALUES ($1,false) RETURNING id",
    [title]
  );
  const convoId = c.rows[0].id;

  await pool.query(
    `INSERT INTO conversation_participant (conversation_id, user_id, role)
     VALUES ($1,$2,'member'), ($1,$3,'member')`,
    [convoId, selfId, otherId]
  );

  return convoId;
}

/**
 * GET /messages/:conversationId?cursor=<messageId>&limit=50
 * Returns messages newest-first with keyset pagination by id
 */
router.get("/:conversationId", requireAuth, async (req, res) => {
  try {
    const { conversationId } = req.params;
    const limit = Math.min(Number(req.query.limit || 50), 200);
    const cursor = req.query.cursor ? Number(req.query.cursor) : null;

    let sql = `
      SELECT id, conversation_id, sender_id, content, media_type, media_remote_url, media_local_uri, created_at
      FROM message
      WHERE conversation_id = $1
    `;
    const params = [conversationId];

    if (cursor) {
      sql += " AND id < $2";
      params.push(cursor);
    }
    sql += " ORDER BY id DESC LIMIT " + limit;

    const r = await pool.query(sql, params);
    return res.json({ items: r.rows, nextCursor: r.rows.at(-1)?.id || null });
  } catch (e) {
    console.error("messages list error:", e.message);
    return res.status(500).json({ error: "Failed to fetch messages" });
  }
});

/**
 * POST /messages
 * Body can be either:
 *   A) { conversationId, content?, mediaType?("none"|"image"|"video"), mediaUrl? }
 *   B) { otherUserId, title?, content?, mediaType?, mediaUrl? }  // will ensure/find direct convo
 *   C) { conversationId (optional/invalid), otherUserId, ... }   // if convo missing, auto-ensure then send
 */
router.post(
  "/",
  requireAuth,
  // accept either conversationId OR otherUserId
  body("conversationId").optional().isInt(),
  body("otherUserId").optional().isInt(),
  body("title").optional().isString().trim().isLength({ min: 1, max: 120 }),
  body("content").optional().isString(),
  body("mediaType").optional().isIn(["none", "image", "video"]),
  body("mediaUrl").optional().isString(),
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

      const selfId = req.user.id;
      let { conversationId, otherUserId, title, content, mediaType = "none", mediaUrl } = req.body;

      // Normalize types
      conversationId = conversationId ? Number(conversationId) : null;
      otherUserId = otherUserId ? Number(otherUserId) : null;

      // Resolve a valid conversation id (find/create if needed)
      let convoId = conversationId;

      if (convoId) {
        // Verify conversation exists AND requester is a participant
        const check = await pool.query(
          `
          SELECT c.id
          FROM conversation c
          JOIN conversation_participant cp ON cp.conversation_id = c.id
          WHERE c.id = $1 AND cp.user_id = $2
          LIMIT 1
          `,
          [convoId, selfId]
        );
        if (check.rowCount === 0) {
          if (otherUserId) {
            // Auto-ensure direct with the provided otherUserId
            convoId = await ensureDirect(selfId, otherUserId, title ?? null);
          } else {
            return res
              .status(404)
              .json({ error: "Conversation not found or you are not a participant" });
          }
        }
      } else {
        // No conversationId provided — require otherUserId to create/find direct convo
        if (!otherUserId) {
          return res
            .status(400)
            .json({ error: "Provide either conversationId or otherUserId" });
        }
        convoId = await ensureDirect(selfId, otherUserId, title ?? null);
      }

      // Insert message into the resolved conversation
      const ins = await pool.query(
        `INSERT INTO message (conversation_id, sender_id, content, media_type, media_remote_url)
         VALUES ($1,$2,$3,$4,$5)
         RETURNING id, conversation_id, sender_id, content, media_type, media_remote_url, created_at`,
        [convoId, selfId, content || null, mediaType, mediaUrl || null]
      );

      return res.status(201).json(ins.rows[0]);
    } catch (e) {
      console.error("message create error:", e.message);
      return res.status(500).json({ error: "Failed to create message" });
    }
  }
);

export default router;
