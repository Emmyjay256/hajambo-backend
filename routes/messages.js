import express from "express";
import { body, validationResult } from "express-validator";
import pool from "../db.js";
import { requireAuth } from "../middleware/auth.js";

const router = express.Router();

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
 * { conversationId, content, mediaType?, mediaUrl? }
 */
router.post(
  "/",
  requireAuth,
  body("conversationId").isInt(),
  body("content").optional().isString(),
  body("mediaType").optional().isIn(["none", "image", "video"]),
  body("mediaUrl").optional().isString(),
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

      const { conversationId, content, mediaType = "none", mediaUrl } = req.body;

      const ins = await pool.query(
        `INSERT INTO message (conversation_id, sender_id, content, media_type, media_remote_url)
         VALUES ($1,$2,$3,$4,$5)
         RETURNING id, conversation_id, sender_id, content, media_type, media_remote_url, created_at`,
        [conversationId, req.user.id, content || null, mediaType, mediaUrl || null]
      );

      // Optionally insert message_status rows for other participants here.

      return res.status(201).json(ins.rows[0]);
    } catch (e) {
      console.error("message create error:", e.message);
      return res.status(500).json({ error: "Failed to create message" });
    }
  }
);

export default router;
