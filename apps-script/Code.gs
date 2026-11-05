/**
 * Forever Characters — JSON API for the GitHub Pages site.
 *
 * Storage: a "Roster" tab with one row per character. Rows are keyed by `id`
 * (a short uuid), so a character can be renamed without losing their row.
 *
 * GET  <url>  -> { ok, characters: [...] }                      (public read)
 * POST <url>  body: { token, upserts: [character], deletes: [id] }
 *
 * The sheet stays friendly to hand-editing: add a row and leave `id` blank,
 * and the next write from the site fills one in for you.
 */
const SHEET_NAME = 'Roster';
const HEADERS = [
  'id', 'name', 'player', 'level', 'race', 'class',
  'spec1', 'spec2',
  'prof1', 'prof1Level', 'prof2', 'prof2Level', 'profPlan',
  'trades', 'notes', 'updated',
];

/** Run this once from the editor. It creates the tab and logs your write token. */
function setup() {
  getSheet_();
  const props = PropertiesService.getScriptProperties();
  let token = props.getProperty('TOKEN');
  if (!token) {
    token = Utilities.getUuid();
    props.setProperty('TOKEN', token);
  }
  Logger.log('Your write token: ' + token);
}

function doGet() {
  return json_({ ok: true, characters: readAll_() });
}

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    const token = PropertiesService.getScriptProperties().getProperty('TOKEN');
    if (!token || body.token !== token) return json_({ ok: false, error: 'Wrong token' });
    const result = applyChanges_(
      Array.isArray(body.upserts) ? body.upserts : [],
      Array.isArray(body.deletes) ? body.deletes : []
    );
    return json_({ ok: true, changed: result.changed, characters: result.characters });
  } catch (err) {
    return json_({ ok: false, error: String((err && err.message) || err) });
  }
}

function getSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(SHEET_NAME);
  if (!sh) {
    sh = ss.insertSheet(SHEET_NAME);
    sh.setFrozenRows(1);
    sh.setColumnWidth(1, 70);
  }
  // Keep the header row in sync, in case the tab predates a new column.
  sh.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]).setFontWeight('bold');
  return sh;
}

function rowsOf_(sh) {
  const last = sh.getLastRow();
  if (last < 2) return [];
  return sh.getRange(2, 1, last - 1, HEADERS.length).getDisplayValues();
}

function toObject_(row) {
  const o = {};
  HEADERS.forEach(function (h, i) { o[h] = row[i] == null ? '' : String(row[i]).trim(); });
  o.level = Number(o.level) || 0;
  o.prof1Level = numOrBlank_(o.prof1Level);
  o.prof2Level = numOrBlank_(o.prof2Level);
  return o;
}

/** "22?" and "44" both mean a number; empty stays empty. */
function numOrBlank_(v) {
  const digits = String(v).replace(/[^0-9]/g, '');
  return digits === '' ? '' : Number(digits);
}

function toRow_(c) {
  return HEADERS.map(function (h) {
    if (h === 'updated') return c.updated || new Date().toISOString();
    return c[h] == null ? '' : c[h];
  });
}

function readAll_() {
  return rowsOf_(getSheet_())
    .filter(function (r) { return String(r[1] || '').trim(); })   // needs at least a name
    .map(toObject_);
}

function applyChanges_(upserts, deletes) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const sh = getSheet_();
    const rows = rowsOf_(sh).filter(function (r) { return String(r[1] || '').trim(); });
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
      if (!c || !String(c.name || '').trim()) continue;
      const id = String(c.id || '').trim() || Utilities.getUuid().slice(0, 8);
      const row = toRow_(Object.assign({}, c, { id: id, updated: now }));
      const i = index.get(id);
      if (i != null && !dropped.has(i)) rows[i] = row;
      else { index.set(id, rows.length); rows.push(row); }
      changed++;
    }
    if (!changed) return { changed: 0, characters: rows.map(toObject_) };

    // Rewrite the whole data block in one go — simpler than row-by-row edits.
    const kept = rows.filter(function (_, i) { return !dropped.has(i); });
    const last = sh.getLastRow();
    if (last > 1) sh.getRange(2, 1, last - 1, HEADERS.length).clearContent();
    if (kept.length) {
      sh.getRange(2, 1, kept.length, HEADERS.length).setNumberFormat('@'); // everything as plain text
      sh.getRange(2, 1, kept.length, HEADERS.length).setValues(kept);
    }
    return { changed: changed, characters: kept.map(toObject_) };
  } finally {
    lock.releaseLock();
  }
}

/**
 * Optional: run once to fill an empty sheet with the roster we started from.
 * It does nothing if the tab already has rows.
 */
function seedRoster() {
  const sh = getSheet_();
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
  sh.getRange(2, 1, rows.length, HEADERS.length).setNumberFormat('@');
  sh.getRange(2, 1, rows.length, HEADERS.length).setValues(rows);
  Logger.log('Seeded ' + rows.length + ' characters.');
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
