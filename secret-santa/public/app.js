const app = document.getElementById('app');
const heroLede = document.getElementById('hero-lede');
const heroMeta = document.getElementById('hero-meta');
let editing = false;
let poll = null;
let draft = null;

function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'htmlFor') el.htmlFor = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'value' && 'value' in el) el.value = v;
    else if (k === 'checked') el.checked = !!v;
    else if (k === 'selected') el.selected = !!v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  const add = c => {
    if (c == null || c === false) return;
    if (Array.isArray(c)) c.forEach(add);
    else el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  };
  children.forEach(add);
  return el;
}

function stopPoll() { if (poll) clearInterval(poll); poll = null; }

async function api(path, opts = {}) {
  const headers = { 'content-type': 'application/json' };
  if (path.startsWith('admin') && localStorage.adminKey) headers['x-admin-key'] = localStorage.adminKey;
  let res;
  try {
    res = await fetch('/api/' + path, {
      method: opts.method || (opts.body ? 'POST' : 'GET'),
      headers,
      body: opts.body ? JSON.stringify(opts.body) : undefined
    });
  } catch {
    throw new Error('Can’t reach the server. Is it still running?');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Something went wrong');
  return data;
}

function prettyDate(iso) {
  if (!iso) return '';
  const d = new Date(iso + 'T00:00:00');
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' });
}

function money(s) {
  if (!s || s.budget == null || s.budget === '') return '';
  const n = Number(String(s.budget).replace(/,/g, ''));
  if (s.currency && !Number.isNaN(n)) return s.currency + n.toLocaleString('en-US');
  return String(s.budget);
}

function paintHero(settings) {
  const price = money(settings || {});
  const when = settings && settings.date ? prettyDate(settings.date) : '';
  const bits = [when, price && ('Budget ' + price)].filter(Boolean);
  heroLede.textContent = bits.length
    ? 'Share the link, add a wish list, and the names draw themselves once everyone is in.'
    : 'Set a date, pick a budget, and share one link. Pairings stay secret — even from the organizer.';
  heroMeta.textContent = bits.join('   ·   ');
}

function setStep(step) {
  document.body.dataset.step = step;
  document.body.dataset.compact = step === 'welcome' ? '0' : '1';
}

function playerLink() {
  return location.origin + location.pathname;
}

function confirmBtn(label, onclick) {
  return h('button', { class: 'confirm', type: 'button', onclick },
    h('span', { class: 'ico', 'aria-hidden': 'true' }, '✓'),
    h('span', { class: 'label' }, label),
    h('span', { class: 'chevs', 'aria-hidden': 'true' }, '›››'));
}

function goBtn(label, onclick) {
  return h('button', { class: 'go', type: 'button', onclick },
    h('span', { class: 'ico', 'aria-hidden': 'true' }, '››'),
    h('span', { class: 'label' }, label),
    h('span', { class: 'chevs', 'aria-hidden': 'true' }, '›››'));
}

function showError(node, err) { node.textContent = err && err.message ? err.message : (err || ''); }

async function copyLink(btn) {
  const link = playerLink();
  try {
    await navigator.clipboard.writeText(link);
    const prev = btn.textContent;
    btn.textContent = 'Copied';
    setTimeout(() => { btn.textContent = prev; }, 1600);
  } catch {
    btn.textContent = 'Select the link';
  }
}

function wishRow(value, onRemove) {
  const input = h('input', { class: 'field', value: value || '', placeholder: 'Gift name or https:// link', 'aria-label': 'Gift name or link' });
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); document.querySelector('#app .plus')?.click(); }
  });
  return h('div', { class: 'row wish' },
    h('div', { class: 'grow' }, input),
    h('button', { class: 'x', type: 'button', 'aria-label': 'Remove gift', onclick: onRemove }, '×'));
}

function render(node) {
  stopPoll();
  app.replaceChildren(node);
}

async function start() {
  if (location.hash === '#admin') return admin();
  return player();
}

