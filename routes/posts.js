import express from "express";
import pool from "../db.js";
import { requireAuth } from "./_auth.js";

const router = express.Router();

/**
 * GET /posts?since=<epochMs>&type=post|reel&limit=50
 * Returns newest-first posts with per-user flags + author info.
 */
router.get("/", requireAuth, async (req, res) => {
  try {
    const userId = req.userId ?? req.user?.sub;
    const sinceMs = req.query.since ? Number(req.query.since) : null;
    const type = req.query.type || null; // "post" | "reel" | null
    const limit = Math.min(Number(req.query.limit || 50), 200);

    const params = [];
    const where = [];
    if (sinceMs) {
      params.push(new Date(sinceMs).toISOString());
      where.push(`p.created_at > $${params.length}`);
    }
    if (type) {
      params.push(type);
      where.push(`p.type = $${params.length}`);
    }
    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

    const sql = `
      SELECT
        p.id,
        p.user_id,
        p.type,
        p.content,
        p.media_url,
        EXTRACT(EPOCH FROM p.created_at) * 1000 AS created_at_ms,
        p.likes_count,
        p.comments_count,
        -- author
        u.username AS author_username,
        u.display_name AS author_display_name,
        u.avatar_url AS author_avatar_url,
        -- flags
        EXISTS (
          SELECT 1 FROM post_interaction pi
          WHERE pi.post_id = p.id AND pi.user_id = $${params.push(userId)} AND pi.type = 'like'
        ) AS liked_by_me,
        EXISTS (
          SELECT 1 FROM favourite f
          WHERE f.post_id = p.id AND f.user_id = $${params.push(userId)}
        ) AS favorited_by_me
      FROM post p
      JOIN app_user u ON u.id = p.user_id
      ${whereSql}
      ORDER BY p.created_at DESC
      LIMIT $${params.push(limit)}
    `;

    const r = await pool.query(sql, params);
    const items = r.rows.map(row => ({
      id: String(row.id),
      userId: String(row.user_id),
      type: row.type, // "post" | "reel"
      content: row.content || "",
      mediaUrl: row.media_url || null,
      createdAtMs: Number(row.created_at_ms),
      likesCount: Number(row.likes_count || 0),
      commentsCount: Number(row.comments_count || 0),
      likedByMe: !!row.liked_by_me,
      favoritedByMe: !!row.favorited_by_me,
      author: {
        id: String(row.user_id),
        username: row.author_username || null,
        displayName: row.author_display_name || null,
        avatarUrl: row.author_avatar_url || null,
      },
    }));

    res.json({ items, serverNowMs: Date.now() });
  } catch (e) {
    console.error("GET /posts error:", e.message);
    res.status(500).json({ error: "Failed to fetch posts" });
  }
});

/** Create a post */
router.post("/", requireAuth, express.json(), async (req, res) => {
  try {
    const userId = req.userId ?? req.user?.sub;
    const { type = "post", content = "", mediaUrl = null } = req.body || {};

    const r = await pool.query(
      `INSERT INTO post (user_id, type, content, media_url)
       VALUES ($1,$2,$3,$4)
       RETURNING id, user_id, type, content, media_url, EXTRACT(EPOCH FROM created_at)*1000 created_at_ms, likes_count, comments_count`,
      [userId, type, content, mediaUrl]
    );
    const p = r.rows[0];

    // fetch minimal author fields for response
    const au = await pool.query(
      `SELECT username, display_name, avatar_url FROM app_user WHERE id=$1`,
      [userId]
    );
    const author = au.rows[0] || {};

    res.status(201).json({
      id: String(p.id),
      userId: String(p.user_id),
      type: p.type,
      content: p.content || "",
      mediaUrl: p.media_url,
      createdAtMs: Number(p.created_at_ms),
      likesCount: Number(p.likes_count || 0),
      commentsCount: Number(p.comments_count || 0),
      likedByMe: false,
      favoritedByMe: false,
      author: {
        id: String(p.user_id),
        username: author.username || null,
        displayName: author.display_name || null,
        avatarUrl: author.avatar_url || null,
      },
    });
  } catch (e) {
    console.error("POST /posts error:", e.message);
    res.status(500).json({ error: "Create failed" });
  }
});

