# Flapy Game

Flappy-style game with accounts, guest mode and a **global leaderboard** stored in a [Neon](https://neon.tech) Postgres database.

- On opening the site you choose **Sign in**, **Sign up** (unique username + password) or **Guest** (just a name, names don't need to be unique).
- Every finished game is saved; the leaderboard shows each player's best score, worldwide.
- **Log out** appears only on the Game Over screen.
- The bird images (`face_main.png`, `face_follower1.png`, `face_follower2.png`) are drawn as the *whole* bird. The old canvas-drawn bird is gone.

## Project layout

```
Flapy-Game/
├── server.js            Express API + static file server
├── package.json
├── .env.example         copy to .env and add your Neon connection string
├── db/schema.sql        tables (server.js creates them automatically on start)
└── public/              everything the browser loads
    ├── index.html
    ├── css/style.css
    ├── js/script.js
    └── assets/
        ├── images/  background.png, pipe.svg, face_main.png (player), face_follower1.png, face_follower2.png
        ├── icons/   pause, volume, volume-off, trophy, smile, user, leaderboard, logout, back, refresh (.svg)
        ├── audio/   fly.mp3, catch.mp3, lose.mp3
        └── fonts/   Lilita One + Nunito (local, no internet font needed)
```

To change a bird, replace its PNG with the same file name (transparent background, the whole bird facing right, any size/ratio).

## Setup (5 minutes)

1. **Create the database** - sign in at https://console.neon.tech, create a project, then press **Connect** and copy the connection string (the pooled one is fine).
2. **Add it to the project**
   ```
   cp .env.example .env
   # edit .env and paste your string after DATABASE_URL=
   ```
   (On Replit / Render / Railway: add `DATABASE_URL` as a secret / environment variable instead of using .env.)
3. **Run**
   ```
   npm install
   npm start
   ```
   Open http://localhost:3000. The tables are created automatically the first time the server starts.

> The game now needs a Node host (Replit, Render, Railway, Fly, a VPS ...). Static-only hosting such as GitHub Pages can't run the login/leaderboard API. Never put the Neon connection string in the browser code - it only lives in `.env` on the server.

## How it works

| Endpoint | What it does |
|---|---|
| `POST /api/signup` | create account (username unique, case-insensitive; password stored as a bcrypt hash) |
| `POST /api/login` | sign in |
| `POST /api/guest` | play as guest with any name |
| `GET /api/me` | restore the saved session on page load |
| `POST /api/logout` | end the session |
| `POST /api/run` | called when a game starts |
| `POST /api/score` | called on Game Over, returns your new best + global rank |
| `GET /api/leaderboard` | top 20 best scores + your own rank |

Basic anti-cheat: a score is only accepted for a game that was started on the server, only once, and it can't be higher than the time that game could physically have lasted. (Like any browser game, a determined cheater can still automate play - this stops casual fake scores.)

Guest scores stay on the leaderboard after the guest logs out, but that guest can't be signed back in. Create an account to keep a permanent identity.
