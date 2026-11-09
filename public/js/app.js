// სეკრეტ სანტა — ფრონტენდი (ფრეიმვორკის გარეშე)
const $app = document.getElementById('app');
const $me = document.getElementById('me-btn');
const $modal = document.getElementById('modal');

// ---------- state & storage ----------
const store = {
  get token() { return localStorage.getItem('ss_token') || sessionStorage.getItem('ss_token'); },
  setToken(t, remember) {
    localStorage.removeItem('ss_token'); sessionStorage.removeItem('ss_token');
    if (t) (remember ? localStorage : sessionStorage).setItem('ss_token', t);
  },
  get lastUser() { return localStorage.getItem('ss_last_user') || ''; },
  set lastUser(v) { localStorage.setItem('ss_last_user', v); },
  get pending() { return sessionStorage.getItem('ss_pending_code'); },
  set pending(v) { v ? sessionStorage.setItem('ss_pending_code', v) : sessionStorage.removeItem('ss_pending_code'); },
};
let me = null;

// ---------- helpers ----------
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const isImg = (s) => typeof s === 'string' && s.startsWith('data:image/');
const initial = (n) => esc([...(n || '?').trim()][0] || '?');
const avatar = (u, cls = '') => `<div class="av ${cls}">${isImg(u?.avatar) ? `<img src="${u.avatar}" alt="">` : initial(u?.name)}</div>`;
const gicon = (g, cls = '') => `<div class="gicon ${cls}">${isImg(g?.icon) ? `<img src="${g.icon}" alt="">` : esc(g?.icon || '🎁')}</div>`;

