# Forever Characters

A small website for tracking the forever characters you and your friends are levelling:
who's playing what, where their professions are, and what the group can craft.

Plain HTML/CSS/JS — no build step. It's hosted on GitHub Pages and reads and writes
a Google Sheet through a small Apps Script web app.

## What's in it

- **Roster** — a card per character with class colour, level, specs and professions,
  grouped by player (or by class, or sorted by level). Search and filter by player.
- **Professions** — the part worth having. For every profession: who has it, their skill
  rank and progress to the next rank, a star on the group's best crafter, and whether
  the gathering profession that supplies it is covered by anyone. Professions nobody has
  are listed separately, with the characters who still have a free slot.
- **Trade board** — everything the group can make, pulled from each character's
  "what this character can make" list, searchable.

Professions parse loosely: `Herblore`, `herb` and `Herbalism` all count as Herbalism,
and a skill of `22?` reads as 22. Anything it doesn't recognise is kept and shown as
typed, so nothing you write in the sheet gets lost.

## Running it locally

Needs Node 22.6+ (nothing to install — the server uses only built-ins).

```bash
npm start
```

Then open http://localhost:8001. On Windows, double-clicking `start-server.bat` does
the same thing.

With no `scriptUrl` in `config.js` the site runs in preview mode: it starts from the
roster in `data.js` and saves changes to that browser's localStorage, so you can click
around without touching the sheet.

## Wiring up the Google Sheet

1. Create a Google Sheet (any name).
2. **Extensions → Apps Script**, delete the sample code and paste in `apps-script/Code.gs`.
3. Run `setup()` once. Approve the permissions prompt, then open **View → Logs** and copy
   the write token it printed.
4. Optionally run `seedRoster()` to fill an empty sheet with the starting roster.
5. **Deploy → New deployment → Web app**, with *Execute as: Me* and
   *Who has access: Anyone*. Copy the `/exec` URL.
6. Put that URL in `config.js` as `scriptUrl`, then commit and push.
7. On the live site, click **Write key** once per device and paste the token. Anyone
   without the token still sees the roster, they just can't change it.

The token is the only thing standing between your friends and strangers editing the
sheet, so share it in your group chat, not on the page.

## Hosting on GitHub Pages

Push this folder to a GitHub repo, then **Settings → Pages → Source: Deploy from a
branch**, branch `main`, folder `/ (root)`. `.nojekyll` is already there so Pages serves
the files as-is.

## Configuration

`config.js`:

| key | what it does |
| --- | --- |
| `scriptUrl` | the Apps Script `/exec` URL; empty means localStorage preview mode |
| `levelMax` | character level cap, for the level bars (default 60) |
| `professionMax` | profession skill cap (default 300); also decides which skill ranks exist |
| `realm` | optional label shown next to the title |

Classes, races, specs, professions and the skill ranks live in `data.js`. They're only
suggestions — every field accepts free text, so odd combinations and jokes like
"AH Bot" work fine.

## The sheet

One `Roster` tab, one row per character:

```
id | name | player | level | race | class | spec1 | spec2 |
prof1 | prof1Level | prof2 | prof2Level | profPlan | trades | notes | updated
```

`id` keys the row, so renaming a character keeps their row. You can add rows by hand and
leave `id` blank — the next write from the site fills one in. `trades` is a
semicolon-separated list; the site shows it one per line while editing.
