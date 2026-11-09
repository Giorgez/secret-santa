// სეკრეტ სანტა — სერვერის ლოგიკა (Netlify Functions)
import postgres from 'postgres';
import crypto from 'node:crypto';

let _sql;
export function db() {
  if (!_sql) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new HttpError(500, 'სერვერი არ არის დაკავშირებული ბაზასთან (DATABASE_URL)');
    // Supabase transaction pooler (port 6543) არ უჭერს მხარს prepared statements-ს
    _sql = postgres(url, { prepare: false, max: 3, idle_timeout: 20, connect_timeout: 10 });
  }
  return _sql;
}

export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

const SESSION_DAYS_REMEMBER = 180;
const SESSION_HOURS_SHORT = 12;
const MAX_FAILS = 5;
const LOCK_MINUTES = 10;
const MAX_IMAGE_CHARS = 200_000; // ~150KB
const MIN_PLAYERS = 3;

// ---------- helpers ----------
const clean = (s, max) => String(s ?? '').trim().slice(0, max);
const normUser = (s) => clean(s, 30).toLowerCase().replace(/\s+/g, '_');

function hashPin(pin) {
  const salt = crypto.randomBytes(16).toString('hex');
  const h = crypto.scryptSync(pin, salt, 32).toString('hex');
  return `${salt}:${h}`;
}
function checkPin(pin, stored) {
  const [salt, h] = stored.split(':');
  const test = crypto.scryptSync(pin, salt, 32);
  return crypto.timingSafeEqual(test, Buffer.from(h, 'hex'));
}
function validPin(pin) { return /^\d{4}$|^\d{6}$/.test(String(pin ?? '')); }

function validImage(v) {
  if (v == null || v === '') return null;
  const s = String(v);
  if (s.length > MAX_IMAGE_CHARS) throw new HttpError(400, 'სურათი ძალიან დიდია');
  if (/^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(s)) return s;
  // ემოჯი / მოკლე ტექსტი ჯგუფის იკონად
  if (s.length <= 16 && !s.startsWith('data:')) return s;
  throw new HttpError(400, 'სურათის ფორმატი არასწორია');
}

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function randomCode(n = 6) {
  const b = crypto.randomBytes(n);
  return Array.from(b, (x) => CODE_CHARS[x % CODE_CHARS.length]).join('');
}
function normCode(s) { return clean(s, 24).toUpperCase().replace(/[^A-Z0-9-]/g, ''); }

async function newSession(sql, userId, remember) {
  const token = crypto.randomBytes(32).toString('base64url');
  const ms = remember ? SESSION_DAYS_REMEMBER * 864e5 : SESSION_HOURS_SHORT * 36e5;
  await sql`insert into sessions (token, user_id, expires_at) values (${token}, ${userId}, ${new Date(Date.now() + ms)})`;
  return token;
}

async function authUser(sql, req) {
  const h = req.headers.get('authorization') || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : '';
  if (!token) throw new HttpError(401, 'გთხოვთ, შედით სისტემაში');
  const [u] = await sql`
    select u.* from sessions s join users u on u.id = s.user_id
    where s.token = ${token} and s.expires_at > now()`;
  if (!u) throw new HttpError(401, 'სესია ამოიწურა, შედით თავიდან');
  u._token = token;
  return u;
}

const publicUser = (u) => ({
  id: u.id, username: u.username, name: u.display_name, avatar: u.avatar, interests: u.interests,
});