const MONTHS = ['იანვარი', 'თებერვალი', 'მარტი', 'აპრილი', 'მაისი', 'ივნისი', 'ივლისი', 'აგვისტო', 'სექტემბერი', 'ოქტომბერი', 'ნოემბერი', 'დეკემბერი'];
function fmtDate(iso) {
  const d = new Date(iso);
  return `${d.getDate()} ${MONTHS[d.getMonth()]}, ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
function toLocalInput(iso) {
  if (!iso) return '';
  const d = new Date(iso); const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

function toast(msg, err = false) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.className = 'toast show' + (err ? ' err' : '');
  clearTimeout(toast._t); toast._t = setTimeout(() => (t.className = 'toast'), 2800);
}

async function api(method, path, body) {
  const headers = { 'content-type': 'application/json' };
  if (store.token) headers.authorization = 'Bearer ' + store.token;
  let res;
  try {
    res = await fetch('/api' + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  } catch {
    throw new Error('ინტერნეტთან კავშირი ვერ მოხერხდა');
  }
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && path !== '/login') { store.setToken(null); me = null; renderMe(); }
  if (!res.ok) throw new Error(data.error || 'შეცდომა');
  return data;
}

// სურათის შემცირება 256×256-მდე (კვადრატად ჭრა)
function resizeImage(file, size = 256) {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith('image/')) return reject(new Error('აირჩიეთ სურათი'));
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas'); c.width = c.height = size;
      const s = Math.min(img.width, img.height);
      c.getContext('2d').drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, size, size);
      let out = c.toDataURL('image/webp', 0.8);
      if (!out.startsWith('data:image/webp')) out = c.toDataURL('image/jpeg', 0.82);
      URL.revokeObjectURL(img.src); resolve(out);
    };
    img.onerror = () => reject(new Error('სურათის წაკითხვა ვერ მოხერხდა'));
    img.src = URL.createObjectURL(file);
  });
}

function formData(form) { return Object.fromEntries(new FormData(form).entries()); }

// ფორმის გაგზავნა: ღილაკის დაბლოკვა + შეცდომის ჩვენება
function onSubmit(form, fn) {
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = form.querySelector('[type=submit]');
    if (btn) btn.disabled = true;
    try { await fn(formData(form)); } catch (err) { toast(err.message, true); } finally { if (btn) btn.disabled = false; }
  });
}

function confirmSheet(text, okLabel = 'დიახ', danger = true) {
  return new Promise((resolve) => {
    $modal.innerHTML = `<div class="sheet"><h3>${esc(text)}</h3>
      <button class="btn ${danger ? 'btn-primary' : 'btn-green'}" data-ok>${esc(okLabel)}</button>
      <button class="btn btn-ghost" data-no>გაუქმება</button></div>`;
    $modal.hidden = false;
    const close = (v) => { $modal.hidden = true; $modal.innerHTML = ''; resolve(v); };
    $modal.onclick = (e) => { if (e.target === $modal || e.target.dataset.no !== undefined) close(false); if (e.target.dataset.ok !== undefined) close(true); };
  });
}

async function copy(text) {
  try { await navigator.clipboard.writeText(text); toast('დაკოპირდა ✅'); }
  catch { prompt('დააკოპირეთ:', text); }
}

// ---------- router ----------
const routes = [
  [/^\/$/, home],
  [/^\/login$/, () => authPage('login')],
  [/^\/register$/, () => authPage('register')],
  [/^\/profile$/, profilePage],
  [/^\/new$/, () => groupForm(null)],
  [/^\/join$/, joinByCodePage],
  [/^\/j\/([^/]+)$/, invitePage],
  [/^\/g\/([0-9a-f-]{36})$/, groupPage],
  [/^\/g\/([0-9a-f-]{36})\/edit$/, (id) => groupForm(id)],
];
let countdownTimer;
export function go(path, replace = false) {
  history[replace ? 'replaceState' : 'pushState']({}, '', path);
  render();
}
async function render() {
  clearInterval(countdownTimer);
  $modal.hidden = true;
  window.scrollTo(0, 0);
  const path = location.pathname;
  for (const [re, fn] of routes) {
    const m = path.match(re);
    if (m) {
      try { await fn(...m.slice(1).map(decodeURIComponent)); }
      catch (e) { $app.innerHTML = `<div class="empty"><div class="big">😿</div><p>${esc(e.message)}</p><a class="btn btn-ghost" href="/" data-link>მთავარზე დაბრუნება</a></div>`; }
      return;
    }
  }
  go('/', true);
}
document.addEventListener('click', (e) => {
  const a = e.target.closest('a[data-link]');
  if (a && !e.metaKey && !e.ctrlKey) { e.preventDefault(); go(a.getAttribute('href')); }
});
window.addEventListener('popstate', render);

function renderMe() {
  if (me) { $me.hidden = false; $me.innerHTML = isImg(me.avatar) ? `<img src="${me.avatar}" alt="პროფილი">` : initial(me.name); }
  else { $me.hidden = true; }
}
function requireLogin() {
  if (!me) { go('/login', true); return false; }
  return true;
}

// ---------- pages ----------
async function home() {
  if (!me) {
    $app.innerHTML = `
      <section class="hero">
        <img src="/img/logo.svg" alt="სეკრეტ სანტა">
        <h1>სეკრეტ სანტა</h1>
        <p>ითამაშე საიდუმლო სანტა მეგობრებთან, კოლეგებთან და კლასელებთან 🎄</p>
      </section>
      <a class="btn btn-primary" href="/register" data-link>🎅 დაწყება — რეგისტრაცია</a>
      <a class="btn btn-ghost" href="/login" data-link>უკვე მაქვს ანგარიში — შესვლა</a>
      <div class="sep">ან</div>
      ${joinCodeCard()}
      <div class="card stack">
        <h3>როგორ მუშაობს? 🤔</h3>
        <div>1️⃣ შექმენი ჯგუფი და დააყენე გათამაშების დრო</div>
        <div>2️⃣ გაუგზავნე მოსაწვევი ბმული მეგობრებს</div>
        <div>3️⃣ თითოეული წერს, რა საჩუქარი უყვარს</div>
        <div>4️⃣ დათქმულ დროს ყველა იგებს, ვის უყიდის საჩუქარს — საიდუმლოდ! 🤫</div>
      </div>
      <p class="footer">უფასო · რეკლამის გარეშე · ❤️ ფოთიდან</p>`;
    bindJoinCode();
    return;
  }
  const { groups } = await api('GET', '/me');
  $app.innerHTML = `
    <h1>გამარჯობა, ${esc(me.name)}! 👋</h1>
    <div class="row" style="margin:14px 0 18px">
      <a class="btn btn-primary" href="/new" data-link>➕ ახალი ჯგუფი</a>
      <a class="btn btn-gold" href="/join" data-link>🔑 კოდით</a>
    </div>
    ${!me.interests ? `<div class="card" style="background:#fff3cf"><b>💡 რჩევა:</b> დაწერე შენი ინტერესები, რომ შენმა სანტამ იცოდეს, რა გაჩუქოს! <a href="/profile" data-link>პროფილი →</a></div>` : ''}
    <h2>ჩემი ჯგუფები</h2>
    <div class="glist">
      ${groups.length ? groups.map((g) => `
        <div class="card"><a href="/g/${g.id}" data-link>
          ${gicon(g)}
          <div class="grow">
            <div style="font-weight:800">${esc(g.name)}</div>
            <div class="muted">👥 ${g.member_count}/${g.max_players} ${g.owner_id === me.id ? '· 👑 ადმინი' : ''}</div>
          </div>
          ${statusBadge(g)}
        </a></div>`).join('') : `
        <div class="empty"><div class="big">🎄</div><p>ჯერ არცერთ ჯგუფში არ ხარ.<br>შექმენი ახალი ან შეუერთდი კოდით!</p></div>`}
    </div>`;
}

function statusBadge(g) {
  if (g.rolled_at) return '<span class="badge green">გათამაშდა 🎉</span>';
  if (g.roll_at) return `<span class="badge gold">⏰ ${fmtDate(g.roll_at)}</span>`;
  return '<span class="badge">ელოდება</span>';
}

function joinCodeCard() {
  return `<form class="card" id="join-code-form">
      <h3>🔑 შეუერთდი ჯგუფს კოდით</h3>
      <input name="code" class="code-input" placeholder="მაგ: X7K2PQ" autocomplete="off" autocapitalize="characters" required>
      <button class="btn btn-gold" type="submit" style="margin-top:12px">შემდეგი →</button>
    </form>`;
}
function bindJoinCode() {
  const f = document.getElementById('join-code-form');
  onSubmit(f, ({ code }) => go('/j/' + encodeURIComponent(code.trim().toUpperCase())));
}
async function joinByCodePage() {
  $app.innerHTML = `<a class="back" href="/" data-link>← უკან</a>${joinCodeCard()}`;
  bindJoinCode();
}

// --- login / register ---
function authPage(mode) {
  if (me) return go('/', true);
  const reg = mode === 'register';
  let avatarData = null;
  $app.innerHTML = `
    <a class="back" href="/" data-link>← უკან</a>
    <form class="card" id="auth-form" autocomplete="on">
      <h1>${reg ? '🎅 რეგისტრაცია' : '👋 შესვლა'}</h1>
      ${store.pending ? `<p class="muted">შესვლის შემდეგ ავტომატურად შეუერთდები ჯგუფს (კოდი ${esc(store.pending)}).</p>` : ''}
      ${reg ? `
        <div class="avatar-pick">
          <label for="av-file" style="margin:0;cursor:pointer" id="av-prev">${avatar({ name: '📷' }, 'lg')}</label>
          <input type="file" id="av-file" accept="image/*">
          <span class="hint">შეეხე და ატვირთე სურათი (არასავალდებულო)</span>
        </div>` : ''}
      <label>მომხმარებლის სახელი <span class="hint">${reg ? '— შესასვლელად (მაგ: giorgi_99)' : ''}</span></label>
      <input name="username" required minlength="3" maxlength="30" autocomplete="username" autocapitalize="none" value="${reg ? '' : esc(store.lastUser)}">
      ${reg ? `<label>შენი სახელი <span class="hint">— ასე დაგინახავენ სხვები</span></label>
      <input name="name" required maxlength="40" placeholder="მაგ: გიორგი">` : ''}
      <label>PIN კოდი <span class="hint">— 4 ან 6 ციფრი</span></label>
      <input name="pin" class="pin" type="password" inputmode="numeric" pattern="\\d{4}|\\d{6}" maxlength="6" required autocomplete="${reg ? 'new-password' : 'current-password'}">
      ${reg ? `<label>რა გიყვარს? 🎁 <span class="hint">— სანტას მინიშნებები</span></label>
      <textarea name="interests" maxlength="500" placeholder="მაგ: წიგნები, ყავა, სამაგიდო თამაშები, წინდები 🧦"></textarea>` : ''}
      <label class="check"><input type="checkbox" name="remember" checked> დამიმახსოვრე ამ მოწყობილობაზე</label>
      <button class="btn btn-primary" type="submit">${reg ? 'რეგისტრაცია 🎄' : 'შესვლა'}</button>
      <p class="center muted" style="margin-top:14px">${reg ? 'უკვე გაქვს ანგარიში? <a href="/login" data-link>შესვლა</a>' : 'პირველად ხარ? <a href="/register" data-link>რეგისტრაცია</a>'}</p>
    </form>
    ${reg ? '' : '<p class="center muted">დაგავიწყდა PIN? სთხოვე ჯგუფის ადმინს, ან შექმენი ახალი ანგარიში.</p>'}`;
  if (reg) {
    document.getElementById('av-file').onchange = async (e) => {
      try { avatarData = await resizeImage(e.target.files[0]); document.getElementById('av-prev').innerHTML = avatar({ avatar: avatarData }, 'lg'); }
      catch (err) { toast(err.message, true); }
    };
  }
  onSubmit(document.getElementById('auth-form'), async (d) => {
    const remember = !!d.remember;
    const r = await api('POST', reg ? '/register' : '/login', { ...d, remember, avatar: avatarData });
    store.setToken(r.token, remember); store.lastUser = r.user.username;
    me = r.user; renderMe();
    toast(reg ? 'კეთილი იყოს შენი მობრძანება! 🎉' : 'გამარჯობა! 👋');
    await afterLogin();
  });
}
async function afterLogin() {
  const code = store.pending;
  if (code) {
    store.pending = null;
    try { const r = await api('POST', '/join', { code }); toast('შეუერთდი ჯგუფს! 🎉'); return go('/g/' + r.id, true); }
    catch (e) { toast(e.message, true); }
  }
  go('/', true);
}

// --- invite landing ---
async function invitePage(code) {
  const g = await api('GET', '/invite/' + encodeURIComponent(code));
  const full = g.member_count >= g.max_players;
  $app.innerHTML = `
    <div class="card center">
      <p class="muted">${esc(g.owner_name)} გეპატიჟება 🎅</p>
      <div style="display:flex;justify-content:center;margin:10px 0">${gicon(g, 'lg')}</div>
      <h1>${esc(g.name)}</h1>
      <p class="muted">👥 ${g.member_count}/${g.max_players} მოთამაშე ${g.roll_at && !g.rolled_at ? `· ⏰ ${fmtDate(g.roll_at)}` : ''}</p>
      ${g.rolled_at ? '<p class="badge red">გათამაშება უკვე ჩატარდა</p>'
        : full ? '<p class="badge red">ჯგუფი სავსეა</p>'
        : `<button class="btn btn-green" id="join-btn">🎁 შეუერთდი ჯგუფს</button>`}
    </div>`;
  const btn = document.getElementById('join-btn');
  if (btn) btn.onclick = async () => {
    if (!me) { store.pending = g.code; return go('/register'); }
    btn.disabled = true;
    try { const r = await api('POST', '/join', { code: g.code }); toast(r.already ? 'უკვე ამ ჯგუფში ხარ' : 'შეუერთდი ჯგუფს! 🎉'); go('/g/' + r.id, true); }
    catch (e) { toast(e.message, true); btn.disabled = false; }
  };
}

// --- group page ---
async function groupPage(id) {
  if (!requireLogin()) return;
  const g = await api('GET', '/groups/' + id);
  const link = `${location.origin}/j/${g.invite_code}`;
  const enough = g.members.length >= g.min_players;

  let top = '';
  if (g.rolled_at && g.target) {
    top = `
      <div class="card reveal" id="reveal">
        <h2>🤫 შენ საჩუქარს ყიდულობ...</h2>
        <button class="giftbox" id="open-gift" aria-label="გახსენი">🎁</button>
        <p>შეეხე საჩუქარს, რომ გაიგო!</p>
      </div>`;
  } else if (!g.rolled_at) {
    top = `
      <div class="card center">
        ${g.roll_at ? `<h3>⏰ გათამაშებამდე დარჩა</h3><div class="countdown" id="cd"></div><p class="muted">${fmtDate(g.roll_at)}</p>`
          : '<h3>⏳ გათამაშების დრო ჯერ არ არის დაყენებული</h3>'}
        ${!enough ? `<p class="muted">საჭიროა მინიმუმ ${g.min_players} მოთამაშე (ახლა ${g.members.length})</p>` : ''}
      </div>`;
  }

  $app.innerHTML = `
    <a class="back" href="/" data-link>← ჩემი ჯგუფები</a>
    <div class="row" style="margin-bottom:14px">
      ${gicon(g, 'lg')}
      <div class="grow"><h1 style="margin:0">${esc(g.name)}</h1>
        <div class="muted">👥 ${g.members.length}/${g.max_players} ${g.budget ? `· 💰 ${esc(g.budget)}` : ''}</div></div>
    </div>
    ${top}
    ${!g.rolled_at ? `
      <div class="card">
        <h3>📨 მოიწვიე მეგობრები</h3>
        <div class="invite-code">${esc(g.invite_code)}</div>
        <div class="row">
          <button class="btn btn-green btn-sm grow" id="share">📤 გაზიარება</button>
          <button class="btn btn-ghost btn-sm grow" id="copy">🔗 ბმულის კოპირება</button>
        </div>
      </div>` : ''}
    <div class="card">
      <h3>მოთამაშეები</h3>
      <ul class="members">
        ${g.members.map((m) => `<li>${avatar(m)}<div class="grow"><b>${esc(m.name)}</b>${m.id === me.id ? ' <span class="hint">(შენ)</span>' : ''}
          ${m.id === g.owner_id ? '<div class="hint">👑 ადმინი</div>' : ''}</div>
          ${g.is_owner && m.id !== me.id && !g.rolled_at ? `<button class="btn btn-danger btn-sm" data-kick="${m.id}" data-name="${esc(m.name)}">გაგდება</button>` : ''}</li>`).join('')}
      </ul>
    </div>
    ${g.is_owner ? `
      <div class="card stack">
        <h3>👑 ადმინის პანელი</h3>
        ${!g.rolled_at ? `<button class="btn btn-primary" id="roll" ${enough ? '' : 'disabled'}>🎲 გათამაშება ახლავე</button>` : ''}
        <a class="btn btn-ghost" href="/g/${g.id}/edit" data-link>⚙️ ჯგუფის პარამეტრები</a>
        ${g.rolled_at ? '<button class="btn btn-ghost" id="reset">🔄 გათამაშების გაუქმება</button>' : ''}
        <button class="btn btn-danger" id="del">🗑️ ჯგუფის წაშლა</button>
      </div>` : !g.rolled_at ? '<button class="btn btn-danger" id="leave">ჯგუფის დატოვება</button>' : ''}`;

  // reveal
  const open = document.getElementById('open-gift');
  if (open) open.onclick = () => {
    const t = g.target;
    document.getElementById('reveal').innerHTML = `
      <h2>🎉 შენ საჩუქარს ყიდულობ:</h2>
      <div class="target">
        <div style="display:flex;justify-content:center">${avatar(t, 'xl')}</div>
        <div class="name">${esc(t.name)}</div>
        ${g.budget ? `<div>💰 ბიუჯეტი: ${esc(g.budget)}</div>` : ''}
        <div class="interests"><b>🎁 რა უყვარს:</b><br>${t.interests ? esc(t.interests) : '<i>ჯერ არაფერი დაუწერია... გაოცება მოუწყვე! 😄</i>'}</div>
      </div>
      <p style="margin-top:14px;font-size:.9rem">🤫 არავის უთხრა!</p>`;
  };

  // countdown
  if (g.roll_at && !g.rolled_at) {
    const cd = document.getElementById('cd');
    const tick = () => {
      let s = Math.max(0, Math.floor((new Date(g.roll_at) - Date.now()) / 1000));
      if (s === 0) { clearInterval(countdownTimer); setTimeout(render, 1500); }
      const d = Math.floor(s / 86400); s %= 86400; const h = Math.floor(s / 3600); s %= 3600; const mi = Math.floor(s / 60); s %= 60;
      cd.innerHTML = [[d, 'დღე'], [h, 'საათი'], [mi, 'წუთი'], [s, 'წამი']].map(([v, l]) => `<div><b>${v}</b><span>${l}</span></div>`).join('');
    };
    tick(); countdownTimer = setInterval(tick, 1000);
  }

  const on = (id, fn) => { const el = document.getElementById(id); if (el) el.onclick = fn; };
  on('copy', () => copy(link));
  on('share', async () => {
    const text = `🎅 შემოგვიერთდი სეკრეტ სანტაში — „${g.name}"! კოდი: ${g.invite_code}`;
    if (navigator.share) { try { await navigator.share({ title: 'სეკრეტ სანტა', text, url: link }); } catch {} }
    else copy(`${text}\n${link}`);
  });
  on('roll', async () => {
    if (!(await confirmSheet(`გავათამაშოთ ახლავე? ${g.members.length} მოთამაშე. ამის შემდეგ ახალი წევრები ვეღარ შემოვლენ.`, '🎲 გათამაშება', false))) return;
    try { await api('POST', `/groups/${id}/roll`); toast('გათამაშდა! 🎉'); render(); } catch (e) { toast(e.message, true); }
  });
  on('reset', async () => {
    if (!(await confirmSheet('გავაუქმოთ გათამაშება? ყველას წყვილი წაიშლება და თავიდან მოგიწევთ გათამაშება.', 'გაუქმება'))) return;
    try { await api('POST', `/groups/${id}/reset`); toast('გათამაშება გაუქმდა'); render(); } catch (e) { toast(e.message, true); }
  });
  on('del', async () => {
    if (!(await confirmSheet(`წავშალოთ ჯგუფი „${g.name}"? ეს ვეღარ აღდგება.`, '🗑️ წაშლა'))) return;
    try { await api('DELETE', `/groups/${id}`); toast('ჯგუფი წაიშალა'); go('/', true); } catch (e) { toast(e.message, true); }
  });
  on('leave', async () => {
    if (!(await confirmSheet('დავტოვოთ ჯგუფი?', 'დატოვება'))) return;
    try { await api('POST', `/groups/${id}/leave`); toast('ჯგუფი დატოვე'); go('/', true); } catch (e) { toast(e.message, true); }
  });
  $app.querySelectorAll('[data-kick]').forEach((b) => (b.onclick = async () => {
    if (!(await confirmSheet(`გავაგდოთ ${b.dataset.name}?`, 'გაგდება'))) return;
    try { await api('POST', `/groups/${id}/kick`, { user_id: b.dataset.kick }); toast('მოთამაშე გაგდებულია'); render(); } catch (e) { toast(e.message, true); }
  }));
}

