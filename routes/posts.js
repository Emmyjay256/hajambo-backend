import express from "express";
import { body, validationResult } from "express-validator";
import pool from "../db.js";
import { requireAuth } from "../middleware/auth.js";

const router = express.Router();

/**
 * GET /posts?type=post|reel&cursor=<id>&limit=20
 */
router.get("/", async (req, res) => {
  try {
    const type = req.query.type === "reel" ? "reel" : req.query.type === "post" ? "post" : null;
    const limit = Math.min(Number(req.query.limit || 20), 100);
    const cursor = req.query.cursor ? Number(req.query.cursor) : null;

    const params = [];
    let sql = `SELECT id, user_id, type, content, media_url, likes_count, comments_count, created_at
               FROM post WHERE 1=1`;
    if (type) {
      params.push(type);
      sql += ` AND type = $${params.length}`;
    }
    if (cursor) {
      params.push(cursor);
      sql += ` AND id < $${params.length}`;
    }
    sql += ` ORDER BY id DESC LIMIT ${limit}`;

    const r = await pool.query(sql, params);
    return res.json({ items: r.rows, nextCursor: r.rows.at(-1)?.id || null });
  } catch (e) {
    console.error("posts list error:", e.message);
    return res.status(500).json({ error: "Failed to fetch posts" });
  }
});

/**
 * POST /posts
 * { type: 'post'|'reel', content?, mediaUrl? }
 */
router.post(
  "/",
  requireAuth,
  body("type").isIn(["post", "reel"]),
  body("content").optional().isString(),
  body("mediaUrl").optional().isString(),
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

      const { type, content, mediaUrl } = req.body;
      const r = await pool.query(
        `INSERT INTO post (user_id, type, content, media_url)
         VALUES ($1,$2,$3,$4)
         RETURNING id, user_id, type, content, media_url, likes_count, comments_count, created_at`,
        [req.user.id, type, content || null, mediaUrl || null]
      );
      return res.status(201).json(r.rows[0]);
    } catch (e) {
      console.error("post create error:", e.message);
      return res.status(500).json({ error: "Failed to create post" });
    }
  }
);

/**
 * POST /posts/:id/like (toggle)
 */
router.post("/:id/like", requireAuth, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const postId = Number(req.params.id);
    const userId = req.user.id;

    const exists = await client.query(
      `SELECT 1 FROM post_interaction WHERE post_id=$1 AND user_id=$2 AND type='like'`,
      [postId, userId]
    );

    if (exists.rowCount > 0) {
      await client.query(
        `DELETE FROM post_interaction WHERE post_id=$1 AND user_id=$2 AND type='like'`,
        [postId, userId]
      );
      await client.query(`UPDATE post SET likes_count = GREATEST(likes_count - 1, 0) WHERE id=$1`, [postId]);
      await client.query("COMMIT");
      return res.json({ liked: false });
    } else {
      await client.query(
        `INSERT INTO post_interaction (post_id, user_id, type) VALUES ($1,$2,'like')`,
        [postId, userId]
      );
      await client.query(`UPDATE post SET likes_count = likes_count + 1 WHERE id=$1`, [postId]);
      await client.query("COMMIT");
      return res.json({ liked: true });
    }
  } catch (e) {
    await client.query("ROLLBACK");
    console.error("like toggle error:", e.message);
    return res.status(500).json({ error: "Failed to toggle like" });
  } finally {
    client.release();
  }
});

/**
 * POST /posts/:id/favourite (toggle)
 */
router.post("/:id/favourite", requireAuth, async (req, res) => {
  try {
    const postId = Number(req.params.id);
    const userId = req.user.id;

    const exists = await pool.query(
      `SELECT 1 FROM favourite WHERE post_id=$1 AND user_id=$2`,
      [postId, userId]
    );

    if (exists.rowCount > 0) {
      await pool.query(`DELETE FROM favourite WHERE post_id=$1 AND user_id=$2`, [postId, userId]);
      return res.json({ favourited: false });
    } else {
      await pool.query(
        `INSERT INTO favourite (post_id, user_id) VALUES ($1,$2)`,
        [postId, userId]
      );
      return res.json({ favourited: true });
    }
  } catch (e) {
    console.error("favourite toggle error:", e.message);
    return res.status(500).json({ error: "Failed to toggle favourite" });
  }
});

/**
 * POST /posts/:id/comments  { body }
 * GET  /posts/:id/comments?cursor=<id>&limit=20
 */
router.post("/:id/comments",
  requireAuth,
  body("body").isString().isLength({ min: 1 }),
  async (req, res) => {
    const client = await pool.connect();
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

      await client.query("BEGIN");
      const postId = Number(req.params.id);
      const ins = await client.query(
        `INSERT INTO comment (post_id, user_id, body) VALUES ($1,$2,$3)
         RETURNING id, post_id, user_id, body, created_at`,
        [postId, req.user.id, req.body.body]
      );
      await client.query(`UPDATE post SET comments_count = comments_count + 1 WHERE id=$1`, [postId]);
      await client.query("COMMIT");
      return res.status(201).json(ins.rows[0]);
    } catch (e) {
      await client.query("ROLLBACK");
      console.error("comment create error:", e.message);
      return res.status(500).json({ error: "Failed to add comment" });
    } finally {
      client.release();
    }
  }
);

router.get("/:id/comments", async (req, res) => {
  try {
    const postId = Number(req.params.id);
    const limit = Math.min(Number(req.query.limit || 20), 100);
    const cursor = req.query.cursor ? Number(req.query.cursor) : null;

    let sql = `SELECT id, post_id, user_id, body, created_at
               FROM comment WHERE post_id=$1`;
    const params = [postId];

    if (cursor) {
      sql += " AND id < $2";
      params.push(cursor);
    }
    sql += ` ORDER BY id DESC LIMIT ${limit}`;

    const r = await pool.query(sql, params);
    return res.json({ items: r.rows, nextCursor: r.rows.at(-1)?.id || null });
  } catch (e) {
    console.error("comments list error:", e.message);
    return res.status(500).json({ error: "Failed to fetch comments" });
  }
});

export default router;
