/* 꼼지일기 웹앱 — 서버 없이 동작하는 정적 PWA. 데이터는 이 기기의 브라우저(IndexedDB)에만 저장됩니다. */
(() => {
'use strict';
const PREVIEW = !!window.KK_PREVIEW; // claude.ai 미리보기: 인쇄·마이크·직접 다운로드가 막혀 있어 대체 경로를 씁니다.

// ---------- 저장소 ----------
const DB = {
  db: null,
  open() {
    return new Promise((res, rej) => {
      const r = indexedDB.open('kkomji-diary', 1);
      r.onupgradeneeded = () => { r.result.createObjectStore('diaries', { keyPath: 'id' }); r.result.createObjectStore('kv'); };
      r.onsuccess = () => { DB.db = r.result; res(); };
      r.onerror = () => rej(r.error);
    });
  },
  tx(store, mode, fn) {
    return new Promise((res, rej) => {
      const t = DB.db.transaction(store, mode); const out = fn(t.objectStore(store));
      t.oncomplete = () => res(out && out.result); t.onerror = () => rej(t.error);
    });
  },
  mem: { diaries: new Map(), kv: new Map() }, // 저장소를 못 여는 환경(사생활 보호 모드 등)에서는 메모리에만 보관
  all: () => (DB.db ? DB.tx('diaries', 'readonly', (s) => s.getAll()) : Promise.resolve([...DB.mem.diaries.values()])),
  put: (d) => (DB.db ? DB.tx('diaries', 'readwrite', (s) => s.put(d)) : Promise.resolve(DB.mem.diaries.set(d.id, d))),
  del: (id) => (DB.db ? DB.tx('diaries', 'readwrite', (s) => s.delete(id)) : Promise.resolve(DB.mem.diaries.delete(id))),
  clear: () => (DB.db ? DB.tx('diaries', 'readwrite', (s) => s.clear()) : Promise.resolve(DB.mem.diaries.clear())),
  get: (k) => (DB.db ? DB.tx('kv', 'readonly', (s) => s.get(k)) : Promise.resolve(DB.mem.kv.get(k))),
  set: (k, v) => (DB.db ? DB.tx('kv', 'readwrite', (s) => s.put(v, k)) : Promise.resolve(DB.mem.kv.set(k, v)))
};

// ---------- 상태 ----------
const S = {
  tab: 'home', view: null, lang: 'ko', child: '', entries: [], draft: null, parentOK: false,
  diaryMode: 'cal', ym: null, season: 'all', detailId: null, showOriginal: false, justDone: false,
  aiStyle: 'kid', tool: { kind: 'crayon', color: '#ED6CA6', size: 1 }, up: null, modal: null, book: null, listening: false
};
const T = (ko, en) => (S.lang === 'en' ? en : ko);
const $ = (q) => document.querySelector(q);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
const today = () => ymd(new Date());
const parse = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const DOW = { ko: ['일', '월', '화', '수', '목', '금', '토'], en: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] };
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const fmtDate = (s, lang = S.lang) => {
  const d = parse(s);
  return lang === 'en' ? `${MON[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()} (${DOW.en[d.getDay()]})` : `${d.getMonth() + 1}월 ${d.getDate()}일 (${DOW.ko[d.getDay()]})`;
};
const WEATHER = [
  { id: 'sunny', ko: '맑음', en: 'Sunny', svg: '<circle cx="20" cy="20" r="7" fill="#FFE07A"/><path d="M20 4v5M20 31v5M4 20h5M31 20h5M8.5 8.5l3.5 3.5M28 28l3.5 3.5M31.5 8.5L28 12M12 28l-3.5 3.5"/>', c: '#E9A800' },
  { id: 'cloudy', ko: '흐림', en: 'Cloudy', svg: '<path d="M12 28q-7 0-7-7 0-7 8-6 2-7 10-6 7 0 8 7 6 0 6 6 0 6-6 6Z" fill="#EEF2F5"/>', c: '#8FA3B3' },
  { id: 'rain', ko: '비', en: 'Rainy', svg: '<path d="M12 22q-6 0-6-6 0-6 7-5 2-6 9-5 6 0 7 6 6 0 6 6 0 4-6 4Z" fill="#E3F2FB"/><path d="M13 28l-2 5M20 28l-2 5M27 28l-2 5" stroke="#3168E8"/>', c: '#80C6ED' },
  { id: 'snow', ko: '눈', en: 'Snowy', svg: '<path d="M20 5v30M7 12.5l26 15M7 27.5l26-15"/>', c: '#80C6ED' },
  { id: 'wind', ko: '바람', en: 'Windy', svg: '<path d="M5 15h20a5 5 0 1 0-5-5M5 22h27a5 5 0 1 1-5 5M5 29h12"/>', c: '#75C768' }
];
const MOOD = [
  { id: 'excited', ko: '신나요', en: 'Excited', c: '#FF8768', f: '#FFE4D9', face: '<path d="M12 17q3-4 6 0M22 17q3-4 6 0" /><path d="M13 23q7 9 14 0Z" fill="#453E39"/>' },
  { id: 'happy', ko: '행복해요', en: 'Happy', c: '#FFC92B', f: '#FFF3C4', face: '<circle cx="14" cy="17" r="2" fill="#453E39"/><circle cx="26" cy="17" r="2" fill="#453E39"/><path d="M14 24q6 6 12 0"/>' },
  { id: 'ok', ko: '평범해요', en: 'Okay', c: '#75C768', f: '#E8F5E4', face: '<circle cx="14" cy="17" r="2" fill="#453E39"/><circle cx="26" cy="17" r="2" fill="#453E39"/><path d="M15 25h10"/>' },
  { id: 'sad', ko: '슬퍼요', en: 'Sad', c: '#80C6ED', f: '#E6F1FA', face: '<circle cx="14" cy="17" r="2" fill="#453E39"/><circle cx="26" cy="17" r="2" fill="#453E39"/><path d="M14 28q6-6 12 0"/>' },
  { id: 'angry', ko: '화나요', en: 'Angry', c: '#E5584A', f: '#FFE1DA', face: '<path d="M11 13l6 3M29 13l-6 3"/><circle cx="14" cy="19" r="2" fill="#453E39"/><circle cx="26" cy="19" r="2" fill="#453E39"/><path d="M14 28q6-5 12 0"/>' },
  { id: 'tired', ko: '피곤해요', en: 'Tired', c: '#A987DC', f: '#EFE7FA', face: '<path d="M12 18h6M22 18h6"/><ellipse cx="20" cy="26" rx="3" ry="2.5" fill="#453E39"/>' }
];
const wIcon = (w, n = 28) => `<svg width="${n}" height="${n}" viewBox="0 0 40 40" fill="none" stroke="${w.c}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${w.svg}</svg>`;
const mIcon = (m, n = 28) => `<svg width="${n}" height="${n}" viewBox="0 0 40 40" fill="none" stroke="#453E39" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><circle cx="20" cy="20" r="16" fill="${m.f}" stroke="${m.c}" stroke-width="3"/>${m.face}</svg>`;
const wOf = (id) => WEATHER.find((x) => x.id === id);
const mOf = (id) => MOOD.find((x) => x.id === id);
const lab = (o, lang = S.lang) => (o ? (lang === 'en' ? o.en : o.ko) : '');
const ICON = {
  back: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 6l-6 6 6 6"/></svg>',
  next: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>',
  pen: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 20l4-1 11-11-3-3L5 16z"/><path d="M14 6l3 3"/></svg>',
  mic: '<svg width="38" height="38" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg>',
  home: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 11l8-7 8 7v9h-5v-6H9v6H4z"/></svg>',
  cal: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="5" width="16" height="15" rx="2"/><path d="M4 10h16M9 3v4M15 3v4"/></svg>',
  book: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 6c-2-1.5-5-2-8-1.5V19c3-.5 6 0 8 1.5 2-1.5 5-2 8-1.5V4.5C17 4 14 4.5 12 6z"/><path d="M12 6v14.5"/></svg>',
  undo: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 14L4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/></svg>',
  redo: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 14l5-5-5-5"/><path d="M20 9H10a6 6 0 0 0 0 12h3"/></svg>',
  trash: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/></svg>',
  rotate: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 9V4h5M20 15v5h-5"/><path d="M4 4l6 6M20 20l-6-6"/></svg>',
  me: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 20c1.5-4 4.5-6 8-6s6.5 2 8 6"/></svg>'
};
const sorted = (desc = true) => S.entries.slice().sort((a, b) => (a.date === b.date ? (a.createdAt || 0) - (b.createdAt || 0) : a.date < b.date ? -1 : 1) * (desc ? -1 : 1));
const toast = (msg) => { const t = document.createElement('div'); t.className = 'toast'; t.setAttribute('role', 'status'); t.textContent = msg; document.body.appendChild(t); setTimeout(() => t.remove(), 2400); };
let saveTimer = null;
const saveDraft = () => { clearTimeout(saveTimer); saveTimer = setTimeout(() => DB.set('draft', S.draft).catch(() => toast(T('임시 저장에 실패했어요', 'Could not autosave'))), 400); };
const toBlob = (d) => { if (d instanceof Blob) return d; const [h, b64] = d.split(','), bin = atob(b64), u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return new Blob([u], { type: h.slice(5, h.indexOf(';')) }); };
async function saveFile(filename, data) {
  const blob = toBlob(data);
  if (!PREVIEW) { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = filename; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 5000); return; }
  const dl = window.claude && window.claude.use ? await window.claude.use('downloads') : null;
  if (!dl) return toast(T('이 화면에서는 파일을 저장할 수 없어요', 'Saving files is not available here'));
  try { await dl.save({ filename, data: blob }); } catch (e) { if (!e || e.code !== 'declined') toast(T('파일을 저장하지 못했어요', 'Could not save the file')); }
}
const tier = (p) => (p >= 1 ? 30 : p >= 0.9 ? 20 : p >= 0.8 ? 10 : 0);