// --- create / edit group ---
const EMOJIS = ['🎁', '🎄', '🎅', '⛄', '🦌', '❄️', '🍪', '🧦', '🔔', '⭐', '🏢', '🎓'];
async function groupForm(id) {
  if (!requireLogin()) return;
  const g = id ? await api('GET', '/groups/' + id) : { icon: '🎁', max_players: 20, name: '', budget: '', roll_at: null, invite_code: '' };
  let icon = g.icon || '🎁';
  $app.innerHTML = `
    <a class="back" href="${id ? '/g/' + id : '/'}" data-link>← უკან</a>
    <form class="card" id="gform">
      <h1>${id ? '⚙️ პარამეტრები' : '➕ ახალი ჯგუფი'}</h1>
      <label>ჯგუფის სახელი</label>
      <input name="name" required maxlength="60" placeholder="მაგ: ოფისის სანტა 2026" value="${esc(g.name)}">
      <label>იკონა</label>
      <div class="row" style="margin-bottom:10px"><div id="icon-prev">${gicon({ icon }, 'lg')}</div>
        <label class="btn btn-ghost btn-sm" style="margin:0" for="icon-file">📷 სურათის ატვირთვა</label>
        <input type="file" id="icon-file" accept="image/*" hidden></div>
      <div class="emoji-grid">${EMOJIS.map((e) => `<button type="button" data-emoji="${e}" class="${e === icon ? 'on' : ''}">${e}</button>`).join('')}</div>
      <label>მოთამაშეთა ლიმიტი <span class="hint">— 3-დან 200-მდე</span></label>
      <input name="max_players" type="number" inputmode="numeric" min="3" max="200" required value="${g.max_players}">
      <label>გათამაშების დრო ⏰ <span class="hint">— ამ დროს ავტომატურად გათამაშდება</span></label>
      <input name="roll_at" type="datetime-local" value="${toLocalInput(g.roll_at)}">
      <label>ბიუჯეტი 💰 <span class="hint">— არასავალდებულო</span></label>
      <input name="budget" maxlength="60" placeholder="მაგ: 30-50 ₾" value="${esc(g.budget)}">
      <label>საკუთარი მოსაწვევი კოდი <span class="hint">— არასავალდებულო, ლათინური ასოები/ციფრები</span></label>
      <input name="invite_code" class="code-input" maxlength="24" placeholder="${id ? '' : 'ავტომატური'}" value="${esc(g.invite_code)}" autocapitalize="characters">
      <button class="btn btn-primary" type="submit" style="margin-top:18px">${id ? '💾 შენახვა' : '🎄 ჯგუფის შექმნა'}</button>
    </form>`;
  const setIcon = (v) => {
    icon = v; document.getElementById('icon-prev').innerHTML = gicon({ icon }, 'lg');
    $app.querySelectorAll('[data-emoji]').forEach((b) => b.classList.toggle('on', b.dataset.emoji === v));
  };
  $app.querySelectorAll('[data-emoji]').forEach((b) => (b.onclick = () => setIcon(b.dataset.emoji)));
  document.getElementById('icon-file').onchange = async (e) => {
    try { setIcon(await resizeImage(e.target.files[0])); } catch (err) { toast(err.message, true); }
  };
  onSubmit(document.getElementById('gform'), async (d) => {
    const body = { ...d, icon, roll_at: d.roll_at ? new Date(d.roll_at).toISOString() : null };
    if (!body.invite_code) delete body.invite_code;
    if (id) { await api('PUT', '/groups/' + id, body); toast('შენახულია ✅'); go('/g/' + id, true); }
    else { const r = await api('POST', '/groups', body); toast('ჯგუფი შეიქმნა! 🎉 ახლა მოიწვიე მეგობრები'); go('/g/' + r.id, true); }
  });
}