/** Toggle like */
router.post("/:id/like", requireAuth, async (req, res) => {
  const userId = req.userId ?? req.user?.sub;
  const postId = Number(req.params.id);
  try {
    const liked = await pool.query(
      `SELECT 1 FROM post_interaction WHERE post_id=$1 AND user_id=$2 AND type='like'`,
      [postId, userId]
    );
    if (liked.rowCount) {
      await pool.query(`DELETE FROM post_interaction WHERE post_id=$1 AND user_id=$2 AND type='like'`, [postId, userId]);
      await pool.query(`UPDATE post SET likes_count = GREATEST(likes_count - 1, 0) WHERE id=$1`, [postId]);
      return res.json({ liked: false });
    } else {
      await pool.query(
        `INSERT INTO post_interaction (post_id, user_id, type) VALUES ($1,$2,'like') ON CONFLICT DO NOTHING`,
        [postId, userId]
      );
      await pool.query(`UPDATE post SET likes_count = likes_count + 1 WHERE id=$1`, [postId]);
      return res.json({ liked: true });
    }
  } catch (e) {
    console.error("like toggle error:", e.message);
    res.status(500).json({ error: "Toggle like failed" });
  }
});

/** Toggle favourite */
router.post("/:id/favourite", requireAuth, async (req, res) => {
  const userId = req.userId ?? req.user?.sub;
  const postId = Number(req.params.id);
  try {
    const f = await pool.query(`SELECT 1 FROM favourite WHERE post_id=$1 AND user_id=$2`, [postId, userId]);
    if (f.rowCount) {
      await pool.query(`DELETE FROM favourite WHERE post_id=$1 AND user_id=$2`, [postId, userId]);
      return res.json({ favorited: false });
    } else {
      await pool.query(
        `INSERT INTO favourite (user_id, post_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
        [userId, postId]
      );
      return res.json({ favorited: true });
    }
  } catch (e) {
    console.error("fav toggle error:", e.message);
    res.status(500).json({ error: "Toggle favourite failed" });
  }
});

/** Comments: list with author fields */
router.get("/:id/comments", requireAuth, async (req, res) => {
  try {
    const postId = Number(req.params.id);
    const sinceMs = req.query.since ? Number(req.query.since) : null;

    const params = [postId];
    const whereSince = sinceMs
      ? `AND c.created_at > $${params.push(new Date(sinceMs).toISOString())}`
      : "";

    const r = await pool.query(
      `SELECT
         c.id,
         c.post_id,
         c.user_id,
         c.body,
         EXTRACT(EPOCH FROM c.created_at)*1000 AS created_at_ms,
         u.username AS author_username,
         u.display_name AS author_display_name,
         u.avatar_url AS author_avatar_url
       FROM comment c
       JOIN app_user u ON u.id = c.user_id
       WHERE c.post_id=$1 ${whereSince}
       ORDER BY c.created_at ASC
       LIMIT 500`,
      params
    );

    res.json({
      items: r.rows.map(x => ({
        id: String(x.id),
        postId: String(x.post_id),
        userId: String(x.user_id),
        body: x.body,
        createdAtMs: Number(x.created_at_ms),
        author: {
          id: String(x.user_id),
          username: x.author_username || null,
          displayName: x.author_display_name || null,
          avatarUrl: x.author_avatar_url || null,
        },
      })),
      serverNowMs: Date.now(),
    });
  } catch (e) {
    console.error("GET /comments error:", e.message);
    res.status(500).json({ error: "Failed to fetch comments" });
  }
});

/** Create comment (returns author fields too) */
router.post("/:id/comments", requireAuth, express.json(), async (req, res) => {
  try {
    const postId = Number(req.params.id);
    const userId = req.userId ?? req.user?.sub;
    const body = (req.body?.body || "").trim();
    if (!body) return res.status(400).json({ error: "body required" });

    const ins = await pool.query(
      `INSERT INTO comment (post_id, user_id, body) VALUES ($1,$2,$3)
       RETURNING id, post_id, user_id, body, EXTRACT(EPOCH FROM created_at)*1000 AS created_at_ms`,
      [postId, userId, body]
    );
    await pool.query(`UPDATE post SET comments_count = comments_count + 1 WHERE id=$1`, [postId]);

    // pull author for response
    const au = await pool.query(
      `SELECT username, display_name, avatar_url FROM app_user WHERE id=$1`,
      [userId]
    );
    const author = au.rows[0] || {};
    const c = ins.rows[0];

    res.status(201).json({
      id: String(c.id),
      postId: String(c.post_id),
      userId: String(c.user_id),
      body: c.body,
      createdAtMs: Number(c.created_at_ms),
      author: {
        id: String(c.user_id),
        username: author.username || null,
        displayName: author.display_name || null,
        avatarUrl: author.avatar_url || null,
      },
    });
  } catch (e) {
    console.error("POST /comments error:", e.message);
    res.status(500).json({ error: "Create comment failed" });
  }
});

export default router;
