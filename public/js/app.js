// სეკრეტ სანტა — ფრონტენდი
import { icon, GROUP_ICONS } from './icons.js';

const $app = document.getElementById('app');
const $me = document.getElementById('me-btn');
const $modal = document.getElementById('modal');

// ---------- storage ----------
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
function gicon(g, cls = '') {
  const v = g?.icon || 'i:gift';
  const inner = isImg(v) ? `<img src="${v}" alt="">` : v.startsWith('i:') ? icon(v.slice(2)) : esc(v);
  return `<div class="gicon ${cls}">${inner}</div>`;
}
const head = (title, { back, sub } = {}) => `
  <div class="head">
    ${back ? `<a class="back" href="${back[0]}" data-link>${icon('back')}${esc(back[1])}</a>` : ''}
    <h1>${title}</h1>
    ${sub ? `<p class="sub">${sub}</p>` : ''}
  </div>`;

const MONTHS = ['იანვარს', 'თებერვალს', 'მარტს', 'აპრილს', 'მაისს', 'ივნისს', 'ივლისს', 'აგვისტოს', 'სექტემბერს', 'ოქტომბერს', 'ნოემბერს', 'დეკემბერს'];
const pad = (n) => String(n).padStart(2, '0');
function fmtDate(iso) {
  const d = new Date(iso);
  return `${d.getDate()} ${MONTHS[d.getMonth()]}, ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function toLocalInput(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function toast(msg, err = false) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.className = 'toast show' + (err ? ' err' : '');
  clearTimeout(toast._t); toast._t = setTimeout(() => (t.className = 'toast'), 3000);
}

async function api(method, path, body) {
  const headers = { 'content-type': 'application/json' };
  if (store.token) headers.authorization = 'Bearer ' + store.token;
  let res;
  try { res = await fetch('/api' + path, { method, headers, body: body ? JSON.stringify(body) : undefined }); }
  catch { throw new Error('ინტერნეტთან კავშირი ვერ მოხერხდა. შეამოწმე კავშირი და სცადე თავიდან.'); }
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && path !== '/login') { store.setToken(null); me = null; renderMe(); }
  if (!res.ok) throw new Error(data.error || 'რაღაც არ გამოვიდა. სცადე თავიდან.');
  return data;
}

function resizeImage(file, size = 256) {
  return new Promise((resolve, reject) => {
    if (!file || !file.type.startsWith('image/')) return reject(new Error('აირჩიე სურათის ფაილი'));
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas'); c.width = c.height = size;
      const s = Math.min(img.width, img.height);
      c.getContext('2d').drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, size, size);
      let out = c.toDataURL('image/webp', 0.8);
      if (!out.startsWith('data:image/webp')) out = c.toDataURL('image/jpeg', 0.82);
      URL.revokeObjectURL(img.src); resolve(out);
    };
    img.onerror = () => reject(new Error('სურათი ვერ წავიკითხე. სცადე სხვა ფაილი.'));
    img.src = URL.createObjectURL(file);
  });
}

function onSubmit(form, fn) {
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = form.querySelector('[type=submit]');
    if (btn) btn.disabled = true;
    try { await fn(Object.fromEntries(new FormData(form).entries())); }
    catch (err) { toast(err.message, true); }
    finally { if (btn) btn.disabled = false; }
  });
}

function confirmPanel(title, text, okLabel) {
  return new Promise((resolve) => {
    $modal.innerHTML = `<div class="panel" role="dialog" aria-modal="true">
      <h3>${esc(title)}</h3>${text ? `<p>${esc(text)}</p>` : ''}
      <div class="btns"><button class="btn btn-primary" data-ok>${esc(okLabel)}</button>
      <button class="btn btn-outline" data-no>გაუქმება</button></div></div>`;
    $modal.hidden = false;
    $modal.querySelector('[data-ok]').focus();
    const close = (v) => { $modal.hidden = true; $modal.innerHTML = ''; resolve(v); };
    $modal.onclick = (e) => {
      if (e.target.closest('[data-ok]')) close(true);
      else if (e.target === $modal || e.target.closest('[data-no]')) close(false);
    };
  });
}

async function copy(text, msg = 'ბმული დაკოპირდა') {
  try { await navigator.clipboard.writeText(text); toast(msg); }
  catch { prompt('დააკოპირე:', text); }
}

// ---------- router ----------
const routes = [
  [/^\/$/, home],
  [/^\/login$/, () => authPage('login')],
  [/^\/register$/, () => authPage('register')],
  [/^\/profile$/, profilePage],
  [/^\/new$/, () => groupForm(null)],
  [/^\/join$/, joinPage],
  [/^\/j\/([^/]+)$/, invitePage],
  [/^\/g\/([0-9a-f-]{36})$/, groupPage],
  [/^\/g\/([0-9a-f-]{36})\/edit$/, (id) => groupForm(id)],
];
let timer;
function go(path, replace = false) {
  history[replace ? 'replaceState' : 'pushState']({}, '', path);
  render();
}
async function render() {
  clearInterval(timer);
  $modal.hidden = true;
  window.scrollTo(0, 0);
  for (const [re, fn] of routes) {
    const m = location.pathname.match(re);
    if (m) {
      try { await fn(...m.slice(1).map(decodeURIComponent)); }
      catch (e) {
        $app.innerHTML = head('ვერ ჩაიტვირთა') + `<div class="sheet"><div class="empty"><p>${esc(e.message)}</p>
          <a class="btn btn-primary" href="/" data-link>მთავარ გვერდზე</a></div></div>`;
      }
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
  $me.hidden = !me;
  if (me) $me.innerHTML = isImg(me.avatar) ? `<img src="${me.avatar}" alt="პროფილი">` : initial(me.name);
}
function requireLogin() { if (!me) { go('/login', true); return false; } return true; }

// ---------- home ----------
async function home() {
  if (!me) {
    $app.innerHTML = `
      <section class="hero">
        <h1>სეკრეტ<span>სანტა</span></h1>
        <img src="/img/logo.svg" alt="">
        <p>შექმენი ჯგუფი, მოიწვიე მეგობრები და დათქმულ დროს თითოეული საიდუმლოდ გაიგებს, ვის ჩუქნის საჩუქარს.</p>
      </section>
      <div class="sheet">
        <div class="btns">
          <a class="btn btn-primary" href="/register" data-link>ანგარიშის შექმნა</a>
          <a class="btn btn-outline" href="/login" data-link>შესვლა</a>
        </div>
        <div class="section">
          <h2>მოსაწვევი კოდი გაქვს?</h2>
          ${codeForm()}
        </div>
        <div class="section">
          <h2>როგორ მუშაობს</h2>
          <ol class="steps">
            <li><span>ადმინი ქმნის ჯგუფს და ნიშნავს გათამაშების დროს.</span></li>
            <li><span>მონაწილეები უერთდებიან ბმულით ან კოდით და წერენ, რა მოსწონთ.</span></li>
            <li><span>დათქმულ დროს ყველა იღებს ერთ სახელს — იმას, ვისაც ჩუქნის.</span></li>
          </ol>
        </div>
        <p class="footer">უფასოა და რეკლამის გარეშე.</p>
      </div>`;
    bindCodeForm();
    return;
  }
  const { groups } = await api('GET', '/me');
  $app.innerHTML = `
    ${head(`გამარჯობა, ${esc(me.name)}`)}
    <div class="sheet">
      ${!me.interests ? `<div class="callout">შენს სანტას დაეხმარება, თუ იცის რა მოგწონს. <a href="/profile" data-link>დაამატე სურვილები</a></div>` : ''}
      <div class="btns two">
        <a class="btn btn-primary" href="/new" data-link>ახალი ჯგუფი</a>
        <a class="btn btn-outline" href="/join" data-link>კოდით შესვლა</a>
      </div>
      <div class="section">
        <h2>ჩემი ჯგუფები</h2>
        ${groups.length ? `<div class="tags">${groups.map(groupTag).join('')}</div>` : `
          <div class="empty"><p>ჯერ არცერთ ჯგუფში არ ხარ. შექმენი ახალი ან შეიყვანე მეგობრისგან მიღებული კოდი.</p></div>`}
      </div>
    </div>`;
}
function groupTag(g) {
  const status = g.rolled_at ? '<span class="status done">გათამაშდა</span>'
    : g.roll_at ? `<span class="status wait">${fmtDate(g.roll_at)}</span>` : '';
  return `<a class="tag" href="/g/${g.id}" data-link>
    ${gicon(g)}
    <div class="grow"><div class="title">${esc(g.name)}</div>
      <div class="meta"><span>${g.member_count} / ${g.max_players} მონაწილე</span>${g.owner_id === me.id ? '<span>შენ ხარ ადმინი</span>' : ''}</div></div>
    ${status}</a>`;
}

// ---------- join by code ----------
const codeForm = (dark = false) => `
  <form class="inline-form ${dark ? 'on-dark-field' : ''}" id="code-form">
    <input name="code" class="code" placeholder="X7K2PQ" autocomplete="off" autocapitalize="characters" aria-label="მოსაწვევი კოდი" required>
    <button class="btn btn-primary" type="submit">გაგრძელება</button>
  </form>`;
function bindCodeForm() {
  onSubmit(document.getElementById('code-form'), ({ code }) => go('/j/' + encodeURIComponent(code.trim().toUpperCase())));
}
function joinPage() {
  $app.innerHTML = head('ჯგუფში შესვლა', { back: ['/', 'უკან'], sub: 'შეიყვანე კოდი, რომელიც ჯგუფის ადმინმა გამოგიგზავნა.' })
    + `<div class="sheet">${codeForm()}</div>`;
  bindCodeForm();
}

// ---------- auth ----------
function authPage(mode) {
  if (me) return go('/', true);
  const reg = mode === 'register';
  let avatarData = null;
  const pendingNote = store.pending ? `შემდეგ ავტომატურად შეუერთდები ჯგუფს ${esc(store.pending)}.` : '';
  $app.innerHTML = head(reg ? 'ანგარიშის შექმნა' : 'შესვლა', {
    back: ['/', 'უკან'],
    sub: pendingNote || (reg ? 'მხოლოდ სახელი და PIN კოდი — არც ელფოსტა, არც ტელეფონი.' : ''),
  }) + `
    <div class="sheet">
      <form id="auth-form" autocomplete="on">
        ${reg ? `
          <label class="photo-pick">
            <span class="av lg" id="av-prev">${icon('camera')}<span class="badge-cam">${icon('plus')}</span></span>
            <span><b>ფოტო</b><br><span class="muted small">არასავალდებულო</span></span>
            <input type="file" id="av-file" accept="image/*">
          </label>` : ''}
        <div class="field">
          <label for="f-user">მომხმარებლის სახელი</label>
          <input id="f-user" name="username" required minlength="3" maxlength="30" autocomplete="username" autocapitalize="none" spellcheck="false" value="${reg ? '' : esc(store.lastUser)}">
          ${reg ? '<p class="help">ამით შეხვალ სისტემაში. მაგალითად: nino_k</p>' : ''}
        </div>
        ${reg ? `<div class="field">
          <label for="f-name">სახელი</label>
          <input id="f-name" name="name" required maxlength="40" autocomplete="given-name">
          <p class="help">ასე დაგინახავენ ჯგუფის წევრები.</p>
        </div>` : ''}
        <div class="field">
          <label for="f-pin">PIN კოდი</label>
          <input id="f-pin" name="pin" class="pin" type="password" inputmode="numeric" pattern="\\d{4}|\\d{6}" maxlength="6" required autocomplete="${reg ? 'new-password' : 'current-password'}">
          <p class="help">4 ან 6 ციფრი.</p>
        </div>
        ${reg ? `<div class="field">
          <label for="f-int">რა მოგწონს?</label>
          <textarea id="f-int" name="interests" maxlength="500" placeholder="წიგნები, ყავა, სამაგიდო თამაშები, თბილი წინდები"></textarea>
          <p class="help">ამას მხოლოდ შენი სანტა ნახავს.</p>
        </div>` : ''}
        <label class="check"><input type="checkbox" name="remember" checked>დამიმახსოვრე ამ მოწყობილობაზე</label>
        <button class="btn btn-primary" type="submit">${reg ? 'ანგარიშის შექმნა' : 'შესვლა'}</button>
      </form>
      <p class="muted" style="margin-top:24px">${reg
        ? 'უკვე გაქვს ანგარიში? <a href="/login" data-link>შესვლა</a>'
        : 'პირველად ხარ? <a href="/register" data-link>ანგარიშის შექმნა</a><br>PIN დაგავიწყდა? ახალი ანგარიში შექმენი და ადმინს თავიდან მოიწვევინე.'}</p>
    </div>`;
  if (reg) {
    document.getElementById('av-file').onchange = async (e) => {
      try {
        avatarData = await resizeImage(e.target.files[0]);
        document.getElementById('av-prev').innerHTML = `<img src="${avatarData}" alt=""><span class="badge-cam">${icon('camera')}</span>`;
      } catch (err) { toast(err.message, true); }
    };
  }
  onSubmit(document.getElementById('auth-form'), async (d) => {
    const remember = !!d.remember;
    const r = await api('POST', reg ? '/register' : '/login', { ...d, remember, avatar: avatarData });
    store.setToken(r.token, remember); store.lastUser = r.user.username;
    me = r.user; renderMe();
    await afterLogin();
  });
}
async function afterLogin() {
  const code = store.pending;
  if (code) {
    store.pending = null;
    try { const r = await api('POST', '/join', { code }); toast('შეუერთდი ჯგუფს'); return go('/g/' + r.id, true); }
    catch (e) { toast(e.message, true); }
  }
  go('/', true);
}

// ---------- invite ----------
async function invitePage(code) {
  const g = await api('GET', '/invite/' + encodeURIComponent(code));
  const full = g.member_count >= g.max_players;
  const blocked = g.rolled_at ? 'ამ ჯგუფში გათამაშება უკვე ჩატარდა, ახალი წევრები ვეღარ შევლენ.'
    : full ? 'ჯგუფი სავსეა. სთხოვე ადმინს, ლიმიტი გაზარდოს.' : '';
  $app.innerHTML = `
    <div class="head">
      ${gicon(g, 'lg')}
      <p class="sub" style="margin-top:16px">${esc(g.owner_name)} გიწვევს</p>
      <h1 style="margin-top:4px">${esc(g.name)}</h1>
      <p class="sub">${g.member_count} / ${g.max_players} მონაწილე${g.roll_at && !g.rolled_at ? `. გათამაშება ${fmtDate(g.roll_at)}` : ''}</p>
    </div>
    <div class="sheet">
      ${blocked ? `<p>${blocked}</p>` : `
        <button class="btn btn-primary" id="join-btn">ჯგუფში შესვლა</button>
        ${!me ? '<p class="muted" style="margin-top:12px">ჯერ შექმენი ანგარიში — ერთ წუთს წაიღებს.</p>' : ''}`}
    </div>`;
  const btn = document.getElementById('join-btn');
  if (btn) btn.onclick = async () => {
    if (!me) { store.pending = g.code; return go('/register'); }
    btn.disabled = true;
    try { const r = await api('POST', '/join', { code: g.code }); toast(r.already ? 'უკვე ამ ჯგუფში ხარ' : 'შეუერთდი ჯგუფს'); go('/g/' + r.id, true); }
    catch (e) { toast(e.message, true); btn.disabled = false; }
  };
}

// ---------- group ----------
async function groupPage(id) {
  if (!requireLogin()) return;
  const g = await api('GET', '/groups/' + id);
  const link = `${location.origin}/j/${g.invite_code}`;
  const enough = g.members.length >= g.min_players;
  const missing = g.min_players - g.members.length;

  let headExtra = '';
  if (!g.rolled_at) {
    headExtra = g.roll_at
      ? `<div class="countdown" id="cd" aria-live="off"></div><p class="note-dark">გათამაშება: ${fmtDate(g.roll_at)}${!enough ? `. საჭიროა კიდევ ${missing} მონაწილე.` : ''}</p>`
      : `<p class="note-dark">${g.is_owner ? 'გათამაშების დრო ჯერ არ დაგინიშნავს.' : 'ადმინს გათამაშების დრო ჯერ არ დაუნიშნავს.'}${!enough ? ` საჭიროა კიდევ ${missing} მონაწილე.` : ''}</p>`;
  }

  $app.innerHTML = `
    <div class="head">
      <a class="back" href="/" data-link>${icon('back')}ჩემი ჯგუფები</a>
      <div style="display:flex;gap:16px;align-items:center">${gicon(g, 'lg')}
        <div><h1>${esc(g.name)}</h1>
        <p class="sub" style="margin-top:6px">${g.members.length} / ${g.max_players} მონაწილე${g.budget ? `. ბიუჯეტი ${esc(g.budget)}` : ''}</p></div>
      </div>
      ${headExtra}
    </div>
    <div class="sheet">
      ${g.rolled_at && g.target ? `
        <div class="reveal-wrap"><div class="string"></div>
          <div class="reveal-tag sealed" id="reveal" role="button" tabindex="0" aria-label="დააჭირე და გეჭიროს, რომ გახსნა">
            <div class="seal-title">ვის<br>ჩუქნი?</div>
            <svg class="hold-ring" viewBox="0 0 76 76"><circle class="bg" cx="38" cy="38" r="35"/><circle class="fg" cx="38" cy="38" r="35"/></svg>
            <div class="seal-hint">დააჭირე და არ აუშვა</div>
          </div></div>` : ''}
      ${!g.rolled_at ? `
        <div class="section">
          <div class="tag invite">
            <div class="lbl">მოსაწვევი კოდი</div>
            <div class="code-big">${esc(g.invite_code)}</div>
            <div class="btns two">
              <button class="btn btn-light btn-sm" id="share">${icon('share')}გაზიარება</button>
              <button class="btn btn-outline on-dark btn-sm" id="copy">${icon('link')}ბმული</button>
            </div>
          </div>
        </div>` : ''}
      <div class="section">
        <h2>მონაწილეები</h2>
        <ul class="people">
          ${g.members.map((m) => `<li>${avatar(m)}
            <div class="grow"><div class="name">${esc(m.name)}${m.id === me.id ? ' <span class="muted">(შენ)</span>' : ''}</div>
            ${m.id === g.owner_id ? '<div class="role">ადმინი</div>' : ''}</div>
            ${g.is_owner && m.id !== me.id && !g.rolled_at ? `<button class="btn-text danger" data-kick="${m.id}" data-name="${esc(m.name)}">ამოშლა</button>` : ''}</li>`).join('')}
        </ul>
      </div>
      ${g.is_owner ? `
        <div class="section">
          <h2>მართვა</h2>
          ${!g.rolled_at ? `<button class="btn btn-primary" id="roll" ${enough ? '' : 'disabled'} style="margin-bottom:8px">${icon('shuffle')}გათამაშება ახლავე</button>` : ''}
          <div class="admin-list">
            <a href="/g/${g.id}/edit" data-link>${icon('settings')}ჯგუფის პარამეტრები</a>
            ${g.rolled_at ? `<button id="reset">${icon('undo')}გათამაშების გაუქმება</button>` : ''}
            <button class="danger" id="del">${icon('trash')}ჯგუფის წაშლა</button>
          </div>
        </div>` : !g.rolled_at ? `<div class="section"><div class="admin-list"><button class="danger" id="leave">${icon('leave')}ჯგუფის დატოვება</button></div></div>` : ''}
    </div>`;

  // reveal: press and hold
  const tag = document.getElementById('reveal');
  if (tag) {
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    let hold;
    const open = () => {
      const t = g.target;
      tag.className = 'reveal-tag opened';
      tag.removeAttribute('role'); tag.removeAttribute('tabindex'); tag.removeAttribute('aria-label');
      tag.innerHTML = `
        <div class="to">შენ საჩუქარს ყიდულობ</div>
        ${avatar(t, 'lg')}
        <div class="who">${esc(t.name)}</div>
        ${g.budget ? `<div class="muted">ბიუჯეტი ${esc(g.budget)}</div>` : ''}
        <div class="wish"><b>რა მოსწონს</b><p>${t.interests ? esc(t.interests) : 'ჯერ არაფერი დაუწერია. შეგიძლია ჯგუფში სხვებს ჰკითხო.'}</p></div>`;
      if (navigator.vibrate) navigator.vibrate(30);
    };
    const start = (e) => {
      e.preventDefault();
      if (reduce) return open();
      tag.classList.add('holding');
      hold = setTimeout(open, 900);
    };
    const cancel = () => { clearTimeout(hold); if (tag.classList.contains('sealed')) tag.classList.remove('holding'); };
    tag.addEventListener('pointerdown', start);
    ['pointerup', 'pointerleave', 'pointercancel'].forEach((ev) => tag.addEventListener(ev, cancel));
    tag.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } });
    tag.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  // countdown
  if (g.roll_at && !g.rolled_at) {
    const cd = document.getElementById('cd');
    const tick = () => {
      let s = Math.max(0, Math.floor((new Date(g.roll_at) - Date.now()) / 1000));
      if (s === 0) { clearInterval(timer); setTimeout(render, 1500); }
      const d = Math.floor(s / 86400); s %= 86400; const h = Math.floor(s / 3600); s %= 3600; const mi = Math.floor(s / 60); s %= 60;
      const parts = d > 0 ? [[d, 'დღე'], [h, 'საათი'], [mi, 'წუთი']] : [[h, 'საათი'], [mi, 'წუთი'], [s, 'წამი']];
      cd.innerHTML = parts.map(([v, l]) => `<div><b>${pad(v)}</b><span>${l}</span></div>`).join('');
    };
    tick(); timer = setInterval(tick, 1000);
  }

  const on = (elId, fn) => { const el = document.getElementById(elId); if (el) el.onclick = fn; };
  on('copy', () => copy(link));
  on('share', async () => {
    const text = `შემოგვიერთდი სეკრეტ სანტაში „${g.name}“. კოდი: ${g.invite_code}`;
    if (navigator.share) { try { await navigator.share({ title: 'სეკრეტ სანტა', text, url: link }); } catch {} }
    else copy(`${text}\n${link}`, 'მოსაწვევი დაკოპირდა');
  });
  on('roll', async () => {
    if (!(await confirmPanel('გავათამაშოთ ახლავე?', `${g.members.length} მონაწილე მიიღებს თავის წყვილს. ამის შემდეგ ჯგუფში ახალი წევრები ვეღარ შევლენ.`, 'გათამაშება'))) return;
    try { await api('POST', `/groups/${id}/roll`); toast('გათამაშდა'); render(); } catch (e) { toast(e.message, true); }
  });
  on('reset', async () => {
    if (!(await confirmPanel('გავაუქმოთ გათამაშება?', 'ყველა წყვილი წაიშლება. ჯგუფი ისევ გაიხსნება და თავიდან უნდა გაათამაშო.', 'გაუქმება'))) return;
    try { await api('POST', `/groups/${id}/reset`); toast('გათამაშება გაუქმდა'); render(); } catch (e) { toast(e.message, true); }
  });
  on('del', async () => {
    if (!(await confirmPanel(`წავშალოთ „${g.name}“?`, 'ჯგუფი და ყველა წყვილი სამუდამოდ წაიშლება.', 'წაშლა'))) return;
    try { await api('DELETE', `/groups/${id}`); toast('ჯგუფი წაიშალა'); go('/', true); } catch (e) { toast(e.message, true); }
  });
  on('leave', async () => {
    if (!(await confirmPanel('დავტოვოთ ჯგუფი?', 'თავიდან შესასვლელად მოსაწვევი კოდი დაგჭირდება.', 'დატოვება'))) return;
    try { await api('POST', `/groups/${id}/leave`); toast('ჯგუფი დატოვე'); go('/', true); } catch (e) { toast(e.message, true); }
  });
  $app.querySelectorAll('[data-kick]').forEach((b) => (b.onclick = async () => {
    if (!(await confirmPanel(`ამოვშალოთ ${b.dataset.name}?`, 'მოსაწვევი კოდით ისევ შეძლებს შემოსვლას, თუ კოდს არ შეცვლი.', 'ამოშლა'))) return;
    try { await api('POST', `/groups/${id}/kick`, { user_id: b.dataset.kick }); toast(`${b.dataset.name} ამოიშალა`); render(); } catch (e) { toast(e.message, true); }
  }));
}

// ---------- create / edit ----------
async function groupForm(id) {
  if (!requireLogin()) return;
  const g = id ? await api('GET', '/groups/' + id)
    : { icon: 'i:gift', max_players: 20, name: '', budget: '', roll_at: null, invite_code: '' };
  let iconVal = g.icon || 'i:gift';
  let uploaded = isImg(iconVal) ? iconVal : null;
  $app.innerHTML = head(id ? 'პარამეტრები' : 'ახალი ჯგუფი', { back: [id ? '/g/' + id : '/', 'უკან'] }) + `
    <div class="sheet">
      <form id="gform">
        <div class="field">
          <label for="g-name">სახელი</label>
          <input id="g-name" name="name" required maxlength="60" placeholder="ოფისი 2026" value="${esc(g.name)}">
        </div>
        <div class="field">
          <label>იკონა</label>
          <div class="icon-grid" id="icons">
            ${GROUP_ICONS.map((n) => `<button type="button" data-icon="i:${n}" aria-pressed="${iconVal === 'i:' + n}" aria-label="${n}">${icon(n)}</button>`).join('')}
          </div>
          <label class="btn btn-outline btn-sm" style="margin-top:12px" id="upload-lbl">${uploaded ? `<img src="${uploaded}" alt="" style="width:24px;height:24px;border-radius:6px">` : icon('camera')}${uploaded ? 'შეცვალე სურათი' : 'ან ატვირთე სურათი'}
            <input type="file" id="icon-file" accept="image/*" hidden></label>
        </div>
        <div class="field">
          <label for="g-roll">გათამაშების დრო</label>
          <input id="g-roll" name="roll_at" type="datetime-local" value="${toLocalInput(g.roll_at)}">
          <p class="help">ამ დროს წყვილები ავტომატურად გადანაწილდება. შეგიძლია ცარიელი დატოვო და ხელით გაათამაშო.</p>
        </div>
        <div class="field">
          <label for="g-max">მონაწილეების ლიმიტი</label>
          <input id="g-max" name="max_players" type="number" inputmode="numeric" min="3" max="200" required value="${g.max_players}">
        </div>
        <div class="field">
          <label for="g-budget">ბიუჯეტი</label>
          <input id="g-budget" name="budget" maxlength="60" placeholder="30–50 ₾" value="${esc(g.budget)}">
        </div>
        <div class="field">
          <label for="g-code">მოსაწვევი კოდი</label>
          <input id="g-code" name="invite_code" class="code" maxlength="24" placeholder="${id ? '' : 'ავტომატური'}" value="${esc(g.invite_code)}" autocapitalize="characters">
          <p class="help">ლათინური ასოები და ციფრები, მინიმუმ 4. ${id ? 'კოდის შეცვლისას ძველი ბმული აღარ იმუშავებს.' : 'ცარიელს თუ დატოვებ, შევქმნით შემთხვევითს.'}</p>
        </div>
        <button class="btn btn-primary" type="submit">${id ? 'შენახვა' : 'ჯგუფის შექმნა'}</button>
      </form>
    </div>`;
  const grid = document.getElementById('icons');
  const setIcon = (v) => {
    iconVal = v;
    grid.querySelectorAll('[data-icon]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.icon === v)));
  };
  grid.querySelectorAll('[data-icon]').forEach((b) => (b.onclick = () => setIcon(b.dataset.icon)));
  document.getElementById('icon-file').onchange = async (e) => {
    try {
      uploaded = await resizeImage(e.target.files[0]); setIcon(uploaded);
      const lbl = document.getElementById('upload-lbl');
      lbl.firstChild.replaceWith(Object.assign(document.createElement('img'), { src: uploaded, alt: '', style: 'width:24px;height:24px;border-radius:6px' }));
    } catch (err) { toast(err.message, true); }
  };
  onSubmit(document.getElementById('gform'), async (d) => {
    const body = { ...d, icon: iconVal, roll_at: d.roll_at ? new Date(d.roll_at).toISOString() : null };
    if (!body.invite_code) delete body.invite_code;
    if (id) { await api('PUT', '/groups/' + id, body); toast('ცვლილებები შენახულია'); go('/g/' + id, true); }
    else { const r = await api('POST', '/groups', body); toast('ჯგუფი შეიქმნა. ახლა მოიწვიე მონაწილეები.'); go('/g/' + r.id, true); }
  });
}

// ---------- profile ----------
async function profilePage() {
  if (!requireLogin()) return;
  let avatarData;
  $app.innerHTML = head('პროფილი', { back: ['/', 'უკან'], sub: '@' + esc(me.username) }) + `
    <div class="sheet">
      <form id="pform">
        <label class="photo-pick">
          <span class="av lg" id="av-prev">${isImg(me.avatar) ? `<img src="${me.avatar}" alt="">` : initial(me.name)}<span class="badge-cam">${icon('camera')}</span></span>
          <span><b>ფოტო</b><br><span class="muted small">შეეხე შესაცვლელად</span></span>
          <input type="file" id="av-file" accept="image/*">
        </label>
        <div class="field">
          <label for="p-name">სახელი</label>
          <input id="p-name" name="name" required maxlength="40" value="${esc(me.name)}">
        </div>
        <div class="field">
          <label for="p-int">რა მოგწონს?</label>
          <textarea id="p-int" name="interests" maxlength="500" placeholder="წიგნები, ყავა, სამაგიდო თამაშები, თბილი წინდები">${esc(me.interests)}</textarea>
          <p class="help">ამას მხოლოდ შენი სანტა ნახავს.</p>
        </div>
        <div class="field">
          <label for="p-pin">ახალი PIN კოდი</label>
          <input id="p-pin" name="pin" class="pin" type="password" inputmode="numeric" pattern="\\d{4}|\\d{6}" maxlength="6" autocomplete="new-password">
          <p class="help">დატოვე ცარიელი, თუ არ ცვლი.</p>
        </div>
        <button class="btn btn-primary" type="submit">შენახვა</button>
      </form>
      <div class="admin-list" style="margin-top:24px"><button id="logout">${icon('leave')}გასვლა</button></div>
    </div>`;
  document.getElementById('av-file').onchange = async (e) => {
    try {
      avatarData = await resizeImage(e.target.files[0]);
      document.getElementById('av-prev').innerHTML = `<img src="${avatarData}" alt=""><span class="badge-cam">${icon('camera')}</span>`;
    } catch (err) { toast(err.message, true); }
  };
  onSubmit(document.getElementById('pform'), async (d) => {
    const body = { name: d.name, interests: d.interests };
    if (d.pin) body.pin = d.pin;
    if (avatarData) body.avatar = avatarData;
    me = (await api('PUT', '/me', body)).user; renderMe(); toast('ცვლილებები შენახულია');
  });
  document.getElementById('logout').onclick = async () => {
    try { await api('POST', '/logout'); } catch {}
    store.setToken(null); me = null; renderMe(); go('/', true);
  };
}

// ---------- boot ----------
(async () => {
  if (store.token) { try { me = (await api('GET', '/me')).user; } catch {} }
  renderMe();
  render();
})();