async function player() {
  const pub = await api('public');
  paintHero(pub.settings);
  const me = +localStorage.me;
  const who = pub.members.find(m => m.id === me);
  if (!who) {
    delete localStorage.me;
    setStep('welcome');
    return welcome(pub);
  }
  if (pub.drawn) return reveal(pub, who);
  if (who.submitted && !editing) return waiting(pub, who);
  return wishlist(pub, who);
}

function welcome(pub) {
  setStep('welcome');
  const price = money(pub.settings);
  const when = prettyDate(pub.settings.date);
  const bits = [when, price && ('up to ' + price)].filter(Boolean);
  render(h('div', {},
    h('p', { class: 'kicker' }, pub.settings.name || 'Secret Santa'),
    h('h2', {}, 'Ready when you are'),
    h('div', { class: 'accent' }),
    h('p', { class: 'sub' }, bits.length ? bits.join(' · ') : 'The organizer sets the date, the budget, and the guest list. You only need the link.'),
    h('div', { class: 'stack' },
      goBtn('I’m playing', () => pickName(pub)),
      h('button', { class: 'ghost', type: 'button', onclick: () => { location.hash = '#admin'; } }, 'I’m organizing')
    ),
    pub.total ? h('p', { class: 'fine' }, pub.ready + ' of ' + pub.total + ' lists are in.') : null
  ));
}

function pickName(pub) {
  setStep('pick');
  if (!pub.members.length) {
    render(h('div', {},
      h('div', { class: 'headrow' },
        h('button', { class: 'back', type: 'button', onclick: () => welcome(pub), 'aria-label': 'Back' }, '‹'),
        h('h2', {}, 'No names yet')),
      h('p', { class: 'sub' }, 'The organizer is still putting the group together. Check back in a bit.')
    ));
    return;
  }
  const err = h('div', { class: 'err', role: 'alert' });
  render(h('div', {},
    h('div', { class: 'headrow' },
      h('button', { class: 'back', type: 'button', onclick: () => welcome(pub), 'aria-label': 'Back' }, '‹'),
      h('div', {}, h('p', { class: 'kicker' }, 'Your name'), h('h2', {}, 'Who are you?'))),
    h('div', { class: 'sheet sheet-green' },
      h('p', { class: 'sub' }, 'Pick yourself from the group. You’ll add a wish list next.'),
      h('div', { class: 'stack' }, pub.members.map(m =>
        h('button', {
          class: 'choice', type: 'button',
          onclick: () => { localStorage.me = String(m.id); editing = false; player(); }
        }, h('span', {}, m.name), m.submitted ? h('small', {}, 'List in') : h('small', {}, 'Waiting'))
      ))
    ),
    err
  ));
}

async function wishlist(pub, who) {
  setStep('list');
  let mine = { wishes: [], note: '' };
  try { mine = await api('mine/' + who.id); } catch (e) { /* keep empty form */ }
  const rows = h('div', { class: 'stack', id: 'wishes' });
  const seed = mine.wishes && mine.wishes.length ? mine.wishes : [{ title: '', url: '' }];
  const addRow = (item) => {
    const value = item && item.url ? item.url : (item && item.title) || '';
    const row = wishRow(value, () => { if (rows.children.length > 1) row.remove(); else row.querySelector('input').value = ''; });
    rows.append(row);
  };
  seed.forEach(addRow);
  const note = h('textarea', {
    class: 'area', maxlength: '280', placeholder: 'You can give me something of your choice as well',
    'aria-label': 'Note for your secret santa'
  });
  note.value = mine.note || '';
  const err = h('div', { class: 'err', role: 'alert' });
  const submit = async () => {
    err.textContent = '';
    const items = [...rows.querySelectorAll('input')].map(input => ({ title: input.value, url: '' })).filter(it => it.title.trim());
    try {
      await api('submit', { body: { memberId: who.id, note: note.value, items } });
      editing = false;
      await player();
    } catch (e) { showError(err, e); }
  };
  const price = money(pub.settings);
  render(h('div', {},
    h('div', { class: 'headrow' },
      h('button', { class: 'back', type: 'button', 'aria-label': 'Back', onclick: () => { delete localStorage.me; editing = false; player(); } }, '‹'),
      h('div', {}, h('p', { class: 'kicker' }, who.name), h('h2', {}, 'Add gifts to your wishlist'))),
    h('div', { class: 'accent' }),
    h('p', { class: 'sub' }, price ? ('Keep each gift around ' + price + '.') : 'Add names, links, or both.'),
    h('div', { class: 'sheet sheet-cream' },
      rows,
      h('div', { class: 'addbar' }, h('button', {
        class: 'plus', type: 'button', 'aria-label': 'Add another gift',
        onclick: () => { if (rows.children.length >= 12) { err.textContent = 'Twelve gifts is the limit here.'; return; } addRow(); rows.lastChild.querySelector('input').focus(); }
      }, '+')),
      h('label', { class: 'lbl', style: 'margin-top:14px' }, h('span', {}, 'A note, if you want one'), note)
    ),
    err,
    confirmBtn(mine.submitted ? 'Update my list' : 'Submit my list', submit)
  ));
}

