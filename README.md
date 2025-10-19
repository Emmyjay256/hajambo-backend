Perfect — here’s a fully written, professional-grade README.md summarizing everything we’ve built together, written in technical detail so it fits your repo directly. It covers your backend architecture, deployment setup, tunnel configuration, and integration with the Hajambo Android app.


🌀 Hajambo Backend

Hajambo is a lightweight social + messaging backend built with Node.js, Express, and PostgreSQL, designed for hackathon-level experimentation and seamless integration with the Hajambo Android app.
It supports user authentication, posts, reels, messaging, USSD interactions, and SMS auto-replies via Africa’s Talking API, all running on a single VM behind a persistent Cloudflare Tunnel.


🚀 Project Overview

The Hajambo backend provides REST APIs for user registration, login, posting, interactions (likes, favorites, comments), and SMS/USSD integrations.
It also serves static assets, including the Android APK, directly through the same HTTPS tunnel endpoint.


🧩 Tech Stack

Component	                     Description

Runtime	                       Node.js v20 (NVM managed)
Framework	                     Express.js
Database	                     PostgreSQL 15
Auth	                         JWT (JSON Web Tokens)
Storage	                       Local static directory (/home/user/hajambo-down)
SMS/USSD	                     Africa’s Talking SDK (sandbox + production ready)
Tunnel	                       Cloudflare Quick Tunnel (trycloudflare.com)
Deployment	                   Bare-metal VM using nohup + Cloudflare tunnel



🧱 Directory Structure

hajambo-backend/
├── index.js               # Main Express app and routes registration
├── db.js                  # PostgreSQL pool connector
├── routes/
│   ├── auth.js            # Register & login routes
│   ├── posts.js           # Feed posts, likes, favorites, comments
│   ├── messages.js        # Chat endpoints (future)
├── .env                   # Environment configuration (local only)
├── public/                # Static assets (optional)
└── ../hajambo-down/       # Directory for shared files (e.g., app-debug.apk)


⚙️ Environment Variables

Create a .env file at project root or export variables before running:

export DB_USER="hajambo_user"
export DB_PASSWORD="emmaemma"
export DB_HOST="127.0.0.1"
export DB_NAME="hajambo"
export DB_PORT=5432
export AT_USERNAME="sandbox"
export AT_API_KEY="atsk_xxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
export JWT_SECRET="your-strong-secret"



🗄️ Database Setup

Initialize the PostgreSQL database:

sudo -u postgres psql <<'SQL'
CREATE DATABASE hajambo;
CREATE USER hajambo_user WITH PASSWORD 'emmaemma';
GRANT ALL PRIVILEGES ON DATABASE hajambo TO hajambo_user;
ALTER DATABASE hajambo OWNER TO hajambo_user;
SQL

Verify the connection:

psql "postgresql://hajambo_user:emmaemma@127.0.0.1:5432/hajambo" -c "SELECT now();"

Test from the backend:

curl -s http://127.0.0.1:3000/test-db


🔐 Authentication API

Register

curl -s -X POST http://127.0.0.1:3000/auth/register \
  -H "Content-Type: application/json" \
  -d '{"username":"ash","password":"secret123"}'

Login

curl -s -X POST http://127.0.0.1:3000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"ash","password":"secret123"}'

The response includes a JWT token:

{
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": { "id": 1, "username": "ash" }
}

Use it in future requests as:

Authorization: Bearer <token>


📨 Africa’s Talking Integration

Inbound SMS Webhook

Automatically replies to messages sent to your shortcode.

POST /webhooks/sms
{
  "from": "+2567xxxxxxx",
  "to": "21771",
  "text": "hello"
}

Auto-response:

Hajambo! You said: "hello"

USSD Webhook

Basic menu interaction:

CON Welcome to Hajambo!
1. Register
2. About Us


🌍 Cloudflare Tunnel (Quick Tunnel)

Traffic from the internet is securely proxied to your local VM.

Start tunnel:

nohup cloudflared tunnel --url http://127.0.0.1:3000 > tunnel.log 2>&1 &

View tunnel URL:

grep -A2 "Your quick Tunnel has been created" tunnel.log

Example output:

https://cookie-goes-defining-assets.trycloudflare.com

Everything under this URL maps to your app:

https://cookie-goes-defining-assets.trycloudflare.com/ → backend root

https://cookie-goes-defining-assets.trycloudflare.com/app-debug.apk → Android APK download




📱 Android App Integration

The Hajambo Android app connects directly to this backend for:

User authentication via /auth/register and /auth/login

Fetching and posting content via /posts

Optional SMS/USSD integration through Africa’s Talking sandbox


The backend also hosts the latest app build for testers:

curl -I https://cookie-goes-defining-assets.trycloudflare.com/app-debug.apk



🧰 Deployment Commands

Run this anytime you pull new updates:

git fetch --all
git reset --hard origin/main
git clean -fd
npm ci
export DB_USER="hajambo_user"
export DB_PASSWORD="emmaemma"
export DB_HOST="127.0.0.1"
export DB_NAME="hajambo"
export DB_PORT=5432
export AT_API_KEY="atsk_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
export JWT_SECRET="your-jwt-secret"
pkill -f 'node index.js' 2>/dev/null || true
nohup /home/user/.nvm/versions/node/v20.19.5/bin/node index.js > node.log 2>&1 &
sleep 1
tail -n 60 node.log



💾 Static File Hosting

Files in /home/user/hajambo-down/ are served publicly:

app.use(express.static('/home/user/hajambo-down'));

Example:

https://cookie-goes-defining-assets.trycloudflare.com/app-debug.apk



🧠 Notes

The Cloudflare quick tunnel is ephemeral — keep cloudflared running for availability.

For production, migrate to a named Cloudflare Tunnel for persistent URLs.

The backend currently supports sandbox SMS/USSD — switch to production credentials to go live.

Authentication state on Android will use EncryptedSharedPreferences for secure token storage.


🧑‍💻 Maintainers

Developed by: Emmanuel Odaka Adongu, Menya Titus, Kawunde Shadrach, Adoke Jonathan and Mugabi Comfort Ronnie
Backend runtime: Ubuntu VM + Node.js
App: Android (Kotlin, Room, Jetpack Navigation)
Tunnel: Cloudflare


Would you like me to make a shorter “Hackathon version” (2–3 sections) to show on your GitHub home page while keeping this one as README_DEV.md?