// ---------- the draw ----------
// შემთხვევითი წრე: ყველა ჩუქნის შემდეგს — არავინ ხვდება საკუთარ თავს
function derangementCycle(ids) {
  const a = [...ids];
  for (let i = a.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a.map((giver, i) => [giver, a[(i + 1) % a.length]]);
}

export async function rollGroup(sql, groupId) {
  return sql.begin(async (tx) => {
    const [g] = await tx`select * from groups where id = ${groupId} for update`;
    if (!g) throw new HttpError(404, 'ჯგუფი ვერ მოიძებნა');
    if (g.rolled_at) return false;
    const mem = await tx`select user_id from members where group_id = ${groupId}`;
    if (mem.length < MIN_PLAYERS) throw new HttpError(400, `გათამაშებისთვის საჭიროა მინიმუმ ${MIN_PLAYERS} მოთამაშე`);
    const pairs = derangementCycle(mem.map((m) => m.user_id));
    await tx`delete from assignments where group_id = ${groupId}`;
    for (const [giver, receiver] of pairs) {
      await tx`insert into assignments (group_id, giver_id, receiver_id) values (${groupId}, ${giver}, ${receiver})`;
    }
    await tx`update groups set rolled_at = now() where id = ${groupId}`;
    return true;
  });
}

// ავტომატური გათამაშება, თუ დრო მოვიდა (უსაფრთხოდ — შეცდომას არ აგდებს)
export async function autoRollDue(sql, groupIds = null) {
  const due = groupIds
    ? await sql`select id from groups where rolled_at is null and roll_at <= now() and id = any(${groupIds})`
    : await sql`select id from groups where rolled_at is null and roll_at <= now() limit 200`;
  let n = 0;
  for (const { id } of due) {
    try { if (await rollGroup(sql, id)) n++; } catch { /* ცოტა მოთამაშე — ველოდებით */ }
  }
  return n;
}

// ---------- group views ----------
async function groupSummaryList(sql, userId) {
  return sql`
    select g.id, g.name, g.icon, g.roll_at, g.rolled_at, g.max_players, g.owner_id,
      (select count(*)::int from members m2 where m2.group_id = g.id) as member_count
    from groups g join members m on m.group_id = g.id
    where m.user_id = ${userId}
    order by g.created_at desc`;
}

async function groupDetail(sql, groupId, me) {
  const [g] = await sql`select * from groups where id = ${groupId}`;
  if (!g) throw new HttpError(404, 'ჯგუფი ვერ მოიძებნა');
  const members = await sql`
    select u.id, u.display_name as name, u.avatar, m.joined_at
    from members m join users u on u.id = m.user_id
    where m.group_id = ${groupId} order by m.joined_at`;
  if (!members.some((m) => m.id === me.id)) throw new HttpError(403, 'თქვენ ამ ჯგუფის წევრი არ ხართ');
  let target = null;
  if (g.rolled_at) {
    const [t] = await sql`
      select u.id, u.display_name as name, u.avatar, u.interests
      from assignments a join users u on u.id = a.receiver_id
      where a.group_id = ${groupId} and a.giver_id = ${me.id}`;
    target = t || null;
  }
  const isOwner = g.owner_id === me.id;
  return {
    id: g.id, name: g.name, icon: g.icon, budget: g.budget, max_players: g.max_players,
    roll_at: g.roll_at, rolled_at: g.rolled_at, owner_id: g.owner_id,
    invite_code: g.invite_code, is_owner: isOwner,
    members, target, min_players: MIN_PLAYERS,
  };
}

async function requireOwner(sql, groupId, me) {
  const [g] = await sql`select * from groups where id = ${groupId}`;
  if (!g) throw new HttpError(404, 'ჯგუფი ვერ მოიძებნა');
  if (g.owner_id !== me.id) throw new HttpError(403, 'ეს მხოლოდ ჯგუფის ადმინს შეუძლია');
  return g;
}

function parseRollAt(v) {
  if (v == null || v === '') return null;
  const d = new Date(v);
  if (isNaN(d)) throw new HttpError(400, 'გათამაშების დრო არასწორია');
  return d;
}
function parseMax(v) {
  const n = parseInt(v, 10);
  if (!(n >= MIN_PLAYERS && n <= 200)) throw new HttpError(400, `მოთამაშეთა ლიმიტი უნდა იყოს ${MIN_PLAYERS}-დან 200-მდე`);
  return n;
}

async function uniqueCode(sql, wanted) {
  if (wanted) {
    const c = normCode(wanted);
    if (c.length < 4) throw new HttpError(400, 'მოსაწვევი კოდი მინიმუმ 4 სიმბოლო (ლათინური ასოები/ციფრები)');
    return c;
  }
  for (let i = 0; i < 8; i++) {
    const c = randomCode();
    const [x] = await sql`select 1 from groups where invite_code = ${c}`;
    if (!x) return c;
  }
  throw new HttpError(500, 'კოდის შექმნა ვერ მოხერხდა');
}

// ---------- router ----------
export async function handle(req) {
  const url = new URL(req.url);
  const path = url.pathname.replace(/^\/api/, '').replace(/\/+$/, '') || '/';
  const method = req.method;
  const body = ['POST', 'PUT', 'PATCH'].includes(method) ? await req.json().catch(() => ({})) : {};
  const sql = db();
  let m;

  // --- auth ---
  if (method === 'POST' && path === '/register') {
    const username = normUser(body.username);
    const name = clean(body.name, 40) || username;
    if (!/^[\p{L}\p{N}_.-]{3,30}$/u.test(username)) throw new HttpError(400, 'მომხმარებლის სახელი: 3-30 სიმბოლო, ჰარის გარეშე');
    if (!validPin(body.pin)) throw new HttpError(400, 'PIN უნდა იყოს 4 ან 6 ციფრი');
    const [exists] = await sql`select 1 from users where username = ${username}`;
    if (exists) throw new HttpError(409, 'ეს სახელი უკვე დაკავებულია, აირჩიეთ სხვა');
    const [u] = await sql`
      insert into users (username, display_name, pin_hash, avatar, interests)
      values (${username}, ${name}, ${hashPin(String(body.pin))}, ${validImage(body.avatar)}, ${clean(body.interests, 500)})
      returning *`;
    const token = await newSession(sql, u.id, !!body.remember);
    return { token, user: publicUser(u) };
  }

  if (method === 'POST' && path === '/login') {
    const username = normUser(body.username);
    const [u] = await sql`select * from users where username = ${username}`;
    if (!u) throw new HttpError(401, 'მომხმარებელი ან PIN არასწორია');
    if (u.locked_until && new Date(u.locked_until) > new Date()) {
      const mins = Math.ceil((new Date(u.locked_until) - Date.now()) / 60000);
      throw new HttpError(429, `ძალიან ბევრი მცდელობა. სცადეთ ${mins} წუთში`);
    }
    if (!validPin(body.pin) || !checkPin(String(body.pin), u.pin_hash)) {
      const fails = u.failed_logins + 1;
      if (fails >= MAX_FAILS) {
        await sql`update users set failed_logins = 0, locked_until = ${new Date(Date.now() + LOCK_MINUTES * 6e4)} where id = ${u.id}`;
        throw new HttpError(429, `ძალიან ბევრი მცდელობა. სცადეთ ${LOCK_MINUTES} წუთში`);
      }
      await sql`update users set failed_logins = ${fails} where id = ${u.id}`;
      throw new HttpError(401, 'მომხმარებელი ან PIN არასწორია');
    }
    await sql`update users set failed_logins = 0, locked_until = null where id = ${u.id}`;
    const token = await newSession(sql, u.id, !!body.remember);
    return { token, user: publicUser(u) };
  }

  // --- public invite preview ---
  if (method === 'GET' && (m = path.match(/^\/invite\/([^/]+)$/))) {
    const code = normCode(decodeURIComponent(m[1]));
    const [g] = await sql`
      select g.name, g.icon, g.max_players, g.rolled_at, g.roll_at, u.display_name as owner_name,
        (select count(*)::int from members where group_id = g.id) as member_count
      from groups g join users u on u.id = g.owner_id where g.invite_code = ${code}`;
    if (!g) throw new HttpError(404, 'მოსაწვევი კოდი ვერ მოიძებნა');
    return { ...g, code };
  }

  // ---- everything below requires login ----
  const me = await authUser(sql, req);

  if (method === 'POST' && path === '/logout') {
    await sql`delete from sessions where token = ${me._token}`;
    return { ok: true };
  }

  if (method === 'GET' && path === '/me') {
    const ids = (await sql`select group_id from members where user_id = ${me.id}`).map((r) => r.group_id);
    if (ids.length) await autoRollDue(sql, ids);
    return { user: publicUser(me), groups: await groupSummaryList(sql, me.id) };
  }

  if (method === 'PUT' && path === '/me') {
    const name = clean(body.name, 40) || me.display_name;
    const interests = body.interests !== undefined ? clean(body.interests, 500) : me.interests;
    const avatar = body.avatar !== undefined ? validImage(body.avatar) : me.avatar;
    let pinHash = me.pin_hash;
    if (body.pin) {
      if (!validPin(body.pin)) throw new HttpError(400, 'PIN უნდა იყოს 4 ან 6 ციფრი');
      pinHash = hashPin(String(body.pin));
    }
    const [u] = await sql`
      update users set display_name = ${name}, interests = ${interests}, avatar = ${avatar}, pin_hash = ${pinHash}
      where id = ${me.id} returning *`;
    return { user: publicUser(u) };
  }

  if (method === 'POST' && path === '/groups') {
    const name = clean(body.name, 60);
    if (!name) throw new HttpError(400, 'მიუთითეთ ჯგუფის სახელი');
    const code = await uniqueCode(sql, body.invite_code);
    try {
      const g = await sql.begin(async (tx) => {
        const [g] = await tx`
          insert into groups (name, icon, budget, max_players, roll_at, invite_code, owner_id)
          values (${name}, ${validImage(body.icon) || '🎁'}, ${clean(body.budget, 60)}, ${parseMax(body.max_players ?? 20)},
                  ${parseRollAt(body.roll_at)}, ${code}, ${me.id})
          returning id`;
        await tx`insert into members (group_id, user_id) values (${g.id}, ${me.id})`;
        return g;
      });
      return { id: g.id };
    } catch (e) {
      if (e.code === '23505') throw new HttpError(409, 'ეს მოსაწვევი კოდი უკვე დაკავებულია');
      throw e;
    }
  }

  if (method === 'POST' && path === '/join') {
    const code = normCode(body.code);
    return sql.begin(async (tx) => {
      const [g] = await tx`select * from groups where invite_code = ${code} for update`;
      if (!g) throw new HttpError(404, 'მოსაწვევი კოდი ვერ მოიძებნა');
      const [already] = await tx`select 1 from members where group_id = ${g.id} and user_id = ${me.id}`;
      if (already) return { id: g.id, already: true };
      if (g.rolled_at) throw new HttpError(400, 'ამ ჯგუფში გათამაშება უკვე ჩატარდა');
      const [{ c }] = await tx`select count(*)::int as c from members where group_id = ${g.id}`;
      if (c >= g.max_players) throw new HttpError(400, 'ჯგუფი სავსეა');
      await tx`insert into members (group_id, user_id) values (${g.id}, ${me.id})`;
      return { id: g.id };
    });
  }

  if ((m = path.match(/^\/groups\/([0-9a-f-]{36})(?:\/([a-z]+))?$/))) {
    const [, gid, action] = m;

    if (method === 'GET' && !action) {
      await autoRollDue(sql, [gid]);
      return groupDetail(sql, gid, me);
    }

    if (method === 'POST' && action === 'leave') {
      const [g] = await sql`select * from groups where id = ${gid}`;
      if (!g) throw new HttpError(404, 'ჯგუფი ვერ მოიძებნა');
      if (g.owner_id === me.id) throw new HttpError(400, 'ადმინს არ შეუძლია დატოვება — წაშალეთ ჯგუფი');
      if (g.rolled_at) throw new HttpError(400, 'გათამაშების შემდეგ ჯგუფის დატოვება შეუძლებელია');
      await sql`delete from members where group_id = ${gid} and user_id = ${me.id}`;
      return { ok: true };
    }

    // owner-only actions
    const g = await requireOwner(sql, gid, me);

    if (method === 'PUT' && !action) {
      const name = body.name !== undefined ? clean(body.name, 60) || g.name : g.name;
      const icon = body.icon !== undefined ? validImage(body.icon) || '🎁' : g.icon;
      const budget = body.budget !== undefined ? clean(body.budget, 60) : g.budget;
      const max = body.max_players !== undefined ? parseMax(body.max_players) : g.max_players;
      const rollAt = body.roll_at !== undefined ? parseRollAt(body.roll_at) : g.roll_at;
      const code = body.invite_code !== undefined && normCode(body.invite_code) !== g.invite_code
        ? await uniqueCode(sql, body.invite_code) : g.invite_code;
      const [{ c }] = await sql`select count(*)::int as c from members where group_id = ${gid}`;
      if (max < c) throw new HttpError(400, `ჯგუფში უკვე ${c} მოთამაშეა — ლიმიტი ამაზე ნაკლები ვერ იქნება`);
      try {
        await sql`update groups set name=${name}, icon=${icon}, budget=${budget}, max_players=${max},
                  roll_at=${rollAt}, invite_code=${code} where id=${gid}`;
      } catch (e) {
        if (e.code === '23505') throw new HttpError(409, 'ეს მოსაწვევი კოდი უკვე დაკავებულია');
        throw e;
      }
      return { ok: true };
    }

    if (method === 'DELETE' && !action) {
      await sql`delete from groups where id = ${gid}`;
      return { ok: true };
    }

    if (method === 'POST' && action === 'kick') {
      if (body.user_id === me.id) throw new HttpError(400, 'საკუთარი თავის გაგდება არ შეიძლება');
      if (g.rolled_at) throw new HttpError(400, 'ჯერ გააუქმეთ გათამაშება, შემდეგ გააგდეთ მოთამაშე');
      await sql`delete from members where group_id = ${gid} and user_id = ${body.user_id}`;
      return { ok: true };
    }

    if (method === 'POST' && action === 'roll') {
      if (g.rolled_at) throw new HttpError(400, 'უკვე გათამაშებულია');
      await rollGroup(sql, gid);
      return { ok: true };
    }

    if (method === 'POST' && action === 'reset') {
      await sql.begin(async (tx) => {
        await tx`delete from assignments where group_id = ${gid}`;
        // გაუქმების შემდეგ ავტო-გათამაშება აღარ გაეშვება, სანამ ადმინი ახალ დროს არ დააყენებს
        await tx`update groups set rolled_at = null, roll_at = null where id = ${gid}`;
      });
      return { ok: true };
    }
  }

  throw new HttpError(404, 'ასეთი მოთხოვნა არ არსებობს');
}

export async function respond(req) {
  try {
    const data = await handle(req);
    return Response.json(data, { headers: { 'cache-control': 'no-store' } });
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 500;
    if (status === 500) console.error(e);
    const error = e instanceof HttpError ? e.message : 'სერვერის შეცდომა, სცადეთ თავიდან';
    return Response.json({ error }, { status, headers: { 'cache-control': 'no-store' } });
  }
}