async function waiting(pub, who) {
  setStep('wait');
  let mine = { wishes: [], note: '' };
  try { mine = await api('mine/' + who.id); } catch (e) { /* status still useful */ }
  const pct = pub.total ? Math.round((pub.ready / pub.total) * 100) : 0;
  let message = 'Names are drawn automatically once every list is in. This page checks for you.';
  if (pub.total < 2) message = 'The group needs at least two people before a draw can happen.';
  else if (pub.ready < pub.total) message = 'Waiting on ' + (pub.total - pub.ready) + ' more ' + (pub.total - pub.ready === 1 ? 'list' : 'lists') + '.';
  else if (!pub.rosterFinal) message = 'Every current list is in. Pairings start once the organizer locks the guest list. They still won’t see who got whom.';
  else message = 'Every list is in. Pairings show up here as soon as the draw finishes. The organizer never sees them.';
  render(h('div', {},
    h('p', { class: 'kicker' }, 'Hi ' + who.name),
    h('h2', {}, 'You’re on the list'),
    h('div', { class: 'accent' }),
    h('div', { class: 'sheet sheet-cream' },
      h('p', { class: 'sub', style: 'color:#5c4d44' }, pub.ready + ' of ' + pub.total + ' lists submitted'),
      h('div', { class: 'progress', 'aria-hidden': 'true' }, h('span', { style: 'width:' + pct + '%' })),
      h('p', { class: 'fine' }, message),
      mine.wishes && mine.wishes.length ? h('div', { class: 'stack', style: 'margin-top:14px' }, mine.wishes.map(wishView)) : null,
      mine.note ? h('p', { class: 'quote' }, mine.note) : null
    ),
    h('div', { class: 'links' },
      h('button', { class: 'texty', type: 'button', onclick: () => { editing = true; wishlist(pub, who); } }, 'Edit my list'),
      h('button', { class: 'texty', type: 'button', onclick: () => { delete localStorage.me; editing = false; player(); } }, 'Not you?')
    )
  ));
  poll = setInterval(async () => {
    try {
      const next = await api('public');
      if (next.drawn || next.ready !== pub.ready) player();
    } catch { /* keep the current screen */ }
  }, 4000);
}

function wishView(w) {
  const safe = /^https?:\/\//i.test(w.url || '');
  if (safe) return h('a', { class: 'gift', href: w.url, target: '_blank', rel: 'noopener noreferrer' }, h('span', {}, w.title), h('small', {}, 'Open'));
  return h('div', { class: 'gift' }, h('span', {}, w.title));
}

