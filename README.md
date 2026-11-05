# Forever Characters

A small website for tracking the characters you and your friends are levelling in
**World of Warcraft: Forever**: who's playing what, where their professions are, and
what the group can actually craft right now.

Plain HTML/CSS/JS — no build step. It's hosted on GitHub Pages and reads and writes
a Google Sheet through a small Apps Script web app.

## What's in it

- **Roster** — a card per character with class colour, level, specs and professions,
  grouped by player (or by class, or sorted by level). Search and filter by player.
- **Professions** — the part worth having. For every profession: who has it, their skill
  rank and progress towards that rank's cap, a star on the group's best crafter, how many
  tracked recipes they've unlocked, and whether the profession that supplies it is covered
  by anyone. Professions nobody has are listed separately, with the characters who still
  have a free slot.
- **Trade board** — the actual recipe list, 1-300, filtered against the group's real
  skill levels. **Can make now** is what someone can craft today, with who and at what
  skill; **Nearly there** is everything within 25 skill of somebody; **Everything** is
  the full book. Each row shows the skill needed and the materials for one craft.
  Lines people wrote in the sheet appear under *From the sheet* and are matched back to
  real recipes — "Peacebloom = Spell Damage potion" finds Minor Arcane Elixir — and the
  recipes they matched get a ★.

Professions parse loosely: `Herblore`, `herb` and `Herbalism` all count as Herbalism,
and a skill of `22?` reads as 22. Anything it doesn't recognise is kept and shown as
typed, so nothing you write in the sheet gets lost.

## The recipes

`recipes.js` holds the 1-300 route for each crafting profession — 121 recipes with the
skill they unlock at and the materials for one craft. That file is the baseline; the
group edits the list from the site itself:

- **+ Recipe** on the trade board adds one.
- **Clicking any recipe** opens it for editing. Correcting a built-in writes a row to the
  sheet's `Recipes` tab that replaces it for everyone, tagged *fixed by <name>*; one you
  added shows as *added by <name>*.
- **Hide it** removes a built-in recipe that turned out not to exist. **Undo the fix** on
  a correction drops it and brings the original back.
- **Have you made it?** in the same dialog is the vote: *It works* or *It's wrong*, one
  per person. A confirmed recipe shows **✓ confirmed** and clears its **?**; a disputed
  one shows **⚠ 1 says wrong** so nobody wastes materials on it. The **Needs checking**
  filter lists what's in reach of someone's skill but nobody has confirmed — a to-do list
  for the next time you're near a trainer.

Editing a recipe's skill or materials clears its votes, since a confirmation of the old
numbers says nothing about the new ones.

So nobody has to touch code to fix a wrong skill number — which matters, because:

Forever launched on 4 November 2026, so this data comes from community guides written
during the beta rather than from anything official. Steps past skill 225 are the ones
those guides still mark untested; the site shows them with a **?** so nobody plans a
shopping trip around a number that might move. Sources are listed at the top of
`recipes.js` — spot-check anything you're about to spend real gold on.

Forever's professions differ from Classic's in ways the site already accounts for:
nine primaries with no Jewelcrafting or Inscription, Enchanting both gathers and crafts,
Tailoring's recommended partner is Enchanting, First Aid makes the healing potions that
used to be Alchemy's, and the rank thresholds are Apprentice 75 / Journeyman 150 /
Expert 225 / Artisan 300, trainable at 50, 125 and 200 with character levels 10, 20
and 35.

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

Classes, races, specs, professions and the skill ranks live in `data.js`; the recipes
live in `recipes.js`. The lists are only suggestions — every field accepts free text, so
odd combinations and jokes like "AH Bot" work fine.

## The sheet

Three tabs. `Recipes` holds what the group added or corrected, and starts empty — the
built-in list covers the basics:

```
id | profession | name | skill | mats | note | removed | by | updated
```

A row here replaces the built-in recipe with the same profession and name; `removed` set
to `yes` hides it instead.

`Votes` is one row per person per recipe:

```
id | profession | name | by | verdict | note | updated
```

`verdict` is `works` or `wrong`. Editing by hand in the sheet works just as well as
editing on the site, on either tab.

`Roster` has one row per character:

```
id | name | player | level | race | class | spec1 | spec2 |
prof1 | prof1Level | prof2 | prof2Level | profPlan | trades | notes | updated
```

`id` keys the row, so renaming a character keeps their row. You can add rows by hand and
leave `id` blank — the next write from the site fills one in. `trades` is a
semicolon-separated list; the site shows it one per line while editing.