// ---------- 그림책 마크업 (미리보기와 인쇄가 같은 마크업을 사용) ----------
const LAYOUTS = [
  { id: 'classic', ko: '클래식', en: 'Classic' }, { id: 'gallery', ko: '갤러리', en: 'Gallery' },
  { id: 'notebook', ko: '그림일기장', en: 'Notebook' }, { id: 'side', ko: '나란히', en: 'Side by side' }, { id: 'frame', ko: '액자', en: 'Frame' }
];
const COVERS = [
  { id: 'gallery', ko: '갤러리', en: 'Gallery' }, { id: 'minimal', ko: '미니멀', en: 'Minimal' },
  { id: 'seasonal', ko: '시즌', en: 'Seasonal' }, { id: 'frame', ko: '액자', en: 'Frame' }, { id: 'big', ko: '큰 제목', en: 'Big title' }
];
function pageHTML(e, layout, no, o) {
  const L = o.lang, w = wOf(e.weather), m = mOf(e.mood);
  const note = o.notes && e.note && e.noteInBook !== false ? e.note : '';
  const nl = L === 'en' ? "PARENT'S NOTE" : '부모님 코멘트';
  const date = fmtDate(e.date, L);
  const story = e.textSource === 'handwriting' && e.handwriting ? `<img src="${e.handwriting}" alt="">` : esc(e.text);
  const art = `<div class="art"><img src="${e.drawing}" alt=""></div>`;
  const metaIcons = `<span>${date}</span>${w ? `<i></i><span style="display:flex;align-items:center;gap:6px">${wIcon(w, 20)}${lab(w, L)}</span>` : ''}${m ? `<i></i><span style="display:flex;align-items:center;gap:6px">${mIcon(m, 20)}${lab(m, L)}</span>` : ''}`;
  const m2 = [date, lab(w, L), lab(m, L)].filter(Boolean).join(' · ');
  let body = '';
  if (layout === 'gallery') body = `${art}<div class="hd"><h2 class="ttl">${esc(e.title)}</h2><span class="m2">${m2}</span></div><p class="story">${story}</p><span class="sp"></span>${note ? `<p class="note"><span class="lbl">${nl}</span>${esc(note)}</p>` : ''}`;
  else if (layout === 'notebook') body = `<div class="hd"><span>${date}</span><span><small>${L === 'en' ? 'Weather' : '날씨'}</small>${lab(w, L)}</span><span><small>${L === 'en' ? 'Mood' : '기분'}</small>${lab(m, L)}</span></div><div class="tr"><span class="lbl">${L === 'en' ? 'Title' : '제목'}</span><h2 class="ttl">${esc(e.title)}</h2></div>${art}<p class="story">${story}</p>${note ? `<div class="nb"><span class="lbl">${nl}</span><p class="note">${esc(note)}</p></div>` : ''}`;
  else if (layout === 'side') body = `<div class="meta"><span>${date}</span><span>${[lab(w, L), lab(m, L)].filter(Boolean).join(' · ')}</span></div><div class="cols">${art}<div class="rt"><h2 class="ttl">${esc(e.title)}</h2><p class="story">${story}</p><span class="sp"></span>${note ? `<div class="nb"><span class="lbl">${nl}</span><p class="note">${esc(note)}</p></div>` : ''}</div></div>`;
  else if (layout === 'frame') body = `${art}<h2 class="ttl">${esc(e.title)}</h2><span class="m2">${m2}</span><p class="story">${story}</p><span class="sp"></span>${note ? `<span class="rule"></span><p class="note">${esc(note)}</p>` : ''}`;
  else body = `<div class="meta">${metaIcons}</div><h2 class="ttl">${esc(e.title)}</h2>${art}<p class="story">${story}</p><span class="sp"></span>${note ? `<div class="nb"><span class="lbl">${nl}</span><p class="note">${esc(note)}</p></div>` : ''}`;
  return `<section class="pg l-${layout}${note ? '' : ' nonote'}"><div class="safe">${body}</div><div class="no">${no}</div></section>`;
}
function coverHTML(b) {
  const img = (S.entries.find((e) => e.id === b.coverId) || {}).drawing || 'assets/drawing-flowers-cover.png';
  const t = esc(b.title), i = `<img src="${img}" alt="">`;
  let body;
  if (b.cover === 'seasonal') body = `<div class="top"><span>${esc(b.seasonLabel || '')}</span><span>${esc(b.year || '')}</span></div>${i}<h1>${t}</h1>`;
  else if (b.cover === 'frame') body = `<div class="mat">${i}</div><h1>${t}</h1>`;
  else if (b.cover === 'big') body = `<h1>${t}</h1>${i}`;
  else body = `${i}<h1>${t}</h1>`;
  return `<section class="pg cover c-${b.cover}"><div class="safe">${body}</div></section>`;
}
const backHTML = () => `<section class="pg cover back"><div class="safe"><span>Kkomji Diary</span></div></section>`;

const STYLES = [
  { id: 'kid', ko: '꼬마 화가', en: 'Little Artist', dko: '아이가 크레용으로 그린 듯', den: 'Like a child drew it in crayon' },
  { id: 'round', ko: '동글동글', en: 'Roly-Poly', dko: '둥글둥글 귀여운 표정', den: 'Rounded shapes and cute faces' },
  { id: 'storybook', ko: '포근한 그림책', en: 'Cozy Storybook', dko: '차분한 색의 그림책 느낌', den: 'Calm colors, like a picture book' },
  { id: 'doodle', ko: '쓱쓱 낙서', en: 'Quick Doodle', dko: '펜으로 쓱쓱 그린 선 그림', den: 'Loose pen-line drawing' }
];

// ---------- 공통 조각 ----------
const steps = (n) => { const L = [T('그림', 'Draw'), T('이야기', 'Story'), T('정보', 'Info'), T('완성', 'Done')]; return `<div class="steps" aria-label="${T('진행 단계', 'Progress')} ${n}/4">${L.map((x, i) => `<div class="${i + 1 < n ? 'done' : i + 1 === n ? 'on' : ''}">${x}${i + 1 < n ? ' ✓' : ''}</div>`).join('')}</div>`; };
const top = (title, back, right = '<span style="width:44px"></span>') => `<div class="topbar"><button class="iconbtn" data-a="${back}" aria-label="${T('뒤로', 'Back')}">${ICON.back}</button><div class="t">${title}</div>${right}</div>`;
const tabbar = () => `<nav class="tabbar" aria-label="${T('주요 메뉴', 'Main menu')}">${[['home', T('홈', 'Home'), ICON.home], ['diary', T('일기장', 'Diary'), ICON.cal], ['book', T('그림책', 'Art Book'), ICON.book], ['me', T('내 정보', 'Me'), ICON.me]].map(([id, l, ic]) => `<button data-a="tab" data-v="${id}" class="${S.tab === id ? 'on' : ''}"${S.tab === id ? ' aria-current="page"' : ''}>${ic}${l}</button>`).join('')}</nav>`;
const card = (e) => `<button class="entry-card" data-a="open" data-v="${e.id}"><img class="thumb" src="${e.drawing}" alt=""><div class="meta"><div class="ttl">${esc(e.title)}</div><div class="mute" style="font-size:12px">${fmtDate(e.date)}</div></div></button>`;
const sheet = (e, orig) => { const w = wOf(e.weather), m = mOf(e.mood); return `<article class="sheet"><div class="meta"><b style="color:var(--ink)">${fmtDate(e.date)}</b>${w ? `<span>${lab(w)}</span>` : ''}${m ? `<span>${lab(m)}</span>` : ''}</div><h3>${esc(e.title)}</h3><img class="draw" src="${orig && e.drawingOriginal ? e.drawingOriginal : e.drawing}" alt="${T('아이 그림', "Child's drawing")}">${e.handwriting ? `<img src="${e.handwriting}" alt="${T('아이 손글씨', 'Handwriting')}" style="width:100%">` : ''}${e.text ? `<p class="txt">${esc(e.text)}</p>` : ''}${e.note ? `<div class="note"><b>${T('부모님 코멘트', "Parent's Note")}</b>${esc(e.note)}</div>` : ''}</article>`; };

