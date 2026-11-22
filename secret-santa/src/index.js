const J = (d, s = 200) => new Response(JSON.stringify(d), {
  status: s, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
const bad = (m, s = 400) => J({ error: m }, s);
const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const numId = v => { const n = Number(v); return Number.isInteger(n) && n > 0 ? n : 0; };

let schemaPromise = null;
function schemaReady(db) {
  if (!schemaPromise) {
    schemaPromise = ensureSchema(db).catch(err => { schemaPromise = null; throw err; });
  }
  return schemaPromise;
}

async function ensureSchema(db) {
  await db.batch([
    db.prepare('CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT)'),
    db.prepare(`CREATE TABLE IF NOT EXISTS members (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      drawn_id INTEGER,
      note TEXT,
      submitted INTEGER NOT NULL DEFAULT 0
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS exclusions (
      giver INTEGER NOT NULL, receiver INTEGER NOT NULL,
      PRIMARY KEY (giver, receiver)
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS wishes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      member_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      url TEXT
    )`)
  ]);
  const info = await db.prepare('PRAGMA table_info(members)').all();
  const cols = new Set(info.results.map(c => c.name));
  if (!cols.has('note')) await db.prepare('ALTER TABLE members ADD COLUMN note TEXT').run();
  if (!cols.has('submitted')) await db.prepare('ALTER TABLE members ADD COLUMN submitted INTEGER NOT NULL DEFAULT 0').run();
}

async function getSettings(db) {
  const { results } = await db.prepare('SELECT key,value FROM settings').all();
  const s = { name: 'Secret Santa', date: '', budget: '', currency: '$', drawn: '0', drawError: '', roster: 'open' };
  for (const r of results) s[r.key] = r.value;
  return s;
}
const setSetting = (db, k, v) => db.prepare(
  'INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').bind(k, String(v));

function publicSettings(s) {
  return { name: s.name, date: s.date, budget: s.budget, currency: s.currency || '$', rosterFinal: s.roster === 'final' };
}

// Random assignment where nobody draws themselves or an excluded person (backtracking).
function solve(ids, ban) {
  const order = shuffle([...ids]), used = new Set(), res = {};
  const go = i => {
    if (i === order.length) return true;
    const g = order[i];
    for (const r of shuffle(ids.filter(x => x !== g && !used.has(x) && !ban.has(g + ':' + x)))) {
      used.add(r); res[g] = r;
      if (go(i + 1)) return true;
      used.delete(r);
    }
    return false;
  };
  return go(0) ? res : null;
}

function cleanItem(it) {
  let title = String(it?.title || '').trim().slice(0, 200);
  let url = String(it?.url || '').trim().slice(0, 1000);
  if (!url && /^https?:\/\//i.test(title)) url = title;
  if (url) {
    try {
      const u = new URL(url);
      if (u.protocol !== 'http:' && u.protocol !== 'https:') return { error: 'Links must start with http:// or https://' };
      url = u.href.slice(0, 1000);
      if (title === url || /^https?:\/\//i.test(title)) {
        const path = u.pathname === '/' ? '' : u.pathname;
        title = (u.hostname.replace(/^www\./, '') + path).slice(0, 80) || u.hostname;
      }
    } catch {
      return { error: 'That link doesn’t look valid.' };
    }
  }
  if (!title) return null;
  return { title, url: url || null };
}

// Runs only when every current player has submitted. The result is stored,
// but never returned to the organizer.
async function maybeDraw(db) {
  const s = await getSettings(db);
  if (s.drawn === '1') return { drawn: true };
  const { results } = await db.prepare('SELECT id, submitted FROM members').all();
  const ready = results.filter(r => Number(r.submitted) === 1).length;
  if (s.roster !== 'final' || results.length < 2 || ready !== results.length) {
    return { drawn: false, ready, total: results.length, rosterFinal: s.roster === 'final' };
  }
  const ids = results.map(r => r.id);
  const ban = new Set((await db.prepare('SELECT giver,receiver FROM exclusions').all()).results.map(r => r.giver + ':' + r.receiver));
  const res = solve(ids, ban);
  if (!res) {
    const msg = 'No valid draw exists with these exclusions. Remove one and try again.';
    await setSetting(db, 'drawError', msg).run();
    return { drawn: false, ready, total: results.length, error: msg };
  }
  await db.batch([
    ...ids.map(id => db.prepare('UPDATE members SET drawn_id=? WHERE id=?').bind(res[id], id)),
    setSetting(db, 'drawn', '1'),
    setSetting(db, 'drawError', '')
  ]);
  return { drawn: true, ready, total: results.length };
}

export default {
  async fetch(req, env) {
    const u = new URL(req.url);
    if (!u.pathname.startsWith('/api/')) return env.ASSETS.fetch(req);
    const p = u.pathname.slice(5).split('/').filter(Boolean), m = req.method, db = env.DB;
    const body = (m === 'GET' || m === 'DELETE') ? {} : await req.json().catch(() => ({}));
    try {
      await schemaReady(db);

      if (p[0] === 'public' && m === 'GET') {
        const s = await getSettings(db);
        const { results } = await db.prepare('SELECT id,name,submitted FROM members ORDER BY name').all();
        const members = results.map(r => ({ id: r.id, name: r.name, submitted: Number(r.submitted) === 1 }));
        return J({
          settings: publicSettings(s),
          drawn: s.drawn === '1',
          rosterFinal: s.roster === 'final',
          members,
          ready: members.filter(r => r.submitted).length,
          total: members.length
        });
      }

      if (p[0] === 'mine' && m === 'GET') {
        const id = numId(p[1]);
        const me = await db.prepare('SELECT id,name,note,submitted FROM members WHERE id=?').bind(id).first();
        if (!me) return bad('That person is not in this group.', 404);
        const wishes = (await db.prepare('SELECT id,title,url FROM wishes WHERE member_id=? ORDER BY id').bind(id).all()).results;
        return J({ id: me.id, name: me.name, note: me.note || '', submitted: Number(me.submitted) === 1, wishes });
      }

      if (p[0] === 'assignment' && m === 'GET') {
        const id = numId(p[1]);
        const me = await db.prepare('SELECT drawn_id FROM members WHERE id=?').bind(id).first();
        if (!me || !me.drawn_id) return bad('Names have not been drawn yet.', 404);
        const t = await db.prepare('SELECT id,name,note FROM members WHERE id=?').bind(me.drawn_id).first();
        const wishes = (await db.prepare('SELECT id,title,url FROM wishes WHERE member_id=? ORDER BY id').bind(t.id).all()).results;
        const s = await getSettings(db);
        return J({ name: t.name, note: t.note || '', wishes, budget: s.budget, currency: s.currency || '$', date: s.date });
      }

      if (p[0] === 'submit' && m === 'POST') {
        const memberId = numId(body.memberId);
        const member = await db.prepare('SELECT id FROM members WHERE id=?').bind(memberId).first();
        if (!member) return bad('Pick your name from the group first.');
        const s = await getSettings(db);
        if (s.drawn === '1') return bad('The draw is locked, so lists can’t be edited.');
        const note = String(body.note || '').trim().slice(0, 280);
        const rawItems = Array.isArray(body.items) ? body.items.slice(0, 20) : [];
        const clean = [];
        for (const it of rawItems) {
          const item = cleanItem(it);
          if (!item) continue;
          if (item.error) return bad(item.error);
          clean.push(item);
        }
        if (!clean.length && !note) return bad('Add at least one gift, or leave a short note.');
        await db.batch([
          db.prepare('DELETE FROM wishes WHERE member_id=?').bind(memberId),
          ...clean.map(it => db.prepare('INSERT INTO wishes(member_id,title,url) VALUES(?,?,?)').bind(memberId, it.title, it.url)),
          db.prepare('UPDATE members SET note=?, submitted=1 WHERE id=?').bind(note, memberId)
        ]);
        const draw = await maybeDraw(db);
        return J({ ok: true, drawn: !!draw.drawn, error: draw.error || '' });
      }

      if (p[0] === 'admin') {
        if (!env.ADMIN_KEY || req.headers.get('x-admin-key') !== env.ADMIN_KEY) return bad('Wrong organizer password.', 401);
        const s = await getSettings(db), drawn = s.drawn === '1';
        const sub = p[1];
        if (!sub && m === 'GET') {
          // Names and progress only. drawn_id is intentionally not selected.
          const mem = (await db.prepare('SELECT id,name,submitted FROM members ORDER BY name').all()).results
            .map(r => ({ id: r.id, name: r.name, submitted: Number(r.submitted) === 1 }));
          const ex = (await db.prepare('SELECT giver,receiver FROM exclusions').all()).results;
          return J({
            settings: {
              name: s.name, date: s.date, budget: s.budget, currency: s.currency || '$',
              drawError: s.drawError || '', rosterFinal: s.roster === 'final'
            },
            drawn,
            ready: mem.filter(r => r.submitted).length,
            members: mem,
            exclusions: ex
          });
        }
        if (sub === 'settings' && m === 'POST') {
          const name = String(body.name || 'Secret Santa').trim().slice(0, 100) || 'Secret Santa';
          const date = String(body.date || '').trim().slice(0, 50);
          const currency = ['$', '€', '£', '₹'].includes(body.currency) ? body.currency : '$';
          const amount = String(body.budget ?? '').trim().replace(/,/g, '');
          if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) return bad('Pick a date from the calendar.');
          if (amount && !/^\d{1,7}$/.test(amount)) return bad('Enter a price limit as a whole number.');
          if (amount && Number(amount) <= 0) return bad('The price limit needs to be at least 1.');
          await db.batch([
            setSetting(db, 'name', name),
            setSetting(db, 'date', date),
            setSetting(db, 'budget', amount),
            setSetting(db, 'currency', currency)
          ]);
          return J({ ok: true });
        }
        if (sub === 'roster' && m === 'POST') {
          if (drawn) return bad('Reset the draw before changing the guest list.');
          const final = body.final ? 'final' : 'open';
          await setSetting(db, 'roster', final).run();
          const draw = final === 'final' ? await maybeDraw(db) : { drawn: false };
          if (draw.error) return bad(draw.error);
          return J({ ok: true, drawn: !!draw.drawn });
        }
        if (sub === 'members' && m === 'POST') {
          if (drawn) return bad('Reset the draw before changing participants.');
          if (s.roster === 'final') return bad('Reopen the guest list before adding someone.');
          const name = String(body.name || '').trim().slice(0, 60);
          if (!name) return bad('Enter a name.');
          try { await db.prepare('INSERT INTO members(name) VALUES(?)').bind(name).run(); }
          catch { return bad('That name is already in the group.'); }
          return J({ ok: true });
        }
        if (sub === 'members' && m === 'DELETE') {
          if (drawn) return bad('Reset the draw before changing participants.');
          if (s.roster === 'final') return bad('Reopen the guest list before removing someone.');
          const id = numId(p[2]);
          await db.batch([
            db.prepare('DELETE FROM members WHERE id=?').bind(id),
            db.prepare('DELETE FROM wishes WHERE member_id=?').bind(id),
            db.prepare('DELETE FROM exclusions WHERE giver=? OR receiver=?').bind(id, id)
          ]);
          const draw = await maybeDraw(db);
          return J({ ok: true, drawn: !!draw.drawn });
        }
        if (sub === 'exclusions' && m === 'POST') {
          if (drawn) return bad('Reset the draw before changing exclusions.');
          const g = numId(body.giver), r = numId(body.receiver);
          if (!g || !r || g === r) return bad('Pick two different people.');
          const st = [db.prepare('INSERT OR IGNORE INTO exclusions VALUES(?,?)').bind(g, r)];
          if (body.both) st.push(db.prepare('INSERT OR IGNORE INTO exclusions VALUES(?,?)').bind(r, g));
          await db.batch(st);
          return J({ ok: true });
        }
        if (sub === 'exclusions' && m === 'DELETE') {
          if (drawn) return bad('Reset the draw before changing exclusions.');
          await db.prepare('DELETE FROM exclusions WHERE giver=? AND receiver=?').bind(numId(p[2]), numId(p[3])).run();
          return J({ ok: true });
        }
        if (sub === 'draw' && m === 'POST') {
          if (drawn) return bad('Names are already drawn. Reset first if you want to redo it.');
          const draw = await maybeDraw(db);
          if (draw.error) return bad(draw.error);
          if (!draw.drawn) {
            if ((draw.total || 0) < 2) return bad('Add at least 2 participants.');
            if (!draw.rosterFinal) return bad('Lock the guest list before drawing names.');
            return bad('Wait until every person has submitted a list.');
          }
          return J({ ok: true });
        }
        if (sub === 'reset' && m === 'POST') {
          await db.batch([
            db.prepare('UPDATE members SET drawn_id=NULL'),
            setSetting(db, 'drawn', '0'),
            setSetting(db, 'drawError', '')
          ]);
          return J({ ok: true });
        }
      }
      return bad('Not found', 404);
    } catch (e) { return bad(e.message || 'Something went wrong', 500); }
  }
};
