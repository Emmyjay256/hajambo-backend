import express from "express";
import { body, validationResult } from "express-validator";
import pool from "../db.js";
import { requireAuth } from "../middleware/auth.js";

const router = express.Router();

/** POST /conversations/ensure-direct  { otherUserId, title? } -> { conversationId } */
router.post(
  "/ensure-direct",
  requireAuth,
  body("otherUserId").isInt(),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const selfId = req.user.id;
    const otherId = Number(req.body.otherUserId);
    const title = req.body.title ?? null;

    try {
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
      if (q.rowCount > 0) return res.json({ conversationId: q.rows[0].id });

      // If client sent a convoId, use it; otherwise build deterministic (order-independent) one
const clientId = req.body.conversationId ? BigInt(req.body.conversationId) : null;
const lower = Math.min(selfId, otherId);
const higher = Math.max(selfId, otherId);
const deterministicId = BigInt("1" + String(lower).padStart(4,"0") + String(higher).padStart(4,"0"));
const finalId = (clientId ?? deterministicId).toString();

// Create conversation if missing (no auto-id; safe on duplicates)
await pool.query(
  `INSERT INTO conversation (id, title, is_group)
   VALUES ($1, $2, false)
   ON CONFLICT (id) DO NOTHING`,
  [finalId, title]
);

// Ensure both participants exist (idempotent)
await pool.query(
  `INSERT INTO conversation_participant (conversation_id, user_id, role)
   VALUES ($1,$2,'member'), ($1,$3,'member')
   ON CONFLICT (conversation_id, user_id) DO NOTHING`,
  [finalId, selfId, otherId]
);

return res.status(201).json({ conversationId: finalId });
    } catch (e) {
      console.error("ensure-direct error:", e.message);
      return res.status(500).json({ error: "Failed to ensure conversation" });
    }
  }
);

export default router;