// ---------- 화면 ----------
const V = {};
V.home = () => {
  const rec = sorted().slice(0, 2), now = new Date(), ymKey = ymd(now).slice(0, 7);
  const days = new Set(S.entries.filter((e) => e.date.startsWith(ymKey)).map((e) => e.date)).size;
  const total = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  return `<main>
  <div class="row between" style="min-height:52px"><img src="assets/logo-ko.png" alt="${T('꼼지일기', 'Kkomji Diary')}" style="height:44px"><button class="chip" data-a="tab" data-v="me">${esc(S.child || T('내 프로필', 'Profile'))}</button></div>
  <div class="row" style="gap:6px"><img src="assets/mascot.png" alt="" style="width:140px;height:120px;object-fit:contain"><h1 class="title" style="font-size:31px">${T('오늘 너의 마음엔<br>어떤 그림이<br>피었니?', 'What bloomed<br>in your heart<br>today?')}</h1></div>
  <button class="btn big" data-a="write">${ICON.pen}${T('오늘의 그림일기 쓰기', "Write Today's Diary")}</button>
  ${S.draft ? `<button class="list-row" data-a="resume" style="border-style:dashed;text-align:left"><span class="grow col" style="gap:2px"><b style="font-size:15px">${T('쓰던 일기 이어서 하기', 'Continue your draft')}</b><span class="mute" style="font-size:12px">${T('자동으로 저장해 뒀어요', 'Saved automatically')}</span></span>${ICON.next}</button>` : ''}
  <div class="banner"><span class="grow col" style="gap:2px"><b style="font-size:15px">${T(`이번 달 ${days}일 썼어요`, `${days} days this month`)} <span class="mute">/ ${total}</span></b><span style="font-size:12px;color:var(--sub)">${T('빠짐없이 쓰면 그림책 최대 30% 할인', 'Write every day for up to 30% off your book')}</span></span><div style="width:64px;height:8px;border-radius:4px;background:#fff;overflow:hidden"><div style="height:100%;width:${Math.round((days / total) * 100)}%;background:var(--green)"></div></div></div>
  <div class="row between" style="margin-top:4px"><h2 class="title" style="font-size:24px">${T('최근 그림일기', 'Recent diaries')}</h2><button class="btn text" data-a="tab" data-v="diary">${T('전체보기', 'See all')}</button></div>
  ${rec.length ? `<div class="grid2">${rec.map(card).join('')}</div>` : `<p class="mute card" style="padding:20px;text-align:center;line-height:1.6">${T('아직 그림일기가 없어요.<br>첫 번째 이야기를 그려 볼까요?', 'No diaries yet.<br>Shall we draw the first story?')}</p>`}
  <button class="list-row" data-a="tab" data-v="book" style="background:#FFF6D6;border-color:#FFE9A3;text-align:left"><span class="grow col" style="gap:2px"><b style="font-size:15px">${T(`내 그림일기 ${S.entries.length}편`, `${S.entries.length} diaries`)}</b><span style="font-size:12px;color:var(--sub)">${T('모아서 그림책으로 만들어요', 'Turn them into an art book')}</span></span>${ICON.next}</button>
  </main>${tabbar()}`;
};
V.write = () => {
  const d = S.draft, s = d.step;
  if (s === 'method') return `<main>${top(T('그림일기 쓰기', 'Write a Diary'), 'closeWrite')}${steps(1)}
    <h1 class="title" style="font-size:32px;margin-top:8px">${T('그림을 어떻게<br>준비할까?', 'How will you<br>make your picture?')}</h1>
    <button class="card grow col" data-a="goDraw" style="border:2px solid var(--cobalt);border-radius:28px;padding:22px;text-align:left;justify-content:flex-end;min-height:170px;background:#fff"><span class="title">${T('직접 그릴래!', 'Draw My Picture')}</span><span style="font-size:14px;color:var(--sub)">${T('크레용 · 색연필 · 사인펜으로 화면에 그려요', 'Crayon, pencil and marker on screen')}</span></button>
    <div class="card grow col" style="border:2px solid var(--line);border-radius:28px;padding:22px;justify-content:flex-end;min-height:170px"><span class="title">${T('그림을 올릴래!', 'Upload My Drawing')}</span><span style="font-size:14px;color:var(--sub)">${T('종이에 그린 그림을 찍거나 앨범에서 골라요', 'Snap a paper drawing or pick from your album')}</span>
      <div class="grid2" style="gap:8px;margin-top:6px"><label class="btn dark" style="height:48px;font-size:15px">${T('사진 찍기', 'Camera')}<input type="file" accept="image/*" capture="environment" data-f="pick" hidden></label><label class="btn ghost">${T('앨범에서', 'Album')}<input type="file" accept="image/*" data-f="pick" hidden></label></div></div>
    <button class="list-row" data-a="goAi" style="background:#FFF6D6;border-color:#FFE9A3;text-align:left;padding:14px 16px"><img src="assets/mascot.png" alt="" style="width:52px;height:44px;object-fit:contain"><span class="grow col" style="gap:2px"><b class="hand" style="font-size:22px">${T('오늘은 꼼지가 그려줄게', 'Kkomji will draw today')}</b><span style="font-size:12px;color:var(--sub)">${T('그리기 싫은 날엔 이야기만 들려줘요', 'On days you’d rather just tell the story')}</span></span>${ICON.next}</button>
    <p class="mute" style="text-align:center;font-size:12px">${T('올린 그림의 원본은 바꾸지 않고 따로 보관해요', 'Your original picture is kept untouched')}</p></main>`;
  if (s === 'ai') return `<main>${top(T('꼼지가 그려줄게', 'Kkomji will draw'), 'toMethod')}${steps(1)}
    <h1 class="title" style="font-size:30px">${T('어떤 그림으로<br>그려 줄까?', 'Which style<br>would you like?')}</h1>
    <div class="grid2" role="radiogroup" aria-label="${T('그림체', 'Drawing style')}">${STYLES.map((x) => `<button class="entry-card" role="radio" aria-checked="${S.aiStyle === x.id}" data-a="aiStyle" data-v="${x.id}" style="${S.aiStyle === x.id ? 'outline:3px solid var(--cobalt);border-color:transparent' : ''}"><img class="thumb" src="assets/style-${x.id}.png" alt=""><div class="meta"><div class="ttl">${lab(x)}</div><div class="mute" style="font-size:12px">${S.lang === 'en' ? x.den : x.dko}</div></div></button>`).join('')}</div>
    <p class="banner" style="font-size:14px;line-height:1.6">${T('고른 그림체는 기억해 둘게요. 꼼지가 그려주는 기능은 “꼼지 단짝”과 함께 곧 열려요. 오늘은 직접 그리거나 그림을 올려 주세요.', 'We’ll remember your style. Drawing by Kkomji opens soon with the “Kkomji Buddy” plan. For today, please draw or upload a picture.')}</p>
    <span class="grow"></span><button class="btn" disabled>${T('준비 중이에요', 'Coming soon')}</button><button class="btn line" data-a="goDraw">${T('오늘은 직접 그릴래!', 'I’ll draw it myself today')}</button></main>`;
  if (s === 'draw') {
    const C = ['#E5413A', '#ED6CA6', '#FF8768', '#FFC92B', '#75C768', '#80C6ED', '#3168E8', '#A987DC', '#9A6B4F', '#453E39'], t = S.tool, L = S.land;
    const tools = [['crayon', T('크레용', 'Crayon')], ['pencil', T('색연필', 'Pencil')], ['marker', T('사인펜', 'Marker')], ['eraser', T('지우개', 'Eraser')]].map(([k, l]) => `<button class="tool ${t.kind === k ? 'on' : ''}" data-a="tool" data-v="${k}" aria-pressed="${t.kind === k}">${l}</button>`).join('');
    const colors = C.map((c) => `<button class="sw ${t.color === c && t.kind !== 'eraser' ? 'on' : ''}" data-a="color" data-v="${c}" style="background:${c}" aria-label="${c}"></button>`).join('');
    const sizes = [10, 16, 24].map((n, i) => `<button class="sizebtn ${t.size === i ? 'on' : ''}" data-a="size" data-v="${i}" aria-label="${T('굵기', 'Size')} ${i + 1}"><i style="width:${n}px;height:${n}px"></i></button>`).join('');
    const hist = `<button class="iconbtn sq" data-a="undo" aria-label="${T('되돌리기', 'Undo')}">${ICON.undo}</button><button class="iconbtn sq" data-a="redo" aria-label="${T('다시 실행', 'Redo')}">${ICON.redo}</button><button class="iconbtn sq" data-a="askClear" aria-label="${T('전체 지우기', 'Clear all')}">${ICON.trash}</button>`;
    const cvs = `<canvas id="draw" class="paper" width="1600" height="1200" aria-label="${T('도화지', 'Canvas')}"></canvas>`;
    if (L) return `<div class="land"><div class="land-in ${L}" id="landin">
      <div class="lcol"><button class="tool" data-a="landOff" style="font-weight:700">${T('작게', 'Exit')}</button>${tools}<span class="grow"></span><div class="lsizes">${sizes}</div></div>
      <div class="lcv" id="lcv">${cvs}</div>
      <div class="lcol"><div class="lcolors">${colors}</div><span class="grow"></span><div class="lhist">${hist}</div><button class="btn" data-a="drawNext" style="height:48px;padding:0;font-size:15px">${T('다음', 'Next')}</button></div>
    </div></div>`;
    return `<main style="background:var(--paper);gap:10px;padding-block:10px 16px">${top(T('직접 그리기', 'Draw'), 'toMethod', `<button class="btn" data-a="drawNext" style="height:44px;padding:0 18px;font-size:15px">${T('다음', 'Next')}</button>`)}
    ${cvs}
    <button class="btn dark" data-a="land" style="height:48px;font-size:15px">${ICON.rotate}${T('화면 가득 크게 그리기', 'Draw full screen')}</button>
    <div class="tools card" style="padding:12px">
      <div class="trow">${tools}</div>
      <div class="swgrid">${colors}</div>
      <div class="trow" style="flex-wrap:nowrap">${sizes}<span class="grow"></span>${hist}</div>
    </div></main>`;
  }
  if (s === 'upload') return `<main>${top(T('그림 올리기', 'Upload'), 'toMethod', `<button class="btn" data-a="upNext" style="height:44px;padding:0 18px;font-size:15px">${T('다음', 'Next')}</button>`)}${steps(1)}
    <div class="canvas-wrap"><canvas id="upv" class="paper" style="cursor:default;max-height:46vh;width:auto;max-width:100%"></canvas></div>
    <div class="card col" style="padding:16px;gap:14px">
      <div class="row"><button class="btn ghost grow" data-a="rot">${T('90° 돌리기', 'Rotate 90°')}</button><button class="btn ghost grow" data-a="upReset">${T('원본으로', 'Reset')}</button></div>
      <label class="row" style="font-size:14px;font-weight:600">${T('밝기', 'Brightness')}<input type="range" min="60" max="150" value="${S.up.br}" data-r="br" class="grow" style="accent-color:var(--cobalt)"></label>
      <label class="row" style="font-size:14px;font-weight:600">${T('대비', 'Contrast')}<input type="range" min="60" max="160" value="${S.up.ct}" data-r="ct" class="grow" style="accent-color:var(--cobalt)"></label>
      <p class="mute" style="font-size:12px">${T('보정은 선택이에요. 찍은 원본은 그대로 따로 저장돼요.', 'Adjusting is optional. The original is always kept.')}</p>
    </div></main>`;
  if (s === 'story') {
    const tab = d.storyTab || 'voice', SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    return `<main>${top(T('그림일기 쓰기', 'Write a Diary'), 'toPicture')}${steps(2)}
    <div class="seg" role="tablist">${[['voice', T('말로 쓰기', 'Speak')], ['type', T('타이핑하기', 'Type')], ['hand', T('손글씨 쓰기', 'Write by Hand')]].map(([k, l]) => `<button role="tab" aria-selected="${tab === k}" class="${tab === k ? 'on' : ''}" data-a="storyTab" data-v="${k}">${l}</button>`).join('')}</div>
    <div class="row"><img src="${d.drawing}" alt="" style="width:92px;height:58px;object-fit:cover;border-radius:10px;border:1px solid var(--line)"><h2 class="title" style="font-size:22px">${T('그림 속 이야기를<br>들려줄래?', 'Tell me the story<br>in your picture')}</h2></div>
    ${tab === 'hand' ? `<div class="canvas-wrap"><canvas id="hand" class="paper" width="1600" height="700" aria-label="${T('손글씨 쓰는 곳', 'Handwriting area')}"></canvas></div><div class="row"><button class="btn ghost grow" data-a="handClear">${T('다시 쓰기', 'Clear')}</button></div><p class="mute" style="font-size:12px">${T('쓴 글씨는 서체로 바꾸지 않고 그대로 그림책에 실려요.', 'Your handwriting goes into the book exactly as written.')}</p>`
      : `<label class="field grow"><span class="row between"><span>${tab === 'voice' ? T('들은 이야기', 'What I heard') : T('이야기', 'Story')}</span><span class="mute" style="font-weight:400;font-size:12px">${T('고칠 수 있어요', 'You can edit this')}</span></span><textarea id="story" class="hand" data-m="text" style="flex:1;min-height:150px;font-size:24px" placeholder="${tab === 'voice' ? T('마이크를 누르고 이야기해 주세요', 'Tap the mic and tell your story') : T('오늘 있었던 일을 써 보세요', 'Write about your day')}">${esc(d.text)}</textarea></label>`}
    ${tab === 'voice' ? (PREVIEW ? `<p class="banner" style="font-size:14px;line-height:1.6">${T('이 미리보기 화면에서는 마이크를 쓸 수 없어요. 여기서는 타이핑이나 손글씨로 써 보고, 말로 쓰기는 GitHub에 올린 주소에서 확인해 주세요.', 'The microphone is blocked in this preview. Type or handwrite here; speaking works on the hosted site.')}</p>` : SR ? `<div class="col" style="align-items:center;gap:14px;padding:10px 0"><button class="mic ${S.listening ? '' : 'idle'}" data-a="mic" aria-label="${S.listening ? T('녹음 멈추기', 'Stop') : T('말하기 시작', 'Start speaking')}">${ICON.mic}</button><b style="font-size:14px;margin-top:8px">${S.listening ? T('듣고 있어요…', 'Listening…') : T('마이크를 눌러 주세요', 'Tap the mic')}</b></div>` : `<p class="banner" style="font-size:14px;line-height:1.6">${T('이 브라우저는 음성 인식을 지원하지 않아요. Chrome이나 Safari에서 열거나, 타이핑으로 써 주세요.', 'Speech recognition is not supported in this browser. Try Chrome or Safari, or type instead.')}</p>`) : ''}
    <button class="btn" data-a="storyNext">${T('다 했어!', "I'm done!")}</button></main>`;
  }
  if (s === 'info') return `<main>${top(T('그림일기 쓰기', 'Write a Diary'), 'toStory')}${steps(3)}
    <label class="field">${T('날짜', 'Date')}<input type="date" data-m="date" value="${d.date}" max="${today()}"></label>
    <label class="field">${T('제목', 'Title')}<input class="hand" data-m="title" value="${esc(d.title)}" maxlength="24" style="font-size:24px;font-weight:700" placeholder="${T('오늘 일기의 제목', 'Title of today')}"></label>
    <div class="field">${T('날씨', 'Weather')} <div style="display:grid;grid-template-columns:repeat(5,1fr);gap:6px;font-weight:400">${WEATHER.map((w) => `<button class="pick ${d.weather === w.id ? 'on' : ''}" data-a="weather" data-v="${w.id}" aria-pressed="${d.weather === w.id}">${wIcon(w)}${lab(w)}</button>`).join('')}</div></div>
    <div class="field">${T('오늘의 기분', 'Mood')} <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:6px;font-weight:400">${MOOD.map((m) => `<button class="pick ${d.mood === m.id ? 'on' : ''}" data-a="mood" data-v="${m.id}" aria-pressed="${d.mood === m.id}" style="flex-direction:row;gap:6px;font-size:14px;min-height:54px">${mIcon(m)}${lab(m)}</button>`).join('')}</div></div>
    <span class="grow"></span><button class="btn" data-a="infoNext">${T('다음', 'Next')}</button></main>`;
  if (s === 'note') return `<main>${top(T('그림일기 쓰기', 'Write a Diary'), 'toInfo')}${steps(4)}
    <h1 class="title">${T('부모님 코멘트', "Parent's Note")}</h1>
    ${S.parentOK ? `<label class="field">${T('아이에게 남기는 한마디 (선택)', 'A few words for your child (optional)')}<textarea data-m="note" maxlength="150" style="height:150px;font-family:var(--book)" placeholder="${T('작은 꽃도 놓치지 않고 바라보는 네 마음이 참 예뻐.', 'I love how you notice even the smallest flowers.')}">${esc(d.note)}</textarea><span class="mute" style="font-weight:400;font-size:12px">${T('150자까지 · 이 날짜 페이지 아래쪽에 들어가요', 'Up to 150 characters · shown on this day’s page')}</span></label>
      <div class="list-row" style="padding:14px 16px"><span class="grow" style="font-size:15px;font-weight:600">${T('그림책 페이지에 함께 싣기', 'Include in the art book')}</span><button class="switch ${d.noteInBook ? 'on' : ''}" role="switch" aria-checked="${d.noteInBook}" data-a="noteInBook" aria-label="${T('그림책에 싣기', 'Include in book')}"></button></div>`
      : `<p style="font-size:16px;line-height:1.7;color:var(--sub)">${T('부모님이 응원 한마디를 남길 수 있어요. 아이 혼자 쓰고 있다면 건너뛰어도 괜찮아요.', 'A parent can leave a short note. If your child is writing alone, you can skip this.')}</p><button class="btn line" data-a="gateNote">${T('부모님 확인하고 코멘트 쓰기', 'Parent check & write a note')}</button>`}
    <span class="grow"></span><button class="btn big" data-a="finish">${T('그림일기 완성하기', 'Finish My Diary')}</button></main>`;
  return '';
};
V.detail = () => {
  const e = S.entries.find((x) => x.id === S.detailId); if (!e) { S.view = null; return V.home(); }
  return `<main>${top(S.justDone ? T('그림일기 완성!', 'Diary finished!') : fmtDate(e.date), 'closeDetail')}
    ${S.justDone ? `<div class="row"><img src="assets/mascot.png" alt="" style="width:84px"><div class="col" style="gap:0"><b class="title">${T('그림일기 완성!', 'All done!')}</b><span style="font-size:13px;color:var(--green-d)">${T('일기장에 저장했어요', 'Saved to your diary')}</span></div></div>` : ''}
    ${sheet(e, S.showOriginal)}
    <div class="grid2" style="gap:8px">
      ${e.drawingOriginal ? `<button class="btn ghost" data-a="toggleOrig">${S.showOriginal ? T('보정본 보기', 'Show adjusted') : T('원본 그림 보기', 'Show original')}</button>` : ''}
      <button class="btn ghost" data-a="download">${T('그림 저장', 'Save picture')}</button>
      <button class="btn ghost" data-a="editNote">${e.note ? T('코멘트 고치기', 'Edit note') : T('부모님 코멘트 쓰기', 'Add parent note')}</button>
      <button class="btn ghost" data-a="askDelete" style="color:#B23A3A">${T('일기 삭제', 'Delete')}</button>
    </div>
    <span class="grow"></span><button class="btn dark" data-a="closeDetail">${S.justDone ? T('홈으로', 'Home') : T('닫기', 'Close')}</button></main>`;
};
V.diary = () => {
  const cal = S.diaryMode === 'cal';
  let body;
  if (cal) {
    const [y, m] = S.ym.split('-').map(Number), first = new Date(y, m - 1, 1).getDay(), n = new Date(y, m, 0).getDate();
    const by = {}; S.entries.forEach((e) => { if (e.date.startsWith(S.ym)) by[Number(e.date.slice(8))] = e; });
    const cells = [];
    for (let i = 0; i < first; i++) cells.push('<span></span>');
    for (let d = 1; d <= n; d++) cells.push(by[d] ? `<button class="d has" data-a="open" data-v="${by[d].id}" aria-label="${d} ${esc(by[d].title)}"><img src="${by[d].drawing}" alt=""><span>${d}</span></button>` : `<span class="d">${d}</span>`);
    body = `<div class="row between"><button class="iconbtn" data-a="ym" data-v="-1" aria-label="${T('이전 달', 'Previous month')}">${ICON.back}</button><div class="col" style="align-items:center;gap:0"><b style="font-size:18px">${T(`${y}년 ${m}월`, `${MON[m - 1]} ${y}`)}</b><span class="mute" style="font-size:12px">${T(`이번 달 ${Object.keys(by).length}편`, `${Object.keys(by).length} this month`)}</span></div><button class="iconbtn" data-a="ym" data-v="1" aria-label="${T('다음 달', 'Next month')}">${ICON.next}</button></div>
      <div class="cal">${DOW[S.lang === 'en' ? 'en' : 'ko'].map((x) => `<span class="w">${x}</span>`).join('')}</div><div class="cal">${cells.join('')}</div>`;
  } else {
    const SE = [['all', T('전체', 'All')], ['spring', T('봄', 'Spring')], ['summer', T('여름', 'Summer')], ['fall', T('가을', 'Fall')], ['winter', T('겨울', 'Winter')]];
    const inS = (e) => { const mo = Number(e.date.slice(5, 7)); return S.season === 'all' || { spring: [3, 4, 5], summer: [6, 7, 8], fall: [9, 10, 11], winter: [12, 1, 2] }[S.season].includes(mo); };
    const list = sorted().filter(inS);
    body = `<div class="opts" style="gap:6px;padding:0">${SE.map(([k, l]) => `<button class="chip ${S.season === k ? 'on' : ''}" data-a="season" data-v="${k}">${l}</button>`).join('')}</div>${list.length ? `<div class="grid2">${list.map(card).join('')}</div>` : `<p class="mute" style="text-align:center;padding:30px 0">${T('여기엔 아직 일기가 없어요', 'Nothing here yet')}</p>`}`;
  }
  return `<main><h1 class="title">${esc(S.child ? T(`${S.child}의 일기장`, `${S.child}'s Diary`) : T('나의 일기장', 'My Diary'))}</h1>
    <div class="seg" role="tablist"><button role="tab" aria-selected="${cal}" class="${cal ? 'on' : ''}" data-a="dmode" data-v="cal">${T('달력', 'Calendar')}</button><button role="tab" aria-selected="${!cal}" class="${cal ? '' : 'on'}" data-a="dmode" data-v="gal">${T('갤러리', 'Gallery')}</button></div>${body}</main>${tabbar()}`;
};
const bookEntries = () => { const b = S.book; return sorted(false).filter((e) => b.sel.has(e.id)); };
V.book = () => {
  const b = S.book;
  if (!S.entries.length) return `<main><h1 class="title">${T('나의 그림책', 'My Art Book')}</h1><p class="card mute" style="padding:24px;text-align:center;line-height:1.7">${T('그림일기가 모이면 여기서 그림책을 만들 수 있어요.', 'Once you have some diaries, you can make a book here.')}</p><button class="btn" data-a="write">${T('오늘의 그림일기 쓰기', "Write Today's Diary")}</button></main>${tabbar()}`;
  const hd = (n, title) => `${top(T('그림책 만들기', 'Create My Book'), n === 1 ? 'bookHome' : 'bookPrev')}<div class="steps">${[T('일기 선택', 'Diaries'), T('표지', 'Cover'), T('페이지', 'Pages'), T('미리보기', 'Preview')].map((x, i) => `<div class="${i + 1 < n ? 'done' : i + 1 === n ? 'on' : ''}">${x}</div>`).join('')}</div><h1 class="title" style="font-size:26px">${title}</h1>`;
  const en = bookEntries();
  if (b.step === 1) {
    const inRange = sorted(false).filter((e) => e.date >= b.from && e.date <= b.to);
    const totalDays = Math.round((parse(b.to) - parse(b.from)) / 864e5) + 1, wrote = new Set(inRange.map((e) => e.date)).size, p = totalDays > 0 ? wrote / totalDays : 0, off = totalDays >= 30 ? tier(p) : 0;
    return `<main>${hd(1, T('책에 담을 일기를 골라요', 'Choose diaries for your book'))}
      <div class="grid2"><label class="field">${T('시작', 'From')}<input type="date" data-b="from" value="${b.from}"></label><label class="field">${T('끝', 'To')}<input type="date" data-b="to" value="${b.to}"></label></div>
      <div class="banner"><span class="grow col" style="gap:2px"><b style="font-size:15px">${T(`출석 ${wrote}일 / ${totalDays}일 (${Math.round(p * 100)}%)`, `${wrote} of ${totalDays} days (${Math.round(p * 100)}%)`)}</b><span style="font-size:12px;color:var(--sub)">${totalDays < 30 ? T('30일 이상 기간부터 출석 할인이 적용돼요', 'Attendance discount applies to periods of 30+ days') : off ? T(`출석 완주 할인 ${off}% 대상이에요`, `You qualify for ${off}% off`) : T('80% 이상 쓰면 10%, 90%는 20%, 완주는 30% 할인', '10% off at 80%, 20% at 90%, 30% for every day')}</span></span>${off ? `<b class="hand" style="font-size:30px;color:var(--cobalt-d)">${off}%</b>` : ''}</div>
      <div class="row between"><b style="font-size:14px">${T(`${inRange.length}편 중 ${en.length}편 선택`, `${en.length} of ${inRange.length} selected`)}</b><button class="btn text" data-a="selAll">${en.length === inRange.length ? T('모두 해제', 'Clear all') : T('모두 선택', 'Select all')}</button></div>
      <div class="col" style="gap:8px">${inRange.map((e) => `<label class="list-row"><input type="checkbox" data-c="${e.id}" ${b.sel.has(e.id) ? 'checked' : ''}><img src="${e.drawing}" alt=""><span class="col grow" style="gap:0;min-width:0"><b class="hand" style="font-size:18px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(e.title)}</b><span class="mute" style="font-size:12px">${fmtDate(e.date)}</span></span></label>`).join('') || `<p class="mute" style="text-align:center;padding:20px">${T('이 기간에는 일기가 없어요', 'No diaries in this period')}</p>`}</div>
      <p class="mute" style="font-size:12px">${T(`표지 + ${en.length}페이지 · 하루 한 페이지. 실물 인쇄는 보통 24페이지부터 가능해요.`, `Cover + ${en.length} pages · one day per page. Printing usually needs 24+ pages.`)}</p>
      <button class="btn" data-a="bookNext" ${en.length ? '' : 'disabled'}>${T('표지 만들기', 'Design the cover')}</button></main>`;
  }
  if (b.step === 2) return `<main>${hd(2, T('표지를 만들어요', 'Design the cover'))}
      <div class="spread-wrap"><div class="spread" style="--z:.36">${coverHTML(b)}</div></div>
      <label class="field">${T('제목', 'Title')}<input class="hand" data-b="title" value="${esc(b.title)}" maxlength="30" style="font-size:22px;font-weight:700"></label>
      <div class="field">${T('표지 디자인', 'Cover design')}<div class="opts">${COVERS.map((c) => `<button class="opt ${b.cover === c.id ? 'on' : ''}" data-a="cover" data-v="${c.id}" aria-pressed="${b.cover === c.id}"><span class="pv">${coverHTML({ ...b, cover: c.id })}</span><b>${lab(c)}</b></button>`).join('')}</div></div>
      <div class="field">${T('대표 그림', 'Cover picture')}<div class="opts" style="gap:8px">${en.map((e) => `<button data-a="coverPic" data-v="${e.id}" aria-label="${esc(e.title)}" aria-pressed="${b.coverId === e.id}" style="flex:none;width:72px;height:54px;padding:0;border-radius:10px;overflow:hidden;background:#fff;border:${b.coverId === e.id ? '3px solid var(--cobalt)' : '1px solid var(--line)'}"><img src="${e.drawing}" alt="" style="width:100%;height:100%;object-fit:cover"></button>`).join('')}</div></div>
      <button class="btn" data-a="bookNext">${T('페이지 디자인 고르기', 'Choose page design')}</button></main>`;
  const o = { lang: b.lang, notes: b.notes };
  if (b.step === 3) return `<main>${hd(3, T('페이지 디자인을 골라요', 'Choose a page design'))}
      <div class="spread-wrap"><div class="spread" style="--z:.36">${pageHTML(en[0], b.layout, 1, o)}</div></div>
      <div class="field">${T('내지 레이아웃', 'Page layout')}<div class="opts">${LAYOUTS.map((l) => `<button class="opt ${b.layout === l.id ? 'on' : ''}" data-a="layout" data-v="${l.id}" aria-pressed="${b.layout === l.id}"><span class="pv">${pageHTML(en[0], l.id, 1, o)}</span><b>${lab(l)}</b></button>`).join('')}</div></div>
      <div class="list-row" style="padding:14px 16px"><span class="grow" style="font-size:15px;font-weight:600">${T('부모님 코멘트 넣기', "Include parent's notes")}</span><button class="switch ${b.notes ? 'on' : ''}" role="switch" aria-checked="${b.notes}" data-a="bnotes" aria-label="${T('부모님 코멘트 넣기', 'Include notes')}"></button></div>
      <div class="field">${T('책 언어 (날짜·날씨 표기)', 'Book language (dates & labels)')}<div class="seg"><button class="${b.lang === 'ko' ? 'on' : ''}" data-a="blang" data-v="ko">한국어</button><button class="${b.lang === 'en' ? 'on' : ''}" data-a="blang" data-v="en">English</button></div></div>
      <button class="btn" data-a="bookNext">${T('책 미리보기', 'Preview the book')}</button></main>`;
  const pages = [coverHTML(b), ...en.map((e, i) => pageHTML(e, b.layout, i + 1, o)), backHTML()];
  const spreads = [[0]]; for (let i = 1; i < pages.length - 1; i += 2) spreads.push(i + 1 < pages.length - 1 ? [i, i + 1] : [i]); spreads.push([pages.length - 1]);
  b.spread = Math.min(b.spread, spreads.length - 1); const cur = spreads[b.spread];
  const label = b.spread === 0 ? T('앞표지', 'Front cover') : b.spread === spreads.length - 1 ? T('뒷표지', 'Back cover') : cur.join('–') + ' / ' + en.length;
  return `<main>${hd(4, esc(b.title))}
      <div class="spread-wrap"><div class="spread" id="spread" data-n="${cur.length}">${cur.map((i) => pages[i]).join('')}</div>
        <div class="row"><button class="iconbtn" data-a="sp" data-v="-1" style="background:#fff" aria-label="${T('이전', 'Previous')}" ${b.spread ? '' : 'disabled'}>${ICON.back}</button><b style="font-size:14px;min-width:110px;text-align:center">${label}</b><button class="iconbtn" data-a="sp" data-v="1" style="background:#fff" aria-label="${T('다음', 'Next')}" ${b.spread < spreads.length - 1 ? '' : 'disabled'}>${ICON.next}</button></div></div>
      <p class="mute" style="font-size:13px;line-height:1.6">${T('210 × 210mm 정사각 · 재단 여백 3mm 포함 · 표지 + ' + en.length + '페이지 + 뒷표지', '210 × 210mm square · 3mm bleed · cover + ' + en.length + ' pages + back')}</p>
      <button class="btn big" data-a="pdf">${T('인쇄용 PDF 만들기', 'Make print-ready PDF')}</button>
      <p class="mute" style="font-size:12px;line-height:1.6">${PREVIEW ? T('미리보기에서는 페이지를 이미지로 묶은 PDF가 저장돼요. 인쇄소용 고품질 PDF는 GitHub에 올린 주소에서 만들어 주세요.', 'This preview saves an image-based PDF. Make the print-quality PDF on the hosted site.') : T('인쇄 창이 열리면 “PDF로 저장”을 선택하세요. 여백은 “없음”, 배경 그래픽은 켜 주세요.', 'In the print dialog choose “Save as PDF”, set margins to “None” and turn on background graphics.')}</p></main>`;
};
V.me = () => `<main><h1 class="title">${T('내 정보', 'Me')}</h1>
  <label class="field">${T('아이 이름 (그림책 제목에 쓰여요)', "Child's name (used in the book title)")}<input data-k="child" value="${esc(S.child)}" maxlength="12" placeholder="${T('예: 이재', 'e.g. Ejae')}"></label>
  <div class="field">${T('언어', 'Language')}<div class="seg"><button class="${S.lang === 'ko' ? 'on' : ''}" data-a="lang" data-v="ko">한국어</button><button class="${S.lang === 'en' ? 'on' : ''}" data-a="lang" data-v="en">English</button></div></div>
  <div class="card col" style="padding:16px;gap:10px"><b>${T('부모님 영역', 'Parent area')}</b>
    <button class="btn ghost" data-a="export">${T('모든 일기 내려받기 (백업 파일)', 'Download all diaries (backup)')}</button>
    <label class="btn ghost">${T('백업 파일 불러오기', 'Restore from backup')}<input type="file" accept="application/json,.json" data-f="import" hidden></label>
    <button class="btn ghost" data-a="seed">${T('샘플 일기 5편 넣어 보기', 'Add 5 sample diaries')}</button>
    <button class="btn ghost" data-a="askWipe" style="color:#B23A3A">${T('모든 일기 삭제', 'Delete all diaries')}</button></div>
  <div class="card col" style="padding:16px;gap:6px;font-size:13px;line-height:1.7;color:var(--sub)"><b style="color:var(--ink);font-size:15px">${T('베타 버전 안내', 'About this beta')}</b>
    <span>· ${T('이 베타 버전은 회원 가입이 없고, 일기는 이 기기의 브라우저에만 저장돼요.', 'This beta has no sign-up. Diaries are stored only in this browser on this device.')}</span>
    <span>· ${T('위시버니 주식회사의 서버로 전송되거나 저장되는 일기는 없어요.', 'No diary is sent to or stored on WishBunny Inc. servers.')}</span>
    <span>· ${T('말로 쓰기를 쓰면 목소리가 브라우저 회사의 음성 인식 서비스로 전송될 수 있어요.', 'When you use Speak, your voice may be sent to the browser maker’s speech recognition service.')}</span>
    <span>· ${T('접속 기록은 호스팅 업체에 남을 수 있어요.', 'Access logs may be kept by the hosting provider.')}</span>
    <span>· ${T('브라우저 기록을 지우면 일기도 지워지니 백업 파일을 받아 두세요.', 'Clearing browser data deletes your diaries, so please download a backup.')}</span>
    <span>· ${T('AI 글 다듬기와 번역, “꼼지가 그려줄게”는 아직 준비 중이에요.', 'AI polishing, translation and “Kkomji will draw” are not available yet.')}</span></div>
  ${PREVIEW ? '' : `<a class="btn text" href="index.html">${T('꼼지일기 소개 페이지', 'About Kkomji Diary')}</a>`}</main>${tabbar()}`;

// ---------- 모달 ----------
function modalHTML() {
  const m = S.modal; if (!m) return '';
  if (m.type === 'gate') return `<div class="modal" role="dialog" aria-modal="true" aria-label="${T('부모님 확인', 'Parent check')}"><div class="box"><b class="title" style="font-size:26px">${T('부모님 확인', 'Parent check')}</b><p style="font-size:15px;color:var(--sub)">${T('부모님만 할 수 있는 일이에요. 답을 적어 주세요.', 'This is for parents. Please answer.')}</p><label class="field">${m.a} × ${m.b} = ?<input id="gate" inputmode="numeric" autocomplete="off"></label><div class="grid2"><button class="btn ghost" data-a="closeModal">${T('취소', 'Cancel')}</button><button class="btn" data-a="gateOK" style="height:48px;font-size:15px">${T('확인', 'OK')}</button></div></div></div>`;
  if (m.type === 'confirm') return `<div class="modal${S.land === 'rot' ? ' rot' : ''}" role="alertdialog" aria-modal="true"><div class="box"><b style="font-size:18px;line-height:1.5">${m.msg}</b><div class="grid2"><button class="btn ghost" data-a="closeModal">${T('취소', 'Cancel')}</button><button class="btn danger" data-a="confirmOK" style="height:48px;font-size:15px">${m.ok}</button></div></div></div>`;
  if (m.type === 'note') return `<div class="modal" role="dialog" aria-modal="true"><div class="box"><b class="title" style="font-size:26px">${T('부모님 코멘트', "Parent's Note")}</b><label class="field"><span class="mute" style="font-weight:400">${T('150자까지', 'Up to 150 characters')}</span><textarea id="noteEdit" maxlength="150" style="height:140px;font-family:var(--book)">${esc(m.val)}</textarea></label><div class="grid2"><button class="btn ghost" data-a="closeModal">${T('취소', 'Cancel')}</button><button class="btn" data-a="noteSave" style="height:48px;font-size:15px">${T('저장', 'Save')}</button></div></div></div>`;
  return '';
}
const gate = (then) => { if (S.parentOK) return then(); S.modal = { type: 'gate', a: 6 + Math.floor(Math.random() * 4), b: 6 + Math.floor(Math.random() * 4), then }; render(); const g = $('#gate'); if (g) g.focus(); };
const confirmBox = (msg, ok, then) => { S.modal = { type: 'confirm', msg, ok, then }; render(); };

// ---------- 렌더 ----------
function render() {
  stopMic(true);
  const v = S.view || S.tab;
  $('#app').innerHTML = (V[v] || V.home)() + modalHTML();
  document.documentElement.lang = S.lang;
  mount();
}
function mount() {
  const d = S.draft;
  if (S.view === 'write' && d) {
    if (d.step === 'draw') { initDraw(); fitLand(); }
    if (d.step === 'upload') drawUp(900);
    if (d.step === 'story' && d.storyTab === 'hand') initHand();
  }
  const sp = $('#spread');
  if (sp) { const n = Number(sp.dataset.n), w = Math.min($('#app').clientWidth - 60, 1000); sp.style.setProperty('--z', String(Math.min(0.62, w / (816 * n)))); }
}

// ---------- 그리기 ----------
function fitLand() {
  const box = $('#landin'); if (!box) return; const rot = S.land === 'rot', W = rot ? window.innerHeight : window.innerWidth, H = rot ? window.innerWidth : window.innerHeight;
  box.style.width = W + 'px'; box.style.height = H + 'px';
  const c = $('#draw'), h = Math.min(H - 20, ((W - 2 * 96 - 40) * 3) / 4);
  c.style.height = h + 'px'; c.style.width = (h * 4) / 3 + 'px';
}
window.addEventListener('resize', () => { if (S.land) { S.land = window.innerHeight > window.innerWidth ? 'rot' : 'full'; const b = $('#landin'); if (b) { b.className = 'land-in ' + S.land; fitLand(); } } });
let cv = null, cx = null, undoS = [], redoS = [], drawing = false, last = null;
function pos(c, e) { const r = c.getBoundingClientRect(); if (S.land === 'rot' && c.id === 'draw') return { x: ((e.clientY - r.top) / r.height) * c.width, y: ((r.right - e.clientX) / r.width) * c.height }; return { x: (e.clientX - r.left) * (c.width / r.width), y: (e.clientY - r.top) * (c.height / r.height) }; }
function stroke(a, b) {
  const t = S.tool, w = [16, 32, 56][t.size], dist = Math.hypot(b.x - a.x, b.y - a.y);
  cx.save(); cx.globalCompositeOperation = t.kind === 'eraser' ? 'destination-out' : 'source-over';
  cx.strokeStyle = t.color; cx.fillStyle = t.color; cx.lineCap = 'round'; cx.lineJoin = 'round';
  if (t.kind === 'crayon') { // 굵고 거친 왁스 질감
    const n = Math.max(1, Math.ceil(dist / 2));
    for (let i = 0; i < n; i++) { const x = a.x + ((b.x - a.x) * i) / n, y = a.y + ((b.y - a.y) * i) / n; for (let k = 0; k < 7; k++) { cx.globalAlpha = 0.2 + Math.random() * 0.32; cx.beginPath(); cx.arc(x + (Math.random() - 0.5) * w, y + (Math.random() - 0.5) * w, Math.random() * w * 0.13 + 1.2, 0, 6.283); cx.fill(); } }
  } else if (t.kind === 'pencil') { // 가는 결이 여러 겹 겹치는 색연필: 겹칠수록 진해져요
    const pw = w * 0.95, n = Math.max(1, Math.ceil(dist / 1.5)), ang = Math.atan2(b.y - a.y, b.x - a.x) + Math.PI / 2, ox = Math.cos(ang), oy = Math.sin(ang);
    for (let k = 0; k < 10; k++) { const o1 = (Math.random() + Math.random() - 1) * pw * 0.5, o2 = o1 + (Math.random() - 0.5) * pw * 0.2; cx.globalAlpha = 0.2 + Math.random() * 0.25; cx.lineWidth = 2 + Math.random() * 3.5; cx.beginPath(); cx.moveTo(a.x + ox * o1, a.y + oy * o1); cx.lineTo(b.x + ox * o2, b.y + oy * o2); cx.stroke(); }
    for (let i = 0; i < n; i++) { const x = a.x + ((b.x - a.x) * i) / n, y = a.y + ((b.y - a.y) * i) / n; for (let k = 0; k < 4; k++) { const g = (Math.random() + Math.random() - 1) * pw * 0.55; cx.globalAlpha = 0.12 + Math.random() * 0.2; cx.fillRect(x + ox * g + (Math.random() - 0.5) * 2, y + oy * g + (Math.random() - 0.5) * 2, 1.5 + Math.random() * 2.5, 1.5 + Math.random() * 2.5); } }
  } else { cx.globalAlpha = 1; cx.lineWidth = t.kind === 'eraser' ? w * 1.5 : w * 0.45; cx.beginPath(); cx.moveTo(a.x, a.y); cx.lineTo(b.x, b.y); cx.stroke(); }
  cx.restore();
}
const flat = (c) => { const o = document.createElement('canvas'); o.width = c.width; o.height = c.height; const g = o.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, o.width, o.height); g.drawImage(c, 0, 0); return o.toDataURL('image/png'); };
function bindPen(c, onDown, onEnd) {
  c.onpointerdown = (e) => { e.preventDefault(); onDown(); drawing = true; last = pos(c, e); stroke(last, last); try { c.setPointerCapture(e.pointerId); } catch (_) {} };
  c.onpointermove = (e) => { if (!drawing) return; const p = pos(c, e); stroke(last, p); last = p; };
  c.onpointerup = c.onpointercancel = () => { if (drawing) { drawing = false; onEnd(); } };
}
function initDraw() {
  cv = $('#draw'); cx = cv.getContext('2d', { willReadFrequently: true }); undoS = []; redoS = [];
  if (S.draft.strokes) { const im = new Image(); im.onload = () => cx.drawImage(im, 0, 0); im.src = S.draft.strokes; }
  bindPen(cv, () => { undoS.push(cx.getImageData(0, 0, cv.width, cv.height)); if (undoS.length > 20) undoS.shift(); redoS = []; }, () => { S.draft.strokes = cv.toDataURL('image/png'); saveDraft(); });
}
function initHand() {
  const c = $('#hand'), g = c.getContext('2d');
  if (S.draft.handwriting) { const im = new Image(); im.onload = () => g.drawImage(im, 0, 0); im.src = S.draft.handwriting; }
  const keep = S.tool; let prevCx = null;
  bindPen(c, () => { prevCx = cx; cx = g; S.tool = { kind: 'marker', color: '#3A342F', size: 0 }; }, () => { S.tool = keep; S.draft.handwriting = c.toDataURL('image/png'); S.draft.textSource = 'handwriting'; saveDraft(); cx = prevCx; });
}

// ---------- 업로드 보정 ----------
function adjust(img, up, max) {
  const sc = Math.min(1, max / Math.max(img.width, img.height)), w = Math.round(img.width * sc), h = Math.round(img.height * sc), q = up.rot % 180 !== 0;
  const c = document.createElement('canvas'); c.width = q ? h : w; c.height = q ? w : h; const g = c.getContext('2d', { willReadFrequently: true });
  g.translate(c.width / 2, c.height / 2); g.rotate((up.rot * Math.PI) / 180); g.drawImage(img, -w / 2, -h / 2, w, h);
  if (up.br !== 100 || up.ct !== 100) { const d = g.getImageData(0, 0, c.width, c.height), p = d.data, b = up.br / 100, k = up.ct / 100; for (let i = 0; i < p.length; i += 4) for (let j = 0; j < 3; j++) { const v = (p[i + j] * b - 128) * k + 128; p[i + j] = v < 0 ? 0 : v > 255 ? 255 : v; } g.putImageData(d, 0, 0); }
  return c;
}
function drawUp(max) { const v = $('#upv'); if (!v || !S.up || !S.up.img) return; const c = adjust(S.up.img, S.up, max); v.width = c.width; v.height = c.height; v.getContext('2d').drawImage(c, 0, 0); }
function loadImage(src) { return new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; }); }
const whiten = (im) => { const c = document.createElement('canvas'); c.width = im.width; c.height = im.height; const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(im, 0, 0); return c.toDataURL('image/png'); };
const readFile = (f, as = 'readAsDataURL') => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r[as](f); });

// ---------- 음성 ----------
let rec = null;
function stopMic(silent) { if (rec) { try { rec.onend = null; rec.stop(); } catch (_) {} rec = null; } if (S.listening) { S.listening = false; if (!silent) render(); } }
function startMic() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition; if (!SR) return;
  const base = S.draft.text ? S.draft.text.replace(/\s*$/, ' ') : ''; let fin = '';
  rec = new SR(); rec.lang = S.lang === 'en' ? 'en-US' : 'ko-KR'; rec.continuous = true; rec.interimResults = true;
  rec.onresult = (ev) => { let inter = ''; for (let i = ev.resultIndex; i < ev.results.length; i++) { const r = ev.results[i]; if (r.isFinal) fin += r[0].transcript + ' '; else inter += r[0].transcript; } S.draft.text = (base + fin + inter).trim(); S.draft.textSource = 'voice'; const ta = $('#story'); if (ta) ta.value = S.draft.text; saveDraft(); };
  rec.onerror = (ev) => { toast(ev.error === 'not-allowed' ? T('마이크 사용을 허락해 주세요', 'Please allow microphone access') : T('잘 못 들었어요. 다시 말해 줄래요?', "I couldn't hear that. Try again?")); stopMic(); };
  rec.onend = () => { rec = null; S.listening = false; render(); };
  try { rec.start(); S.listening = true; const keep = rec; rec = null; render(); rec = keep; } catch (_) { stopMic(); }
}

// ---------- 그림책 초기화 ----------
function newBook() {
  const all = sorted(false), f = all.length ? all[0].date : today(), t = all.length ? all[all.length - 1].date : today();
  const y = t.slice(0, 4), name = S.child || T('우리 아이', 'My');
  S.book = { step: 1, from: f, to: t, sel: new Set(all.map((e) => e.id)), title: S.lang === 'en' ? `${S.child ? S.child + "'s" : 'My'} ${y} Diary` : `${name}의 ${y}년 그림일기`, cover: 'gallery', coverId: all.length ? all[0].id : null, layout: 'classic', notes: true, lang: S.lang, spread: 0, year: y, seasonLabel: S.lang === 'en' ? 'ART BOOK' : '그림일기' };
}

// ---------- 동작 ----------
const A = {
  tab(el) { S.view = null; S.tab = el.dataset.v; if (S.tab === 'book' && (!S.book || !S.book.sel.size)) newBook(); render(); window.scrollTo(0, 0); },
  write() { S.draft = { id: uid(), step: 'method', date: today(), title: '', weather: '', mood: '', text: '', textSource: 'voice', storyTab: 'voice', note: '', noteInBook: true, lang: S.lang }; S.view = 'write'; saveDraft(); render(); },
  resume() { S.view = 'write'; if (S.draft.step === 'upload' || S.draft.step === 'ai') S.draft.step = 'method'; render(); },
  closeWrite() { S.land = null; S.view = null; render(); },
  toMethod() { S.land = null; S.draft.step = 'method'; render(); },
  land() { S.land = window.innerHeight > window.innerWidth ? 'rot' : 'full'; keepCanvas(); },
  landOff() { S.land = null; keepCanvas(); },
  goDraw() { S.draft.step = 'draw'; saveDraft(); render(); },
  goAi() { S.draft.step = 'ai'; render(); },
  aiStyle(el) { S.aiStyle = el.dataset.v; DB.set('aiStyle', S.aiStyle); render(); },
  tool(el) { S.tool.kind = el.dataset.v; keepCanvas(); }, color(el) { S.tool.color = el.dataset.v; if (S.tool.kind === 'eraser') S.tool.kind = 'crayon'; keepCanvas(); }, size(el) { S.tool.size = Number(el.dataset.v); keepCanvas(); },
  undo() { if (undoS.length) { redoS.push(cx.getImageData(0, 0, cv.width, cv.height)); cx.putImageData(undoS.pop(), 0, 0); S.draft.strokes = cv.toDataURL('image/png'); saveDraft(); } },
  redo() { if (redoS.length) { undoS.push(cx.getImageData(0, 0, cv.width, cv.height)); cx.putImageData(redoS.pop(), 0, 0); S.draft.strokes = cv.toDataURL('image/png'); saveDraft(); } },
  askClear() { confirmBox(T('그림을 전부 지울까요?', 'Clear the whole drawing?'), T('지우기', 'Clear'), () => { S.draft.strokes = null; saveDraft(); }); },
  drawNext() { S.land = null; S.draft.drawing = flat(cv); S.draft.strokes = cv.toDataURL('image/png'); S.draft.drawingSource = 'draw'; delete S.draft.drawingOriginal; S.draft.step = 'story'; saveDraft(); render(); },
  rot() { S.up.rot = (S.up.rot + 90) % 360; drawUp(900); }, upReset() { S.up.rot = 0; S.up.br = 100; S.up.ct = 100; render(); },
  upNext() { const u = S.up; S.draft.drawingOriginal = adjust(u.img, { rot: 0, br: 100, ct: 100 }, 2000).toDataURL('image/jpeg', 0.92); S.draft.drawing = u.rot || u.br !== 100 || u.ct !== 100 ? adjust(u.img, u, 2000).toDataURL('image/jpeg', 0.92) : S.draft.drawingOriginal; S.draft.drawingSource = 'upload'; S.draft.step = 'story'; saveDraft(); render(); },
  toPicture() { S.draft.step = S.draft.drawingSource === 'draw' ? 'draw' : 'method'; render(); },
  storyTab(el) { S.draft.storyTab = el.dataset.v; if (el.dataset.v !== 'hand' && S.draft.textSource === 'handwriting' && !S.draft.handwriting) S.draft.textSource = 'typed'; render(); },
  handClear() { S.draft.handwriting = null; saveDraft(); render(); },
  mic() { if (S.listening) stopMic(); else startMic(); },
  storyNext() { const d = S.draft; if (d.storyTab === 'hand') { if (!d.handwriting) return toast(T('글씨를 써 주세요', 'Please write something')); d.textSource = 'handwriting'; } else { if (!d.text.trim()) return toast(T('이야기를 들려주세요', 'Please tell your story')); d.textSource = d.storyTab === 'voice' ? 'voice' : 'typed'; d.handwriting = null; } d.step = 'info'; saveDraft(); render(); },
  toStory() { S.draft.step = 'story'; render(); },
  weather(el) { S.draft.weather = S.draft.weather === el.dataset.v ? '' : el.dataset.v; saveDraft(); render(); }, mood(el) { S.draft.mood = S.draft.mood === el.dataset.v ? '' : el.dataset.v; saveDraft(); render(); },
  infoNext() { if (!S.draft.title.trim()) return toast(T('제목을 써 주세요', 'Please add a title')); if (!S.draft.date) S.draft.date = today(); S.draft.step = 'note'; saveDraft(); render(); },
  toInfo() { S.draft.step = 'info'; render(); },
  gateNote() { gate(() => render()); },
  noteInBook() { S.draft.noteInBook = !S.draft.noteInBook; saveDraft(); render(); },
  async finish() {
    const d = S.draft, e = { id: d.id, date: d.date, title: d.title.trim(), weather: d.weather, mood: d.mood, drawing: d.drawing, drawingOriginal: d.drawingOriginal || null, drawingSource: d.drawingSource, strokes: d.strokes || null, text: d.textSource === 'handwriting' ? '' : d.text.trim(), transcript: d.textSource === 'voice' ? d.text.trim() : '', textSource: d.textSource, handwriting: d.textSource === 'handwriting' ? d.handwriting : null, note: (d.note || '').trim(), noteInBook: d.noteInBook, lang: S.lang, createdAt: Date.now(), updatedAt: Date.now() };
    try { await DB.put(e); await DB.set('draft', null); } catch (_) { return toast(T('저장하지 못했어요. 저장 공간을 확인해 주세요.', 'Could not save. Please check storage space.')); }
    S.entries.push(e); S.draft = null; S.book = null; S.detailId = e.id; S.justDone = true; S.showOriginal = false; S.view = 'detail'; render(); window.scrollTo(0, 0);
  },
  open(el) { S.detailId = el.dataset.v; S.justDone = false; S.showOriginal = false; S.view = 'detail'; render(); window.scrollTo(0, 0); },
  closeDetail() { S.view = null; if (S.justDone) S.tab = 'home'; S.justDone = false; render(); },
  toggleOrig() { S.showOriginal = !S.showOriginal; render(); },
  download() { const e = S.entries.find((x) => x.id === S.detailId), d = S.showOriginal && e.drawingOriginal ? e.drawingOriginal : e.drawing; saveFile(`kkomji-${e.date}.${d.startsWith('data:image/png') ? 'png' : 'jpg'}`, d); },
  editNote() { gate(() => { const e = S.entries.find((x) => x.id === S.detailId); S.modal = { type: 'note', val: e.note || '' }; render(); const n = $('#noteEdit'); if (n) n.focus(); }); },
  async noteSave() { const e = S.entries.find((x) => x.id === S.detailId); e.note = $('#noteEdit').value.trim(); e.updatedAt = Date.now(); await DB.put(e); S.modal = null; render(); toast(T('코멘트를 저장했어요', 'Note saved')); },
  askDelete() { gate(() => confirmBox(T('이 일기를 삭제할까요? 되돌릴 수 없어요.', 'Delete this diary? This cannot be undone.'), T('삭제', 'Delete'), async () => { await DB.del(S.detailId); S.entries = S.entries.filter((x) => x.id !== S.detailId); S.book = null; S.view = null; })); },
  dmode(el) { S.diaryMode = el.dataset.v; render(); }, season(el) { S.season = el.dataset.v; render(); },
  ym(el) { const [y, m] = S.ym.split('-').map(Number), d = new Date(y, m - 1 + Number(el.dataset.v), 1); S.ym = d.getFullYear() + '-' + pad(d.getMonth() + 1); render(); },
  bookHome() { S.view = null; S.tab = 'home'; render(); }, bookPrev() { S.book.step--; render(); window.scrollTo(0, 0); },
  bookNext() { const b = S.book; if (b.step === 1 && !b.sel.has(b.coverId)) b.coverId = bookEntries()[0].id; b.step++; b.spread = 0; render(); window.scrollTo(0, 0); },
  selAll() { const b = S.book, r = S.entries.filter((e) => e.date >= b.from && e.date <= b.to); b.sel = bookEntries().length === r.length ? new Set() : new Set(r.map((e) => e.id)); render(); },
  cover(el) { S.book.cover = el.dataset.v; render(); }, coverPic(el) { S.book.coverId = el.dataset.v; render(); }, layout(el) { S.book.layout = el.dataset.v; render(); },
  bnotes() { S.book.notes = !S.book.notes; render(); }, blang(el) { S.book.lang = el.dataset.v; render(); },
  sp(el) { S.book.spread += Number(el.dataset.v); render(); },
  async pdf() {
    const b = S.book, en = bookEntries(), o = { lang: b.lang, notes: b.notes }, html = coverHTML(b) + en.map((e, i) => pageHTML(e, b.layout, i + 1, o)).join('') + backHTML();
    if (!PREVIEW) { $('#print-root').innerHTML = html; const t = document.title; document.title = b.title; setTimeout(() => { window.print(); document.title = t; }, 250); return; }
    // 미리보기에서는 인쇄 창을 열 수 없어 각 페이지를 이미지로 그려 PDF로 묶습니다.
    if (!window.html2canvas || !window.jspdf) return toast(T('이 화면에서는 PDF를 만들 수 없어요', 'PDF is not available here'));
    if (S.busy) return; S.busy = true; toast(T('PDF를 만드는 중이에요…', 'Making your PDF…'));
    const box = document.createElement('div'); box.style.cssText = 'position:fixed;left:-12000px;top:0;width:816px'; box.innerHTML = html; document.body.appendChild(box);
    try {
      const pdf = new window.jspdf.jsPDF({ unit: 'mm', format: [216, 216], compress: true }); let first = true;
      for (const pg of box.querySelectorAll('.pg')) { const c = await window.html2canvas(pg, { scale: 2, backgroundColor: null, logging: false }); if (!first) pdf.addPage([216, 216]); first = false; pdf.addImage(c.toDataURL('image/jpeg', 0.92), 'JPEG', 0, 0, 216, 216); }
      await saveFile((b.title || 'kkomji-book') + '.pdf', pdf.output('blob'));
    } catch (_) { toast(T('PDF를 만들지 못했어요', 'Could not make the PDF')); }
    box.remove(); S.busy = false;
  },
  lang(el) { S.lang = el.dataset.v; DB.set('lang', S.lang); S.book = null; render(); },
  export() { gate(() => { render(); saveFile(`kkomji-backup-${today()}.json`, new Blob([JSON.stringify({ app: 'kkomji-diary', v: 1, child: S.child, entries: S.entries })], { type: 'application/json' })); }); },
  async seed() {
    const smp = [['2026-04-12', '꽃밭', 'Flower Garden', 'sunny', 'happy', 'drawing-flowers-cover.png', '꽃들이 나한테 인사하는 것 같았어요.', 'The flowers looked like they were saying hi.', ''], ['2026-04-18', '비 오는 날 노란 우산', 'Yellow Umbrella in the Rain', 'rain', 'ok', 'drawing-rain.png', '우산에서 빗소리가 노래했어요.', 'The rain sang on my umbrella.', ''], ['2026-04-22', '우리 집 앞에 핀 꽃', 'Flowers in Front of My House', 'sunny', 'excited', 'drawing-flowers-real.png', '오늘 우리 집 앞에서 예쁜 꽃을 봤어요.\n빨간 꽃도 있고 노란 꽃도 있었어요.', 'Today I saw pretty flowers in front of my house.\nThere were red ones and yellow ones.', '작은 꽃도 놓치지 않고 바라보는 네 마음이 참 예뻐. 오늘의 봄을 오래 기억하자.'], ['2026-04-23', '수영을 했어요', 'I Went Swimming', 'sunny', 'happy', 'drawing-swim.png', '아빠랑 수영장에 갔어요.\n물이 차가웠는데 발차기를 열 번이나 했어요!', 'I went to the pool with Dad.\nThe water was cold, but I kicked ten times!', ''], ['2026-04-26', '할머니 집에 갔어요', "Grandma's House", 'sunny', 'happy', 'drawing-house.png', '할머니 집 나무에 빨간 열매가 있었어요.', "There were red berries on Grandma's tree.", '']];
    try { for (const [date, ko, en, w, m, f, tk, te, note] of smp) { const blob = await (await fetch('assets/' + f)).blob(), url = await readFile(blob); const im = await loadImage(url); const e = { id: 'sample-' + date, date, title: T(ko, en), weather: w, mood: m, drawing: whiten(im), drawingOriginal: null, drawingSource: 'upload', text: T(tk, te), transcript: '', textSource: 'typed', handwriting: null, note: S.lang === 'en' && note ? 'I love how you notice even the smallest flowers.' : note, noteInBook: true, lang: S.lang, createdAt: Date.now(), updatedAt: Date.now(), sample: true }; await DB.put(e); S.entries = S.entries.filter((x) => x.id !== e.id).concat(e); } S.book = null; S.ym = '2026-04'; render(); toast(T('샘플 일기를 넣었어요', 'Sample diaries added')); } catch (_) { toast(T('샘플을 불러오지 못했어요', 'Could not load samples')); }
  },
  askWipe() { gate(() => confirmBox(T('모든 일기를 삭제할까요? 되돌릴 수 없어요.', 'Delete ALL diaries? This cannot be undone.'), T('모두 삭제', 'Delete all'), async () => { await DB.clear(); S.entries = []; S.book = null; })); },
  closeModal() { S.modal = null; render(); },
  gateOK() { const m = S.modal; if (Number($('#gate').value) === m.a * m.b) { S.parentOK = true; S.modal = null; m.then(); if (!S.modal) render(); } else { toast(T('답이 달라요. 다시 해 볼까요?', 'Not quite. Try again?')); $('#gate').value = ''; $('#gate').focus(); } },
  async confirmOK() { const m = S.modal; S.modal = null; await m.then(); render(); }
};
function keepCanvas() { const data = cv ? cv.toDataURL('image/png') : null; if (data) S.draft.strokes = data; const u = undoS, r = redoS; render(); undoS = u; redoS = r; }

document.addEventListener('click', (ev) => { const el = ev.target.closest('[data-a]'); if (!el || el.disabled) return; const fn = A[el.dataset.a]; if (fn) fn(el, ev); });
document.addEventListener('input', (ev) => {
  const el = ev.target;
  if (el.dataset.m && S.draft) { S.draft[el.dataset.m] = el.value; if (el.dataset.m === 'text') S.draft.textSource = S.draft.storyTab === 'voice' ? 'voice' : 'typed'; saveDraft(); }
  if (el.dataset.r && S.up) { S.up[el.dataset.r] = Number(el.value); drawUp(700); }
  if (el.dataset.k === 'child') { S.child = el.value.trim(); DB.set('child', S.child); S.book = null; }
  if (el.dataset.b === 'title') S.book.title = el.value;
});
document.addEventListener('change', async (ev) => {
  const el = ev.target;
  if (el.dataset.b === 'title') render();
  if (el.dataset.b === 'from' || el.dataset.b === 'to') { const b = S.book; if (el.value) b[el.dataset.b] = el.value; if (b.from > b.to) b.to = b.from; b.sel = new Set(S.entries.filter((e) => e.date >= b.from && e.date <= b.to).map((e) => e.id)); render(); }
  if (el.dataset.c) { el.checked ? S.book.sel.add(el.dataset.c) : S.book.sel.delete(el.dataset.c); render(); }
  if (el.dataset.f === 'pick' && el.files[0]) { try { const img = await loadImage(await readFile(el.files[0])); S.up = { img, rot: 0, br: 100, ct: 100 }; S.draft.step = 'upload'; render(); } catch (_) { toast(T('사진을 열지 못했어요', 'Could not open that photo')); } }
  if (el.dataset.f === 'import' && el.files[0]) { gate(async () => { try { const j = JSON.parse(await readFile(el.files[0], 'readAsText')); if (j.app !== 'kkomji-diary' || !Array.isArray(j.entries)) throw 0; for (const e of j.entries) await DB.put(e); S.entries = await DB.all(); if (j.child && !S.child) { S.child = j.child; DB.set('child', S.child); } S.book = null; render(); toast(T(`${j.entries.length}편을 불러왔어요`, `${j.entries.length} diaries restored`)); } catch (_) { toast(T('백업 파일을 읽지 못했어요', 'Could not read the backup file')); } }); }
});
document.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' && ev.target.id === 'gate') A.gateOK(); if (ev.key === 'Escape' && S.modal) A.closeModal(); });

// ---------- 시작 ----------
(async () => {
  try {
    await DB.open();
    S.entries = (await DB.all()) || [];
    S.lang = (await DB.get('lang')) || ((navigator.language || 'ko').startsWith('ko') ? 'ko' : 'en');
    S.child = (await DB.get('child')) || '';
    S.aiStyle = (await DB.get('aiStyle')) || 'kid'; if (!STYLES.some((x) => x.id === S.aiStyle)) S.aiStyle = 'kid';
    const d = await DB.get('draft'); if (d && d.id) S.draft = d;
  } catch (_) { toast('이 화면에서는 일기가 창을 닫으면 사라져요.'); }
  const latest = sorted()[0]; S.ym = (latest ? latest.date : today()).slice(0, 7);
  render();
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
})();
})();
