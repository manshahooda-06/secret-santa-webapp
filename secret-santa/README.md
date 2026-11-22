# Secret Santa (runs on your own PC)

Cloudflare Worker + D1 database, both running locally via `wrangler dev`. Free, no Cloudflare account needed.

## One-time setup
1. Install Node.js 20+ from https://nodejs.org
2. In this folder run: `npm install`
3. Copy `.dev.vars.example` to `.dev.vars` and set `ADMIN_KEY` to your organiser password.
4. Create the database: `npm run db:init`

## Run it
`npm start` -> app at http://localhost:8787

- Participants open `/`
- You open `/#admin` and log in with your ADMIN_KEY

## Let friends reach it from the internet (free)
Install cloudflared (Windows: `winget install Cloudflare.cloudflared`, Mac: `brew install cloudflared`), then in a second terminal:

`cloudflared tunnel --url http://localhost:8787`

It prints an `https://something.trycloudflare.com` link. Share that link. It changes every time you restart the tunnel, so share it after you start and keep both terminals running until the event. Your PC must stay on and awake.

## Data
Stored in `.wrangler/state/`. Copy that folder to back it up. Deleting it wipes everything.
