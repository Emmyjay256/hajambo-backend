Perfect — here’s a fully written, professional-grade README.md summarizing everything we’ve built together, written in technical detail so it fits your repo directly. It covers your backend architecture, deployment setup, tunnel configuration, and integration with the Hajambo Android app.


🌀 Hajambo Backend

Hajambo is a lightweight social + messaging backend built with Node.js, Express, and PostgreSQL, designed for hackathon-level experimentation and seamless integration with the Hajambo Android app.
It supports user authentication, posts, reels, messaging, USSD interactions, and SMS auto-replies via Africa’s Talking API, all running on a single VM behind a persistent Cloudflare Tunnel.

USSD experience (multi-language, menu-driven)

The USSD entrypoint provides a compact, low-bandwidth interface for users without data. It is fully menu-driven and localized. On the very first dial, a caller is asked to choose a language (English, Kiswahili, Luganda, Runyankore-Rukiga, Runyoro-Rutooro, Acholi, Ateso). Next, they enter a short display name (capped to 20 characters). Those two steps create a ussd_user record and immediately drop the user into the main menu. Returning users skip onboarding and land straight on the menu in their preferred language.

The main menu surfaces four actions: (1) Post a short text update (≤160 chars), (2) Feed to read the latest public posts, (3) My posts to browse content authored by the current user, and (4) Language to switch locale at any time. Common navigational keys are supported across all screens: 0 to exit the session, 00 to jump back to the home menu, 8 for previous page, and 9 for next page. Screens that display lists also show a concise footer that reminds users of these controls so the flow feels familiar across languages.

First-time creation and identity model

When a USSD user completes the language + name step, we persist a row in ussd_user(phone, username, language). To ensure the rest of the platform “just works” with existing APIs and feeds, the backend also creates a shadow row in app_user and links it via app_user.ussd_user_id. This is deliberate: it allows a USSD post to be stored with a standard user_id like any other app post, while still retaining the original USSD identity. The shadow account gets an auto-generated username derived from the caller’s name/phone plus a random password hash (never shown to the user). This design keeps API queries and UI code unified, and it means the Android app and USSD share the same feed primitives.

Posting from USSD

Choosing “1. Post” prompts the user for a single free-text message (≤160 characters). On submit, the backend trims and stores it as a normal row in post(type='post', content, user_id, created_at). Because we ensured a shadow app_user exists, no special case is required in the post table. The flow ends with a short confirmation (“Post saved! Thanks for sharing.” in the active language). This keeps round-trips short and predictable on low-quality networks.

Reading the feed and your own posts

The Feed and My posts flows share the same pagination model. Each screen shows up to three items with a tiny preview (username: first 50 chars…), and a footer that advertises navigation: 8 for Prev, 9 for Next, 00 for Home, and 0 for Exit. Selecting an item number (1–3) opens a detail view that shows the full text and a reduced footer (8 Back · 00 Home · 0 Exit). Paging uses a simple “fetch PAGE_SIZE + 1” strategy to detect whether there is a next page without an extra count query, which keeps latency low on USSD gateways.

Language switching at any time

The Language item replays the locale picker and updates ussd_user.language. All subsequent screens are immediately served in the chosen language. Input normalization is defensive: single-digit selections accept leading zeros and stray whitespace, and the special 00 “Home” token is preserved exactly. If a user enters an invalid digit, the flow returns a localised “Invalid choice” message and reprints the language menu.

Input normalization and resilience

USSD gateways can insert spaces or leading zeros; the router normalizes common keypresses so 03, 3, and 3 all resolve to “3”. The special Home token 00 is never collapsed. This dramatically reduces edge-case bugs and makes flows tolerant of handset/GW quirks. The handler also gracefully falls back to the previous page when a user pages past the end, and it consistently supports 0 (Exit) and 00 (Home) from most depths in the tree.

Database touchpoints

ussd_user: (id, phone, username, language) stores the caller profile and locale.
app_user: a mirrored row is created once per ussd_user via ussd_user_id to unify content ownership with the rest of the platform.
post: USSD posts are inserted as normal type='post' content with user_id set to the shadow app_user. Queries for feed/my posts join against app_user and/or ussd_user to render names consistently.
This mapping lets your analytics, moderation, and feed endpoints operate identically for app and USSD users.


Errors, logging, and gateway compatibility

Every POST to the USSD route logs a compact line with the caller’s phone and raw text, plus parsed segments and notable invalid selections. User-visible errors are localized and terse (“Internal error” ends the session; invalid inputs continue the session with a prompt). The handler sets Content-Type: text/plain and always prefixes responses with CON (continue) or END (terminate), matching common Africa’s Talking semantics. A webhook token check can be added at the Express layer if the aggregator supports it.

Extending the tree

Adding a new language is as simple as cloning the messages.en keys into a new messages.xx object and translating the strings 1:1. New menu items follow the same pattern: add a choice branch in the main switch, keep the on-screen strings short (remember many USSD gateways truncate around ~160–182 chars including the CON|END prefix), and reuse the pagination helpers where lists are involved. Because USSD users already have shadow app_user rows, any new feature that targets the primary app can be exposed to USSD with minimal schema work.

Why this design works well on USSD

Low round-trips: single-screen actions, small lists, and immediate confirmations minimize session timeouts.
Consistent navigation: the same 8/9/00/0 pattern on every list reduces user confusion.
Unified identity: shadow accounts mean posts, likes, and other features remain first-class without branching logic.
Localization first: all user-facing text is centralized in a catalog so adding locales is predictable and safe.





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
export AT_API_KEY="atsk_xxxxxxxxxxxxxxxxxxxxxxxxxxxxx"   ///not shared here
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

USSD Webhook

Very extensive ussd interface discussed before


🌍 Cloudflare Tunnel (Quick Tunnel)

Traffic from the internet is securely proxied to your local VM.

Start tunnel:

nohup cloudflared tunnel --url http://127.0.0.1:3000 > tunnel.log 2>&1 &

View tunnel URL:

grep -A2 "Your quick Tunnel has been created" tunnel.log

Example output:

https://cookie-goes-defining-assets.trycloudflare.com

Everything under this URL maps to this app:

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

