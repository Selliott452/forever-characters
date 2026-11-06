# Forever Characters

**[characters.selliott.me](https://characters.selliott.me/)**

A small website for tracking the characters you and your friends are levelling in
**World of Warcraft: Forever**: who's playing what, where their professions are, and
what the group can actually craft right now.

Plain HTML/CSS/JS — no build step. It's hosted on GitHub Pages and reads and writes
a Google Sheet through a small Apps Script web app.

## What's in it

- **Roster** — a card per character with class colour, level, specs and professions,
  grouped by player (or by class, or sorted by level). Search and filter by player.
  A character has two primary profession slots, picked from a list so they can't be
  mistyped, and a skill box for each secondary — Cooking, Fishing and First Aid — since
  everyone has those. A secondary shows up once you put a number against it.
- **Professions** — the part worth having. For every profession: who has it, their skill
  rank and progress towards that rank's cap, a star on the group's best crafter, and how
  many services are posted for it, grouped into gathering, crafting and secondary. The
  ones nobody has yet sit at the end of their group with a dashed border.
- **Service board** — a board of services people have posted: *I can craft this for
  you*. Nothing on it is generated or fetched — every line is there because somebody
  typed it. Each one carries the character who makes it, the profession, the materials
  it needs, who to ask, and notes. Group it by profession, character or player, or sort newest first, and
  filter to one profession with the chips.

Professions parse loosely: `Herblore`, `herb` and `Herbalism` all count as Herbalism,
and a skill of `22?` reads as 22. Anything it doesn't recognise is kept and shown as
typed, so nothing you write in the sheet gets lost.

## Posting a service

**+ Post a service** on the board puts one up; clicking one opens it again to edit, or
to **take it down**. The only required field is what you can craft — everything else is
optional, so "Portals to Ironforge" with nothing else filled in is a perfectly good
post.

**Materials** is what the job needs — *6x Linen Cloth*, or *I have the mats*. It shows
on the board as you wrote it, with no label in front of it. **Notes** is for everything
else: *free for the group*, *whisper me after raid*.

If you name a character who's on the roster, the board shows their skill in that
profession next to the service, so people can see it's the maxed Tailor and not the
level 3 alt. Name one who isn't on the roster and it posts anyway.

Your name is remembered in your browser so you only type it once.

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

With no `scriptUrl` in `config.js` the site runs in preview mode: it starts empty and
saves whatever you add to that browser's localStorage, so you can click around without
touching the sheet. Nothing you add in preview mode reaches anyone else.

## Wiring up the Google Sheet

1. Create a Google Sheet (any name).
2. **Extensions → Apps Script**, delete the sample code and paste in `apps-script/Code.gs`.
3. Run `setup()` once. Approve the permissions prompt, then open **View → Logs** and copy
   the write token it printed.
4. **Deploy → New deployment → Web app**, with *Execute as: Me* and
   *Who has access: Anyone*. Copy the `/exec` URL.
5. Put that URL in `config.js` as `scriptUrl`, then commit and push.
6. On the live site, click **Write key** once per device and paste the token. Anyone
   without the token still sees the roster, they just can't change it.

The token is the only thing standing between your friends and strangers editing the
sheet, so share it in your group chat, not on the page.

## Hosting on GitHub Pages

This one is live at **https://characters.selliott.me/**, served from `main` at the repo
root. To host your own copy: push it to a GitHub repo, then **Settings → Pages →
Source: Deploy from a branch**, branch `main`, folder `/ (root)`. `.nojekyll` is already
there so Pages serves the files as-is.

The custom domain comes from the `CNAME` file in the repo root, paired with a DNS
CNAME record pointing `characters` at `selliott452.github.io`. Delete that file to go
back to the `github.io` address.

## Configuration

`config.js`:

| key | what it does |
| --- | --- |
| `scriptUrl` | the Apps Script `/exec` URL; empty means localStorage preview mode |
| `levelMax` | character level cap, for the level bars (default 60) |
| `professionMax` | profession skill cap (default 300); also decides which skill ranks exist |
| `realm` | optional label shown next to the title |

Classes, races, specs, professions and the skill ranks live in `data.js`, set to what
Forever actually has: the nine original classes with no Death Knight, Monk, Demon Hunter
or Evoker; four races a side plus the Skyborne, who pick a faction at creation; and no
Jewelcrafting or Inscription. Race, class and spec are only suggestions — those fields
accept free text, so odd combinations and jokes like "AH Bot" work fine. The two
profession slots are dropdowns, so those are the whole list.

## The sheet

Two tabs. `Posts` is the service board, one row per service:

```
id | char | profession | item | mats | note | by | updated
```

Only `item` is required. An update only touches the fields it carries, so a column you
added by hand, or one the site has stopped collecting, survives an edit from the site
instead of being blanked. Editing by hand in the sheet works just as well as editing
on the site, on either tab.

`Roster` has one row per character:

```
id | name | player | level | race | class | spec1 | spec2 |
prof1 | prof1Level | prof2 | prof2Level | cooking | fishing | firstaid | notes | updated
```

`id` keys the row, so renaming a character keeps their row. You can add rows by hand and
leave `id` blank — the next write from the site fills one in. `prof1` and `prof2` are the
two primary slots; `cooking`, `fishing` and `firstaid` are skill numbers, since everyone
has those three.
