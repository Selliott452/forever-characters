/**
 * Forever Characters — JSON API for the GitHub Pages site.
 *
 * Two tabs, both one row per thing, both keyed by a short `id` so a rename
 * doesn't lose the row:
 *   Roster   — the characters.
 *   Recipes  — recipes the group added or corrected. The site ships a built-in
 *              list in recipes.js; a row here with the same profession + name
 *              replaces it, and a row with `removed` = yes hides it. That's how
 *              you fix a wrong skill number without anyone touching the code.
 *   Votes    — one row per person per recipe, saying whether they've seen it
 *              work in game. That's what clears the "?" on the provisional
 *              entries, and what flags one as wrong.
 *
 * GET  <url>  -> { ok, characters: [...], recipes: [...], votes: [...] }
 * POST <url>  body: { token, upserts, deletes, recipeUpserts, recipeDeletes,
 *                     voteUpserts, voteDeletes }
 *
 * Both tabs stay friendly to hand-editing: add a row and leave `id` blank, and
 * the next write from the site fills one in.
 */
const SHEETS = {
  roster: {
    name: 'Roster',
    headers: [
      'id', 'name', 'player', 'level', 'race', 'class',
      'spec1', 'spec2',
      'prof1', 'prof1Level', 'prof2', 'prof2Level', 'profPlan',
      'trades', 'notes', 'updated',
    ],
    required: ['name'],
    numbers: ['level', 'prof1Level', 'prof2Level'],
  },
  recipes: {
    name: 'Recipes',
    headers: ['id', 'profession', 'name', 'skill', 'mats', 'note', 'removed', 'by', 'updated'],
    required: ['profession', 'name'],
    numbers: ['skill'],
  },
  votes: {
    name: 'Votes',
    headers: ['id', 'profession', 'name', 'by', 'verdict', 'note', 'updated'],
    required: ['profession', 'name', 'by'],
    numbers: [],
  },
};

/** Run this once from the editor. It creates both tabs and logs your write token. */
function setup() {
  getSheet_(SHEETS.roster);
  getSheet_(SHEETS.recipes);
  getSheet_(SHEETS.votes);
  const props = PropertiesService.getScriptProperties();
  let token = props.getProperty('TOKEN');
  if (!token) {
    token = Utilities.getUuid();
    props.setProperty('TOKEN', token);
  }
  Logger.log('Your write token: ' + token);
}

function doGet() {
  return json_({
    ok: true,
    characters: readAll_(SHEETS.roster),
    recipes: readAll_(SHEETS.recipes),
    votes: readAll_(SHEETS.votes),
  });
}

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    const token = PropertiesService.getScriptProperties().getProperty('TOKEN');
    if (!token || body.token !== token) return json_({ ok: false, error: 'Wrong token' });

    const roster = applyChanges_(SHEETS.roster, body.upserts, body.deletes);
    const recipes = applyChanges_(SHEETS.recipes, body.recipeUpserts, body.recipeDeletes);
    const votes = applyChanges_(SHEETS.votes, body.voteUpserts, body.voteDeletes);
    return json_({
      ok: true,
      changed: roster.changed + recipes.changed + votes.changed,
      characters: roster.rows,
      recipes: recipes.rows,
      votes: votes.rows,
    });
  } catch (err) {
    return json_({ ok: false, error: String((err && err.message) || err) });
  }
}

function getSheet_(cfg) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(cfg.name);
  if (!sh) {
    sh = ss.insertSheet(cfg.name);
    sh.setFrozenRows(1);
    sh.setColumnWidth(1, 70);
  }
  // Keep the header row in sync, in case the tab predates a new column.
  sh.getRange(1, 1, 1, cfg.headers.length).setValues([cfg.headers]).setFontWeight('bold');
  return sh;
}

function rowsOf_(sh, cfg) {
  const last = sh.getLastRow();
  if (last < 2) return [];
  return sh.getRange(2, 1, last - 1, cfg.headers.length).getDisplayValues()
    .filter(function (r) {
      return cfg.required.every(function (field) {
        return String(r[cfg.headers.indexOf(field)] || '').trim();
      });
    });
}

function toObject_(cfg, row) {
  const o = {};
  cfg.headers.forEach(function (h, i) { o[h] = row[i] == null ? '' : String(row[i]).trim(); });
  cfg.numbers.forEach(function (h) { o[h] = numOrBlank_(o[h]); });
  return o;
}

/** "22?" and "44" both mean a number; empty stays empty. */
function numOrBlank_(v) {
  const digits = String(v).replace(/[^0-9]/g, '');
  return digits === '' ? '' : Number(digits);
}

function toRow_(cfg, c) {
  return cfg.headers.map(function (h) {
    if (h === 'updated') return c.updated || new Date().toISOString();
    return c[h] == null ? '' : c[h];
  });
}