async function reveal(pub, who) {
  setStep('reveal');
  let gift;
  try { gift = await api('assignment/' + who.id); }
  catch (e) {
    render(h('div', {}, h('h2', {}, 'Not quite yet'), h('p', { class: 'sub' }, e.message)));
    return;
  }
  const price = money(gift);
  render(h('div', {},
    h('p', { class: 'kicker' }, 'Only you can see this'),
    h('h2', {}, 'You’re gifting'),
    h('div', { class: 'sheet sheet-green' },
      h('p', { class: 'kicker' }, 'Your person'),
      h('h2', {}, gift.name),
      h('div', { class: 'row' },
        price ? h('span', { class: 'chip' }, 'Budget ' + price) : null,
        pub.settings.date ? h('span', { class: 'chip' }, prettyDate(pub.settings.date)) : null
      ),
      gift.note ? h('p', { class: 'quote' }, '“' + gift.note + '”') : null,
      h('div', { class: 'stack', style: 'margin-top:14px' },
        gift.wishes.length ? gift.wishes.map(wishView) : h('p', {}, gift.note ? 'No specific gifts — the note is the brief.' : 'They left the gift up to you.')
      ),
      h('p', { class: 'fine' }, 'The organizer can’t see this pairing, and neither can anyone else who opens the link as themselves.')
    ),
    h('div', { class: 'links' },
      h('button', { class: 'texty', type: 'button', onclick: () => { delete localStorage.me; player(); } }, 'Not you?')
    )
  ));
  poll = setInterval(async () => {
    try {
      const next = await api('public');
      if (!next.drawn) player();
    } catch { /* keep the current screen */ }
  }, 4000);
}

