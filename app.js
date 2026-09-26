/*! Tabù: un gioco di parole a squadre. JavaScript semplice, nessun passaggio di build. */
(() => {
'use strict';

// ---------- costanti ----------
const DECK = window.TABOO_DECK || { categories: [], cards: [] };
const PREFIX = 'tabu-mt-room-';
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const MAX_TEAMS = 4;
const MAX_PLAYERS = 24;
const TEAM_NAMES = ['Blu', 'Rosa', 'Lilla', 'Arancio'];
const OUT_LABEL = { correct: 'Indovinata', taboo: 'Tabù', skip: 'Saltata', none: 'Non conta' };
const OUT_CYCLE = ['correct', 'taboo', 'skip', 'none'];
const OPTS = {
  seconds: [[30, '30 s'], [45, '45 s'], [60, '1 min'], [90, '90 s'], [120, '2 min']],
  turns: [[3, '3'], [5, '5'], [8, '8'], [0, 'Senza limite']],
  skips: [[0, 'Nessuno'], [1, '1'], [3, '3'], [-1, 'Illimitati']],
  skipPenalty: [[0, 'Niente'], [1, '1 punto']],
  tabooPenalty: [[1, '1 punto'], [0, 'Niente']],
};
const OPT_LABEL = { seconds: 'Durata del turno', turns: 'Turni per squadra', skips: 'Salti per turno', skipPenalty: 'Un salto costa', tabooPenalty: 'Un tabù costa' };
const DEFAULTS = { seconds: 60, turns: 5, skips: -1, skipPenalty: 0, tabooPenalty: 1 };
const HOST_TTL = 8 * 3600e3;

const Q = new URLSearchParams(location.search);
const DEBUG_T = Math.max(0, Math.min(600, parseInt(Q.get('t'), 10) || 0));
const PEER_Q = (Q.get('peer') || '').trim();

const CAT_NAME = { custom: 'Le tue carte' };
const CAT_COUNT = {};
DECK.categories.forEach(c => { CAT_NAME[c.id] = c.name; });
DECK.cards.forEach(c => { CAT_COUNT[c[0]] = (CAT_COUNT[c[0]] || 0) + 1; });

// ---------- piccoli aiuti ----------
const $ = s => document.querySelector(s);
const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ESC[c]);
const now = () => Date.now();
const num = n => Number(n).toLocaleString('it-IT');
const MINUS = '\u2212';
const signed = n => (n > 0 ? '+' + n : n < 0 ? MINUS + -n : '0');
const pts = n => (n < 0 ? MINUS + -n : String(n));
const plural = (n, one, many) => n + ' ' + (n === 1 ? one : many);
const cleanName = s => String(s == null ? '' : s).replace(/\s+/g, ' ').trim().slice(0, 18);
const cleanCode = s => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4);
const andList = a => (a.length < 2 ? a.join('') : a.slice(0, -1).join(', ') + ' e ' + a[a.length - 1]);

function randInt(n) { const a = new Uint32Array(1); crypto.getRandomValues(a); return a[0] % n; }
function rid(n) { let s = ''; for (let i = 0; i < (n || 10); i++) s += 'abcdefghijklmnopqrstuvwxyz0123456789'[randInt(36)]; return s; }
function makeCode() { let s = ''; for (let i = 0; i < 4; i++) s += CODE_CHARS[randInt(CODE_CHARS.length)]; return s; }
function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = randInt(i + 1); const x = a[i]; a[i] = a[j]; a[j] = x; }
  return a;
}
function fmt(ms) { const s = Math.max(0, Math.ceil(ms / 1000)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); }

