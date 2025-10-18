import express from "express";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { body, validationResult } from "express-validator";
import pool from "../db.js";

const router = express.Router();

// ---- helpers ----
function sign(u) {
  return jwt.sign({ sub: u.id, username: u.username }, process.env.JWT_SECRET, {
    expiresIn: "7d",
  });
}

function requireAuth(req, res, next) {
  try {
    const hdr = req.headers.authorization || "";
    const [, token] = hdr.split(" ");
    if (!token) return res.status(401).json({ error: "Missing token" });
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.user = payload;
    next();
  } catch {
    return res.status(401).json({ error: "Invalid token" });
  }
}

// ---- POST /auth/register ----
router.post(
  "/register",
  body("username").isString().trim().isLength({ min: 3 }),
  body("password").isString().isLength({ min: 6 }),
  body("email").optional().isEmail(),
  body("phone").optional().isString().isLength({ min: 3 }),
  body("displayName").optional().isString().isLength({ min: 1 }),
  body("avatarUrl").optional().isString(),
  body("bio").optional().isString(),
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

      const { username, password, email, phone, displayName, avatarUrl, bio } = req.body;

      // exists?
      const ex = await pool.query(
        "SELECT id FROM app_user WHERE username=$1 OR email=$2 OR phone=$3 LIMIT 1",
        [username, email || null, phone || null]
      );
      if (ex.rowCount > 0) return res.status(409).json({ error: "User already exists" });

      const hash = await bcrypt.hash(password, 12);
      const ins = await pool.query(
        `INSERT INTO app_user (username, password_hash, email, phone, display_name, avatar_url, bio)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         RETURNING id, username, email, phone, display_name, avatar_url, bio, created_at`,
        [username, hash, email || null, phone || null, displayName || null, avatarUrl || null, bio || null]
      );

      const user = ins.rows[0];
      const token = sign(user);

      return res.status(201).json({
        token,
        user: {
          id: String(user.id),
          username: user.username,
          email: user.email,
          phone: user.phone,
          displayName: user.display_name,
          avatarUrl: user.avatar_url,
          bio: user.bio,
          createdAt: user.created_at,
        },
      });
    } catch (e) {
      console.error("register error:", e.message);
      return res.status(500).json({ error: "Register failed" });
    }
  }
);

// ---- POST /auth/login ----
router.post(
  "/login",
  body("username").isString(),
  body("password").isString(),
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

      const { username, password } = req.body;
      const r = await pool.query(
        `SELECT id, username, email, phone, password_hash, display_name, avatar_url, bio
         FROM app_user WHERE username=$1 LIMIT 1`,
        [username]
      );
      if (r.rowCount === 0) return res.status(401).json({ error: "Invalid credentials" });

      const u = r.rows[0];
      const ok = await bcrypt.compare(password, u.password_hash);
      if (!ok) return res.status(401).json({ error: "Invalid credentials" });

      const token = sign(u);
      return res.json({
        token,
        user: {
          id: String(u.id),
          username: u.username,
          email: u.email,
          phone: u.phone,
          displayName: u.display_name,
          avatarUrl: u.avatar_url,
          bio: u.bio,
        },
      });
    } catch (e) {
      console.error("login error:", e.message);
      return res.status(500).json({ error: "Login failed" });
    }
  }
);

// ---- GET /auth/me ----
router.get("/me", requireAuth, async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT id, username, email, phone, display_name, avatar_url, bio, created_at
       FROM app_user WHERE id=$1`,
      [req.user.sub]
    );
    if (r.rowCount === 0) return res.status(404).json({ error: "User not found" });
    const u = r.rows[0];
    return res.json({
      id: String(u.id),
      username: u.username,
      email: u.email,
      phone: u.phone,
      displayName: u.display_name,
      avatarUrl: u.avatar_url,
      bio: u.bio,
      createdAt: u.created_at,
    });
  } catch (e) {
    console.error("me error:", e.message);
    return res.status(500).json({ error: "Failed to load profile" });
  }
});

// ---- PATCH /auth/me ----
router.patch("/me", requireAuth, express.json(), async (req, res) => {
  try {
    const userId = req.user.sub; // comes from JWT
    const { username, displayName, avatarUrl, bio } = req.body;

    const updates = [];
    const params = [];
    if (username) {
      params.push(username);
      updates.push(`username = $${params.length}`);
    }
    if (displayName) {
      params.push(displayName);
      updates.push(`display_name = $${params.length}`);
    }
    if (avatarUrl) {
      params.push(avatarUrl);
      updates.push(`avatar_url = $${params.length}`);
    }
    if (bio) {
      params.push(bio);
      updates.push(`bio = $${params.length}`);
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: "No fields to update" });
    }

    params.push(userId);
    const sql = `UPDATE app_user SET ${updates.join(", ")} WHERE id = $${params.length} RETURNING id, username, email, phone, display_name, avatar_url, bio, created_at`;
    const r = await pool.query(sql, params);
    if (r.rowCount === 0) return res.status(404).json({ error: "User not found" });

    const u = r.rows[0];
    res.json({
      id: String(u.id),
      username: u.username,
      email: u.email,
      phone: u.phone,
      displayName: u.display_name,
      avatarUrl: u.avatar_url,
      bio: u.bio,
      createdAt: u.created_at,
    });
  } catch (e) {
    console.error("PATCH /auth/me error:", e.message);
    res.status(500).json({ error: "Update failed" });
  }
});

export default router;
