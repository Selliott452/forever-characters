(() => {
  'use strict';

  const CFG = window.WOW_CONFIG || {};
  const D = window.WOW_DATA;
  const SCRIPT_URL = (CFG.scriptUrl || '').trim();
  const LEVEL_MAX = Number(CFG.levelMax) || 60;
  const PROF_MAX = Number(CFG.professionMax) || 300;
  const TIERS = D.TIERS;
  const R = window.WOW_RECIPES || {};
  const NEARLY = 25;   // skill points from "we can make this" to "nearly there"

  const $ = id => document.getElementById(id);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const ls = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch { /* storage unavailable */ } },
  };
  const status = msg => { $('status').textContent = msg || ''; };
  const newId = () => Math.random().toString(36).slice(2, 10);
  const titleCase = s => String(s).replace(/\S+/g, w => w[0].toUpperCase() + w.slice(1).toLowerCase());

  const state = {
    chars: [],
    recipes: [],   // rows from the sheet's Recipes tab, on top of the built-in list
    votes: [],     // one row per person per recipe: have they seen it work in game?
    route: 'roster',
    ui: { q: '', player: '', group: 'player', tq: '', tprof: '', tshow: 'now' },
  };
  let token = ls.get('wow-token') || '';
  let myName = ls.get('wow-who') || '';   // name to credit recipes to, this browser only

  /* ---------- game-data helpers ---------- */

  // People type "Shamen", "Ret", "Herblore". Match what we can, keep the rest as typed.
  function normClass(raw) {
    const s = String(raw || '').trim();
    if (!s) return '';
    if (D.CLASSES[s]) return s;
    const t = titleCase(s);
    if (D.CLASSES[t]) return t;
    return D.CLASS_ALIASES[s.toLowerCase()] || '';
  }
  const classColor = raw => (D.CLASSES[normClass(raw)] || {}).color || '';

  function normProf(raw) {
    const s = String(raw || '').trim();
    if (!s) return '';
    if (D.PROFESSIONS[s]) return s;
    const t = titleCase(s);
    if (D.PROFESSIONS[t]) return t;
    return D.PROFESSION_ALIASES[s.toLowerCase()] || '';
  }

  /**
   * Where a skill number sits on the ladder. The bar fills towards the current
   * rank's cap rather than towards 300, because that's the wall you actually
   * hit: 44 Tailoring is more than half way through Apprentice, not 15% of the
   * way to Artisan.
   */
  function tierOf(level) {
    const n = Number(level);
    if (!Number.isFinite(n) || n <= 0) return null;
    let i = TIERS.findIndex(t => n <= t.cap);
    if (i < 0) i = TIERS.length - 1;
    const cur = TIERS[i];
    const next = TIERS[i + 1];
    const floor = i ? TIERS[i - 1].cap : 0;
    return {
      name: cur.name,
      goal: cur.cap,
      pct: Math.max(2, Math.min(100, Math.round(((n - floor) / Math.max(1, cur.cap - floor)) * 100))),
      capped: !next && n >= Math.min(cur.cap, PROF_MAX),
      next,
      // Trainers teach the next rank before you hit the current cap.
      canTrain: next && n >= next.trainAt ? next : null,
    };
  }

  /** The professions a character has, as objects the views can render directly. */
  function profsOf(c) {
    return [[c.prof1, c.prof1Level], [c.prof2, c.prof2Level]]
      .filter(([name]) => String(name || '').trim())
      .map(([raw, lvl]) => {
        const name = normProf(raw);
        const meta = D.PROFESSIONS[name] || {};
        return {
          raw: String(raw).trim(),
          name: name || String(raw).trim(),
          known: !!name,
          kind: meta.kind || 'unknown',
          icon: meta.icon || '❓',
          needs: meta.needs || null,
          level: lvl === '' || lvl == null ? '' : Number(lvl),
          tier: tierOf(lvl),
        };
      });
  }

  /** Professions named in a character's plan ("drop Skinning for Engineering"). */
  function plannedProfs(c) {
    const text = String(c.profPlan || '') + ' ' + String(c.notes || '');
    if (!text.trim()) return [];
    const have = new Set(profsOf(c).map(p => p.name));
    return Object.keys(D.PROFESSIONS)
      .filter(p => !have.has(p) && new RegExp('\\b' + p + '\\b', 'i').test(text));
  }

  const tradesOf = c => String(c.trades || '')
    .split(/[\n;]+/).map(s => s.trim()).filter(Boolean);

  /* ---------- recipes ---------- */

  /**
   * The built-in list in recipes.js is a baseline, not the truth — the game is
   * days old and the numbers came from beta guides. Rows on the sheet's Recipes
   * tab sit on top of it: same profession + name replaces the built-in entry,
   * and `removed` hides it. So the group can correct a skill level or delete a
   * recipe that turned out not to exist without anyone editing code.
   */
  let RX = new Map();
  const rkey = (prof, name) => prof + '|' + String(name).trim().toLowerCase();
  const isYes = v => /^(yes|true|y|1|x)$/i.test(String(v || '').trim());

  function rebuildRecipes() {
    const map = new Map();
    for (const prof of Object.keys(R)) {
      for (const r of R[prof]) map.set(rkey(prof, r.name), Object.assign({ prof, builtIn: true }, r));
    }
    for (const u of state.recipes) {
      const prof = normProf(u.profession) || String(u.profession || '').trim();
      const name = String(u.name || '').trim();
      if (!prof || !name) continue;
      const k = rkey(prof, name);
      if (isYes(u.removed)) { map.delete(k); continue; }
      const base = map.get(k);
      map.set(k, {
        prof, name, id: u.id,
        skill: Number(u.skill) || 0,
        mats: u.mats || '',
        note: u.note || '',
        by: u.by || '',
        builtIn: false,
        corrects: !!(base && base.builtIn),
      });
    }

    // Votes hang off whatever the recipe ended up being. A vote for a recipe
    // that has since been renamed or hidden just doesn't find a home.
    for (const r of map.values()) r.votes = { works: [], wrong: [] };
    for (const v of state.votes) {
      const prof = normProf(v.profession) || String(v.profession || '').trim();
      const r = map.get(rkey(prof, v.name || ''));
      if (!r || !String(v.by || '').trim()) continue;
      (isWrong(v.verdict) ? r.votes.wrong : r.votes.works)
        .push({ id: v.id, by: String(v.by).trim(), note: v.note || '' });
    }
    RX = map;
  }

  const isWrong = v => /^(wrong|no|bad|false)$/i.test(String(v || '').trim());
  /** Confirmed by a real player beats whatever the guides said. */
  const verified = r => !!(r.votes && r.votes.works.length);
  const disputed = r => !!(r.votes && r.votes.wrong.length);
  const myVote = r => {
    if (!r.votes || !myName) return null;
    const mine = n => n.by.toLowerCase() === myName.toLowerCase();
    const yes = r.votes.works.find(mine);
    if (yes) return { verdict: 'works', row: yes };
    const no = r.votes.wrong.find(mine);
    return no ? { verdict: 'wrong', row: no } : null;
  };

  const recipesFor = prof => [...RX.values()]
    .filter(r => r.prof === prof)
    .sort((a, b) => a.skill - b.skill || a.name.localeCompare(b.name));
  const recipeProfessions = () => [...new Set([...RX.values()].map(r => r.prof))];
  const skillOf = h => Number(h.p.level) || 0;
  /** "4x Bolt of Silk Cloth, 2x Red Dye" -> ["Bolt of Silk Cloth", "Red Dye"] */
  const matsOf = r => String(r.mats || '').split(',')
    .map(s => s.replace(/^\s*\d+\s*x\s*/i, '').trim()).filter(Boolean);

  /**
   * Tie a line someone wrote in the sheet to a real recipe. An exact name is a
   * sure thing; otherwise we look for a material they named, which is how
   * "Peacebloom = Spell Damage potion" finds Minor Arcane Elixir. Loose matches
   * only count against recipes that character can already make, or every herb
   * would match half the alchemy book.
   */
  function matchNote(text, profs) {
    const low = text.toLowerCase();
    const exact = [], loose = [];
    for (const p of profs) {
      for (const r of recipesFor(p.name)) {
        if (low.includes(r.name.toLowerCase())) exact.push({ prof: p.name, r });
        else if ((Number(p.level) || 0) >= r.skill &&
                 matsOf(r).some(m => low.includes(m.toLowerCase()))) loose.push({ prof: p.name, r });
      }
    }
    return exact.length ? { hits: exact, exact: true } : { hits: loose.slice(0, 3), exact: false };
  }

  const primaryCount = c => profsOf(c)
    .filter(p => p.kind === 'gathering' || p.kind === 'crafting' || p.kind === 'unknown').length;

  /* ---------- storage: Google Sheet via Apps Script, or this browser ---------- */

  const remote = {
    async load() {
      const res = await fetch(SCRIPT_URL);
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || 'Load failed');
      return {
        characters: data.characters || [],
        recipes: data.recipes || [],
        votes: data.votes || [],
      };
    },
    async save(change) {
      // text/plain keeps this a "simple" request, so the browser skips the CORS preflight Apps Script can't answer.
      const res = await fetch(SCRIPT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(Object.assign({ token }, change)),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || 'Save failed');
      return {
        characters: data.characters || null,
        recipes: data.recipes || null,
        votes: data.votes || null,
      };
    },
  };

  const local = {
    async load() {
      const roster = ls.get('wow-roster');
      let chars;
      try { chars = roster ? JSON.parse(roster) : null; } catch { chars = null; }
      let recipes, votes;
      try { recipes = JSON.parse(ls.get('wow-recipes') || '[]'); } catch { recipes = []; }
      try { votes = JSON.parse(ls.get('wow-votes') || '[]'); } catch { votes = []; }
      return {
        characters: chars || D.SEED.map(c => Object.assign({ id: newId() }, c)),
        recipes, votes,
      };
    },
    async save() {
      ls.set('wow-roster', JSON.stringify(state.chars));
      ls.set('wow-recipes', JSON.stringify(state.recipes));
      ls.set('wow-votes', JSON.stringify(state.votes));
      return {};
    },
  };

  const store = SCRIPT_URL ? remote : local;
  const canWrite = () => !SCRIPT_URL || !!token;

  async function saveChanges(change) {
    status('Saving…');
    try {
      const fresh = await store.save(Object.assign({
        upserts: [], deletes: [],
        recipeUpserts: [], recipeDeletes: [],
        voteUpserts: [], voteDeletes: [],
      }, change));
      if (fresh.characters) state.chars = fresh.characters;
      if (fresh.recipes) state.recipes = fresh.recipes;
      if (fresh.votes) state.votes = fresh.votes;
      status('Saved.');
      setTimeout(() => { if ($('status').textContent === 'Saved.') status(''); }, 1800);
    } catch (err) {
      status('Could not save: ' + err.message);
      await refresh(true);
    }
    render();
  }

  async function refresh(quiet) {
    if (!quiet) status('Loading…');
    try {
      const data = await store.load();
      state.chars = data.characters.map(c => Object.assign({}, c, { id: c.id || newId() }));
      state.recipes = data.recipes;
      state.votes = data.votes || [];
      if (!quiet) status('');
    } catch (err) {
      status('Could not load the roster: ' + err.message);
    }
  }

  /* ---------- small render helpers ---------- */

  const bar = (pct, cls) => `<div class="${cls || 'bar'}"><i style="width:${Math.max(0, Math.min(100, pct))}%"></i></div>`;

  function profRow(p) {
    const skill = p.level === '' ? '&mdash;'
      : p.tier ? `${p.level} / ${p.tier.goal}` : String(p.level);
    const tier = p.tier ? `<span class="tier">${esc(p.tier.capped ? 'Max' : p.tier.name)}</span>` : '';
    const unknown = p.known ? '' : ' <small>(not a known profession)</small>';
    return `<div class="prof ${p.kind}">
      <span class="icon">${p.icon}</span>
      <span class="pname">${esc(p.name)}${unknown}${tier}</span>
      <span class="pskill">${skill}</span>
      ${p.tier ? bar(p.tier.pct, 'pbar') : '<div class="pbar"></div>'}
    </div>`;
  }

  function charCard(c, opts) {
    const color = classColor(c.class);
    const lvlPct = Math.round((Math.min(Number(c.level) || 0, LEVEL_MAX) / LEVEL_MAX) * 100);
    const profs = profsOf(c);
    const planned = plannedProfs(c);
    const specs = [c.spec1, c.spec2].filter(s => String(s || '').trim());

    return `<article class="card clickable" data-id="${esc(c.id)}" style="--cc:${esc(color || '#2c3645')}">
      <div class="cname">${esc(c.name)}<span class="lvl">Lv ${esc(c.level || '?')}</span></div>
      ${bar(lvlPct)}
      <div class="sub">
        ${esc(c.race || '?')}<span class="sep">&middot;</span>${esc(c.class || '?')}
        ${opts && opts.showPlayer ? `<span class="sep">&middot;</span>${esc(c.player || 'unassigned')}` : ''}
      </div>
      ${specs.length ? `<div class="specs">${specs.map((s, i) =>
        `<span class="spec ${/^tbd$/i.test(s) ? 'tbd' : (i === 0 ? 'main' : '')}">${esc(s)}</span>`).join('')}</div>` : ''}
      <div class="profs">
        ${profs.length ? profs.map(profRow).join('') : '<span class="noprof">No professions yet</span>'}
        ${planned.length ? `<span class="plan">${esc(planned.join(', '))} planned</span>` : ''}
      </div>
      ${c.profPlan ? `<div class="note">${esc(c.profPlan)}</div>` : ''}
      ${c.notes ? `<div class="note">${esc(c.notes)}</div>` : ''}
    </article>`;
  }

  /* ---------- view: roster ---------- */

  function matches(c, q) {
    if (!q) return true;
    const hay = [c.name, c.player, c.race, c.class, c.spec1, c.spec2,
      c.prof1, c.prof2, c.profPlan, c.notes, c.trades].join(' ').toLowerCase();
    return hay.includes(q.toLowerCase());
  }

  function renderRoster() {
    const { q, player, group } = state.ui;
    const players = [...new Set(state.chars.map(c => c.player || 'unassigned'))].sort();
    const list = state.chars
      .filter(c => matches(c, q))
      .filter(c => !player || (c.player || 'unassigned') === player);

    const covered = new Set();
    state.chars.forEach(c => profsOf(c).forEach(p => { if (p.known) covered.add(p.name); }));
    const primaries = Object.keys(D.PROFESSIONS).filter(p => D.PROFESSIONS[p].kind !== 'secondary');
    const coveredPrimary = primaries.filter(p => covered.has(p)).length;
    const levels = state.chars.map(c => Number(c.level) || 0);

    const stats = `<div class="stats">
      <div class="stat"><b>${state.chars.length}</b><span>Characters</span></div>
      <div class="stat"><b>${players.length}</b><span>Players</span></div>
      <div class="stat"><b>${levels.length ? Math.max(...levels) : 0}</b><span>Highest level</span></div>
      <div class="stat"><b>${coveredPrimary}/${primaries.length}</b><span>Professions covered</span></div>
    </div>`;

    const toolbar = `<div class="toolbar">
      <input type="search" id="q" placeholder="Search characters…" value="${esc(q)}">
      <select id="group">
        <option value="player"${group === 'player' ? ' selected' : ''}>Group by player</option>
        <option value="class"${group === 'class' ? ' selected' : ''}>Group by class</option>
        <option value="level"${group === 'level' ? ' selected' : ''}>Level, high to low</option>
      </select>
      <span class="spacer"></span>
      <div class="chips">
        <button class="chip${player ? '' : ' on'}" data-player="">Everyone</button>
        ${players.map(p => `<button class="chip${player === p ? ' on' : ''}" data-player="${esc(p)}">${esc(p)}</button>`).join('')}
      </div>
    </div>`;

    if (!list.length) {
      return stats + toolbar + `<p class="empty">${state.chars.length ? 'Nothing matches that.' : 'No characters yet.'}</p>`;
    }

    let body = '';
    if (group === 'level') {
      const sorted = [...list].sort((a, b) => (Number(b.level) || 0) - (Number(a.level) || 0) ||
        String(a.name).localeCompare(String(b.name)));
      body = `<div class="cards">${sorted.map(c => charCard(c, { showPlayer: true })).join('')}</div>`;
    } else {
      const keyOf = c => group === 'class' ? (c.class || 'Unknown class') : (c.player || 'unassigned');
      const groups = new Map();
      list.forEach(c => {
        const k = keyOf(c);
        if (!groups.has(k)) groups.set(k, []);
        groups.get(k).push(c);
      });
      body = [...groups.entries()]
        .sort((a, b) => b[1].length - a[1].length || String(a[0]).localeCompare(String(b[0])))
        .map(([k, cs]) => {
          const color = group === 'class' ? classColor(k) : '';
          const sorted = [...cs].sort((a, b) => (Number(b.level) || 0) - (Number(a.level) || 0) ||
            String(a.name).localeCompare(String(b.name)));
          return `<div class="playerhead">
              <h2${color ? ` style="color:${esc(color)}"` : ''}>${esc(k)}</h2>
              <span class="count">${cs.length} character${cs.length === 1 ? '' : 's'}</span>
            </div>
            <div class="cards">${sorted.map(c => charCard(c, { showPlayer: group === 'class' })).join('')}</div>`;
        }).join('');
    }
    return stats + toolbar + body;
  }

  /* ---------- view: professions ---------- */

  /** profession name -> { holders: [...], planners: [...] } across the whole roster. */
  function professionIndex() {
    const idx = new Map();
    const touch = name => {
      if (!idx.has(name)) idx.set(name, { holders: [], planners: [] });
      return idx.get(name);
    };
    for (const c of state.chars) {
      for (const p of profsOf(c)) touch(p.name).holders.push({ c, p });
      for (const name of plannedProfs(c)) touch(name).planners.push(c);
    }
    for (const entry of idx.values()) {
      entry.holders.sort((a, b) => (Number(b.p.level) || 0) - (Number(a.p.level) || 0));
    }
    return idx;
  }

  function holderLi(h, best) {
    const { c, p } = h;
    const color = classColor(c.class);
    const skill = p.level === '' ? '&mdash;' : `${p.level}${p.tier ? ' / ' + p.tier.goal : ''}`;
    const tier = p.tier ? ` <span class="tier">${esc(p.tier.capped ? 'Max' : p.tier.name)}</span>` : '';
    return `<li class="${best ? 'best' : ''}" data-id="${esc(c.id)}" style="--cc:${esc(color || '#e6e9ef')}">
      <span class="who">${esc(c.name)}<small>${esc(c.player || '')}${c.level ? ' &middot; Lv ' + esc(c.level) : ''}</small></span>
      <span class="skill">${skill}${tier}</span>
      ${p.tier ? bar(p.tier.pct, 'hbar') : ''}
    </li>`;
  }

  function pairingLine(name, meta, idx) {
    const out = [];
    if (meta.needs) {
      const src = idx.get(meta.needs) || { holders: [], planners: [] };
      if (src.holders.length) {
        const who = src.holders.slice(0, 3).map(h => h.c.name).join(', ');
        out.push(`<p class="pairing ok">${D.PROFESSIONS[meta.needs].icon} ${esc(meta.needs)} covered by ${esc(who)}</p>`);
      } else if (src.planners.length) {
        out.push(`<p class="pairing planned">${esc(meta.needs)} only planned, by ${esc(src.planners.map(c => c.name).join(', '))}</p>`);
      } else {
        out.push(`<p class="pairing miss">Wants ${esc(meta.needs)} — nobody has it yet</p>`);
      }
    } else if (meta.kind === 'crafting' && !meta.gathers) {
      out.push(`<p class="pairing">No gathering partner — materials come from drops</p>`);
    }
    if (meta.feeds) {
      const fed = meta.feeds.filter(f => (idx.get(f) || { holders: [] }).holders.length);
      out.push(fed.length
        ? `<p class="pairing ok">Feeds ${esc(fed.join(', '))}</p>`
        : `<p class="pairing">Feeds ${esc(meta.feeds.join(', '))} — none taken yet</p>`);
    }
    if (meta.gathers) out.push(`<p class="pairing ok">Collects its own materials</p>`);
    return out.join('');
  }

  function profCard(name, entry, idx) {
    const meta = D.PROFESSIONS[name] || { kind: 'unknown', icon: '❓', makes: '' };
    const holders = entry ? entry.holders : [];
    const planners = entry ? entry.planners : [];
    const bestLevel = Math.max(...holders.map(h => Number(h.p.level) || 0), 0);

    // Secondaries don't compete for the two primary slots, so "free slots" is
    // only worth saying about a primary profession.
    const freeSlots = !holders.length && meta.kind !== 'secondary'
      ? state.chars.filter(c => primaryCount(c) < 2).slice(0, 4)
      : [];

    const recipes = recipesFor(name);
    const unlocked = recipes.filter(r => r.skill <= bestLevel).length;
    const recipeLine = recipes.length
      ? `<p class="unlocked"><b>${unlocked}</b> of ${recipes.length} tracked recipes unlocked
           &middot; <a href="#/trades" data-prof="${esc(name)}">see them</a></p>`
      : '';

    return `<article class="profcard${holders.length ? '' : ' gap'}">
      <h3>${meta.icon} ${esc(name)}<span class="kind">${esc(meta.kind)}</span></h3>
      <p class="makes">${esc(meta.makes || '')}</p>
      ${holders.length
        ? `<ul class="holders">${holders.map(h =>
            holderLi(h, holders.length > 1 && bestLevel > 0 && (Number(h.p.level) || 0) === bestLevel)).join('')}</ul>`
        : `<p class="pairing miss">Nobody has this yet${freeSlots.length
            ? ` — free slots: ${esc(freeSlots.map(c => c.name).join(', '))}`
            : meta.kind === 'secondary' ? ' — anyone can take it alongside their primaries' : ''}</p>`}
      ${planners.length ? `<p class="pairing planned">Planned by ${esc(planners.map(c => c.name).join(', '))}</p>` : ''}
      ${recipeLine}
      ${pairingLine(name, meta, idx)}
    </article>`;
  }

  function renderProfessions() {
    const idx = professionIndex();
    const order = ['gathering', 'crafting', 'secondary'];
    const known = Object.keys(D.PROFESSIONS);
    const extra = [...idx.keys()].filter(n => !D.PROFESSIONS[n]);

    const taken = known.filter(n => (idx.get(n) || { holders: [] }).holders.length);
    const open = known.filter(n => !(idx.get(n) || { holders: [] }).holders.length);
    const byKind = (a, b) => order.indexOf(D.PROFESSIONS[a].kind) - order.indexOf(D.PROFESSIONS[b].kind) ||
      a.localeCompare(b);

    const primaries = known.filter(n => D.PROFESSIONS[n].kind !== 'secondary');
    const coveredPrimary = primaries.filter(n => (idx.get(n) || { holders: [] }).holders.length).length;
    const crafters = taken.filter(n => D.PROFESSIONS[n].kind === 'crafting');
    const unsupported = crafters.filter(n => {
      const needs = D.PROFESSIONS[n].needs;
      return needs && !(idx.get(needs) || { holders: [] }).holders.length;
    });
    const maxSkill = Math.max(0, ...state.chars.flatMap(c => profsOf(c).map(p => Number(p.level) || 0)));

    const stats = `<div class="stats">
      <div class="stat"><b>${coveredPrimary}/${primaries.length}</b><span>Primary covered</span></div>
      <div class="stat"><b>${crafters.length}</b><span>Crafting trades</span></div>
      <div class="stat"><b>${unsupported.length}</b><span>Missing suppliers</span></div>
      <div class="stat"><b>${maxSkill || '—'}</b><span>Top skill</span></div>
    </div>`;

    const section = (title, names) => names.length
      ? `<h2 class="section-title">${esc(title)}</h2>
         <div class="profcards">${names.map(n => profCard(n, idx.get(n), idx)).join('')}</div>`
      : '';

    return stats +
      section('Covered', taken.sort(byKind)) +
      section('Spelled differently in the sheet', extra.sort()) +
      section('Nobody has these yet', open.sort(byKind));
  }

  /* ---------- view: trade board ---------- */

  /** Every recipe in a profession someone has, tagged with who can make it. */
  function board(idx, profs) {
    const rows = [];
    for (const prof of profs) {
      const holders = (idx.get(prof) || { holders: [] }).holders;
      for (const r of recipesFor(prof)) {
        const makers = holders.filter(h => skillOf(h) >= r.skill);
        let closest = null;
        if (!makers.length && holders.length) {
          const top = holders.reduce((a, b) => (skillOf(b) > skillOf(a) ? b : a));
          closest = { c: top.c, gap: r.skill - skillOf(top) };
        }
        rows.push({
          prof, r, makers, closest,
          status: makers.length ? 'now' : closest && closest.gap <= NEARLY ? 'soon' : 'later',
        });
      }
    }
    return rows;
  }

  /**
   * What the row says about how much to trust this recipe. Someone saying they
   * made it in game outranks the "?" the guides earned, and someone saying it's
   * wrong outranks both.
   */
  function voteTag(r) {
    const v = r.votes || { works: [], wrong: [] };
    const names = list => list.map(n => n.by).join(', ');
    if (v.wrong.length) {
      return `<span class="vote bad" title="${esc(names(v.wrong))} couldn’t make this as written">
        ⚠ ${v.wrong.length} say${v.wrong.length === 1 ? 's' : ''} wrong</span>`;
    }
    if (v.works.length) {
      return `<span class="vote good" title="Confirmed in game by ${esc(names(v.works))}">
        ✓ confirmed${v.works.length > 1 ? ' ×' + v.works.length : ''}</span>`;
    }
    return r.unconfirmed
      ? '<span class="tier" title="The guides still list this step as untested — nobody has confirmed it">?</span>'
      : '';
  }

  function recipeRow(row, noted) {
    const { r, prof, makers, closest, status } = row;
    const meta = D.PROFESSIONS[prof] || {};
    const who = makers.length
      ? makers.map(h => `<b style="--cc:${esc(classColor(h.c.class) || '#e6e9ef')}">${esc(h.c.name)}</b> ${skillOf(h)}`).join(', ')
      : closest ? `${esc(closest.c.name)} is ${closest.gap} away`
      : 'nobody has ' + esc(prof);
    const credit = r.builtIn ? ''
      : `<span class="by-tag" title="${r.corrects ? 'Corrected' : 'Added'} by hand, not from the built-in list">${
          r.corrects ? 'fixed' : 'added'}${r.by ? ' by ' + esc(r.by) : ''}</span>`;
    return `<div class="recipe ${status}" data-recipe="${esc(rkey(prof, r.name))}"${canWrite() ? ' title="Click to edit or confirm this recipe"' : ''}>
      <span class="rname">
        ${esc(r.name)}
        ${voteTag(r)}
        ${credit}
        ${noted ? '<span class="noted" title="Someone wrote this in the sheet">★</span>' : ''}
      </span>
      <span class="rskill">${meta.icon || ''} ${r.skill}</span>
      <span class="rmats">${esc(r.mats)}${r.note ? ` <em>— ${esc(r.note)}</em>` : ''}</span>
      <span class="rwho">${who}</span>
    </div>`;
  }

  function renderTrades() {
    const idx = professionIndex();
    const ui = state.ui;
    const all = recipeProfessions();
    const ours = all.filter(p => (idx.get(p) || { holders: [] }).holders.length);
    const profs = ui.tprof ? [ui.tprof] : (ours.length ? ours : all);
    const rows = board(idx, profs);

    // Lines people wrote in the sheet, tied back to real recipes where we can.
    const notes = [];
    const notedKeys = new Set();
    for (const c of state.chars) {
      const cp = profsOf(c);
      for (const text of tradesOf(c)) {
        const m = matchNote(text, cp);
        m.hits.forEach(h => notedKeys.add(h.prof + '|' + h.r.name));
        notes.push({ c, text, m });
      }
    }

    const counts = {
      now: rows.filter(r => r.status === 'now').length,
      soon: rows.filter(r => r.status === 'soon').length,
      confirmed: rows.filter(r => verified(r.r)).length,
      disputed: rows.filter(r => disputed(r.r)).length,
    };
    // "Needs checking" is the useful subset: things someone could go and
    // confirm in game now, that nobody has confirmed yet.
    const inReach = row => row.status === 'now' || row.status === 'soon';
    const needsCheck = row => inReach(row) && !verified(row.r);
    const passes = row => ui.tshow === 'check' ? needsCheck(row)
      : ({ now: ['now'], soon: ['now', 'soon'], all: ['now', 'soon', 'later'] }[ui.tshow] || ['now'])
        .includes(row.status);

    const q = ui.tq.toLowerCase();
    const list = rows
      .filter(passes)
      .filter(r => !q || (r.r.name + ' ' + r.r.mats + ' ' + r.prof + ' ' +
        r.makers.map(h => h.c.name).join(' ')).toLowerCase().includes(q));

    const stats = `<div class="stats">
      <div class="stat"><b>${counts.now}</b><span>Can make now</span></div>
      <div class="stat"><b>${counts.soon}</b><span>Nearly there</span></div>
      <div class="stat"><b>${counts.confirmed}</b><span>Confirmed in game</span></div>
      <div class="stat"><b>${rows.length}</b><span>Recipes tracked</span></div>
    </div>`;

    const toolbar = `<div class="toolbar">
      <input type="search" id="tq" placeholder="Search recipes…" value="${esc(ui.tq)}">
      <select id="tprof">
        <option value=""${ui.tprof ? '' : ' selected'}>Professions we have</option>
        ${all.map(p => `<option value="${esc(p)}"${ui.tprof === p ? ' selected' : ''}>${esc(p)}</option>`).join('')}
      </select>
      ${canWrite() ? '<button id="addRecipe">+ Recipe</button>' : ''}
      <span class="spacer"></span>
      <div class="chips">
        ${[['now', 'Can make now'], ['soon', 'Nearly there'], ['check', 'Needs checking'], ['all', 'Everything']]
          .map(([k, label]) => `<button class="chip${ui.tshow === k ? ' on' : ''}" data-show="${k}">${label}</button>`).join('')}
      </div>
    </div>`;

    const noteBlock = notes.length ? `
      <h2 class="section-title">From the sheet</h2>
      <div class="trades">${notes.map(n => {
        const color = classColor(n.c.class);
        const hits = n.m.hits.map(h => `${D.PROFESSIONS[h.prof].icon} ${esc(h.r.name)}`).join(', ');
        return `<div class="trade" data-id="${esc(n.c.id)}" style="--cc:${esc(color || '#2c3645')}">
          <span class="what">${esc(n.text)}</span>
          <span class="by"><b>${esc(n.c.name)}</b>${n.c.player ? ' &middot; ' + esc(n.c.player) : ''}</span>
          ${hits ? `<span class="via">${n.m.exact ? '' : 'probably '}${hits}</span>`
                 : '<span class="via">no matching recipe — kept as a note</span>'}
        </div>`;
      }).join('')}</div>` : '';

    if (!list.length) {
      const nothing = ui.tshow === 'check' && rows.length
        ? 'Everything within reach has been confirmed in game. Nice.'
        : rows.length ? 'Nothing matches that.'
        : 'No recipes for these professions yet — add one with + Recipe.';
      return stats + toolbar + noteBlock + `<p class="empty">${nothing}</p>`;
    }

    // Group what's left by profession, in the order the professions page uses.
    const groups = new Map();
    for (const row of list) {
      if (!groups.has(row.prof)) groups.set(row.prof, []);
      groups.get(row.prof).push(row);
    }
    const body = [...groups.entries()].map(([prof, rs]) => {
      const meta = D.PROFESSIONS[prof] || {};
      const holders = (idx.get(prof) || { holders: [] }).holders;
      const best = Math.max(0, ...holders.map(skillOf));
      return `<div class="playerhead">
          <h2>${meta.icon || ''} ${esc(prof)}</h2>
          <span class="count">${holders.length ? `best skill ${best}` : 'nobody has this yet'}
            &middot; ${rs.length} shown</span>
        </div>
        <div class="recipes">${rs.sort((a, b) => a.r.skill - b.r.skill)
          .map(row => recipeRow(row, notedKeys.has(row.prof + '|' + row.r.name))).join('')}</div>`;
    }).join('');

    return stats + toolbar + noteBlock + body;
  }

  /* ---------- render & routing ---------- */

  function render() {
    rebuildRecipes();
    const view = $('view');
    document.querySelectorAll('.tabs a').forEach(a =>
      a.classList.toggle('on', a.dataset.tab === state.route));

    if (state.route === 'professions') view.innerHTML = renderProfessions();
    else if (state.route === 'trades') view.innerHTML = renderTrades();
    else view.innerHTML = renderRoster();

    $('addBtn').hidden = !canWrite();
    fillDatalists();
  }

  function route() {
    const hash = (location.hash || '#/roster').replace(/^#\/?/, '');
    state.route = ['roster', 'professions', 'trades'].includes(hash) ? hash : 'roster';
    render();
    window.scrollTo({ top: 0 });
  }

  /* ---------- datalists ---------- */

  function fillDatalists() {
    const set = (id, values) => {
      $(id).innerHTML = [...new Set(values.filter(Boolean))]
        .map(v => `<option value="${esc(v)}">`).join('');
    };
    set('players', state.chars.map(c => c.player).sort());
    set('races', D.RACES);
    set('classes', Object.keys(D.CLASSES));
    set('professions', Object.keys(D.PROFESSIONS));
    specsFor($('classInput') ? $('classInput').value : '');
  }

  /** Spec suggestions follow the class box, with every spec as a fallback. */
  function specsFor(cls) {
    const key = normClass(cls);
    const own = key ? D.CLASSES[key].specs : [];
    const all = Object.values(D.CLASSES).flatMap(c => c.specs);
    $('specs').innerHTML = [...new Set(own.concat(own.length ? [] : all))]
      .map(v => `<option value="${esc(v)}">`).join('');
  }

  /* ---------- character dialog ---------- */

  const dlg = $('charDialog');
  const form = $('charForm');

  function profHint(which) {
    const name = form[`prof${which}`].value;
    const level = form[`prof${which}Level`].value;
    const hint = $(`prof${which}Hint`);
    const key = normProf(name);
    if (!String(name).trim()) { hint.textContent = ''; hint.className = 'hint'; return; }

    if (!key) {
      hint.className = 'hint warn';
      hint.textContent = `“${name}” isn't a profession I know — it'll still be saved and shown.`;
      return;
    }
    const meta = D.PROFESSIONS[key];
    const bits = [`${meta.icon} ${key} · ${meta.kind}`];
    const t = tierOf(level);
    if (t) {
      if (t.capped) bits.push(`maxed at ${t.goal}`);
      else if (t.canTrain) bits.push(`${t.name} — can train ${t.canTrain.name} at level ${t.canTrain.level}`);
      else if (t.next) bits.push(`${t.name} — train ${t.next.name} at ${t.next.trainAt}`);
      else bits.push(`${t.name}, cap ${t.goal}`);
    }
    const known = recipesFor(key);
    if (known.length) {
      bits.push(`${known.filter(r => r.skill <= (Number(level) || 0)).length}/${known.length} tracked recipes`);
    }
    if (meta.needs) {
      const holders = state.chars.filter(c => profsOf(c).some(p => p.name === meta.needs));
      bits.push(holders.length
        ? `needs ${meta.needs} — ${holders.map(c => c.name).join(', ')} ${holders.length > 1 ? 'have' : 'has'} it`
        : `needs ${meta.needs} — nobody has it yet`);
    }
    hint.className = 'hint';
    hint.textContent = bits.join(' · ');
  }

  function openChar(c) {
    const blank = { id: '', name: '', player: '', level: '', race: '', class: '', spec1: '', spec2: '', prof1: '', prof1Level: '', prof2: '', prof2Level: '', profPlan: '', trades: '', notes: '' };
    const data = Object.assign({}, blank, c || {});
    // Newlines read better than semicolons while editing.
    data.trades = tradesOf(data).join('\n');
    for (const k of Object.keys(blank)) if (form[k]) form[k].value = data[k] ?? '';

    $('charTitle').textContent = c ? data.name : 'New character';
    $('deleteBtn').hidden = !c;
    specsFor(data.class);
    profHint(1);
    profHint(2);
    dlg.returnValue = '';
    dlg.showModal();
    form.name.focus();
  }

  form.addEventListener('submit', e => {
    e.preventDefault();
    const c = {};
    new FormData(form).forEach((v, k) => { c[k] = typeof v === 'string' ? v.trim() : v; });
    if (!c.name) return;
    c.id = c.id || newId();
    c.trades = tradesOf(c).join('; ');

    const i = state.chars.findIndex(x => x.id === c.id);
    if (i >= 0) state.chars[i] = Object.assign({}, state.chars[i], c);
    else state.chars.push(c);

    dlg.close();
    render();
    saveChanges({ upserts: [c] });
  });

  $('deleteBtn').addEventListener('click', () => {
    const id = form.id.value;
    const c = state.chars.find(x => x.id === id);
    if (!c || !confirm(`Delete ${c.name}? This removes their row from the sheet.`)) return;
    state.chars = state.chars.filter(x => x.id !== id);
    dlg.close();
    render();
    saveChanges({ deletes: [id] });
  });

  $('classInput').addEventListener('input', e => specsFor(e.target.value));
  ['prof1', 'prof1Level'].forEach(n => form[n].addEventListener('input', () => profHint(1)));
  ['prof2', 'prof2Level'].forEach(n => form[n].addEventListener('input', () => profHint(2)));

  document.querySelectorAll('dialog .cancel').forEach(b =>
    b.addEventListener('click', () => b.closest('dialog').close('cancel')));

  /* ---------- recipe dialog ---------- */

  const rdlg = $('recipeDialog');
  const rform = $('recipeForm');

  function openRecipe(r) {
    const blank = { id: '', was: '', profession: state.ui.tprof || '', name: '', skill: '', mats: '', note: '', by: myName };
    const data = r ? {
      id: r.id || '', was: rkey(r.prof, r.name),
      profession: r.prof, name: r.name, skill: r.skill || '',
      mats: r.mats || '', note: r.note || '', by: r.by || myName,
    } : blank;
    for (const k of Object.keys(blank)) if (rform[k]) rform[k].value = data[k] ?? '';

    $('recipeTitle').textContent = r ? r.name : 'New recipe';
    $('recipeLead').textContent = !r
      ? 'This goes in the sheet, so everyone sees it.'
      : r.builtIn
        ? 'This one ships with the site, from a beta guide. Saving writes a correction to the sheet that replaces it for everyone.'
        : 'Added by hand. Saving updates it for everyone.';
    $('removeRecipe').hidden = !r;
    $('removeRecipe').textContent = r && r.builtIn ? 'Hide it' : (r && r.corrects ? 'Undo the fix' : 'Remove');
    renderVoteBox(r);
    rdlg.showModal();
    rform.name.focus();
  }

  function renderVoteBox(r) {
    $('voteBox').hidden = !r;
    if (!r) return;
    const v = r.votes || { works: [], wrong: [] };
    const said = [];
    if (v.works.length) said.push(`${v.works.map(n => n.by).join(', ')} made it`);
    if (v.wrong.length) said.push(`${v.wrong.map(n => n.by).join(', ')} couldn’t`);
    const mine = myVote(r);
    $('voteState').textContent = said.join(' · ') || 'Nobody has checked this one in game yet.';
    $('voteClear').hidden = !mine;
    $('voteWorks').classList.toggle('on', !!mine && mine.verdict === 'works');
    $('voteWrong').classList.toggle('on', !!mine && mine.verdict === 'wrong');
  }

  function castVote(verdict) {
    const r = RX.get(rform.was.value);
    if (!r) return;
    const by = rform.by.value.trim();
    if (!by) {
      $('voteState').textContent = 'Put your name in first, so people know who checked it.';
      rform.by.focus();
      return;
    }
    myName = by;
    ls.set('wow-who', myName);

    const mine = myVote(r);   // matches on myName, which we just set
    const row = {
      id: (mine && mine.row.id) || newId(),
      profession: r.prof, name: r.name, by, verdict, note: '',
    };
    const i = state.votes.findIndex(x => x.id === row.id);
    if (i >= 0) state.votes[i] = row; else state.votes.push(row);

    rdlg.close();
    render();
    saveChanges({ voteUpserts: [row] });
  }

  $('voteWorks').addEventListener('click', () => castVote('works'));
  $('voteWrong').addEventListener('click', () => castVote('wrong'));
  $('voteClear').addEventListener('click', () => {
    const r = RX.get(rform.was.value);
    const mine = r && myVote(r);
    if (!mine) return;
    state.votes = state.votes.filter(x => x.id !== mine.row.id);
    rdlg.close();
    render();
    saveChanges({ voteDeletes: [mine.row.id] });
  });

  /** Every vote row pointing at a recipe, by id. */
  const votesOn = r => state.votes.filter(v =>
    rkey(normProf(v.profession) || String(v.profession || '').trim(), v.name || '') === rkey(r.prof, r.name));

  /** A row that hides a built-in recipe rather than replacing it. */
  const hideRow = (r, by) => ({
    id: newId(), profession: r.prof, name: r.name,
    skill: r.skill || '', mats: r.mats || '', note: r.note || '',
    removed: 'yes', by: by || '',
  });

  rform.addEventListener('submit', e => {
    e.preventDefault();
    const o = {};
    new FormData(rform).forEach((v, k) => { o[k] = typeof v === 'string' ? v.trim() : v; });
    if (!o.profession || !o.name) return;
    o.profession = normProf(o.profession) || o.profession;
    o.id = o.id || newId();
    o.removed = '';
    myName = o.by;
    ls.set('wow-who', myName);

    const upserts = [o];
    const was = rform.was.value;
    const prev = was ? RX.get(was) : null;

    // Renaming a correction would leave the original built-in showing as well,
    // so hide the one we were editing.
    if (was && was !== rkey(o.profession, o.name) && prev && prev.builtIn) {
      upserts.push(hideRow(prev, o.by));
    }

    // Votes confirm a specific skill and material list. Change either and the
    // old confirmations no longer mean anything, so the recipe goes back to
    // unchecked rather than carrying a ✓ it didn't earn.
    const edited = prev && (String(prev.skill) !== String(o.skill) ||
      (prev.mats || '') !== (o.mats || '') ||
      rkey(prev.prof, prev.name) !== rkey(o.profession, o.name));
    const voteDeletes = edited ? votesOn(prev).map(v => v.id).filter(Boolean) : [];
    if (voteDeletes.length) {
      state.votes = state.votes.filter(v => !voteDeletes.includes(v.id));
    }

    const i = state.recipes.findIndex(x => x.id === o.id);
    if (i >= 0) state.recipes[i] = o; else state.recipes.push(o);
    upserts.slice(1).forEach(row => state.recipes.push(row));

    rdlg.close();
    render();
    saveChanges({ recipeUpserts: upserts, voteDeletes });
  });

  $('removeRecipe').addEventListener('click', () => {
    const r = RX.get(rform.was.value);
    if (!r) return;
    const ask = r.builtIn
      ? `Hide ${r.name} from the board for everyone?`
      : r.corrects ? `Drop your changes to ${r.name} and go back to the built-in one?`
      : `Remove ${r.name}? This deletes its row from the sheet.`;
    if (!confirm(ask)) return;

    if (r.builtIn) {
      const row = hideRow(r, myName);
      state.recipes.push(row);
      rdlg.close();
      render();
      saveChanges({ recipeUpserts: [row] });
    } else {
      state.recipes = state.recipes.filter(x => x.id !== r.id);
      rdlg.close();
      render();
      saveChanges({ recipeDeletes: [r.id] });
    }
  });

  /* ---------- write key ---------- */

  const keyDialog = $('keyDialog');
  $('keyBtn').addEventListener('click', () => {
    $('keyInput').value = token;
    keyDialog.showModal();
  });
  keyDialog.addEventListener('close', () => {
    if (keyDialog.returnValue !== 'save') return;
    token = $('keyInput').value.trim();
    ls.set('wow-token', token);
    showMode();
    render();
  });

  function showMode() {
    if (!SCRIPT_URL) {
      $('mode').textContent = 'This browser only';
      $('mode').title = 'config.js has no scriptUrl, so the roster is saved in localStorage.';
      $('keyBtn').hidden = true;
      $('footnote').textContent = 'Preview mode: edits are saved in this browser only. ' +
        'Add your Apps Script URL to config.js to share the roster through the Google Sheet.';
    } else {
      $('mode').textContent = token ? 'Can edit' : 'Read-only';
      $('keyBtn').hidden = false;
      $('footnote').textContent = token
        ? 'Edits are written to the shared Google Sheet.'
        : 'Read-only. Click “Write key” and paste the token to edit.';
    }
  }

  /* ---------- events ---------- */

  $('addBtn').addEventListener('click', () => openChar(null));

  $('view').addEventListener('click', e => {
    if (e.target.id === 'addRecipe') return openRecipe(null);

    const rec = e.target.closest('[data-recipe]');
    if (rec) {
      if (!canWrite()) return;
      const r = RX.get(rec.dataset.recipe);
      if (r) openRecipe(r);
      return;
    }

    const chip = e.target.closest('.chip');
    if (chip) {
      if (chip.dataset.show) state.ui.tshow = chip.dataset.show;
      else state.ui.player = chip.dataset.player;
      return render();
    }
    // "see them" on a profession card jumps to that profession's recipes.
    const seeAll = e.target.closest('[data-prof]');
    if (seeAll) { state.ui.tprof = seeAll.dataset.prof; state.ui.tshow = 'all'; return; }

    const row = e.target.closest('[data-id]');
    if (row && canWrite()) {
      const c = state.chars.find(x => x.id === row.dataset.id);
      if (c) openChar(c);
    }
  });

  // Re-rendering replaces the search box, so put the cursor back where it was.
  function renderKeepingFocus() {
    const el = document.activeElement;
    const id = el && el.id;
    const pos = el && typeof el.selectionStart === 'number' ? el.selectionStart : null;
    render();
    const next = id && $(id);
    if (!next) return;
    next.focus();
    if (pos != null) { try { next.setSelectionRange(pos, pos); } catch { /* not a text input */ } }
  }

  $('view').addEventListener('input', e => {
    if (e.target.id === 'q') { state.ui.q = e.target.value; return renderKeepingFocus(); }
    if (e.target.id === 'tq') { state.ui.tq = e.target.value; return renderKeepingFocus(); }
  });

  $('view').addEventListener('change', e => {
    if (e.target.id === 'group') { state.ui.group = e.target.value; render(); }
    if (e.target.id === 'tprof') { state.ui.tprof = e.target.value; render(); }
  });

  window.addEventListener('hashchange', route);

  /* ---------- go ---------- */

  (async () => {
    $('realm').textContent = CFG.realm || '';
    showMode();
    await refresh();
    if (!SCRIPT_URL) await local.save();   // keep the seeded roster around
    route();
  })();
})();