async function admin() {
  setStep('admin');
  if (!localStorage.adminKey) return login();
  let data;
  try { data = await api('admin'); }
  catch (e) {
    delete localStorage.adminKey;
    return login(e.message);
  }
  paintHero(data.settings);
  if (!draft) {
    draft = {
      name: data.settings.name || 'Secret Santa',
      date: data.settings.date || '',
      budget: data.settings.budget || '',
      currency: data.settings.currency || '$'
    };
  }
  const err = h('div', { class: 'err', role: 'alert' });
  const refresh = async () => { draft = { ...draft }; await admin(); };

  const name = h('input', { class: 'dark-field', value: draft.name, 'aria-label': 'Group name', oninput: e => { draft.name = e.target.value; } });
  const date = h('input', { class: 'dark-field', type: 'date', value: draft.date, 'aria-label': 'Event date', oninput: e => { draft.date = e.target.value; } });
  const currency = h('select', { class: 'dark-field', 'aria-label': 'Currency', style: 'max-width:88px', onchange: e => { draft.currency = e.target.value; refresh(); } },
    ['$', '€', '£', '₹'].map(c => h('option', { value: c, selected: c === draft.currency }, c)));
  const budget = h('input', { class: 'dark-field', inputmode: 'numeric', value: draft.budget, placeholder: '50', 'aria-label': 'Price limit', oninput: e => { draft.budget = e.target.value.replace(/[^\d]/g, ''); e.target.value = draft.budget; } });
  const presets = [25, 50, 75, 100, 150, 300];
  const person = h('input', { class: 'dark-field', placeholder: 'Add a person', 'aria-label': 'Person’s name', maxlength: '60' });
  const link = h('input', { class: 'dark-field', readonly: 'readonly', value: playerLink(), 'aria-label': 'Player link' });

  const save = async () => {
    err.textContent = '';
    try {
      await api('admin/settings', { body: { name: draft.name, date: draft.date, budget: draft.budget, currency: draft.currency } });
      await admin();
    } catch (e) { showError(err, e); }
  };
  const addPerson = async () => {
    err.textContent = '';
    try {
      await api('admin/members', { body: { name: person.value } });
      person.value = '';
      await admin();
    } catch (e) { showError(err, e); }
  };
  person.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); addPerson(); } });

  const ready = data.ready === data.members.length && data.members.length >= 2;
  const rosterFinal = !!data.settings.rosterFinal;
  let drawBlock;
  if (data.drawn) {
    drawBlock = h('div', { class: 'sheet sheet-green' },
      h('h2', { style: 'font-size:28px' }, 'The draw is done'),
      h('p', {}, 'Pairings are hidden on this page, including from you. Everyone opens the player link, picks their name, and sees only their own person.'),
      h('div', { style: 'margin-top:14px' }, h('button', {
        class: 'ghost', type: 'button',
        onclick: async () => {
          if (!confirm('This clears the pairings for everyone. Wish lists stay. Continue?')) return;
          try { await api('admin/reset', { method: 'POST', body: {} }); await admin(); }
          catch (e) { showError(err, e); }
        }
      }, 'Reset the draw'))
    );
  } else if (ready && rosterFinal) {
    drawBlock = h('div', { class: 'block' },
      h('p', { class: 'sub' }, data.settings.drawError || 'Everyone has submitted. Run the draw if it did not start on its own. You still will not see who got whom.'),
      confirmBtn('Draw names', async () => {
        err.textContent = '';
        try { await api('admin/draw', { method: 'POST', body: {} }); await admin(); }
        catch (e) { showError(err, e); }
      })
    );
  } else if (ready) {
    drawBlock = h('p', { class: 'fine' }, 'Every current list is in. Lock the guest list when nobody else is joining, and the draw will run. You will not see the pairs.');
  } else {
    drawBlock = h('p', { class: 'fine' }, 'Names draw automatically once the guest list is locked and every person has submitted. You will not see the result.');
  }

  const nm = Object.fromEntries(data.members.map(m => [m.id, m.name]));
  const givers = h('select', { class: 'dark-field', 'aria-label': 'First person' }, h('option', { value: '' }, 'Person'), ...data.members.map(m => h('option', { value: m.id }, m.name)));
  const receivers = h('select', { class: 'dark-field', 'aria-label': 'Person they can’t draw' }, h('option', { value: '' }, 'Can’t draw'), ...data.members.map(m => h('option', { value: m.id }, m.name)));
  const both = h('input', { type: 'checkbox', id: 'both' });

  render(h('div', {},
    h('div', { class: 'headrow' },
      h('button', { class: 'back', type: 'button', 'aria-label': 'Back to players', onclick: () => { location.hash = ''; } }, '‹'),
      h('div', {}, h('p', { class: 'kicker' }, 'Organizer'), h('h2', {}, 'Set up the draw'))),
    h('div', { class: 'stack' },
      h('label', { class: 'lbl' }, h('span', {}, 'Group name'), name),
      h('label', { class: 'lbl' }, h('span', {}, 'Event date'), date),
      h('div', {},
        h('span', { class: 'lbl' }, h('span', {}, 'Price limit')),
        h('div', { class: 'presets', style: 'margin:8px 0' }, presets.map(n =>
          h('button', {
            type: 'button', 'aria-pressed': String(draft.budget) === String(n),
            onclick: () => { draft.budget = String(n); refresh(); }
          }, (draft.currency || '$') + n)
        )),
        h('div', { class: 'row' }, currency, h('div', { class: 'grow' }, budget))
      )
    ),
    err,
    confirmBtn('Save date and price', save),
    h('div', { class: 'block', style: 'margin-top:18px' },
      h('h2', { style: 'font-size:26px' }, 'People'),
      h('p', { class: 'sub' }, data.members.length ? (data.ready + ' of ' + data.members.length + ' lists submitted' + (rosterFinal ? ' · guest list locked' : '')) : 'Add everyone who is playing, including you if you want a giftee.'),
      h('div', { class: 'stack' }, data.members.map(m => h('div', { class: 'status' },
        h('span', { class: 'row' }, h('span', { class: 'dot' + (m.submitted ? ' on' : '') }), m.name),
        h('span', { class: 'row' },
          h('small', {}, m.submitted ? 'List in' : 'Waiting'),
          data.drawn || rosterFinal ? null : h('button', {
            class: 'x', type: 'button', 'aria-label': 'Remove ' + m.name,
            onclick: async () => { try { await api('admin/members/' + m.id, { method: 'DELETE' }); await admin(); } catch (e) { showError(err, e); } }
          }, '×')
        )
      ))),
      data.drawn || rosterFinal ? null : h('div', { class: 'row', style: 'margin-top:10px' },
        h('div', { class: 'grow' }, person),
        h('button', { class: 'plus', type: 'button', 'aria-label': 'Add person', onclick: addPerson }, '+')
      ),
      data.drawn ? null : h('div', { style: 'margin-top:12px' }, rosterFinal
        ? h('button', { class: 'ghost', type: 'button', onclick: async () => { try { await api('admin/roster', { body: { final: false } }); await admin(); } catch (e) { showError(err, e); } } }, 'Reopen guest list')
        : h('button', { class: 'ghost', type: 'button', onclick: async () => { try { await api('admin/roster', { body: { final: true } }); await admin(); } catch (e) { showError(err, e); await admin(); } } }, 'Lock guest list'))
    ),
    h('div', { class: 'block', style: 'margin-top:18px' },
      h('h2', { style: 'font-size:26px' }, 'Share the link'),
      h('p', { class: 'sub' }, 'Players open this, pick their name, and send their list.'),
      h('div', { class: 'share' },
        link,
        h('button', { class: 'ghost', type: 'button', onclick: e => copyLink(e.currentTarget) }, 'Copy')
      ),
      (!data.settings.date || !data.settings.budget) ? h('p', { class: 'fine' }, 'Save a date and a price limit so players see them beside the list.') : null
    ),
    h('div', { class: 'block', style: 'margin-top:18px' }, drawBlock),
    h('details', {},
      h('summary', {}, 'Keep two people apart (optional)'),
      h('p', { class: 'fine' }, 'Useful for couples. Players never see this, and it never reveals who was drawn.'),
      h('div', { class: 'stack', style: 'margin-top:10px' }, data.exclusions.map(x => h('div', { class: 'status' },
        h('span', {}, (nm[x.giver] || 'Someone') + ' can’t draw ' + (nm[x.receiver] || 'someone')),
        data.drawn ? null : h('button', {
          class: 'x', type: 'button', 'aria-label': 'Remove exclusion',
          onclick: async () => { try { await api('admin/exclusions/' + x.giver + '/' + x.receiver, { method: 'DELETE' }); await admin(); } catch (e) { showError(err, e); } }
        }, '×')
      ))),
      data.drawn ? null : h('div', { class: 'stack', style: 'margin-top:10px' },
        givers, receivers,
        h('label', { class: 'row fine' }, both, 'Both directions'),
        h('button', {
          class: 'ghost', type: 'button',
          onclick: async () => {
            try {
              await api('admin/exclusions', { body: { giver: givers.value, receiver: receivers.value, both: both.checked } });
              await admin();
            } catch (e) { showError(err, e); }
          }
        }, 'Add exclusion')
      )
    ),
    h('p', { class: 'links' }, h('button', { class: 'texty', type: 'button', onclick: () => { delete localStorage.adminKey; draft = null; login(); } }, 'Log out'))
  ));
}

function login(message) {
  setStep('admin');
  paintHero(null);
  const key = h('input', { class: 'dark-field', type: 'password', placeholder: 'Organizer password', 'aria-label': 'Organizer password' });
  const err = h('div', { class: 'err', role: 'alert' }, message || '');
  const go = () => { localStorage.adminKey = key.value; draft = null; admin(); };
  key.addEventListener('keydown', e => { if (e.key === 'Enter') go(); });
  render(h('div', {},
    h('div', { class: 'headrow' },
      h('button', { class: 'back', type: 'button', 'aria-label': 'Back', onclick: () => { location.hash = ''; } }, '‹'),
      h('div', {}, h('p', { class: 'kicker' }, 'Organizer'), h('h2', {}, 'Unlock setup'))),
    h('p', { class: 'sub' }, 'This password lives in .dev.vars on the computer hosting the app. Players never need it.'),
    key,
    err,
    h('div', { style: 'margin-top:12px' }, confirmBtn('Continue', go))
  ));
}

window.addEventListener('hashchange', () => { editing = false; start().catch(e => { app.textContent = e.message; }); });
start().catch(e => { app.textContent = e.message; });