// --- profile ---
async function profilePage() {
  if (!requireLogin()) return;
  let avatarData;
  $app.innerHTML = `
    <a class="back" href="/" data-link>← უკან</a>
    <form class="card" id="pform">
      <div class="avatar-pick">
        <label for="av-file" style="margin:0;cursor:pointer" id="av-prev">${avatar(me, 'xl')}</label>
        <input type="file" id="av-file" accept="image/*">
        <span class="hint">შეეხე სურათს შესაცვლელად</span>
      </div>
      <p class="center muted">@${esc(me.username)}</p>
      <label>შენი სახელი</label>
      <input name="name" required maxlength="40" value="${esc(me.name)}">
      <label>რა გიყვარს? 🎁 <span class="hint">— სანტა ამას დაინახავს</span></label>
      <textarea name="interests" maxlength="500" placeholder="მაგ: წიგნები, ყავა, სამაგიდო თამაშები...">${esc(me.interests)}</textarea>
      <label>ახალი PIN <span class="hint">— დატოვე ცარიელი, თუ არ ცვლი</span></label>
      <input name="pin" class="pin" type="password" inputmode="numeric" pattern="\\d{4}|\\d{6}" maxlength="6" autocomplete="new-password">
      <button class="btn btn-primary" type="submit" style="margin-top:18px">💾 შენახვა</button>
    </form>
    <button class="btn btn-ghost" id="logout">🚪 გასვლა</button>`;
  document.getElementById('av-file').onchange = async (e) => {
    try { avatarData = await resizeImage(e.target.files[0]); document.getElementById('av-prev').innerHTML = avatar({ avatar: avatarData }, 'xl'); }
    catch (err) { toast(err.message, true); }
  };
  onSubmit(document.getElementById('pform'), async (d) => {
    const body = { name: d.name, interests: d.interests };
    if (d.pin) body.pin = d.pin;
    if (avatarData) body.avatar = avatarData;
    const r = await api('PUT', '/me', body);
    me = r.user; renderMe(); toast('შენახულია ✅');
  });
  document.getElementById('logout').onclick = async () => {
    try { await api('POST', '/logout'); } catch {}
    store.setToken(null); me = null; renderMe(); go('/', true);
  };
}

// ---------- boot ----------
(async () => {
  if (store.token) {
    try { me = (await api('GET', '/me')).user; } catch { /* token expired */ }
  }
  renderMe();
  render();
})();

