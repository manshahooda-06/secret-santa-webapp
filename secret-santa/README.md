# Secret Santa

A small web app for running a Secret Santa name draw with friends, family or colleagues. It runs entirely on your own computer as a Cloudflare Worker with a local D1 (SQLite) database, so it is free to host and needs no Cloudflare account.

## Features

- **Fixed draw.** Once every person has submitted a list, names are drawn on the server and saved. Everyone sees the same result on every device.
- **Hidden from the organizer.** The organizer page and the organizer API never include who was assigned to whom. Each player only sees their own person.
- **Hidden exclusions.** The organiser can stop specific people from drawing each other (optionally both ways). Exclusions never reach participant pages.
- **No sign-in.** Participants open a shared link and pick their own name.
- **Wish lists and a note.** Each person adds gift names or links, plus an optional note, then submits the list. Their Secret Santa sees both after the draw.
- **Organiser can play.** They use the same player link as everyone else and only learn their own assignment.
- **Safe redraws.** The draw is locked after it runs. Resetting it clears pairings only, and the organizer still is not shown the result.

## How it works

| Piece | What it does |
| --- | --- |
| `public/index.html` | Page shell (participant view at `/`, organiser view at `/#admin`) |
| `public/styles.css` | Festive layout, for phones and wider screens |
| `public/app.js` | Front-end flow for setup, wish lists, and the private reveal |
| `public/favicon.svg` | The browser tab icon |
| `src/index.js` | The Worker: serves the API under `/api/*` and everything else from `public/` |
| `schema.sql` | Database tables: `settings`, `members`, `exclusions`, `wishes` |
| `wrangler.toml` | Worker configuration and database binding |
| `.dev.vars` | Your organiser password (`ADMIN_KEY`). Never share or commit this file |

The draw uses a randomised backtracking search. Nobody draws themselves or someone they are excluded from. If the exclusions make a valid draw impossible, the organiser is told and nothing is saved. At least 2 participants are needed. The draw runs on its own when the last list is submitted.

## Requirements

- Node.js 20 or newer (22 LTS recommended; newer versions may work but are less tested with Wrangler)
- Windows, macOS or Linux
- Optional: `cloudflared`, to let people outside your network reach the app

## First-time setup

Run these in the project folder (the one containing `wrangler.toml`):

1. `npm install`
2. Copy `.dev.vars.example` to `.dev.vars` and set your password:
   ```
   ADMIN_KEY=choose-a-long-password
   ```
3. `npm run db:init` creates the database tables. It is safe to run again; it will not erase data.

## Running the app

```
npm start
```

The app is now at `http://localhost:8787`.

- Participants use `http://localhost:8787/`
- The organiser uses `http://localhost:8787/#admin` and logs in with `ADMIN_KEY`

The first time you start it, Windows may show a firewall prompt. Allowing it on private networks lets people on your Wi-Fi use `http://<your-PC-IP>:8787`.

## Organiser workflow

1. Open `/#admin` and log in.
2. Set the event date and price limit, and add every participant.
3. Copy the player link and share it.
4. Each player picks their name, adds gift names or links, optionally leaves a note, and submits.
5. When the last list is submitted, names are drawn automatically. The organizer page only shows who has submitted, never the pairs.
6. Players open the link again, pick their name, and see that one person's list and note.
7. If a draw has to be redone, reset it and press **Draw names**. The result stays hidden.

Lock the guest list when everyone who is playing has been added. The draw waits for that lock and for every list. People can't be added or removed once the draw is done — reset it first. Lists also lock when the draw runs.

## Sharing with people outside your network

Install `cloudflared`:

- Windows: `winget install Cloudflare.cloudflared`
- macOS: `brew install cloudflared`

With the app running, open a second terminal and run:

```
cloudflared tunnel --url http://localhost:8787
```

It prints an `https://something.trycloudflare.com` link. Share that link with participants.

Notes:

- The link changes every time you restart the tunnel, so share it after starting.
- Keep both terminals running and your PC awake until the event is over.
- Quick tunnels have no uptime guarantee. They are fine for a small group.

## Inspecting the database

Run these from the project folder (the one with `wrangler.toml`):

```
npx wrangler d1 execute santa --local --command "SELECT * FROM members"
npx wrangler d1 execute santa --local --command "SELECT * FROM exclusions"
npx wrangler d1 execute santa --local --command "SELECT * FROM wishes"
npx wrangler d1 execute santa --local --command "SELECT * FROM settings"
```

To see who drew whom (spoilers!):

```
npx wrangler d1 execute santa --local --command "SELECT g.name AS giver, r.name AS receiver FROM members g LEFT JOIN members r ON r.id = g.drawn_id"
```

You can also open the SQLite file under `.wrangler/state/v3/d1/miniflare-D1DatabaseObject/` with a tool such as DB Browser for SQLite. Open a copy, not the live file.

## Data and backups

All data is stored in `.wrangler/state/` inside the project folder and survives restarts. To back up, copy that folder somewhere safe, ideally before the draw. Deleting it wipes everything.

## Changing the favicon

The icon is `public/favicon.svg`, referenced in the `<head>` of `public/index.html`. To use another file type, update both the `href` and `type` attributes of the `<link rel="icon">` tag, then hard refresh (Ctrl+Shift+R).

## Troubleshooting

| Problem | Fix |
| --- | --- |
| `Cannot find module ... finetunes.js` during setup | The install is damaged. Delete `node_modules` and `package-lock.json`, run `npm cache clean --force`, then `npm install`. If it persists, use Node 22 LTS or move the project out of OneDrive/Desktop. |
| `Couldn't find a D1 DB with the name or binding 'santa'` | You are in the wrong folder. `cd` into the folder that contains `wrangler.toml`. |
| "Wrong admin password" | Check that `.dev.vars` is named exactly that (no `.example` or `.txt`), contains `ADMIN_KEY=...`, and that you restarted `npm start` after editing it. |
| Favicon still shows the old icon or 404 | Hard refresh, or open a private window. Browsers cache favicons heavily. |
| Friends can't open the link | The tunnel must still be running and the link must be the latest one printed. Your PC must be on and awake. |
| "No valid draw exists" | Your exclusions are too restrictive. Remove some and try again. |

## Security notes

- There is no participant login by design. Anyone with the link can pick any name and see that person's assignment. Only share the link with people you trust. Wish lists can't be edited after the draw.
- The organiser password is stored in `.dev.vars` and sent as a request header, so keep the app on trusted networks or behind the HTTPS tunnel.
- Exclusions and assignments are only exposed through organiser-only or per-person endpoints, but anyone with access to the database files on your PC can read everything.
- `wrangler dev` is a development server. It is fine for a small group for a few weeks, not for public production use.

## Limitations

- Single event per installation. For a second group, copy the project to a new folder with its own database.
- No email notifications or reminders.
- Wish lists support a name or a link per gift, plus one short note (no images).
