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

  /** The "what this character can make" lines from a character's own card. */
  const tradesOf = c => String(c.trades || '')
    .split(/[\n;]+/).map(s => s.trim()).filter(Boolean);

  /* ---------- the trade board ---------- */

  /**
   * Trades are just what people typed. Nothing is generated from a recipe list
   * or fetched from anywhere, so the only derived bit is the link back to a
   * roster character: we match on name, so the sheet stays readable and a
   * trade posted for someone not on the roster still shows.
   */
  const charNamed = name => state.chars.find(c =>
    String(c.name).trim().toLowerCase() === String(name || '').trim().toLowerCase());

  /** The poster's skill in the profession they posted under, if we can tell. */
  function skillFor(row) {
    const c = charNamed(row.char);
    if (!c || !row.prof) return null;
    const p = profsOf(c).find(x => x.name === row.prof);
    return p && p.level !== '' ? p : null;
  }

  /**
   * Everything the board shows, from the two places a person can type a trade:
   * a post of their own, or the "what this character can make" lines on their
   * character card. Clicking a row opens whichever one it came from.
   */
  function boardRows() {
    const rows = [];
    for (const post of state.posts) {
      rows.push({
        id: post.id || '',
        char: String(post.char || '').trim(),
        prof: normProf(post.profession) || String(post.profession || '').trim(),
        item: String(post.item || '').trim(),
        mats: String(post.mats || '').trim(),
        note: String(post.note || '').trim(),
        by: String(post.by || '').trim(),
        updated: post.updated || '',
      });
    }
    for (const c of state.chars) {
      for (const item of tradesOf(c)) {
        rows.push({
          id: '', fromCard: c.id, char: c.name, prof: '', item,
          mats: '', note: '', by: c.player || '', updated: c.updated || '',
        });
      }
    }
    return rows;
  }

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
    const skill = p.level === '' ? '&mdash;' : `${p.level}${p.tier ? ' / ' + p.tier.goal : ''}`;
    const tier = p.tier ? ` <span class="tier">${esc(p.tier.capped ? 'Max' : p.tier.name)}</span>` : '';
    return `<li class="${best ? 'best' : ''}" data-id="${esc(c.id)}" style="--cc:${esc(color || '#e6e9ef')}">
      <span class="who">${esc(c.name)}<small>${esc(c.player || '')}${c.level ? ' &middot; Lv ' + esc(c.level) : ''}</small></span>
      <span class="skill">${skill}${tier}</span>
      ${p.tier ? bar(p.tier.pct, 'hbar') : ''}
    </li>`;
  }

  function profCard(name, entry) {
    const meta = D.PROFESSIONS[name] || { kind: 'unknown', icon: '❓', makes: '' };
    const holders = entry ? entry.holders : [];
    const bestLevel = Math.max(...holders.map(h => Number(h.p.level) || 0), 0);

    const posted = state.posts.filter(x =>
      (normProf(x.profession) || String(x.profession || '').trim()) === name);
    const postLine = posted.length
      ? `<p class="unlocked"><b>${posted.length}</b> thing${posted.length === 1 ? '' : 's'} on the trade board
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
    const order = ['gathering', 'crafting', 'secondary'];
    const known = Object.keys(D.PROFESSIONS);
    const extra = [...idx.keys()].filter(n => !D.PROFESSIONS[n]);

    const taken = known.filter(n => (idx.get(n) || { holders: [] }).holders.length);
    const open = known.filter(n => !(idx.get(n) || { holders: [] }).holders.length);
    const byKind = (a, b) => order.indexOf(D.PROFESSIONS[a].kind) - order.indexOf(D.PROFESSIONS[b].kind) ||
      a.localeCompare(b);

    const section = (title, names) => names.length
      ? `<h2 class="section-title">${esc(title)}</h2>
         <div class="profcards">${names.map(n => profCard(n, idx.get(n))).join('')}</div>`
      : '';

    return section('Covered', taken.sort(byKind)) +
      section('Spelled differently in the sheet', extra.sort()) +
      section('Nobody has these yet', open.sort(byKind));
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
    const skill = skillFor(row);
    const who = [
      row.char && !hideChar
        ? `<b style="--cc:${esc((c && classColor(c.class)) || '#e6e9ef')}">${esc(row.char)}</b>`
        : '',
      row.by && row.by.toLowerCase() !== String(row.char).toLowerCase() ? esc(row.by) : '',
    ].filter(Boolean).join(' <span class="sep">&middot;</span> ');

    // Open the post, or the character card the line was typed on.
    const target = row.id ? ` data-post="${esc(row.id)}"` : ` data-id="${esc(row.fromCard)}"`;
    const hint = row.id ? 'Click to edit this trade' : 'Typed on this character’s card — click to edit it there';

    return `<div class="post"${target}${canWrite() ? ` title="${hint}"` : ''}>
      <span class="pitem">${meta.icon ? meta.icon + ' ' : ''}${esc(row.item)}${
        row.id ? '' : '<span class="from-card" title="From this character’s own card">card</span>'}</span>
      <span class="pwho">${who || '<em>nobody said who</em>'}${
        skill ? `<small>${esc(row.prof)} ${skill.level}</small>` : ''}</span>
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
      return toolbar + `<div class="posts">${sorted.map(tradeRow).join('')}</div>`;
    }

    const blank = NOT_SAID[ui.tgroup];
    const keyOf = r => (ui.tgroup === 'char' ? r.char : ui.tgroup === 'by' ? r.by : r.prof) || blank;
    const groups = new Map();
    for (const r of list) {
      const k = keyOf(r);
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(r);
    }

    const body = [...groups.entries()]
      // Biggest group first, with the ones nobody labelled at the bottom.
      .sort((a, b) => (a[0] === blank) - (b[0] === blank) ||
        b[1].length - a[1].length || String(a[0]).localeCompare(String(b[0])))
      .map(([k, rs]) => {
        const icon = ui.tgroup === 'profession' ? ((D.PROFESSIONS[k] || {}).icon || '') : '';
        const c = ui.tgroup === 'char' ? charNamed(k) : null;
        const color = c ? classColor(c.class) : '';
        const sub = c
          ? [c.player, c.level ? 'Lv ' + c.level : ''].filter(Boolean).join(' · ')
          : `${rs.length} trade${rs.length === 1 ? '' : 's'}`;
        return `<div class="playerhead">
            <h2${color ? ` style="color:${esc(color)}"` : ''}>${icon ? icon + ' ' : ''}${esc(k)}</h2>
            <span class="count">${esc(sub)}</span>
          </div>
          <div class="posts">${rs.map(r => tradeRow(r, ui.tgroup === 'char')).join('')}</div>`;
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
    set('chars', state.chars.map(c => c.name).sort());
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
    showMode();
    await refresh();
    if (!SCRIPT_URL) await local.save();   // keep the seeded roster around
    route();
  })();
})();
