import express from "express";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { body, validationResult } from "express-validator";
import pool from "../db.js";

const router = express.Router();

router.post(
  "/register",
  body("username").isString().trim().isLength({ min: 3 }),
  body("password").isString().isLength({ min: 6 }),
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

      const { username, password, email, phone } = req.body;

      // check exists
      const ex = await pool.query(
        "SELECT id FROM app_user WHERE username=$1 OR email=$2 OR phone=$3 LIMIT 1",
        [username, email || null, phone || null]
      );
      if (ex.rowCount > 0) return res.status(409).json({ error: "User already exists" });

      const hash = await bcrypt.hash(password, 12);
      const ins = await pool.query(
        `INSERT INTO app_user (username, password_hash, email, phone)
         VALUES ($1,$2,$3,$4) RETURNING id, username, created_at`,
        [username, hash, email || null, phone || null]
      );

      const user = ins.rows[0];
      const token = jwt.sign(
        { sub: user.id, username: user.username },
        process.env.JWT_SECRET,
        { expiresIn: "7d" }
      );
      return res.status(201).json({ token, user });
    } catch (e) {
      console.error("register error:", e.message);
      return res.status(500).json({ error: "Register failed" });
    }
  }
);

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
        "SELECT id, username, password_hash FROM app_user WHERE username=$1 LIMIT 1",
        [username]
      );
      if (r.rowCount === 0) return res.status(401).json({ error: "Invalid credentials" });

      const u = r.rows[0];
      const ok = await bcrypt.compare(password, u.password_hash);
      if (!ok) return res.status(401).json({ error: "Invalid credentials" });

      const token = jwt.sign({ sub: u.id, username: u.username }, process.env.JWT_SECRET, {
        expiresIn: "7d",
      });
      return res.json({ token, user: { id: u.id, username: u.username } });
    } catch (e) {
      console.error("login error:", e.message);
      return res.status(500).json({ error: "Login failed" });
    }
  }
);

export default router;
