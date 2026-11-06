(() => {
  'use strict';

  const CFG = window.WOW_CONFIG || {};
  const D = window.WOW_DATA;
  const SCRIPT_URL = (CFG.scriptUrl || '').trim();
  const LEVEL_MAX = Number(CFG.levelMax) || 60;
  const PROF_MAX = Number(CFG.professionMax) || 300;
  const TIERS = D.TIERS;

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

  /** list -> Map(key -> items), keys in the order they first turn up. */
  function groupBy(list, keyOf) {
    const groups = new Map();
    for (const item of list) {
      const k = keyOf(item);
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(item);
    }
    return groups;
  }

  /** How characters are ordered everywhere: furthest along first. */
  const byLevelThenName = (a, b) => (Number(b.level) || 0) - (Number(a.level) || 0) ||
    String(a.name).localeCompare(String(b.name));

  const state = {
    chars: [],
    posts: [],     // the trade board: one row per thing somebody offers to make
    route: 'roster',
    ui: { q: '', player: '', group: 'player', tq: '', tprof: '', tgroup: 'profession' },
  };
  let token = ls.get('wow-token') || '';
  let myName = ls.get('wow-who') || '';   // name to sign posts with, this browser only

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

  // Primaries fill the character's two slots; everyone has every secondary, so
  // each one is a column of its own on the roster and all you set is the skill.
  const PRIMARIES = Object.keys(D.PROFESSIONS).filter(n => D.PROFESSIONS[n].kind !== 'secondary');
  const SECONDARIES = Object.keys(D.PROFESSIONS).filter(n => D.PROFESSIONS[n].kind === 'secondary');
  const secKey = name => name.toLowerCase().replace(/[^a-z]/g, '');   // "First Aid" -> "firstaid"

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
    };
  }

  /** The professions a character has, as objects the views can render directly. */
  function profsOf(c) {
    const one = (raw, lvl) => {
      const name = normProf(raw);
      const meta = D.PROFESSIONS[name] || {};
      return {
        name: name || String(raw).trim(),
        known: !!name,
        kind: meta.kind || 'unknown',
        icon: meta.icon || '❓',
        level: lvl === '' || lvl == null ? '' : Number(lvl),
        tier: tierOf(lvl),
      };
    };
    const out = [[c.prof1, c.prof1Level], [c.prof2, c.prof2Level]]
      .filter(([name]) => String(name || '').trim())
      .map(([raw, lvl]) => one(raw, lvl));
    // A secondary counts as "has it" once there's a skill against it — nobody
    // wants three empty rows on every card for trades they haven't touched.
    for (const name of SECONDARIES) {
      if (Number(c[secKey(name)]) > 0) out.push(one(name, c[secKey(name)]));
    }
    return out;
  }

  /** Professions named in a character's plan ("drop Skinning for Engineering"). */
  function plannedProfs(c) {
    const text = String(c.notes || '');
    if (!text.trim()) return [];
    const have = new Set(profsOf(c).map(p => p.name));
    return Object.keys(D.PROFESSIONS)
      .filter(p => !have.has(p) && new RegExp('\\b' + p + '\\b', 'i').test(text));
  }

  /* ---------- the trade board ---------- */

  /**
   * Trades are just what people typed. Nothing is generated from a recipe list
   * or fetched from anywhere, so the only derived bit is the link back to a
   * roster character: we match on name, so the sheet stays readable and a
   * trade posted for someone not on the roster still shows.
   */
  const charNamed = name => state.chars.find(c =>
    String(c.name).trim().toLowerCase() === String(name || '').trim().toLowerCase());

  /** Everything the board shows: one row per post, trimmed and with the
   *  profession spelled the way `data.js` spells it. */
  const boardRows = () => state.posts.map(post => {
    const text = k => String(post[k] || '').trim();
    return {
      id: post.id || '',
      char: text('char'),
      prof: normProf(post.profession) || text('profession'),
      item: text('item'),
      mats: text('mats'),
      note: text('note'),
      by: text('by'),
      updated: post.updated || '',
    };
  });

  /* ---------- storage: Google Sheet via Apps Script, or this browser ---------- */

  const remote = {
    async load() {
      const res = await fetch(SCRIPT_URL);
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || 'Load failed');
      return { characters: data.characters || [], posts: data.posts || [] };
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
      return { characters: data.characters || null, posts: data.posts || null };
    },
  };

  const local = {
    async load() {
      const roster = ls.get('wow-roster');
      const board = ls.get('wow-posts');
      let chars, posts;
      try { chars = roster ? JSON.parse(roster) : null; } catch { chars = null; }
      try { posts = board ? JSON.parse(board) : null; } catch { posts = null; }
      return {
        characters: chars || D.SEED.map(c => Object.assign({ id: newId() }, c)),
        posts: posts || D.SEED_POSTS.map(x => Object.assign({ id: newId() }, x)),
      };
    },
    async save() {
      ls.set('wow-roster', JSON.stringify(state.chars));
      ls.set('wow-posts', JSON.stringify(state.posts));
      return {};
    },
  };

  const store = SCRIPT_URL ? remote : local;
  const canWrite = () => !SCRIPT_URL || !!token;

  async function saveChanges(change) {
    status('Saving…');
    try {
      const fresh = await store.save(Object.assign({
        upserts: [], deletes: [], postUpserts: [], postDeletes: [],
      }, change));
      if (fresh.characters) state.chars = fresh.characters;
      if (fresh.posts) state.posts = fresh.posts;
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
      state.posts = (data.posts || []).map(x => Object.assign({}, x, { id: x.id || newId() }));
      if (!quiet) status('');
    } catch (err) {
      status('Could not load the roster: ' + err.message);
    }
  }

  /* ---------- small render helpers ---------- */

  const bar = (pct, cls) => `<div class="${cls || 'bar'}"><i style="width:${Math.max(0, Math.min(100, pct))}%"></i></div>`;
  const tierBadge = tier => tier ? `<span class="tier">${esc(tier.capped ? 'Max' : tier.name)}</span>` : '';
  const skillText = p => p.level === '' ? '&mdash;' : `${p.level}${p.tier ? ' / ' + p.tier.goal : ''}`;

  function profRow(p) {
    const unknown = p.known ? '' : ' <small>(not a known profession)</small>';
    return `<div class="prof ${p.kind}">
      <span class="icon">${p.icon}</span>
      <span class="pname">${esc(p.name)}${unknown}${tierBadge(p.tier)}</span>
      <span class="pskill">${skillText(p)}</span>
      ${p.tier ? bar(p.tier.pct, 'pbar') : '<div class="pbar"></div>'}
    </div>`;
  }

  function charCard(c, showPlayer) {
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
        ${showPlayer ? `<span class="sep">&middot;</span>${esc(c.player || 'unassigned')}` : ''}
      </div>
      ${specs.length ? `<div class="specs">${specs.map((s, i) =>
        `<span class="spec ${/^tbd$/i.test(s) ? 'tbd' : (i === 0 ? 'main' : '')}">${esc(s)}</span>`).join('')}</div>` : ''}
      <div class="profs">
        ${profs.length ? profs.map(profRow).join('') : '<span class="noprof">No professions yet</span>'}
        ${planned.length ? `<span class="plan">${esc(planned.join(', '))} planned</span>` : ''}
      </div>
      ${c.notes ? `<div class="note">${esc(c.notes)}</div>` : ''}
    </article>`;
  }

  /* ---------- view: roster ---------- */

  function matches(c, q) {
    if (!q) return true;
    const hay = [c.name, c.player, c.race, c.class, c.spec1, c.spec2,
      c.prof1, c.prof2, c.notes].join(' ').toLowerCase();
    return hay.includes(q.toLowerCase());
  }

  function renderRoster() {
    const { q, player, group } = state.ui;
    const players = [...new Set(state.chars.map(c => c.player || 'unassigned'))].sort();
    const list = state.chars
      .filter(c => matches(c, q))
      .filter(c => !player || (c.player || 'unassigned') === player);

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
      return toolbar + `<p class="empty">${state.chars.length ? 'Nothing matches that.' : 'No characters yet.'}</p>`;
    }

    if (group === 'level') {
      const sorted = [...list].sort(byLevelThenName);
      return toolbar + `<div class="cards">${sorted.map(c => charCard(c, true)).join('')}</div>`;
    }

    const byClass = group === 'class';
    const groups = groupBy(list, c => byClass ? (c.class || 'Unknown class') : (c.player || 'unassigned'));
    const body = [...groups.entries()]
      .sort((a, b) => b[1].length - a[1].length || String(a[0]).localeCompare(String(b[0])))
      .map(([k, cs]) => {
        const color = byClass ? classColor(k) : '';
        return `<div class="playerhead">
            <h2${color ? ` style="color:${esc(color)}"` : ''}>${esc(k)}</h2>
            <span class="count">${cs.length} character${cs.length === 1 ? '' : 's'}</span>
          </div>
          <div class="cards">${[...cs].sort(byLevelThenName).map(c => charCard(c, byClass)).join('')}</div>`;
      }).join('');
    return toolbar + body;
  }

  /* ---------- view: professions ---------- */

  /** profession name -> { holders: [...] } across the whole roster. */
  function professionIndex() {
    const idx = new Map();
    const touch = name => {
      if (!idx.has(name)) idx.set(name, { holders: [] });
      return idx.get(name);
    };
    for (const c of state.chars) {
      for (const p of profsOf(c)) touch(p.name).holders.push({ c, p });
    }
    for (const entry of idx.values()) {
      entry.holders.sort((a, b) => (Number(b.p.level) || 0) - (Number(a.p.level) || 0));
    }
    return idx;
  }

  function holderLi(h, best) {
    const { c, p } = h;
    const color = classColor(c.class);
    return `<li class="${best ? 'best' : ''}" data-id="${esc(c.id)}" style="--cc:${esc(color || '#e6e9ef')}">
      <span class="who">${esc(c.name)}<small>${esc(c.player || '')}${c.level ? ' &middot; Lv ' + esc(c.level) : ''}</small></span>
      <span class="skill">${skillText(p)} ${tierBadge(p.tier)}</span>
      ${p.tier ? bar(p.tier.pct, 'hbar') : ''}
    </li>`;
  }

  function profCard(name, entry, posted) {
    const meta = D.PROFESSIONS[name] || { kind: 'unknown', icon: '❓', makes: '' };
    const holders = entry ? entry.holders : [];
    const bestLevel = Math.max(...holders.map(h => Number(h.p.level) || 0), 0);
    const postLine = posted
      ? `<p class="unlocked"><b>${posted}</b> thing${posted === 1 ? '' : 's'} on the trade board
           &middot; <a href="#/trades" data-prof="${esc(name)}">see them</a></p>`
      : '';

    return `<article class="profcard${holders.length ? '' : ' gap'}">
      <h3>${meta.icon} ${esc(name)}<span class="kind">${esc(meta.kind)}</span></h3>
      <p class="makes">${esc(meta.makes || '')}</p>
      ${holders.length
        ? `<ul class="holders">${holders.map(h =>
            holderLi(h, holders.length > 1 && bestLevel > 0 && (Number(h.p.level) || 0) === bestLevel)).join('')}</ul>`
        : ''}
      ${postLine}
    </article>`;
  }

  function renderProfessions() {
    const idx = professionIndex();
    const known = Object.keys(D.PROFESSIONS);
    const extra = [...idx.keys()].filter(n => !D.PROFESSIONS[n]);
    const posts = groupBy(boardRows(), r => r.prof);

    // Grouped by what kind of profession it is. Within a group, the ones
    // somebody has come first — the rest keep their dashed card, which is
    // enough to say nobody has them.
    const has = n => (idx.get(n) || { holders: [] }).holders.length;
    const byUse = (a, b) => (has(b) ? 1 : 0) - (has(a) ? 1 : 0) || a.localeCompare(b);
    const ofKind = kind => known.filter(n => D.PROFESSIONS[n].kind === kind).sort(byUse);

    const section = (title, names) => names.length
      ? `<h2 class="section-title">${esc(title)}</h2>
         <div class="profcards">${names.map(n =>
           profCard(n, idx.get(n), (posts.get(n) || []).length)).join('')}</div>`
      : '';

    return section('Gathering', ofKind('gathering')) +
      section('Crafting', ofKind('crafting')) +
      section('Secondary', ofKind('secondary')) +
      section('Spelled differently in the sheet', extra.sort());
  }

  /* ---------- view: trade board ---------- */

  // What a group is called when nobody filled that field in.
  const NOT_SAID = {
    profession: 'No profession given',
    char: 'No character given',
    by: 'Unsigned',
  };

  function tradeRow(row, hideChar) {
    const meta = D.PROFESSIONS[row.prof] || {};
    const c = charNamed(row.char);
    // Their skill in the profession they posted under, when we can tell.
    const p = c && row.prof ? profsOf(c).find(x => x.name === row.prof) : null;
    const skill = p && p.level !== '' ? `${row.prof} ${p.level}` : '';
    const who = [
      row.char && !hideChar
        ? `<b style="--cc:${esc((c && classColor(c.class)) || '#e6e9ef')}">${esc(row.char)}</b>`
        : '',
      row.by && row.by.toLowerCase() !== String(row.char).toLowerCase() ? esc(row.by) : '',
    ].filter(Boolean).join(' <span class="sep">&middot;</span> ');

    return `<div class="post" data-post="${esc(row.id)}"${canWrite() ? ' title="Click to edit this trade"' : ''}>
      <span class="pitem">${meta.icon ? meta.icon + ' ' : ''}${esc(row.item)}</span>
      <span class="pwho">${who || '<em>nobody said who</em>'}${
        skill ? `<small>${esc(skill)}</small>` : ''}</span>
      ${row.mats ? `<span class="pmats">You bring: ${esc(row.mats)}</span>` : '<span class="pmats"></span>'}
      ${row.note ? `<span class="pnote">${esc(row.note)}</span>` : ''}
    </div>`;
  }

  function renderTrades() {
    const ui = state.ui;
    const all = boardRows();
    const profs = [...new Set(all.map(r => r.prof).filter(Boolean))].sort();

    const q = ui.tq.toLowerCase();
    const list = all
      .filter(r => !ui.tprof || r.prof === ui.tprof)
      .filter(r => !q || [r.item, r.mats, r.note, r.char, r.by, r.prof]
        .join(' ').toLowerCase().includes(q));

    const toolbar = `<div class="toolbar">
      <input type="search" id="tq" placeholder="Search trades…" value="${esc(ui.tq)}">
      <select id="tgroup">
        ${[['profession', 'Group by profession'], ['char', 'Group by character'],
           ['by', 'Group by player'], ['new', 'Newest first']]
          .map(([k, label]) => `<option value="${k}"${ui.tgroup === k ? ' selected' : ''}>${label}</option>`).join('')}
      </select>
      ${canWrite() ? '<button id="addPost" class="primary">+ Post a trade</button>' : ''}
      <span class="spacer"></span>
      <div class="chips">
        <button class="chip${ui.tprof ? '' : ' on'}" data-prof-filter="">Everything</button>
        ${profs.map(p => `<button class="chip${ui.tprof === p ? ' on' : ''}" data-prof-filter="${esc(p)}">${
          (D.PROFESSIONS[p] || {}).icon || ''} ${esc(p)}</button>`).join('')}
      </div>
    </div>`;

    if (!list.length) {
      const nothing = all.length
        ? 'Nothing matches that.'
        : canWrite()
          ? 'No trades yet. Click <b>+ Post a trade</b> to put the first one up.'
          : 'No trades yet.';
      return toolbar + `<p class="empty">${nothing}</p>`;
    }

    if (ui.tgroup === 'new') {
      const sorted = [...list].sort((a, b) => String(b.updated).localeCompare(String(a.updated)));
      return toolbar + `<div class="posts">${sorted.map(r => tradeRow(r)).join('')}</div>`;
    }

    const blank = NOT_SAID[ui.tgroup];
    const byChar = ui.tgroup === 'char';
    const groups = groupBy(list, r =>
      (byChar ? r.char : ui.tgroup === 'by' ? r.by : r.prof) || blank);

    const body = [...groups.entries()]
      // Biggest group first, with the ones nobody labelled at the bottom.
      .sort((a, b) => (a[0] === blank) - (b[0] === blank) ||
        b[1].length - a[1].length || String(a[0]).localeCompare(String(b[0])))
      .map(([k, rs]) => {
        const icon = ui.tgroup === 'profession' ? ((D.PROFESSIONS[k] || {}).icon || '') : '';
        const c = byChar ? charNamed(k) : null;
        const color = c ? classColor(c.class) : '';
        const sub = c
          ? [c.player, c.level ? 'Lv ' + c.level : ''].filter(Boolean).join(' · ')
          : `${rs.length} trade${rs.length === 1 ? '' : 's'}`;
        return `<div class="playerhead">
            <h2${color ? ` style="color:${esc(color)}"` : ''}>${icon ? icon + ' ' : ''}${esc(k)}</h2>
            <span class="count">${esc(sub)}</span>
          </div>
          <div class="posts">${rs.map(r => tradeRow(r, byChar)).join('')}</div>`;
      }).join('');

    return toolbar + body;
  }

  /* ---------- render & routing ---------- */

  function render() {
    const view = $('view');
    document.querySelectorAll('.tabs a').forEach(a =>
      a.classList.toggle('on', a.dataset.tab === state.route));

    if (state.route === 'professions') view.innerHTML = renderProfessions();
    else if (state.route === 'trades') view.innerHTML = renderTrades();
    else view.innerHTML = renderRoster();

    $('addBtn').hidden = !canWrite();
    fillRosterLists();
  }

  function route() {
    const hash = (location.hash || '#/roster').replace(/^#\/?/, '');
    state.route = ['roster', 'professions', 'trades'].includes(hash) ? hash : 'roster';
    render();
    window.scrollTo({ top: 0 });
  }

  /* ---------- suggestion lists ---------- */

  const setList = (id, values) => {
    $(id).innerHTML = [...new Set(values.filter(Boolean))]
      .map(v => `<option value="${esc(v)}">`).join('');
  };

  /** Built once: these come from `data.js` and never change. */
  function fillStaticLists() {
    setList('races', D.RACES);
    setList('classes', Object.keys(D.CLASSES));
    setList('professions', Object.keys(D.PROFESSIONS));
  }

  /** Rebuilt on every render, because the roster is what they list. */
  function fillRosterLists() {
    setList('players', state.chars.map(c => c.player).sort());
    setList('chars', state.chars.map(c => c.name).sort());
  }

  /**
   * The two primary slots are picked from a list, so nobody can invent a
   * profession by typo. A value already in the sheet that isn't on the list
   * still gets an option of its own, or saving a character would quietly drop
   * it.
   */
  function fillProfSelects() {
    for (const which of ['prof1', 'prof2']) {
      const sel = form[which];
      const had = sel.value;
      const names = PRIMARIES.includes(had) || !had ? PRIMARIES : PRIMARIES.concat(had);
      sel.innerHTML = '<option value="">— none —</option>' +
        names.map(n => `<option value="${esc(n)}">${D.PROFESSIONS[n] ? D.PROFESSIONS[n].icon + ' ' : ''}${esc(n)}</option>`).join('');
      sel.value = had;
    }
  }

  /** One skill box per secondary, built from `data.js` so the two stay in step. */
  function fillSecondaries() {
    $('secGrid').innerHTML = SECONDARIES.map(n => `<label>${D.PROFESSIONS[n].icon} ${esc(n)}
      <input name="${esc(secKey(n))}" type="number" min="0" max="1000" inputmode="numeric" placeholder="—">
    </label>`).join('');
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

  const blankChar = () => Object.assign({
    id: '', name: '', player: '', level: '', race: '', class: '', spec1: '', spec2: '',
    prof1: '', prof1Level: '', prof2: '', prof2Level: '', notes: '',
  }, Object.fromEntries(SECONDARIES.map(n => [secKey(n), ''])));

  function openChar(c) {
    const blank = blankChar();
    const data = Object.assign({}, blank, c || {});
    // Fill the dropdowns before setting values, so an unknown profession from
    // the sheet has an option to be selected.
    data.prof1 = normProf(data.prof1) || data.prof1;
    data.prof2 = normProf(data.prof2) || data.prof2;
    for (const k of Object.keys(blank)) if (form[k]) form[k].value = data[k] ?? '';
    fillProfSelects();
    for (const k of ['prof1', 'prof2']) form[k].value = data[k] ?? '';

    $('charTitle').textContent = c ? data.name : 'New character';
    $('deleteBtn').hidden = !c;
    specsFor(data.class);
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

  document.querySelectorAll('dialog .cancel').forEach(b =>
    b.addEventListener('click', () => b.closest('dialog').close('cancel')));

  /* ---------- post dialog ---------- */

  const rdlg = $('postDialog');
  const rform = $('postForm');

  function openPost(post) {
    const blank = {
      id: '', char: '', profession: state.ui.tprof || '',
      item: '', mats: '', note: '', by: myName,
    };
    const data = Object.assign({}, blank, post || {});
    for (const k of Object.keys(blank)) if (rform[k]) rform[k].value = data[k] ?? '';

    $('postTitle').textContent = post ? 'Edit trade' : 'Post a trade';
    $('removePost').hidden = !post;
    postHint();
    rdlg.showModal();
    (post ? rform.item : rform.char).focus();
  }

  /** Say what we know about the character they named, so typos are obvious. */
  function postHint() {
    const name = rform.char.value.trim();
    const hint = $('postHint');
    if (!name) { hint.className = 'hint'; hint.textContent = 'Leave blank if it isn’t tied to one character.'; return; }
    const c = charNamed(name);
    if (!c) {
      hint.className = 'hint warn';
      hint.textContent = `No character called “${name}” on the roster — the trade still posts.`;
      return;
    }
    const profs = profsOf(c).map(p => `${p.icon} ${p.name}${p.level === '' ? '' : ' ' + p.level}`);
    hint.className = 'hint';
    hint.textContent = [c.player, c.class, profs.join(' · ')].filter(Boolean).join(' · ');
  }

  rform.addEventListener('submit', e => {
    e.preventDefault();
    const o = {};
    new FormData(rform).forEach((v, k) => { o[k] = typeof v === 'string' ? v.trim() : v; });
    if (!o.item) return;
    o.id = o.id || newId();
    o.profession = normProf(o.profession) || o.profession;
    // The sheet stamps this itself; set it here so "newest first" also works
    // in preview mode, where there is no sheet.
    o.updated = new Date().toISOString();
    // A character that is on the roster gets stored under its exact spelling,
    // so the board can tie the trade back to them later.
    const c = charNamed(o.char);
    if (c) o.char = c.name;
    myName = o.by;
    ls.set('wow-who', myName);

    const i = state.posts.findIndex(x => x.id === o.id);
    if (i >= 0) state.posts[i] = Object.assign({}, state.posts[i], o);
    else state.posts.push(o);

    rdlg.close();
    render();
    saveChanges({ postUpserts: [o] });
  });

  $('removePost').addEventListener('click', () => {
    const id = rform.id.value;
    const post = state.posts.find(x => x.id === id);
    if (!post || !confirm(`Take “${post.item}” off the board?`)) return;
    state.posts = state.posts.filter(x => x.id !== id);
    rdlg.close();
    render();
    saveChanges({ postDeletes: [id] });
  });

  rform.char.addEventListener('input', postHint);

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
    if (e.target.id === 'addPost') return openPost(null);

    const hit = e.target.closest('[data-post]');
    if (hit) {
      if (!canWrite()) return;
      const post = state.posts.find(x => x.id === hit.dataset.post);
      if (post) openPost(post);
      return;
    }

    const chip = e.target.closest('.chip');
    if (chip) {
      if (chip.dataset.profFilter != null) state.ui.tprof = chip.dataset.profFilter;
      else state.ui.player = chip.dataset.player;
      return render();
    }
    // "see them" on a profession card jumps to that profession's trades.
    const seeAll = e.target.closest('[data-prof]');
    if (seeAll) { state.ui.tprof = seeAll.dataset.prof; return; }

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
    if (e.target.id === 'tgroup') { state.ui.tgroup = e.target.value; render(); }
  });

  window.addEventListener('hashchange', route);

  /* ---------- go ---------- */

  (async () => {
    $('realm').textContent = CFG.realm || '';
    fillStaticLists();
    fillSecondaries();
    showMode();
    await refresh();
    if (!SCRIPT_URL) await local.save();   // keep the seeded roster around
    route();
  })();
})();