function readAll_(cfg) {
  const sh = getSheet_(cfg);
  return rowsOf_(sh, cfg).map(function (r) { return toObject_(cfg, r); });
}

function applyChanges_(cfg, upserts, deletes) {
  upserts = Array.isArray(upserts) ? upserts : [];
  deletes = Array.isArray(deletes) ? deletes : [];

  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const sh = getSheet_(cfg);
    const rows = rowsOf_(sh, cfg);
    if (!upserts.length && !deletes.length) {
      return { changed: 0, rows: rows.map(function (r) { return toObject_(cfg, r); }) };
    }

    const index = new Map();
    rows.forEach(function (r, i) { if (r[0]) index.set(String(r[0]), i); });

    const dropped = new Set();
    let changed = 0;

    for (const id of deletes) {
      const i = index.get(String(id));
      if (i != null) { dropped.add(i); index.delete(String(id)); changed++; }
    }

    const now = new Date().toISOString();
    for (const c of upserts) {
      if (!c) continue;
      const ok = cfg.required.every(function (f) { return String(c[f] || '').trim(); });
      if (!ok) continue;
      const id = String(c.id || '').trim() || Utilities.getUuid().slice(0, 8);
      const row = toRow_(cfg, Object.assign({}, c, { id: id, updated: now }));
      const i = index.get(id);
      if (i != null && !dropped.has(i)) rows[i] = row;
      else { index.set(id, rows.length); rows.push(row); }
      changed++;
    }

    // Rewrite the whole data block in one go — simpler than row-by-row edits.
    const kept = rows.filter(function (_, i) { return !dropped.has(i); });
    const last = sh.getLastRow();
    if (last > 1) sh.getRange(2, 1, last - 1, cfg.headers.length).clearContent();
    if (kept.length) {
      sh.getRange(2, 1, kept.length, cfg.headers.length).setNumberFormat('@'); // plain text
      sh.getRange(2, 1, kept.length, cfg.headers.length).setValues(kept);
    }
    return { changed: changed, rows: kept.map(function (r) { return toObject_(cfg, r); }) };
  } finally {
    lock.releaseLock();
  }
}

/**
 * Optional: run once to fill an empty Roster with the characters we started
 * from. It does nothing if the tab already has rows. The Recipes tab is meant
 * to start empty — the site's built-in list covers the basics.
 */
function seedRoster() {
  const cfg = SHEETS.roster;
  const sh = getSheet_(cfg);
  if (sh.getLastRow() > 1) {
    Logger.log('Roster already has rows — not seeding.');
    return;
  }
  // name, player, level, race, class, spec1, spec2, prof1, lvl, prof2, lvl, plan, trades, notes
  const seed = [
    ['Daz Moonspear', 'Josh', 1, 'Night Elf', 'Druid', 'Feral (Bear)', 'Feral (Cat)', 'Skinning', 1, 'Leatherworking', 1, 'Transition Skinning to Engineering end game', '', ''],
    ['Daz Lighthammer', 'Josh', 9, 'Dwarf', 'Paladin', 'Protection', 'Retribution', 'Mining', 1, 'Blacksmithing', 1, '', '', ''],
    ['Daz Stoneblade', 'Josh', 1, 'Night Elf', 'Warrior', 'Protection', 'Fury', '', '', '', '', '', '', ''],
    ['Smoke Blazenbeard', 'Ian', 1, 'Dwarf', 'Paladin', 'Retribution', 'Protection', '', '', '', '', '', '', ''],
    ['Beard Smokenblaze', 'Ian', 1, 'Dwarf', 'Warrior', 'Fury', '', '', '', '', '', '', '', ''],
    ['Soot Kegsplitter', 'Adam', 9, 'Dwarf', 'Shaman', 'Elemental', 'Restoration', 'Herbalism', 15, 'Alchemy', 14, '', 'Peacebloom = Spell Damage potion; Silverleaf = Physical Damage potion', ''],
    ['Summon Yous', 'Adam', 1, 'Human', 'Warlock', 'AH Bot', 'Summon Bot', '', '', '', '', '', '', ''],
    ['Oran Ge eard', 'Ryan', 9, 'Dwarf', 'Shaman', 'TBD', 'TBD', 'Mining', '', '', '', '', '', ''],
    ['Anya BlazinBraids', 'Sam', 10, 'Dwarf', 'Priest', 'Shadow', 'TBD', 'Enchanting', 22, 'Tailoring', 44, '', '6 linen cloth = 6 slot bag', ''],
  ];
  const now = new Date().toISOString();
  const rows = seed.map(function (s) { return [Utilities.getUuid().slice(0, 8)].concat(s, [now]); });
  sh.getRange(2, 1, rows.length, cfg.headers.length).setNumberFormat('@');
  sh.getRange(2, 1, rows.length, cfg.headers.length).setValues(rows);
  Logger.log('Seeded ' + rows.length + ' characters.');
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