// ---------- memoria del browser ----------
const store = {
  get(k, d) { try { const v = localStorage.getItem('tabu:' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem('tabu:' + k, JSON.stringify(v)); } catch (e) { /* pieno o bloccato */ } },
  del(k) { try { localStorage.removeItem('tabu:' + k); } catch (e) { /* niente */ } },
};
const sess = {
  get(k) { try { return sessionStorage.getItem('tabu:' + k); } catch (e) { return null; } },
  set(k, v) { try { sessionStorage.setItem('tabu:' + k, v); } catch (e) { /* niente */ } },
};

function cleanSettings(s) {
  const o = Object.assign({}, DEFAULTS, { off: [] });
  if (s && typeof s === 'object') {
    Object.keys(OPTS).forEach(k => { if (OPTS[k].some(x => x[0] === s[k])) o[k] = s[k]; });
    if (Array.isArray(s.off)) o.off = Array.from(new Set(s.off.filter(id => typeof id === 'string' && CAT_NAME[id])));
  }
  return o;
}
function freeColor(list) { return [0, 1, 2, 3].find(x => !list.some(t => t.c === x)); }
function cleanTeams(list) {
  const out = [];
  (Array.isArray(list) ? list : []).forEach(t => {
    if (out.length >= MAX_TEAMS || !t || typeof t !== 'object') return;
    let c = t.c | 0;
    if (c < 0 || c > 3 || out.some(x => x.c === c)) c = freeColor(out);
    out.push({ name: typeof t.name === 'string' ? t.name.slice(0, 18) : '', c });
  });
  while (out.length < 2) { const c = freeColor(out); out.push({ name: TEAM_NAMES[c], c }); }
  return out;
}
const savedPrefs = store.get('prefs', {}) || {};
const prefs = {
  settings: cleanSettings(savedPrefs.settings),
  teams: cleanTeams(savedPrefs.teams),
  sound: savedPrefs.sound !== false,
  name: cleanName(savedPrefs.name),
};
let prefsT = 0;
function savePrefs() { clearTimeout(prefsT); prefsT = setTimeout(() => store.set('prefs', prefs), 250); }

// ---------- carte ----------
let customCache = null;
function customText() { const t = store.get('custom', ''); return typeof t === 'string' ? t : ''; }
function setCustom(text) { store.set('custom', String(text).slice(0, 20000)); customCache = null; }
function customCards() {
  if (customCache) return customCache;
  const out = [];
  const seen = new Set();
  customText().split(/\r?\n/).forEach(line => {
    const m = line.match(/^\s*([^:|]+?)\s*(?:[:|]\s*(.*))?$/);
    if (!m) return;
    const word = m[1].trim().slice(0, 40);
    const key = word.toLowerCase();
    if (!word || seen.has(key)) return;
    seen.add(key);
    const taboo = (m[2] || '').split(',').map(s => s.trim().slice(0, 30)).filter(Boolean).slice(0, 6);
    out.push(['custom', word].concat(taboo));
  });
  customCache = out;
  return out;
}
function poolParts(settings) {
  const off = new Set(settings.off);
  return { deck: DECK.cards.filter(c => !off.has(c[0])), custom: off.has('custom') ? [] : customCards() };
}
function poolCount(settings) {
  const off = new Set(settings.off);
  let n = off.has('custom') ? 0 : customCards().length;
  Object.keys(CAT_COUNT).forEach(id => { if (!off.has(id)) n += CAT_COUNT[id]; });
  return n;
}

// Carte già uscite: la prossima partita pesca prima quelle nuove.
let seenList = store.get('seen', []);
if (!Array.isArray(seenList)) seenList = [];
let seenT = 0;
function markSeen(word) {
  seenList.push(word);
  if (seenList.length > 6000) seenList = seenList.slice(-5000);
  clearTimeout(seenT);
  seenT = setTimeout(() => store.set('seen', seenList), 800);
}
function buildOrder(settings) {
  const { deck, custom } = poolParts(settings);
  const seen = new Set(seenList);
  let fresh = deck.filter(c => !seen.has(c[1]));
  if (fresh.length < Math.min(40, deck.length)) {
    const words = new Set(deck.map(c => c[1]));
    seenList = seenList.filter(w => !words.has(w));
    fresh = deck;
  }
  const freshSet = new Set(fresh);
  const order = shuffle(fresh).concat(shuffle(deck.filter(c => !freshSet.has(c))));
  // le carte personalizzate finiscono all'inizio del mazzo, così escono davvero
  const span = Math.min(order.length, Math.max(60, custom.length * 3));
  shuffle(custom).forEach(c => order.splice(randInt(span + 1), 0, c));
  return order;
}

// ---------- modello di gioco ----------
let G = null; // partita attiva: locale, oppure la stanza che ospitiamo

function newTeam(name, c) { return { name, c, score: 0, turns: 0, next: 0 }; }
function newLocalGame() {
  const settings = cleanSettings(prefs.settings);
  return {
    v: 1, mode: 'local', settings,
    teams: prefs.teams.map(t => newTeam(cleanName(t.name) || TEAM_NAMES[t.c], t.c)),
    order: buildOrder(settings), pos: 0, cur: 0, phase: 'ready', turn: null, last: null, tn: 0,
  };
}
function newRoomGame() {
  const pid = rid(10);
  return {
    v: 1, mode: 'online', settings: cleanSettings(prefs.settings),
    teams: [newTeam(TEAM_NAMES[0], 0), newTeam(TEAM_NAMES[1], 1)],
    order: [], pos: 0, cur: 0, phase: 'lobby', turn: null, last: null, tn: 0,
    players: { [pid]: { name: prefs.name || 'Host', team: 0, on: true, j: 0 } }, jn: 1, host: pid, claim: null,
  };
}
function validGame(g) {
  return !!g && typeof g === 'object' && Array.isArray(g.teams) && g.teams.length >= 2 && Array.isArray(g.order) && !!g.settings && typeof g.phase === 'string';
}
function remaining(t) { return t.running ? Math.max(0, t.endsAt - now()) : Math.max(0, t.left); }
function draw() {
  if (!G.order.length) return null;
  if (G.pos >= G.order.length) { G.order = shuffle(G.order); G.pos = 0; }
  const c = G.order[G.pos++];
  if (c[0] !== 'custom') markSeen(c[1]);
  return c;
}
function startTurn(describer) {
  const ms = (DEBUG_T || G.settings.seconds) * 1000;
  G.tn = (G.tn || 0) + 1;
  G.turn = { id: G.tn, team: G.cur, describer, total: ms, endsAt: now() + ms, left: ms, running: true, card: draw(), results: [], skips: 0 };
  G.phase = 'playing';
  G.claim = null;
}
function endTurn() {
  const t = G.turn;
  if (t.card) t.results.push({ c: t.card, o: 'none' });
  t.card = null; t.running = false; t.left = 0;
  G.phase = 'review';
}
function turnPoints(t) {
  let p = 0;
  t.results.forEach(r => {
    if (r.o === 'correct') p += 1;
    else if (r.o === 'taboo') p -= G.settings.tabooPenalty;
    else if (r.o === 'skip') p -= G.settings.skipPenalty;
  });
  return p;
}
function isOver() { const n = G.settings.turns; return n > 0 && G.teams.every(t => t.turns >= n); }
function confirmTurn() {
  const t = G.turn;
  const team = G.teams[t.team];
  const p = turnPoints(t);
  team.score += p; team.turns += 1; team.next += 1;
  G.last = { team: t.team, pts: p };
  G.turn = null;
  G.cur = (t.team + 1) % G.teams.length;
  G.phase = isOver() ? 'over' : 'ready';
}
function restart() {
  G.teams.forEach(t => { t.score = 0; t.turns = 0; t.next = 0; });
  G.order = buildOrder(G.settings);
  G.pos = 0; G.cur = 0; G.turn = null; G.last = null; G.claim = null; G.phase = 'ready';
}

// chi è collegato in una squadra, in ordine di arrivo
function members(team) {
  return Object.keys(G.players).filter(id => G.players[id].team === team && G.players[id].on).sort((a, b) => G.players[a].j - G.players[b].j);
}
function upcoming() {
  const c = G.claim;
  const p = c && G.players[c];
  if (p && p.on && p.team === G.cur) return c;
  const m = members(G.cur);
  return m.length ? m[G.teams[G.cur].next % m.length] : null;
}
function smallestTeam() {
  let best = 0, bn = Infinity;
  G.teams.forEach((t, i) => { const n = members(i).length; if (n < bn) { bn = n; best = i; } });
  return best;
}

// Tutte le mosse passano da qui: in locale senza controlli, online con i permessi di ogni ruolo.
function apply(pid, a) {
  if (!G || !a || typeof a.a !== 'string') return false;
  const online = G.mode === 'online';
  const me = online ? G.players[pid] : null;
  if (online && !me) return false;
  const host = !online || pid === G.host;
  const t = G.turn;
  const ph = G.phase;
  const lead = !online || host || !!(t && t.describer === pid);
  const i = a.i | 0;
  switch (a.a) {
    case 'start': {
      if (ph !== 'ready') return false;
      let d = null;
      if (online) { d = upcoming(); if (!d || (d !== pid && !host)) return false; }
      startTurn(d);
      return true;
    }
    case 'claim':
      if (!online || ph !== 'ready' || me.team !== G.cur) return false;
      G.claim = pid;
      return true;
    case 'correct': case 'skip': case 'taboo':
      if (ph !== 'playing' || !t || !t.card) return false;
      if (typeof a.w === 'string' && a.w !== t.card[1]) return false;
      if (!lead && !(a.a === 'taboo' && me.team !== t.team)) return false;
      if (a.a === 'skip' && G.settings.skips >= 0 && t.skips >= G.settings.skips) return false;
      t.results.push({ c: t.card, o: a.a });
      if (a.a === 'skip') t.skips += 1;
      t.card = draw();
      return true;
    case 'pause':
      if (ph !== 'playing' || !lead) return false;
      t.left = remaining(t); t.running = false; G.phase = 'paused';
      return true;
    case 'resume':
      if (ph !== 'paused' || !lead) return false;
      t.endsAt = now() + t.left; t.running = true; G.phase = 'playing';
      return true;
    case 'stop':
      if ((ph !== 'playing' && ph !== 'paused') || !lead) return false;
      endTurn();
      return true;
    case 'toggle': {
      const r = t && t.results[i];
      if (ph !== 'review' || !lead || !r) return false;
      r.o = OUT_CYCLE[(OUT_CYCLE.indexOf(r.o) + 1) % OUT_CYCLE.length];
      return true;
    }
    case 'confirm':
      if (ph !== 'review' || !lead) return false;
      confirmTurn();
      return true;
    case 'end':
      if (!host || ph !== 'ready') return false;
      G.phase = 'over'; G.claim = null;
      return true;
    case 'again':
      if (!host || ph !== 'over') return false;
      restart();
      return true;
    case 'skipteam':
      if (!online || !host || ph !== 'ready') return false;
      G.teams[G.cur].turns += 1;
      G.last = { team: G.cur, pts: 0, skipped: true };
      G.claim = null;
      G.cur = (G.cur + 1) % G.teams.length;
      if (isOver()) G.phase = 'over';
      return true;
    case 'lobby':
      if (!online || !host || (ph !== 'ready' && ph !== 'over')) return false;
      G.phase = 'lobby'; G.turn = null; G.claim = null;
      return true;
    case 'begin':
      if (!online || !host || ph !== 'lobby') return false;
      if (G.teams.some((x, k) => !members(k).length) || !poolCount(G.settings)) return false;
      restart();
      return true;
    case 'team':
      if (!online || ph !== 'lobby' || !G.teams[i]) return false;
      me.team = i;
      return true;
    case 'set': {
      if (!online || !host || ph !== 'lobby' || !OPTS[a.k]) return false;
      const o = OPTS[a.k].find(x => String(x[0]) === String(a.v));
      if (!o) return false;
      G.settings[a.k] = o[0]; prefs.settings[a.k] = o[0]; savePrefs();
      return true;
    }
    case 'cats':
      if (!online || !host || ph !== 'lobby' || !Array.isArray(a.off)) return false;
      G.settings.off = cleanSettings({ off: a.off }).off;
      prefs.settings.off = G.settings.off.slice(); savePrefs();
      return true;
    case 'teams': {
      if (!online || !host || ph !== 'lobby' || i < 2 || i > MAX_TEAMS || i === G.teams.length) return false;
      while (G.teams.length < i) { const c = freeColor(G.teams); G.teams.push(newTeam(TEAM_NAMES[c], c)); }
      if (G.teams.length > i) {
        G.teams = G.teams.slice(0, i);
        Object.keys(G.players).forEach(id => { if (G.players[id].team >= i) G.players[id].team = smallestTeam(); });
      }
      if (G.cur >= G.teams.length) G.cur = 0;
      return true;
    }
    case 'rename': {
      const tm = G.teams[i];
      if (!online || !host || !tm) return false;
      tm.name = cleanName(a.name) || TEAM_NAMES[tm.c];
      return true;
    }
    case 'kick':
      return online && host ? kick(String(a.pid || '')) : false;
    default:
      return false;
  }
}

// Quello che ogni giocatore può vedere: chi indovina non riceve mai la carta.
function viewFor(pid) {
  const online = G.mode === 'online';
  const v = {
    mode: G.mode, phase: G.phase, cur: G.cur, settings: G.settings, last: G.last,
    teams: G.teams.map(t => ({ name: t.name, c: t.c, score: t.score, turns: t.turns })),
  };
  if (online) {
    v.code = R.code; v.you = pid; v.host = G.host; v.isHost = pid === G.host;
    v.players = Object.keys(G.players).map(id => {
      const p = G.players[id];
      return { id, name: p.name, team: p.team, on: !!p.on, j: p.j };
    }).sort((a, b) => a.j - b.j);
    v.myTeam = G.players[pid] ? G.players[pid].team : -1;
    if (G.phase === 'ready') v.up = upcoming();
    if (G.phase === 'lobby') v.pool = poolCount(G.settings);
  }
  const t = G.turn;
  if (t && (G.phase === 'playing' || G.phase === 'paused' || G.phase === 'review')) {
    const me = online ? G.players[pid] : null;
    const role = !online ? 'all' : t.describer === pid ? 'describer' : me && me.team === t.team ? 'guesser' : 'watcher';
    const review = G.phase === 'review';
    v.role = role;
    v.turn = {
      id: t.id, team: t.team, describer: t.describer, left: Math.round(remaining(t)), running: t.running, total: t.total,
      card: review || role === 'guesser' ? null : t.card, outs: t.results.map(r => r.o), skips: t.skips, pts: turnPoints(t),
    };
    if (online) v.turn.watchers = Object.keys(G.players).some(id => G.players[id].on && G.players[id].team !== t.team);
    if (review) {
      v.turn.results = t.results.map(r => ({ w: r.c[1], o: r.o }));
      const n = G.settings.turns;
      v.final = n > 0 && G.teams.every((tm, k) => tm.turns + (k === t.team ? 1 : 0) >= n);
    }
  }
  return v;
}

// ---------- icone ----------
const svg = d => `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const ICON = {
  back: svg('<path d="M15 5l-7 7 7 7"/>'),
  help: svg('<circle cx="12" cy="12" r="9.2"/><path d="M9.5 9.4a2.6 2.6 0 1 1 3.6 2.4c-.8.4-1.1.9-1.1 1.7v.3"/><path d="M12 17.1v.2" stroke-width="2.8"/>'),
  soundOn: svg('<path d="M4 9.5h3.4L12 5.6v12.8l-4.6-3.9H4z" fill="currentColor" stroke="none"/><path d="M15.6 8.8a4.6 4.6 0 0 1 0 6.4M18.2 6.2a8.2 8.2 0 0 1 0 11.6"/>'),
  soundOff: svg('<path d="M4 9.5h3.4L12 5.6v12.8l-4.6-3.9H4z" fill="currentColor" stroke="none"/><path d="M16 9.6l4.8 4.8M20.8 9.6L16 14.4"/>'),
  pause: svg('<path d="M9 6v12M15 6v12" stroke-width="3"/>'),
  x: svg('<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>'),
  leave: svg('<path d="M13.5 4.5H18a1.5 1.5 0 0 1 1.5 1.5v12a1.5 1.5 0 0 1-1.5 1.5h-4.5"/><path d="M10 8l-4 4 4 4M6 12h9.5"/>'),
};

// ---------- pezzi comuni ----------
function soundBtn() {
  return `<button class="icon-btn" data-act="sound" aria-label="Suoni" aria-pressed="${prefs.sound}">${prefs.sound ? ICON.soundOn : ICON.soundOff}</button>`;
}
function bar(title, o) {
  o = o || {};
  return `<header class="bar">${o.back ? `<button class="icon-btn" data-act="${o.back}" aria-label="${esc(o.backLabel || 'Indietro')}">${ICON.back}</button>` : ''}`
    + `<div class="bar-title">${o.dot ? `<span class="dot${o.dot === 'ok' ? ' ok' : ''}" aria-hidden="true"></span>` : ''}<span class="bar-text">${title}</span></div>`
    + `${soundBtn()}<button class="icon-btn" data-act="rules" aria-label="Come si gioca">${ICON.help}</button>`
    + `${o.leave ? `<button class="icon-btn" data-act="leave" aria-label="Esci dalla stanza">${ICON.leave}</button>` : ''}</header>`;
}
function banner() {
  if (R.role === 'client' && R.status === 'lost') return '<p class="banner" role="status">Connessione con l’host persa. Riprovo…</p>';
  if (R.role === 'host' && R.status !== 'online' && now() - R.since > 4000) {
    return '<p class="banner" role="status">Il server di collegamento non risponde. Chi è già dentro continua a giocare; i nuovi potranno entrare appena torna.</p>';
  }
  return '';
}
function topBar(v, title) {
  if (v.mode === 'local') return bar(esc(title), { back: 'home', backLabel: 'Menu principale' });
  return bar('Stanza ' + esc(R.code), { dot: R.status === 'online' ? 'ok' : 'wait', leave: true }) + banner();
}
function tc(v, i) { return 'tc' + (v.teams[i] ? v.teams[i].c : i); }
function playerMap(v) { const m = {}; (v.players || []).forEach(p => { m[p.id] = p; }); return m; }
function nameOf(v, pid) { const p = playerMap(v)[pid]; return p ? esc(p.name) : ''; }

function cardHtml(c, o) {
  o = o || {};
  const taboo = c.slice(2);
  return `<article class="card${o.deal ? ' deal' : ''}${o.swipe ? ' swipeable' : ''}"${o.swipe ? ' data-swipe="1"' : ''}>`
    + `<div class="card-cat">${esc(CAT_NAME[c[0]] || '')}</div>`
    + `<h2 class="card-word fit" data-max="84" data-min="30" data-want="58"><span>${esc(c[1])}</span></h2>`
    + (taboo.length
      ? `<div class="card-say">Non dire</div><ul class="card-taboo">${taboo.map(w => `<li>${esc(w)}</li>`).join('')}</ul>`
      : '<div class="card-say">Nessuna parola vietata su questa carta</div>')
    + '</article>';
}
function scoresHtml(v, hi, order) {
  const idx = order || v.teams.map((t, i) => i);
  return `<ol class="scores">${idx.map(i => `<li class="${tc(v, i)}${hi.indexOf(i) >= 0 ? ' now' : ''}"><span class="team-chip">${esc(v.teams[i].name)}</span><span class="pts">${pts(v.teams[i].score)}</span></li>`).join('')}</ol>`;
}
function lastHtml(v) {
  const l = v.last;
  if (!l || !v.teams[l.team]) return '';
  const n = esc(v.teams[l.team].name);
  let txt;
  if (l.skipped) txt = `Il turno di ${n} è stato saltato.`;
  else if (l.pts > 0) txt = `${n} ha fatto ${plural(l.pts, 'punto', 'punti')} nel turno precedente.`;
  else if (l.pts < 0) txt = `${n} ha perso ${plural(-l.pts, 'punto', 'punti')} nel turno precedente.`;
  else txt = `${n} non ha fatto punti nel turno precedente.`;
  return `<p class="last">${txt}</p>`;
}
function rulesHtml(s, editable) {
  return Object.keys(OPTS).map(k => `<div class="field"><span class="field-label" id="lbl-${k}">${OPT_LABEL[k]}</span>`
    + `<div class="seg" role="radiogroup" aria-labelledby="lbl-${k}">${OPTS[k].map(o => `<button role="radio" aria-checked="${s[k] === o[0]}" data-act="set" data-k="${k}" data-v="${o[0]}"${editable ? '' : ' disabled'}>${o[1]}</button>`).join('')}</div></div>`).join('');
}
function catsHtml(s) {
  const off = new Set(s.off);
  const chip = (id, name, n) => `<button class="chip" aria-pressed="${!off.has(id)}" data-act="cat" data-id="${id}">${esc(name)}<small>${num(n)}</small></button>`;
  let chips = DECK.categories.map(c => chip(c.id, c.name, CAT_COUNT[c.id] || 0)).join('');
  const cn = customCards().length;
  if (cn) chips += chip('custom', CAT_NAME.custom, cn);
  return '<div class="field"><div class="field-head"><span class="field-label">Categorie</span>'
    + '<button class="btn btn-text btn-sm" data-act="cats-all">Tutte</button><button class="btn btn-text btn-sm" data-act="cats-none">Nessuna</button></div>'
    + `<div class="chips">${chips}</div><p class="hint" data-pool>${num(poolCount(s))} carte in gioco</p></div>`;
}
function summaryText(s, pool) {
  const secs = (OPTS.seconds.find(x => x[0] === s.seconds) || [0, s.seconds + ' s'])[1];
  const parts = [
    `turni da ${secs}`,
    s.turns ? `${s.turns} turni per squadra` : 'turni senza limite',
    s.skips < 0 ? 'salti illimitati' : s.skips === 0 ? 'niente salti' : plural(s.skips, 'salto', 'salti') + ' per turno',
  ];
  if (s.skipPenalty) parts.push('un salto costa 1 punto');
  parts.push(s.tabooPenalty ? 'un tabù costa 1 punto' : 'i tabù non costano niente');
  return parts.join(' · ') + ` · ${num(pool)} carte`;
}

// ---------- schermate ----------
function homeHtml() {
  const saved = store.get('local', null);
  const host = store.get('host', null);
  let resume = '';
  if (host && host.code && now() - host.t < HOST_TTL) {
    resume += `<button class="btn btn-ghost btn-wide" data-act="host-resume">Torna alla stanza ${esc(host.code)}<small>La stanza è sul tuo telefono</small></button>`;
  }
  if (validGame(saved) && saved.phase !== 'over') {
    resume += `<button class="btn btn-ghost btn-wide" data-act="local-resume">Riprendi la partita<small>${saved.teams.map(t => esc(t.name) + ' ' + pts(t.score)).join(' · ')}</small></button>`;
  }
  return `<section class="screen home">
<article class="card card-hero">
<div class="card-cat">Un gioco di parole a squadre</div>
<h1 class="card-word fit" data-max="104" data-min="40" data-want="90"><span>Tabù</span></h1>
<div class="card-say">Non dire</div>
<ul class="card-taboo"><li>vietato</li><li>proibito</li><li>parola</li><li>divieto</li><li>sacro</li></ul>
</article>
<p class="lede">Fai indovinare la parola alla tua squadra senza dire nessuna delle parole sotto.</p>
<div class="stack">${resume}
<button class="btn btn-gold btn-wide" data-act="local-new">Gioca con un telefono<small>Ve lo passate a turno</small></button>
<button class="btn btn-wide" data-act="online">Gioca online<small>Ognuno dal proprio telefono</small></button>
<button class="btn btn-text" data-act="rules">Come si gioca</button>
</div>
<p class="foot">${num(DECK.cards.length)} carte in ${DECK.categories.length} categorie</p>
</section>`;
}

function setupHtml() {
  const s = prefs.settings;
  const teams = prefs.teams.map((t, i) => `<div class="team-row tc${t.c}"><input type="text" value="${esc(t.name)}" placeholder="${TEAM_NAMES[t.c]}" maxlength="18" data-act="tname" data-i="${i}" aria-label="Nome della squadra ${i + 1}" autocomplete="off" enterkeyhint="done">`
    + `${prefs.teams.length > 2 ? `<button class="x" data-act="del-team" data-i="${i}" aria-label="Togli la squadra ${esc(t.name || TEAM_NAMES[t.c])}">${ICON.x}</button>` : ''}</div>`).join('');
  const custom = customText();
  const cn = customCards().length;
  return `${bar('Nuova partita', { back: 'home', backLabel: 'Menu principale' })}
<section class="screen">
<div class="field"><span class="field-label">Squadre</span><div class="stack">${teams}
${prefs.teams.length < MAX_TEAMS ? '<button class="btn btn-ghost btn-sm" data-act="add-team">Aggiungi una squadra</button>' : ''}</div></div>
<h2 class="section-title">Regole</h2>
${rulesHtml(s, true)}
<h2 class="section-title">Carte</h2>
${catsHtml(s)}
<details class="custom"${S.customOpen || custom.trim() ? ' open' : ''}><summary>Aggiungi le tue carte <span data-cc>${cn ? '(' + cn + ')' : ''}</span></summary>
<p class="hint">Una carta per riga: la parola, i due punti e poi le parole vietate separate da virgole.</p>
<textarea rows="5" data-act="custom" placeholder="Zia Rosa: abbracci, lasagne, domenica, rumorosa, profumo" aria-label="Le tue carte">${esc(custom)}</textarea></details>
<div class="cta"><button class="btn btn-gold btn-big btn-wide" data-act="start-local">Inizia la partita</button></div>
</section>`;
}

function readyHtml(v) {
  const i = v.cur;
  const team = v.teams[i];
  const lim = v.settings.turns;
  const round = `Turno ${team.turns + 1}${lim ? ' di ' + lim : ''}`;
  const online = v.mode === 'online';
  const tn = `<strong>${esc(team.name)}</strong>`;
  const others = v.teams.length > 2 ? 'le altre squadre controllano' : 'l’altra squadra controlla';
  let who = '';
  let how;
  let btns;
  if (!online) {
    how = `Date il telefono a chi spiega per ${tn}. La sua squadra indovina, ${others} la carta da sopra la spalla.`;
    btns = '<button class="btn btn-gold btn-big btn-wide" data-act="start">Inizia il turno</button><button class="btn btn-text" data-act="end">Termina la partita</button>';
  } else {
    const up = v.up;
    const upName = up ? nameOf(v, up) : '';
    if (!up) {
      how = `Nessuno della squadra ${tn} è collegato in questo momento.`;
      btns = v.isHost ? `<button class="btn btn-gold btn-big btn-wide" data-act="skipteam">Salta il turno di ${esc(team.name)}</button>` : '<p class="wait">Aspettiamo l’host</p>';
    } else {
      who = `<p class="last">${up === v.you ? 'Spieghi tu' : 'Spiega ' + upName}</p>`;
      if (up === v.you) {
        how = `La tua squadra indovina, ${others} le parole vietate.`;
        btns = '<button class="btn btn-gold btn-big btn-wide" data-act="start">Inizia il turno</button>';
      } else if (v.myTeam === i) {
        how = `Tocca a voi indovinare: ascolta ${upName}!`;
        btns = `<p class="wait">Aspettiamo che ${upName} inizi</p><button class="btn btn-ghost btn-wide" data-act="claim">Spiego io</button>`;
      } else {
        how = `Guarda la carta di ${upName} e premi Tabù! se dice una parola vietata.`;
        btns = `<p class="wait">Aspettiamo che ${upName} inizi</p>`;
      }
      if (v.isHost && up !== v.you) btns += `<button class="btn btn-ghost btn-wide" data-act="start">Fai partire il turno di ${upName}</button>`;
    }
    if (v.isHost) {
      btns += `<div class="row host-row">${up ? '<button class="btn btn-text" data-act="skipteam">Salta turno</button>' : ''}<button class="btn btn-text" data-act="end">Fine partita</button><button class="btn btn-text" data-act="lobby">Sala d’attesa</button></div>`;
    }
  }
  return `${topBar(v, round)}
<section class="screen">
<div class="upnext ${tc(v, i)}"><p class="kicker">${online ? round + ' · ' : ''}Tocca a</p><h1 class="upnext-name fit" data-max="88" data-min="34" data-want="64"><span>${esc(team.name)}</span></h1>${who}</div>
${lastHtml(v)}
${scoresHtml(v, [i])}
<p class="how ${tc(v, i)}">${how}</p>
<div class="cta">${btns}</div>
</section>`;
}

function playHtml(v) {
  const t = v.turn;
  const i = t.team;
  const online = v.mode === 'online';
  const role = v.role;
  const lead = role === 'all' || role === 'describer' || !!v.isHost;
  const describing = role === 'all' || role === 'describer';
  const paused = v.phase === 'paused';
  const sk = v.settings.skips;
  const left = sk < 0 ? -1 : Math.max(0, sk - t.skips);
  const dname = online ? nameOf(v, t.describer) : '';
  let body = '';
  if (paused) {
    body = `<div class="card paused-card"><p class="big">In pausa</p>${lead
      ? '<p>La carta resta nascosta finché non riprendi.</p><button class="btn btn-gold" data-act="resume">Riprendi</button><button class="btn btn-ink" data-act="stop">Chiudi il turno</button>'
      : '<p>Un attimo, si riparte subito.</p>'}</div>`;
  } else if (role === 'guesser') {
    body = `<div class="guess ${tc(v, i)}"><p class="guess-big fit" data-max="84" data-min="36" data-want="72"><span>Indovina!</span></p><p class="guess-count">Spiega ${dname}</p></div>`;
  } else if (t.card) {
    const deal = t.card[1] !== S.dealt;
    S.dealt = t.card[1];
    let controls;
    if (describing) {
      const withTaboo = role === 'all' || !t.watchers;
      controls = `<div class="controls${withTaboo ? '' : ' two'}">${withTaboo ? '<button class="btn btn-red" data-act="taboo">Tabù!</button>' : ''}`
        + `<button class="btn btn-ghost" data-act="skip"${left === 0 ? ' disabled' : ''}>Salta</button><button class="btn btn-gold" data-act="correct">Giusto!</button></div>`;
    } else {
      controls = '<div class="controls one"><button class="btn btn-red" data-act="taboo">Tabù!</button></div>';
    }
    const note = online ? `<p class="role ${tc(v, i)}">${role === 'describer' ? 'Spieghi tu' : 'Spiega ' + dname + ': occhio alle parole vietate'}</p>` : '';
    body = note + cardHtml(t.card, { deal, swipe: describing }) + controls;
  }
  const skipsTxt = left < 0 ? '' : left === 0 ? 'Niente più salti' : `<b>${left}</b> ${left === 1 ? 'salto rimasto' : 'salti rimasti'}`;
  return `${online ? banner() : ''}<section class="screen play">
<div class="play-top ${tc(v, i)}"><span class="team-chip">${esc(v.teams[i].name)}</span><div class="timer" data-timer role="timer" aria-label="Tempo rimasto"></div>`
    + `<div class="tools">${lead && !paused ? `<button class="icon-btn" data-act="pause" aria-label="Pausa">${ICON.pause}</button>` : ''}${soundBtn()}</div></div>
<div class="timebar" data-timebar><i></i></div>
<div class="turn-meta"><span><b>${signed(t.pts)}</b> in questo turno</span><span>${skipsTxt}</span></div>
${body}
</section>`;
}

function reviewHtml(v) {
  const t = v.turn;
  const i = t.team;
  const lead = v.role === 'all' || v.role === 'describer' || !!v.isHost;
  const who = v.mode === 'online' ? nameOf(v, t.describer) || 'chi ha spiegato' : '';
  const list = t.results.length
    ? t.results.map((r, k) => `<li><button data-act="toggle" data-i="${k}"${lead ? '' : ' disabled'}><span>${esc(r.w)}</span><span class="o o-${r.o}">${OUT_LABEL[r.o]}</span></button></li>`).join('')
    : '<li class="empty">Nessuna carta in questo turno.</li>';
  const cta = lead
    ? `<button class="btn btn-gold btn-big btn-wide" data-act="confirm">${v.final ? 'Vedi la classifica finale' : 'Prossima squadra'}</button>`
    : `<p class="wait">Aspettiamo che ${who} confermi</p>`;
  return `${topBar(v, 'Tempo scaduto')}
<section class="screen">
<div class="${tc(v, i)}"><p class="kicker">${esc(v.teams[i].name)} in questo turno</p><p class="big-points">${signed(t.pts)}</p></div>
${lead && t.results.length ? '<p class="hint">Tocca una carta per correggere come conta.</p>' : ''}
<ul class="results">${list}</ul>
<div class="cta">${cta}</div>
</section>`;
}

function overHtml(v) {
  const online = v.mode === 'online';
  const idx = v.teams.map((t, i) => i);
  const max = Math.max.apply(null, v.teams.map(t => t.score));
  const win = idx.filter(i => v.teams[i].score === max);
  const order = idx.slice().sort((a, b) => v.teams[b].score - v.teams[a].score);
  const head = win.length === 1
    ? `<div class="upnext ${tc(v, win[0])}"><p class="kicker">Partita finita</p><h1 class="upnext-name fit" data-max="88" data-min="34" data-want="60"><span>Vince ${esc(v.teams[win[0]].name)}</span></h1></div>`
    : `<div class="upnext"><p class="kicker">Partita finita</p><h1 class="upnext-name fit" data-max="88" data-min="34" data-want="60"><span>Pareggio</span></h1><p class="last">${andList(win.map(i => esc(v.teams[i].name)))} sono a pari merito.</p></div>`;
  let btns;
  if (!online) btns = '<button class="btn btn-gold btn-big btn-wide" data-act="again">Gioca ancora</button><button class="btn btn-ghost btn-wide" data-act="menu">Menu principale</button>';
  else if (v.isHost) btns = '<button class="btn btn-gold btn-big btn-wide" data-act="again">Gioca ancora</button><button class="btn btn-ghost btn-wide" data-act="lobby">Torna alla sala d’attesa</button>';
  else btns = '<p class="wait">Aspettiamo l’host</p>';
  return `${topBar(v, 'Classifica finale')}<section class="screen">${head}${scoresHtml(v, win, order)}<div class="cta">${btns}</div></section>`;
}

function gameHtml(v) {
  if (v.phase === 'ready') return readyHtml(v);
  if (v.phase === 'playing' || v.phase === 'paused') return playHtml(v);
  if (v.phase === 'review') return reviewHtml(v);
  if (v.phase === 'over') return overHtml(v);
  if (v.phase === 'lobby') return lobbyHtml(v);
  return '';
}

function onlineHtml() {
  const join = `<div class="stack"><h2 class="section-title">Entra in una stanza</h2>
<label class="field"><span class="field-label">Codice della stanza</span><input type="text" class="code-input" value="${esc(S.code || '')}" maxlength="4" data-act="code" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="ABCD" enterkeyhint="go"></label>
<button class="btn ${S.joinFirst ? 'btn-gold' : ''} btn-wide" data-act="join">Entra</button></div>`;
  const host = `<div class="stack"><h2 class="section-title">Crea una stanza</h2>
<p class="hint">Ricevi un codice da condividere. La stanza gira sul tuo telefono, quindi tieni aperta questa pagina mentre giocate.</p>
<button class="btn ${S.joinFirst ? 'btn-ghost' : 'btn-gold'} btn-wide" data-act="create">Crea una stanza</button></div>`;
  return `${bar('Gioca online', { back: 'home', backLabel: 'Menu principale' })}
<section class="screen">
<label class="field"><span class="field-label">Il tuo nome</span><input type="text" value="${esc(prefs.name)}" maxlength="18" data-act="name" autocomplete="nickname" placeholder="Nome" enterkeyhint="done"></label>
${S.err ? `<p class="error" role="alert">${esc(S.err)}</p>` : ''}
<div class="split">${S.joinFirst ? join + host : host + join}</div>
<p class="hint">Dovete sentirvi: giocate nella stessa stanza oppure in chiamata.</p>
</section>`;
}

function lobbyHtml(v) {
  const me = (v.players || []).find(p => p.id === v.you);
  const cols = v.teams.map((t, i) => {
    const mem = v.players.filter(p => p.team === i);
    const li = mem.length ? mem.map(p => `<li class="${p.on ? '' : 'off'}"><span>${esc(p.name)}${p.id === v.you ? '<span class="tag">tu</span>' : p.id === v.host ? '<span class="tag">host</span>' : ''}</span>`
      + `${v.isHost && p.id !== v.host ? `<button class="x" data-act="kick" data-pid="${esc(p.id)}" aria-label="Rimuovi ${esc(p.name)}">${ICON.x}</button>` : ''}</li>`).join('')
      : '<li class="empty">Ancora nessuno</li>';
    const head = v.isHost
      ? `<input type="text" value="${esc(t.name)}" maxlength="18" data-act="rename" data-i="${i}" aria-label="Nome della squadra ${i + 1}" autocomplete="off" enterkeyhint="done">`
      : `<h3 class="team-chip">${esc(t.name)}</h3>`;
    const join = me && me.team !== i ? `<button class="btn btn-ghost btn-sm" data-act="team" data-i="${i}">Unisciti</button>` : '';
    return `<div class="lobby-team tc${t.c}">${head}<ul>${li}</ul>${join}</div>`;
  }).join('');
  const counts = v.teams.map((t, i) => v.players.filter(p => p.team === i && p.on).length);
  const empty = counts.some(n => n === 0);
  const thin = !empty && counts.some(n => n < 2);
  const settings = v.isHost
    ? `<h2 class="section-title">Squadre</h2><div class="seg" role="radiogroup" aria-label="Numero di squadre">${[2, 3, 4].map(n => `<button role="radio" aria-checked="${v.teams.length === n}" data-act="teams" data-i="${n}">${n} squadre</button>`).join('')}</div>`
      + `<h2 class="section-title">Regole</h2>${rulesHtml(v.settings, true)}<h2 class="section-title">Carte</h2>${catsHtml(v.settings)}`
    : `<p class="hint">${summaryText(v.settings, v.pool || 0)}</p>`;
  const cta = v.isHost
    ? `${empty ? '<p class="hint">Serve almeno un giocatore per squadra.</p>' : thin ? '<p class="hint">Si gioca meglio con almeno due giocatori per squadra.</p>' : ''}<button class="btn btn-gold btn-big btn-wide" data-act="begin"${empty ? ' disabled' : ''}>Inizia la partita</button>`
    : '<p class="wait">Aspettiamo che l’host inizi la partita</p>';
  return `${topBar(v)}
<section class="screen">
<div class="room-card"><p class="kicker">Codice della stanza</p><p class="room-code fit" data-max="64" data-min="32" data-want="60"><span>${esc(v.code)}</span></p>
<div class="row"><button class="btn btn-gold btn-sm" data-act="share">Invita</button><button class="btn btn-ghost btn-sm" data-act="copy">Copia link</button></div>
${v.isHost ? '<p class="hint">Tieni aperta questa pagina: la stanza gira sul tuo telefono.</p>' : ''}</div>
<div class="lobby-teams">${cols}</div>
${settings}
<div class="cta">${cta}</div>
</section>`;
}

function roomHtml(v) {
  const code = esc(R.code);
  if (R.replaced) {
    return `${bar('Stanza ' + code, { leave: true })}<section class="screen"><div class="joining"><p class="big">Sei già dentro</p><p class="hint">Questa stanza è aperta in un’altra scheda o su un altro dispositivo. Vuoi continuare qui?</p></div><div class="cta"><button class="btn btn-gold btn-wide" data-act="rejoin">Continua qui</button></div></section>`;
  }
  if (!v) {
    const msg = R.err ? esc(R.err) : R.slow ? 'Ci sta mettendo più del solito. Continuo a provare…' : 'Connessione in corso…';
    return `${bar('Stanza ' + code, { dot: 'wait', leave: true })}<section class="screen"><div class="joining"><p class="big">${R.role === 'host' ? 'Apro' : 'Entro nella'} stanza ${code}</p><p class="hint">${msg}</p></div></section>`;
  }
  return gameHtml(v);
}

const RULES_HTML = `<div class="rules">
<h2 tabindex="-1">Come si gioca</h2>
<p>Dividetevi in due o più squadre. A ogni turno un giocatore spiega la parola in cima alla carta e la sua squadra prova a indovinarla prima che scada il tempo.</p>
<h3>Parole vietate</h3>
<p>Chi spiega non può dire la parola stessa, nessuna delle parole elencate sotto e nemmeno un loro pezzo: niente «sole» per Girasole. Vietati anche gesti, rime, «fa rima con», spelling, iniziali e traduzioni.</p>
<h3>Punteggio</h3>
<p>Parola indovinata: +1. Tabù, cioè una parola vietata detta per sbaglio: −1. Salto: gratis, oppure −1 se lo scegli nelle regole. Le altre squadre guardano la carta e gridano Tabù! appena sentono una parola vietata.</p>
<h3>Dopo ogni turno</h3>
<p>Controllate l’elenco delle carte, toccatene una per correggere come conta, poi tocca alla squadra successiva. Dopo l’ultimo turno vince chi ha più punti.</p>
<h3>Con un solo telefono</h3>
<p>Chi spiega tiene il telefono e qualcuno dell’altra squadra guarda da sopra la spalla. Trascina la carta a destra per Giusto! e a sinistra per Salta. Da tastiera: freccia destra per Giusto!, freccia sinistra per Salta, freccia giù per Tabù!, P per la pausa.</p>
<h3>Online</h3>
<p>Una persona crea una stanza e condivide il codice o il link; gli altri entrano dal proprio telefono. Chi spiega vede la carta, la sua squadra vede Indovina! e le altre squadre vedono la carta con il pulsante Tabù!. Dovete comunque sentirvi: giocate nella stessa stanza o in chiamata. La stanza gira sul telefono di chi l’ha creata, quindi quella pagina deve restare aperta.</p>
<button class="btn btn-gold" data-close>Chiudi</button>
</div>`;

// ---------- rendering ----------
const app = document.getElementById('app');
const S = { screen: 'home', lastView: null, dealt: null, code: '', err: '', joinFirst: false, customOpen: false };
let lastCmp = '';
let lastScreen = '';
let lastPhase = '';
let pending = false;
let swipe = null;
let fitT = 0;

function selfView() {
  if (S.screen === 'game' && G) return viewFor(null);
  if (S.screen === 'room') {
    if (R.role === 'host' && G) return viewFor(R.pid);
    if (R.role === 'client') return R.view;
  }
  return null;
}
function typingNow() {
  const ae = document.activeElement;
  return !!ae && ae !== document.body && app.contains(ae) && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA');
}
function keyOf(el) {
  const d = el && el.dataset;
  return d && d.act ? [d.act, d.i, d.k, d.v, d.id, d.pid].join('|') : '';
}
function render() {
  const v = selfView();
  if (S.lastView && v) feedback(S.lastView, v);
  S.lastView = v;
  let html = '';
  if (S.screen === 'home') html = homeHtml();
  else if (S.screen === 'setup') html = setupHtml();
  else if (S.screen === 'online') html = onlineHtml();
  else if (S.screen === 'game') html = v ? gameHtml(v) : '';
  else if (S.screen === 'room') html = roomHtml(v);
  const cmp = html.replace(/ deal\b/g, '');
  if (cmp === lastCmp && S.screen === lastScreen) { tick(); return; }
  if (S.screen === lastScreen && (typingNow() || swipe)) { pending = true; return; }
  pending = false;
  const ae = document.activeElement;
  const focusKey = ae && app.contains(ae) && ae.tagName === 'BUTTON' ? keyOf(ae) : '';
  const phase = v ? v.phase : '';
  const moved = S.screen !== lastScreen || phase !== lastPhase;
  app.innerHTML = html;
  lastCmp = cmp; lastScreen = S.screen; lastPhase = phase;
  if (moved) window.scrollTo(0, 0);
  else if (focusKey) {
    const el = Array.prototype.find.call(app.querySelectorAll('button[data-act]'), x => keyOf(x) === focusKey);
    if (el) el.focus({ preventScroll: true });
  }
  fitAll();
  tick();
}
function flushPending() { if (pending && !typingNow() && !swipe) render(); }

// Parola grande sulla carta: la larghezza del carattere si adatta alla parola; le frasi vanno a capo (massimo 3 righe).
const STRETCH = [125, 112, 100, 90, 80, 72];
function fitOne(el) {
  const span = el.firstElementChild;
  const W = el.clientWidth;
  if (!span || !W) return;
  const max = +el.dataset.max || 80;
  const want = Math.min(max, +el.dataset.want || 56);
  el.style.whiteSpace = 'nowrap';
  el.style.fontSize = '100px';
  let best = null;
  for (let k = 0; k < STRETCH.length; k++) {
    el.style.fontStretch = STRETCH[k] + '%';
    const w = span.getBoundingClientRect().width || 1;
    const s = Math.min(max, Math.floor(W * 97 / w));
    if (!best || s > best.s) best = { st: STRETCH[k], s, wrap: false };
    if (s >= want) { best = { st: STRETCH[k], s, wrap: false }; break; }
  }
  if (best.s < want && /\s/.test(span.textContent.trim())) {
    el.style.whiteSpace = 'normal';
    [90, 80, 72].forEach(st => {
      el.style.fontStretch = st + '%';
      for (let s = want; s > best.s; s -= 2) {
        el.style.fontSize = s + 'px';
        if (span.getClientRects().length <= 3 && el.scrollWidth <= el.clientWidth) { best = { st, s, wrap: true }; break; }
      }
    });
  }
  el.style.whiteSpace = best.wrap ? 'normal' : 'nowrap';
  el.style.fontStretch = best.st + '%';
  el.style.fontSize = Math.max(16, best.s) + 'px';
}
function fitAll() { document.querySelectorAll('.fit').forEach(fitOne); }

// ---------- suoni e vibrazione ----------
let AC = null;
let unlocked = false;
function audio() {
  if (!AC) {
    const C = window.AudioContext || window.webkitAudioContext;
    if (!C) return null;
    try { AC = new C(); } catch (e) { return null; }
  }
  if (AC.state === 'suspended') AC.resume().catch(() => {});
  return AC;
}
function tone(freq, dur, o) {
  const ac = audio();
  if (!ac) return;
  o = o || {};
  const t0 = ac.currentTime + (o.at || 0) + 0.005;
  const osc = ac.createOscillator();
  const g = ac.createGain();
  const vol = o.vol || 0.2;
  osc.type = o.type || 'sine';
  osc.frequency.setValueAtTime(freq, t0);
  if (o.slide) osc.frequency.exponentialRampToValueAtTime(freq * o.slide, t0 + dur);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(vol, t0 + 0.012);
  if (o.hold) g.gain.setValueAtTime(vol, t0 + dur - 0.07);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g);
  g.connect(ac.destination);
  osc.start(t0);
  osc.stop(t0 + dur + 0.03);
}
const SND = {
  correct() { tone(784, 0.11, { type: 'triangle', vol: 0.28 }); tone(1175, 0.2, { type: 'triangle', vol: 0.26, at: 0.085 }); },
  skip() { tone(520, 0.15, { vol: 0.2, slide: 0.55 }); },
  taboo() { tone(146, 0.45, { type: 'sawtooth', vol: 0.2, hold: true }); tone(155, 0.45, { type: 'square', vol: 0.08, hold: true }); },
  tick() { tone(1320, 0.045, { type: 'square', vol: 0.06 }); },
  end() { tone(196, 0.95, { type: 'sawtooth', vol: 0.2, hold: true }); tone(207, 0.95, { type: 'square', vol: 0.07, hold: true }); },
  start() { [523, 659, 784].forEach((f, k) => tone(f, 0.16, { type: 'triangle', vol: 0.22, at: k * 0.09 })); },
};
function play(name) { if (!prefs.sound || document.hidden) return; try { SND[name](); } catch (e) { /* audio non disponibile */ } }
function buzz(p) { if (!prefs.sound || !navigator.vibrate) return; try { navigator.vibrate(p); } catch (e) { /* niente */ } }
function unlockAudio() {
  if (unlocked || !prefs.sound) return;
  const ac = audio();
  if (!ac) return;
  try {
    const src = ac.createBufferSource();
    src.buffer = ac.createBuffer(1, 1, 22050);
    src.connect(ac.destination);
    src.start(0);
    unlocked = true;
  } catch (e) { /* riprova al prossimo tocco */ }
}
function flash(kind) {
  const el = $('#flash');
  if (!el || (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches)) return;
  el.className = '';
  void el.offsetWidth;
  el.className = 'on f-' + kind;
}
// Suoni e lampi nascono dal confronto tra la vista precedente e quella nuova: uguale per tutti i dispositivi.
function feedback(a, b) {
  const ta = a.turn;
  const tb = b.turn;
  if (!tb) return;
  if (!ta || ta.id !== tb.id) {
    if (b.phase === 'playing') { play('start'); buzz(40); }
    return;
  }
  if (tb.outs.length > ta.outs.length) {
    const o = tb.outs[tb.outs.length - 1];
    if (o === 'correct') { play('correct'); flash('correct'); buzz(30); }
    else if (o === 'skip') { play('skip'); flash('skip'); buzz(15); }
    else if (o === 'taboo') { play('taboo'); flash('taboo'); buzz([90, 60, 90]); }
  }
  if (b.phase === 'review' && (a.phase === 'playing' || a.phase === 'paused')) { play('end'); buzz([260, 90, 260]); }
}

// ---------- timer ----------
let lastSec = -1;
function timeLeft(v) {
  if (G && G.turn && G.turn.id === v.turn.id && (S.screen === 'game' || R.role === 'host')) return remaining(G.turn);
  const t = v.turn;
  return t.running ? Math.max(0, t.left - (performance.now() - R.viewAt)) : t.left;
}
function tick() {
  const v = S.lastView;
  const el = document.querySelector('[data-timer]');
  if (!v || !v.turn || !el) { lastSec = -1; return; }
  const ms = timeLeft(v);
  const hurry = ms <= 10000;
  const txt = fmt(ms);
  if (el.textContent !== txt) el.textContent = txt;
  el.classList.toggle('hurry', hurry);
  const tb = document.querySelector('[data-timebar]');
  if (tb && tb.firstElementChild) {
    tb.classList.toggle('hurry', hurry);
    tb.firstElementChild.style.transform = 'scaleX(' + Math.max(0, Math.min(1, ms / v.turn.total)).toFixed(4) + ')';
  }
  if (v.phase === 'playing') {
    const s = Math.ceil(ms / 1000);
    if (s !== lastSec && lastSec !== -1 && s >= 1 && s <= 5) play('tick');
    lastSec = s;
  } else lastSec = -1;
}

// ---------- varie ----------
let toastT = 0;
function toast(msg) {
  const el = $('#toast');
  if (!el) return;
  el.textContent = msg;
  el.classList.add('on');
  clearTimeout(toastT);
  toastT = setTimeout(() => el.classList.remove('on'), 2800);
}
let wake = null;
let wakeBusy = false;
function wakeOn() {
  if (wake || wakeBusy || !('wakeLock' in navigator) || document.visibilityState !== 'visible') return;
  wakeBusy = true;
  navigator.wakeLock.request('screen').then(w => {
    wakeBusy = false;
    if (S.screen !== 'game' && S.screen !== 'room') { w.release().catch(() => {}); return; }
    wake = w;
    w.addEventListener('release', () => { if (wake === w) wake = null; });
  }).catch(() => { wakeBusy = false; });
}
function wakeOff() { const w = wake; wake = null; if (w) w.release().catch(() => {}); }
function openRules() {
  let d = document.getElementById('rules');
  if (!d) {
    d = document.createElement('dialog');
    d.id = 'rules';
    d.setAttribute('aria-label', 'Come si gioca');
    d.innerHTML = RULES_HTML;
    d.addEventListener('click', e => {
      if (e.target === d || e.target.closest('[data-close]')) { if (d.close) d.close(); else d.removeAttribute('open'); }
    });
    document.body.appendChild(d);
  }
  if (typeof d.showModal === 'function') { if (!d.open) d.showModal(); } else d.setAttribute('open', '');
  d.scrollTop = 0;
  const h = d.querySelector('h2');
  if (h) h.focus({ preventScroll: true });
}
function focusName() { const el = app.querySelector('[data-act="name"]'); if (el) el.focus(); }

// ---------- azioni ----------
function changed() {
  if (!G) return;
  if (G.mode === 'local') saveLocal();
  else if (R.role === 'host') { saveHost(); broadcast(); }
  render();
}
function doAct(name, extra) {
  const a = Object.assign({ a: name }, extra || {});
  const v = S.lastView;
  if ((name === 'correct' || name === 'skip' || name === 'taboo') && v && v.turn && v.turn.card) a.w = v.turn.card[1];
  if (S.screen === 'game' && G) { if (apply(null, a)) changed(); }
  else if (S.screen === 'room') {
    if (R.role === 'host' && G) { if (apply(R.pid, a)) changed(); }
    else if (R.role === 'client') sendHost(Object.assign({ t: 'act' }, a));
  }
}
let localT = 0;
function saveLocal(immediate) {
  if (!G || G.mode !== 'local') return;
  clearTimeout(localT);
  const g = G;
  if (immediate) store.set('local', g);
  else localT = setTimeout(() => store.set('local', g), 300);
}
function flushSaves() {
  if (G && G.mode === 'local') store.set('local', G);
  if (G && G.mode === 'online' && R.role === 'host') store.set('host', { G, code: R.code, t: now() });
  store.set('seen', seenList);
  store.set('prefs', prefs);
}
function goHome() {
  if (S.screen === 'game' && G && G.mode === 'local') {
    if (G.phase === 'playing') apply(null, { a: 'pause' });
    saveLocal(true);
  }
  S.screen = 'home'; S.lastView = null; S.err = ''; S.joinFirst = false;
  wakeOff();
  render();
}
function resumeLocal() {
  const g = store.get('local', null);
  if (!validGame(g) || g.mode !== 'local') { store.del('local'); render(); return; }
  G = g;
  if (G.phase === 'playing') apply(null, { a: 'pause' });
  S.screen = 'game'; S.lastView = null;
  wakeOn();
  render();
}
function toggled(off, id) { const s = new Set(off); if (s.has(id)) s.delete(id); else s.add(id); return Array.from(s); }
function allCats() { return DECK.categories.map(c => c.id).concat(customCards().length ? ['custom'] : []); }
function setPref(k, off) {
  if (k === 'off') prefs.settings.off = off;
  savePrefs();
  render();
}

const ACT = {
  home: () => goHome(),
  rules: () => openRules(),
  sound: () => { prefs.sound = !prefs.sound; savePrefs(); if (prefs.sound) { unlockAudio(); play('correct'); } render(); },
  'local-new': () => { S.screen = 'setup'; render(); },
  'local-resume': () => resumeLocal(),
  'host-resume': () => startHost(true),
  online: () => { S.screen = 'online'; S.err = ''; render(); },
  'add-team': () => {
    if (prefs.teams.length >= MAX_TEAMS) return;
    const c = freeColor(prefs.teams);
    prefs.teams.push({ name: TEAM_NAMES[c], c });
    savePrefs(); render();
  },
  'del-team': el => { if (prefs.teams.length > 2) { prefs.teams.splice(el.dataset.i | 0, 1); savePrefs(); render(); } },
  set: el => {
    if (S.screen === 'room') { doAct('set', { k: el.dataset.k, v: el.dataset.v }); return; }
    const k = el.dataset.k;
    const o = OPTS[k] && OPTS[k].find(x => String(x[0]) === el.dataset.v);
    if (o) { prefs.settings[k] = o[0]; savePrefs(); render(); }
  },
  cat: el => {
    if (S.screen === 'room') { if (S.lastView) doAct('cats', { off: toggled(S.lastView.settings.off, el.dataset.id) }); return; }
    setPref('off', toggled(prefs.settings.off, el.dataset.id));
  },
  'cats-all': () => { if (S.screen === 'room') doAct('cats', { off: [] }); else setPref('off', []); },
  'cats-none': () => { if (S.screen === 'room') doAct('cats', { off: allCats() }); else setPref('off', allCats()); },
  'start-local': () => {
    if (!poolCount(prefs.settings)) { toast('Scegli almeno una categoria.'); return; }
    G = newLocalGame();
    S.screen = 'game'; S.lastView = null;
    saveLocal(true); wakeOn(); render();
  },
  end: () => { if (window.confirm('Terminare la partita e vedere la classifica?')) doAct('end'); },
  lobby: () => {
    const v = S.lastView;
    if (v && v.phase === 'ready' && !window.confirm('Tornare alla sala d’attesa? La partita in corso finisce qui.')) return;
    doAct('lobby');
  },
  menu: () => { store.del('local'); G = null; goHome(); },
  create: () => {
    if (!prefs.name) { S.err = 'Scrivi prima il tuo nome.'; render(); focusName(); return; }
    startHost(false);
  },
  join: () => {
    const code = cleanCode(S.code);
    if (!prefs.name) { S.err = 'Scrivi prima il tuo nome.'; render(); focusName(); return; }
    if (code.length !== 4) { S.err = 'Il codice della stanza ha 4 caratteri.'; render(); return; }
    joinRoom(code);
  },
  share: () => shareRoom(),
  copy: () => copyLink(),
  leave: () => leaveRoom(),
  rejoin: () => joinRoom(R.code),
  kick: el => {
    const p = playerMap(S.lastView || {})[el.dataset.pid];
    if (p && window.confirm('Togliere ' + p.name + ' dalla stanza?')) doAct('kick', { pid: el.dataset.pid });
  },
  teams: el => doAct('teams', { i: el.dataset.i | 0 }),
  team: el => doAct('team', { i: el.dataset.i | 0 }),
  toggle: el => doAct('toggle', { i: el.dataset.i | 0 }),
};
['start', 'claim', 'correct', 'skip', 'taboo', 'pause', 'resume', 'stop', 'confirm', 'again', 'skipteam', 'begin'].forEach(n => { ACT[n] = () => doAct(n); });

const INPUT = {
  tname(el) { const t = prefs.teams[el.dataset.i | 0]; if (t) { t.name = el.value.slice(0, 18); savePrefs(); } },
  custom(el) {
    setCustom(el.value);
    const n = customCards().length;
    const cc = app.querySelector('[data-cc]');
    if (cc) cc.textContent = n ? '(' + n + ')' : '';
    const pl = app.querySelector('[data-pool]');
    if (pl) pl.textContent = num(poolCount(prefs.settings)) + ' carte in gioco';
  },
  name(el) { prefs.name = cleanName(el.value); savePrefs(); },
  code(el) { const c = cleanCode(el.value); if (el.value !== c) el.value = c; S.code = c; },
  rename(el) { doAct('rename', { i: el.dataset.i | 0, name: el.value }); },
};

app.addEventListener('click', e => {
  const el = e.target.closest('[data-act]');
  if (!el || !app.contains(el) || el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.disabled) return;
  unlockAudio();
  if (typingNow() && document.activeElement !== el) document.activeElement.blur();
  const fn = ACT[el.dataset.act];
  if (fn) fn(el);
});
app.addEventListener('input', e => {
  const act = e.target.dataset && e.target.dataset.act;
  if (act && INPUT[act]) INPUT[act](e.target);
});
app.addEventListener('change', e => { if (e.target.dataset && e.target.dataset.act === 'custom') render(); });
app.addEventListener('focusout', () => { if (pending) setTimeout(flushPending, 0); });
app.addEventListener('toggle', e => { if (e.target.tagName === 'DETAILS') S.customOpen = e.target.open; }, true);
app.addEventListener('keydown', e => {
  const act = e.target.dataset && e.target.dataset.act;
  if (e.key !== 'Enter' || !act) return;
  if (act === 'code') { e.preventDefault(); ACT.join(); }
  else if (act === 'name' || act === 'tname' || act === 'rename') { e.preventDefault(); e.target.blur(); }
});
document.addEventListener('pointerdown', unlockAudio, { capture: true, passive: true });

// Trascina la carta: a destra giusto, a sinistra salta.
app.addEventListener('pointerdown', e => {
  const card = e.target.closest('[data-swipe]');
  if (!card || e.button > 0) return;
  swipe = { card, id: e.pointerId, x: e.clientX, y: e.clientY, dx: 0, on: false };
});
window.addEventListener('pointermove', e => {
  const s = swipe;
  if (!s || e.pointerId !== s.id) return;
  const dx = e.clientX - s.x;
  const dy = e.clientY - s.y;
  if (!s.on) {
    if (Math.abs(dy) > 12 && Math.abs(dy) > Math.abs(dx)) { swipe = null; flushPending(); return; }
    if (Math.abs(dx) < 10) return;
    s.on = true;
    try { s.card.setPointerCapture(e.pointerId); } catch (err) { /* niente */ }
  }
  s.dx = dx;
  s.card.style.transition = 'none';
  s.card.style.transform = `translateX(${dx}px) rotate(${(dx / 22).toFixed(2)}deg)`;
});
function endSwipe(e, cancel) {
  const s = swipe;
  if (!s || e.pointerId !== s.id) return;
  swipe = null;
  s.card.style.transition = 'transform .18s ease';
  s.card.style.transform = '';
  if (!cancel && s.on && Math.abs(s.dx) > 90) {
    const v = S.lastView;
    const skipOk = v && v.turn && (v.settings.skips < 0 || v.turn.skips < v.settings.skips);
    if (s.dx > 0) doAct('correct');
    else if (skipOk) doAct('skip');
  }
  flushPending();
}
window.addEventListener('pointerup', e => endSwipe(e, false));
window.addEventListener('pointercancel', e => endSwipe(e, true));

document.addEventListener('keydown', e => {
  if (e.defaultPrevented || e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
  const tag = e.target && e.target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
  if (document.querySelector('dialog[open]')) return;
  if (tag === 'BUTTON' && (e.key === 'Enter' || e.key === ' ')) return;
  const v = S.lastView;
  if (!v || !v.turn || (S.screen !== 'game' && S.screen !== 'room')) return;
  const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  const describing = v.role === 'all' || v.role === 'describer';
  const lead = describing || !!v.isHost;
  let act = null;
  if (v.phase === 'playing') {
    if (describing && (k === 'ArrowRight' || k === 'Enter' || k === ' ')) act = 'correct';
    else if (describing && (k === 'ArrowLeft' || k === 's')) act = 'skip';
    else if (v.role !== 'guesser' && (k === 'ArrowDown' || k === 't' || k === 'x')) act = 'taboo';
    else if (lead && (k === 'p' || k === 'Escape')) act = 'pause';
  } else if (v.phase === 'paused' && lead && (k === 'p' || k === ' ' || k === 'Enter')) act = 'resume';
  if (act) { e.preventDefault(); doAct(act); }
});

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') {
    if (S.screen === 'game' && G && G.mode === 'local' && G.phase === 'playing') { apply(null, { a: 'pause' }); changed(); }
    flushSaves();
  } else if (S.screen === 'game' || S.screen === 'room') wakeOn();
});
window.addEventListener('pagehide', flushSaves);
window.addEventListener('resize', () => { clearTimeout(fitT); fitT = setTimeout(fitAll, 120); });

// ---------- online: il telefono di chi crea la stanza tiene la partita, gli altri si collegano a lui ----------
function freshR() {
  return {
    role: null, code: '', pid: '', peer: null, conn: null, conns: {}, seen: {}, banned: new Set(),
    status: 'idle', since: now(), view: null, viewAt: 0, joined: false, stopped: false, replaced: false, slow: false,
    err: '', fail: 0, nextTry: 0, lastMsg: 0, lastPing: 0, connAt: 0, lastBeat: 0, idTaken: 0, everOpen: false, resumed: false,
  };
}
const R = freshR();
function setStatus(s) { if (R.status !== s) { R.status = s; R.since = now(); } }

let peerLoading = null;
function loadPeer() {
  if (window.Peer) return Promise.resolve();
  if (!peerLoading) {
    peerLoading = new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = 'peerjs.min.js';
      s.onload = () => (window.Peer ? res() : rej(new Error('peerjs')));
      s.onerror = () => { peerLoading = null; s.remove(); rej(new Error('peerjs')); };
      document.head.appendChild(s);
    });
  }
  return peerLoading;
}
// ?peer=host:porta per usare un proprio server PeerJS al posto di quello pubblico
function peerOpts() {
  const o = { debug: 0 };
  const m = PEER_Q.match(/^([A-Za-z0-9.-]+)(?::(\d+))?(\/[\w/.-]*)?$/);
  if (m) {
    const local = m[1] === 'localhost' || m[1] === '127.0.0.1';
    o.host = m[1];
    o.port = +(m[2] || (local ? 9000 : 443));
    o.path = m[3] || '/';
    o.secure = !local;
    if (local) o.config = { iceServers: [] };
  }
  return o;
}
function backoff() { const f = R.fail++; return Math.min(10000, 1000 * Math.pow(2, Math.min(f, 4))); }
function roomLink(code) {
  const u = new URL(location.href);
  u.search = '';
  u.hash = '';
  u.searchParams.set('room', code);
  if (PEER_Q) u.searchParams.set('peer', PEER_Q);
  return u.toString();
}
function setRoomQuery(code) {
  try {
    const u = new URL(location.href);
    if (code) u.searchParams.set('room', code); else u.searchParams.delete('room');
    history.replaceState(null, '', u.pathname + u.search + u.hash);
  } catch (e) { /* niente */ }
}
function stopRoom(delay) {
  const peer = R.peer;
  const conn = R.conn;
  const wasHost = R.role === 'host';
  clearTimeout(hostT);
  Object.assign(R, freshR());
  const kill = () => {
    try { if (conn) conn.close(); } catch (e) { /* niente */ }
    try { if (peer) peer.destroy(); } catch (e) { /* niente */ }
  };
  if (delay) setTimeout(kill, delay); else kill();
  if (wasHost) G = null;
}
function leaveRoom() {
  if (R.role === 'host' && G) {
    const others = Object.keys(G.players).some(id => id !== G.host && G.players[id].on);
    if (others && !window.confirm('Chiudere la stanza per tutti?')) return;
    Object.keys(R.conns).forEach(pid => { try { R.conns[pid].send({ t: 'closed' }); } catch (e) { /* niente */ } });
    store.del('host');
    stopRoom(400);
  } else {
    if (R.conn && R.conn.open) { try { R.conn.send({ t: 'bye' }); } catch (e) { /* niente */ } }
    stopRoom(300);
  }
  setRoomQuery(null);
  goHome();
}
function shareRoom() {
  const url = roomLink(R.code);
  if (navigator.share) {
    navigator.share({ title: 'Tabù', text: 'Entra nella mia stanza di Tabù: ' + R.code, url })
      .catch(err => { if (!err || err.name !== 'AbortError') copyLink(); });
  } else copyLink();
}
function copyLink() {
  const url = roomLink(R.code);
  const fallback = () => window.prompt('Copia questo link:', url);
  if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(url).then(() => toast('Link copiato'), fallback);
  else fallback();
}

// ----- host -----
let hostT = 0;
function saveHost() {
  if (R.role !== 'host' || !G) return;
  clearTimeout(hostT);
  hostT = setTimeout(() => { if (R.role === 'host' && G) store.set('host', { G, code: R.code, t: now() }); }, 300);
}
function startHost(resume) {
  let saved = resume ? store.get('host', null) : null;
  if (saved && (!validGame(saved.G) || saved.G.mode !== 'online' || !saved.code || !saved.G.players || now() - saved.t > HOST_TTL)) saved = null;
  if (resume && !saved) { store.del('host'); toast('Questa stanza è scaduta.'); goHome(); return; }
  stopRoom();
  Object.assign(R, freshR(), { role: 'host', resumed: !!saved });
  if (saved) { G = saved.G; R.code = cleanCode(saved.code); } else { G = newRoomGame(); R.code = makeCode(); }
  R.pid = G.host;
  const me = G.players[G.host];
  if (me) { me.on = true; if (prefs.name) me.name = prefs.name; }
  S.screen = 'room'; S.lastView = null; S.err = '';
  setRoomQuery(R.code);
  saveHost(); wakeOn(); render();
  loadPeer().then(() => { if (R.role === 'host' && !R.peer) openHostPeer(); })
    .catch(() => toast('Non riesco a caricare il modulo online. Controlla la connessione.'));
}
function openHostPeer() {
  if (R.role !== 'host' || !window.Peer) return;
  const old = R.peer;
  if (old) { try { old.destroy(); } catch (e) { /* niente */ } }
  let peer;
  try { peer = new window.Peer(PREFIX + R.code, peerOpts()); } catch (e) { R.peer = null; R.nextTry = now() + backoff(); return; }
  R.peer = peer;
  setStatus('connecting');
  peer.on('open', () => {
    if (peer !== R.peer) return;
    setStatus('online'); R.fail = 0; R.idTaken = 0; R.everOpen = true;
    render();
  });
  peer.on('connection', c => {
    if (peer === R.peer && R.role === 'host') hostConn(c);
    else { try { c.close(); } catch (e) { /* niente */ } }
  });
  peer.on('disconnected', () => {
    if (peer !== R.peer) return;
    setStatus('connecting');
    R.nextTry = Math.max(R.nextTry, now() + 1500);
    render();
  });
  peer.on('error', err => {
    if (peer !== R.peer) return;
    const type = err && err.type;
    if (type === 'peer-unavailable') return;
    if (type === 'unavailable-id') {
      R.idTaken += 1;
      // codice già usato da un'altra stanza: se nessuno lo conosce ancora ne scegliamo un altro
      if ((!R.everOpen && !R.resumed) || R.idTaken > 15) { newCode(); return; }
    }
    setStatus('connecting');
    R.nextTry = now() + backoff();
    render();
  });
}
function newCode() {
  const others = Object.keys(G.players).length > 1;
  R.code = makeCode(); R.idTaken = 0; R.everOpen = false;
  setRoomQuery(R.code);
  saveHost();
  openHostPeer();
  if (others) toast('La stanza ha un nuovo codice: ' + R.code);
  broadcast();
  render();
}
function hostWatch() {
  if (!window.Peer) { if (!peerLoading) loadPeer().then(openHostPeer).catch(() => {}); return; }
  if (now() < R.nextTry) return;
  const p = R.peer;
  if (!p || p.destroyed) { R.nextTry = now() + backoff(); openHostPeer(); }
  else if (p.disconnected) {
    R.nextTry = now() + backoff();
    try { p.reconnect(); } catch (e) { try { p.destroy(); } catch (e2) { /* niente */ } }
  }
}
function hostConn(conn) {
  conn.on('data', d => onClientMsg(conn, d));
  conn.on('close', () => {
    const pid = conn.pid;
    if (pid && R.conns[pid] === conn) {
      delete R.conns[pid];
      const p = G && G.players[pid];
      if (p && p.on) { p.on = false; changed(); }
    }
  });
  conn.on('error', () => { /* la chiusura arriva dopo */ });
}
function later(fn, ms) { setTimeout(() => { try { fn(); } catch (e) { /* niente */ } }, ms); }
function onClientMsg(conn, d) {
  if (R.role !== 'host' || !G || !d || typeof d !== 'object') return;
  if (d.t === 'hello') {
    let pid = String(d.pid || '').replace(/[^a-z0-9]/gi, '').slice(0, 24) || rid(10);
    if (pid === G.host) pid = rid(10);
    if (R.banned.has(pid)) { try { conn.send({ t: 'kicked' }); } catch (e) { /* niente */ } later(() => conn.close(), 400); return; }
    const name = cleanName(d.name) || 'Giocatore';
    let p = G.players[pid];
    if (!p) {
      if (Object.keys(G.players).length >= MAX_PLAYERS) { try { conn.send({ t: 'full' }); } catch (e) { /* niente */ } later(() => conn.close(), 400); return; }
      p = { name, team: smallestTeam(), on: true, j: G.jn++ };
      G.players[pid] = p;
    } else { p.name = name; p.on = true; }
    const old = R.conns[pid];
    if (old && old !== conn) { try { old.send({ t: 'replaced' }); } catch (e) { /* niente */ } later(() => old.close(), 400); }
    conn.pid = pid;
    R.conns[pid] = conn;
    R.seen[pid] = now();
    try { conn.send({ t: 'welcome', pid, code: R.code }); } catch (e) { /* niente */ }
    changed();
    return;
  }
  const pid = conn.pid;
  if (!pid || R.conns[pid] !== conn) return;
  R.seen[pid] = now();
  const p = G.players[pid];
  if (!p) return;
  if (!p.on) { p.on = true; changed(); }
  if (d.t === 'act') { if (apply(pid, d)) changed(); }
  else if (d.t === 'bye') {
    delete R.conns[pid];
    if (G.phase === 'lobby') delete G.players[pid]; else p.on = false;
    if (G.claim === pid) G.claim = null;
    changed();
    later(() => conn.close(), 200);
  }
}
function kick(pid) {
  if (!G.players[pid] || pid === G.host) return false;
  const c = R.conns[pid];
  if (c) {
    try { c.send({ t: 'kicked' }); } catch (e) { /* niente */ }
    later(() => c.close(), 400);
    delete R.conns[pid];
  }
  delete G.players[pid];
  R.banned.add(pid);
  if (G.claim === pid) G.claim = null;
  return true;
}
function broadcast() {
  if (R.role !== 'host' || !G) return;
  R.lastBeat = now();
  Object.keys(R.conns).forEach(pid => {
    const c = R.conns[pid];
    if (!c.open || !G.players[pid]) return;
    try { c.send({ t: 'view', v: viewFor(pid) }); } catch (e) { /* niente */ }
  });
}
function hostTick() {
  const t = now();
  let dirty = false;
  Object.keys(G.players).forEach(pid => {
    if (pid === G.host) return;
    const p = G.players[pid];
    const c = R.conns[pid];
    const alive = !!(c && c.open && t - (R.seen[pid] || 0) < 15000);
    if (p.on !== alive) { p.on = alive; dirty = true; }
  });
  if (dirty) changed();
  else if (t - R.lastBeat > 4000) broadcast();
}

// ----- chi entra -----
function clientPid(code) {
  let pid = sess.get('pid:' + code);
  if (!pid) { const map = store.get('rooms', {}) || {}; pid = map[code]; }
  return typeof pid === 'string' && pid ? pid : rid(10);
}
function rememberPid(code, pid) {
  sess.set('pid:' + code, pid);
  const map = store.get('rooms', {}) || {};
  delete map[code];
  map[code] = pid;
  const keys = Object.keys(map);
  if (keys.length > 20) delete map[keys[0]];
  store.set('rooms', map);
}
function joinRoom(code) {
  stopRoom();
  Object.assign(R, freshR(), { role: 'client', code });
  R.pid = clientPid(code);
  S.screen = 'room'; S.lastView = null; S.err = '';
  setRoomQuery(code);
  wakeOn(); render();
  loadPeer().then(() => { if (R.role === 'client' && R.code === code) clientTick(); })
    .catch(() => { if (R.role === 'client') { R.err = 'Non riesco a caricare il modulo online. Controlla la connessione.'; render(); } });
}
function failJoin(msg) {
  const code = R.code;
  stopRoom();
  setRoomQuery(null);
  S.screen = 'online'; S.err = msg; S.code = code; S.joinFirst = true; S.lastView = null;
  wakeOff(); render();
}
function newClientPeer() {
  const old = R.peer;
  if (old) { try { old.destroy(); } catch (e) { /* niente */ } }
  let peer;
  try { peer = new window.Peer(peerOpts()); } catch (e) { R.peer = null; return; }
  R.peer = peer;
  peer.on('open', () => { if (peer === R.peer && !R.conn && !R.stopped) clientConnect(); });
  peer.on('error', err => {
    if (peer !== R.peer) return;
    if (err && err.type === 'peer-unavailable') {
      dropConn();
      if (!R.joined) { failJoin('Nessuna stanza con il codice ' + R.code + '. Controlla il codice o chiedi all’host di riaprirla.'); return; }
      setStatus('lost');
    } else if (R.joined) setStatus('lost');
    render();
  });
}
function clientConnect() {
  const peer = R.peer;
  if (!peer || !peer.open || R.stopped) return;
  dropConn();
  let conn;
  try { conn = peer.connect(PREFIX + R.code, { serialization: 'json', reliable: true }); } catch (e) { return; }
  if (!conn) return;
  R.conn = conn;
  R.connAt = now();
  conn.on('open', () => {
    if (conn !== R.conn) { try { conn.close(); } catch (e) { /* niente */ } return; }
    R.lastMsg = now(); R.lastPing = now();
    sendHost({ t: 'hello', pid: R.pid, name: prefs.name || 'Giocatore' });
  });
  conn.on('data', d => { if (conn === R.conn) onHostMsg(d); });
  conn.on('close', () => {
    if (conn !== R.conn) return;
    R.conn = null;
    if (R.joined) setStatus('lost');
    R.nextTry = now() + backoff();
    render();
  });
  conn.on('error', () => { if (conn === R.conn) { dropConn(); if (R.joined) setStatus('lost'); render(); } });
}
function dropConn() { const c = R.conn; R.conn = null; if (c) { try { c.close(); } catch (e) { /* niente */ } } }
function sendHost(m) {
  const c = R.conn;
  if (c && c.open) { try { c.send(m); return true; } catch (e) { /* niente */ } }
  if (m.t === 'act') toast('Non sei collegato all’host in questo momento.');
  return false;
}
function clientTick() {
  if (R.role !== 'client' || R.stopped || !window.Peer) return;
  const t = now();
  const c = R.conn;
  if (c) {
    if (c.open) {
      if (t - R.lastMsg > 12000) { dropConn(); setStatus('lost'); render(); }
      else if (t - R.lastPing >= 4000) { R.lastPing = t; sendHost({ t: 'ping' }); }
      return;
    }
    if (t - R.connAt > 15000) { dropConn(); if (!R.joined && !R.slow) { R.slow = true; render(); } }
    return;
  }
  if (t < R.nextTry) return;
  R.nextTry = t + backoff();
  const p = R.peer;
  if (!p || p.destroyed) newClientPeer();
  else if (p.disconnected) { try { p.reconnect(); } catch (e) { newClientPeer(); } }
  else if (p.open) clientConnect();
}
function onHostMsg(d) {
  R.lastMsg = now();
  if (!d || typeof d !== 'object') return;
  if (d.t === 'welcome') {
    if (typeof d.pid === 'string' && d.pid) R.pid = d.pid;
    rememberPid(R.code, R.pid);
    R.joined = true; R.fail = 0; R.slow = false; R.err = '';
    setStatus('online');
    render();
  } else if (d.t === 'view' && d.v && typeof d.v === 'object') {
    R.view = d.v;
    R.viewAt = performance.now();
    setStatus('online');
    render();
  } else if (d.t === 'kicked') failJoin('L’host ti ha tolto dalla stanza.');
  else if (d.t === 'full') failJoin('Questa stanza è piena.');
  else if (d.t === 'closed') { stopRoom(); setRoomQuery(null); toast('L’host ha chiuso la stanza.'); goHome(); }
  else if (d.t === 'replaced') {
    const code = R.code;
    stopRoom();
    Object.assign(R, { role: 'client', code, stopped: true, replaced: true });
    render();
  }
}

// ---------- avvio ----------
function loop() {
  const mine = G && G.turn && G.phase === 'playing' && ((S.screen === 'game' && G.mode === 'local') || (S.screen === 'room' && R.role === 'host'));
  if (mine && remaining(G.turn) <= 0) { endTurn(); changed(); return; }
  tick();
}
function slowLoop() {
  if (S.screen !== 'room') return;
  if (R.role === 'host' && G) { hostWatch(); hostTick(); if (R.status !== 'online') render(); }
  else if (R.role === 'client') clientTick();
}
function boot() {
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
  const room = cleanCode(Q.get('room'));
  const host = store.get('host', null);
  if (room.length === 4 && host && cleanCode(host.code) === room && now() - host.t < HOST_TTL) startHost(true);
  else if (room.length === 4 && prefs.name && sess.get('pid:' + room)) joinRoom(room);
  else if (room.length === 4) { S.screen = 'online'; S.code = room; S.joinFirst = true; render(); }
  else render();
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(fitAll);
  setInterval(loop, 200);
  setInterval(slowLoop, 1000);
}
boot();
})();
