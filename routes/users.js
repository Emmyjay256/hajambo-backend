import express from "express";
import pool from "../db.js";
import { requireAuth } from "../middleware/auth.js"; // or remove if you want it public

const router = express.Router();

// GET /users?q=ash
router.get("/", /* requireAuth, */ async (req, res) => {
  try {
    const q = (req.query.q || "").trim();
    const like = `%${q}%`;

    // Unify app users + ussd users into one shape
    const sql = `
      SELECT id,
             username,
             COALESCE(display_name, username) AS display_name,
             NULL::text AS avatar_url,
             NULL::text AS phone
      FROM app_user
      ${q ? `WHERE username ILIKE $1 OR display_name ILIKE $1` : ``}

      UNION ALL

      SELECT id,
             username,
             COALESCE(display_name, username) AS display_name,
             NULL::text AS avatar_url,
             phone::text AS phone
      FROM ussd_user
      ${q ? `WHERE username ILIKE $1 OR display_name ILIKE $1 OR phone ILIKE $1` : ``}

      ORDER BY display_name NULLS LAST, username
      LIMIT 200;
    `;

    const params = q ? [like] : [];
    const r = await pool.query(sql, params);

    // Return a compact DTO list
    res.json(
      r.rows.map(row => ({
        id: Number(row.id),
        username: row.username,
        displayName: row.display_name,
        avatarUrl: row.avatar_url,
        phone: row.phone,
      }))
    );
  } catch (e) {
    console.error("GET /users error:", e.message);
    res.status(500).json({ error: "Failed to list users" });
  }
});

export default router;
