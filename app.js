/* Frost & Flame – Daily Tasks (PWA). Its own app, separate from the F&F Tracker, but the same
 * backend, the same PINs and the same sessions. Talks to the backend only through window.FFApi. */
(function () {
  'use strict';
  var USERS = ['Karimulla', 'Thanmayee', 'Gopi', 'All'];
  var state = { loaded: false, tasksLoaded: false, view: 'mine', taskTab: 'mine', me: null,
    tasks: [], people: [], daysLeft: null, openingDate: '2026-11-26', todayTab: '', todayTabExists: false, tasksCached: false };

  /* ---------------- helpers ---------------- */
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function niceDate(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || ''); if (!m) return iso || '';
    return Number(m[3]) + ' ' + ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][Number(m[2]) - 1] + ' ' + m[1];
  }

  /* ---------------- UI plumbing ---------------- */
  var toastTimer;
  function toast(msg, bad) {
    var t = $('#toast'); t.textContent = msg; t.className = 'toast' + (bad ? ' bad' : ''); t.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(function () { t.hidden = true; }, bad ? 4200 : 2600);
  }
  function busy(on, text) { $('#busy').hidden = !on; $('#busy-text').textContent = text || 'Saving…'; }
  function fail(e) {
    busy(false);
    if (e && e.code === 'auth') return; // lock screen already shown
    toast((e && e.message) || 'Something went wrong', true);
  }

  /* ---------------- lock screen: pick who you are, then your own PIN ---------------- */
  var pin = '', lockUser = '', mode = 'login', loginPin = '', newPin1 = '';
  function drawDots() {
    var box = $('#pin-dots'), len = Math.max(4, pin.length); box.innerHTML = '';
    for (var i = 0; i < len; i++) { var d = document.createElement('i'); if (i < pin.length) d.className = 'on'; box.appendChild(d); }
  }
  function pickStep(msg) {
    mode = 'login'; pin = ''; lockUser = ''; loginPin = ''; newPin1 = '';
    $('#lock-users').hidden = false; $('#lock-pin').hidden = true; $('#users-msg').textContent = msg || '';
  }
  function pinStep(user) {
    lockUser = user; mode = 'login'; pin = ''; drawDots();
    $('#lock-users').hidden = true; $('#lock-pin').hidden = false; $('#not-you').hidden = false;
    $('#pin-ask').textContent = 'Hi ' + user + ' – enter your PIN'; $('#lock-msg').textContent = '';
    clearInterval(lockTimer); $$('#keypad button').forEach(function (b) { b.disabled = false; });
  }
  function newPinStep(first) {
    mode = first ? 'new1' : 'new2'; pin = ''; drawDots(); $('#not-you').hidden = true;
    $('#lock-users').hidden = true; $('#lock-pin').hidden = false;
    $('#pin-ask').textContent = first ? 'Welcome ' + lockUser + '! Choose your own PIN (4–8 digits)' : 'Type your new PIN again';
  }
  function showLock(msg) {
    pickStep(msg); $('#app').hidden = true; $('#lock').hidden = false;
    state.tasksLoaded = false; state.me = null; state.tasks = []; state.people = []; state.taskTab = 'mine';
    FFApi.clearLocalData();                                                           // forget data when locked
    $$('.view').forEach(function (v) { v.innerHTML = ''; });                         // and wipe it from the screen
  }
  function showApp() { $('#lock').hidden = true; $('#app').hidden = false; }
  function enterApp() { pin = ''; loginPin = ''; newPin1 = ''; drawDots(); $('#lock-msg').textContent = ''; showApp(); go('mine'); load(); }
  var lockTimer;
  function lockCountdown(sec) {
    var keys = $$('#keypad button'); keys.forEach(function (b) { b.disabled = true; });
    clearInterval(lockTimer);
    var end = Date.now() + sec * 1000;
    function tick() {
      var left = Math.ceil((end - Date.now()) / 1000);
      if (left <= 0) { clearInterval(lockTimer); keys.forEach(function (b) { b.disabled = false; }); $('#lock-msg').textContent = 'Try again'; return; }
      $('#lock-msg').textContent = 'Too many wrong PINs for ' + lockUser + '. Try again in ' + Math.floor(left / 60) + ':' + pad(left % 60);
    }
    tick(); lockTimer = setInterval(tick, 1000);
  }
  function shake() { var dots = $('#pin-dots'); dots.classList.remove('shake'); void dots.offsetWidth; dots.classList.add('shake'); }
  function submitPin() {
    if (pin.length < 4) { $('#lock-msg').textContent = 'Enter at least 4 digits'; return; }
    if (mode === 'new1') {
      if (pin === loginPin) { pin = ''; drawDots(); shake(); $('#lock-msg').textContent = 'Choose a different PIN from the one you were given'; return; }
      newPin1 = pin; $('#lock-msg').textContent = ''; return newPinStep(false);
    }
    if (mode === 'new2') {
      if (pin !== newPin1) { $('#lock-msg').textContent = "Those didn't match – start again"; shake(); return newPinStep(true); }
      $('#lock-msg').textContent = 'Saving…';
      return FFApi.changePin(loginPin, newPin1).then(function () { toast('Your new PIN is set'); enterApp(); },
        function (e) { $('#lock-msg').textContent = e.message; newPinStep(true); });
    }
    var tried = pin; $('#lock-msg').textContent = 'Checking…';
    FFApi.login(lockUser, tried).then(function (r) {
      if (r.mustChangePin) { loginPin = tried; $('#lock-msg').textContent = ''; return newPinStep(true); }
      enterApp();
    }, function (e) {
      pin = ''; drawDots(); shake();
      if (e.code === 'locked') lockCountdown(e.extra.retryAfter || 900);
      else if (e.code === 'bad_pin') $('#lock-msg').textContent = 'Wrong PIN' + (e.extra.remaining != null ? ' · ' + e.extra.remaining + ' tries left' : '');
      else $('#lock-msg').textContent = e.message;
    });
  }
  $$('.user-pick').forEach(function (b) { b.addEventListener('click', function () { pinStep(b.getAttribute('data-user')); }); });
  $('#not-you').addEventListener('click', function () { pickStep(); });
  $('#keypad').addEventListener('click', function (ev) {
    var b = ev.target.closest('button'); if (!b || b.disabled) return;
    var k = b.getAttribute('data-k');
    if (k === 'del') pin = pin.slice(0, -1);
    else if (k === 'ok') return submitPin();
    else if (pin.length < 8) pin += k;
    if (mode === 'login' || pin.length) $('#lock-msg').textContent = '';
    drawDots();
  });
  document.addEventListener('keydown', function (ev) {
    if ($('#lock').hidden || $('#lock-pin').hidden) return;
    if (/^\d$/.test(ev.key) && pin.length < 8) { pin += ev.key; drawDots(); }
    else if (ev.key === 'Backspace') { pin = pin.slice(0, -1); drawDots(); }
    else if (ev.key === 'Enter') submitPin();
  });
  FFApi.onAuthLost(function (msg) { showLock(msg || 'Please unlock again'); });

  /* ---------------- data ---------------- */
  function applyTasks(r) {
    state.tasks = r.tasks || []; state.people = r.people || [];
    state.daysLeft = r.daysLeft; state.openingDate = r.openingDate || '2026-11-26';
    state.todayTab = r.todayTab || ''; state.todayTabExists = !!r.todayTabExists;
    state.tasksCached = !!r.cached; state.tasksLoaded = true;
    if (r.me) state.me = r.me;
  }
  function load(silent) {
    if (!silent && !state.tasksLoaded) renderSkeleton();
    state.taskErr = null;
    return FFApi.tasks().then(function (r) { applyTasks(r); render(); }, function (e) {
      if (e && e.code === 'auth') return;
      state.taskErr = e;
      if (state.tasksLoaded) { netState(); toast(e.message || 'Could not refresh', true); render(); }
      else showLoadError(e);
    });
  }
  function viewEl() { return state.view === 'settings' ? $('#view-settings') : $('#view-tasks'); }
  function showLoadError(e) {
    netState();
    viewEl().innerHTML = '<div class="card empty"><b>Can\'t load right now</b>' + esc((e && e.message) || 'Something went wrong') +
      '<div style="margin-top:14px"><button class="btn btn-ice" id="retry">Try again</button></div></div>';
    if ($('#retry')) $('#retry').onclick = function () { load(); };
  }
  function renderSkeleton() { $('#view-tasks').innerHTML = '<div class="skeleton" style="height:170px"></div><div class="skeleton"></div><div class="skeleton"></div>'; }

  /* ---------------- navigation: My tasks | Team | Settings ---------------- */
  var TITLES = { mine: 'My tasks', team: 'Team', settings: 'Settings' };
  function go(v) {
    state.view = v;
    if (v === 'mine' || v === 'team') state.taskTab = v;
    $('#view-tasks').hidden = v === 'settings'; $('#view-settings').hidden = v !== 'settings';
    $$('.tab[data-view]').forEach(function (t) { t.classList.toggle('active', t.getAttribute('data-view') === v); });
    $('#view-title').textContent = TITLES[v]; window.scrollTo(0, 0);
    if (v === 'settings') renderSettings();
    else if (state.tasksLoaded) renderTasks();
    else if (state.taskErr) showLoadError(state.taskErr);
  }
  $$('.tab[data-view]').forEach(function (t) { t.addEventListener('click', function () { go(t.getAttribute('data-view')); }); });
  $('#btn-refresh').addEventListener('click', function () {
    load().then(function () { if (state.tasksLoaded && !state.taskErr && !state.tasksCached) toast('Up to date'); });
  });
  function render() { if (state.view === 'settings') renderSettings(); else renderTasks(); }

  /* ---------------- TASKS ---------------- */
  function isMineTask(t) {
    var o = String(t.owner || '').trim().toLowerCase();
    var me = state.me && state.me.user ? state.me.user.toLowerCase() : '';
    return o === me || o === 'all';
  }
  function sortTasks(list) {
    return list.slice().sort(function (a, b) {
      if (!!a.done !== !!b.done) return a.done ? 1 : -1;
      if (!!a.carriedOver !== !!b.carriedOver) return a.carriedOver ? 1 : -1;
      return 0;
    });
  }
  function countdownCard() {
    var n = state.daysLeft;
    if (n == null) n = '';
    var unit, label;
    if (n === 0) { unit = 'Opening day'; label = 'Today, ' + niceOpen(state.openingDate); }
    else { unit = n === 1 ? 'day to go' : 'days to go'; label = 'Opening ' + niceOpen(state.openingDate); }
    return '<div class="card hero countdown"><div class="hero-label">Frost &amp; Flame opens</div>' +
      '<div class="countdown-num" data-test="days-left">' + esc(String(n)) + '</div>' +
      '<div class="countdown-unit">' + esc(unit) + '</div>' +
      '<div class="note" style="margin:8px 0 0">' + esc(label) + '</div>' +
      (state.tasksCached ? '<div class="task-pending" data-test="cached-note">Showing the last list saved on this phone</div>' : '') +
      (!state.tasksCached && state.tasksLoaded && !state.todayTabExists ? '<div class="note" data-test="no-today-tab" style="margin:6px 0 0">Today\'s list (' + esc(state.todayTab) + ') isn\'t in the checklist yet – showing what is still open.</div>' : '') +
      '</div>';
  }
  function niceOpen(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
    if (!m) return iso || '';
    var d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getDay()] + ' ' + d.getDate() + ' ' +
      ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getMonth()] + ' ' + m[1];
  }
  function taskRow(t) {
    var meta = [t.category, t.dueLabel || (t.dueDate ? niceDate(t.dueDate) : ''), t.owner && !isMineTask(t) ? t.owner : ''].filter(Boolean).join(' · ');
    var carry = t.carriedOver && t.carriedFrom
      ? '<div class="task-carry" data-test="carried-from">Carried over from ' + esc(t.carriedFrom) + '</div>' : '';
    var pending = t.pending ? '<div class="task-pending">Will update the list when you are online</div>' : '';
    return '<li class="task-row' + (t.done ? ' done' : '') + '" data-task-id="' + esc(t.id) + '">' +
      '<button type="button" class="task-tick" role="checkbox" aria-checked="' + (t.done ? 'true' : 'false') +
      '" data-test="task-tick" data-tick="' + esc(t.id) + '" aria-label="' + esc((t.done ? 'Mark not done: ' : 'Mark done: ') + t.task) + '">' +
      (t.done ? '✓' : '') + '</button>' +
      '<div class="task-body"><div class="task-title" data-test="task-title">' + esc(t.task) + '</div>' +
      (meta ? '<div class="task-meta">' + esc(meta) + '</div>' : '') + carry + pending + '</div></li>';
  }
  function wireTicks(root) {
    $$('[data-tick]', root).forEach(function (b) {
      b.onclick = function () {
        var id = b.getAttribute('data-tick');
        var t = state.tasks.filter(function (x) { return x.id === id; })[0];
        if (!t) return;
        var want = !t.done;
        t.done = want; t.status = want ? 'Done' : 'Not started';
        renderTasks();
        FFApi.setTaskDone(id, want, t.task).then(function (r) {
          if (r.task) {
            state.tasks = state.tasks.map(function (x) { return x.id === id ? Object.assign({}, x, r.task, { pending: !!r.queued }) : x; });
          }
          if (r.queued) toast('Saved on this phone – will update the list when you are online');
          // refresh people counts
          if (state.people) {
            state.people = state.people.map(function (p) {
              var list = state.tasks.filter(function (x) {
                return String(x.owner || '').trim().toLowerCase() === String(p.user || '').trim().toLowerCase();
              });
              return Object.assign({}, p, { total: list.length, done: list.filter(function (x) { return x.done; }).length });
            });
          }
          if (state.view !== 'settings') renderTasks();
        }, function (e) {
          t.done = !want; t.status = t.done ? 'Done' : 'Not started';
          fail(e);
          if (state.view !== 'settings') renderTasks();
        });
      };
    });
  }
  function renderTasks() {
    var el = $('#view-tasks');
    if (!state.tasksLoaded) {
      el.innerHTML = '<div class="skeleton" style="height:170px"></div><div class="skeleton"></div>';
      return;
    }
    var mine = sortTasks(state.tasks.filter(isMineTask));
    var mineDone = mine.filter(function (t) { return t.done; }).length;
    var html = countdownCard();
    if (state.taskTab === 'team') {
      html += (state.people || []).map(function (p) {
        var pct = p.total ? Math.round(p.done / p.total * 100) : 0;
        var barCls = p.user === 'Gopi' ? 'fl' : '';
        return '<div class="card person-prog" data-test="progress-' + esc(p.user) + '">' +
          '<div class="person-prog-top"><span>' + esc(p.user) + '</span><b>' + p.done + '/' + p.total + '</b></div>' +
          '<div class="bar ' + barCls + '"><i style="width:' + pct + '%"></i></div></div>';
      }).join('');
      var all = sortTasks(state.tasks);
      html += '<div class="card"><div class="card-head"><h3>Everyone today</h3><span class="muted">' +
        all.filter(function (t) { return t.done; }).length + '/' + all.length + '</span></div>';
      html += all.length ? '<ul class="task-list">' + all.map(taskRow).join('') + '</ul>' : '<div class="empty">No tasks today</div>';
      html += '</div>';
    } else {
      html += '<div class="card"><div class="card-head"><h3>My tasks today</h3><span class="muted" data-test="my-count">' +
        mineDone + '/' + mine.length + '</span></div>';
      html += mine.length ? '<ul class="task-list" data-test="my-tasks">' + mine.map(taskRow).join('') + '</ul>'
        : '<div class="empty"><b>Nothing for you today</b>Enjoy the quiet, or check the team list.</div>';
      html += '</div>';
    }
    el.innerHTML = html;
    $('#view-title').textContent = state.taskTab === 'team' ? 'Team' : 'My tasks';
    wireTicks(el);
  }

  /* ---------------- SETTINGS ---------------- */
  function renderSettings() {
    var el = $('#view-settings');
    el.innerHTML = '<div class="card"><h3>Change my PIN</h3><p class="note" style="margin-top:-4px">Signed in as <b data-test="me">' + esc(state.me ? state.me.user : '') + '</b>' + (state.me && state.me.isAdmin ? ' (admin)' : '') + '. This is the same PIN as the F&amp;F Tracker. You can only change your own PIN. Never share it.</p><form class="form" id="pin-form" autocomplete="off">' +
      '<div class="field"><label for="pin-old">Current PIN</label><input class="input" id="pin-old" type="password" inputmode="numeric" maxlength="8"></div>' +
      '<div class="field"><label for="pin-new">New PIN (4–8 digits)</label><input class="input" id="pin-new" type="password" inputmode="numeric" maxlength="8"></div>' +
      '<div class="err" id="pin-err"></div><button class="btn" type="submit">Change PIN</button></form></div>' +
      (state.me && state.me.isAdmin ? '<div class="card" id="owner-admin"><h3>Change a task owner</h3><p class="note" style="margin-top:-4px">Only you can do this. It is kept out of the main task screens.</p><div id="owner-list"></div></div>' : '') +
      '<div class="card"><h3>This phone</h3><p class="note" style="margin-top:-4px">Locking signs this phone out of Daily Tasks and the F&amp;F Tracker. Your tasks stay in the Google Sheet.</p><button class="btn" id="btn-lock">Lock / switch person</button></div>' +
      '<p class="note">Daily tasks come from the Opening Checklist Google Sheet, one tab per day. Ticks are written back to that sheet and to its Daily log. Nothing is stored on this phone except the unlock key and, for offline use, your last task list.</p>';
    $('#pin-form').addEventListener('submit', function (ev) {
      ev.preventDefault(); var o = $('#pin-old').value, n = $('#pin-new').value;
      if (!/^\d{4,8}$/.test(n)) { $('#pin-err').textContent = 'New PIN must be 4–8 digits'; return; }
      if (o === n) { $('#pin-err').textContent = 'Choose a different PIN'; return; }
      busy(true); FFApi.changePin(o, n).then(function () { busy(false); toast('PIN changed'); $('#pin-old').value = $('#pin-new').value = ''; $('#pin-err').textContent = ''; },
        function (e) { busy(false); $('#pin-err').textContent = e.message; });
    });
    $('#btn-lock').onclick = function () { FFApi.logout(); showLock('Locked'); };
    if (state.me && state.me.isAdmin && $('#owner-list')) {
      var open = state.tasks.filter(function (t) { return !t.done; });
      if (!state.tasksLoaded) $('#owner-list').innerHTML = '<p class="note">Open My tasks first to load today\'s list.</p>';
      else if (!open.length) $('#owner-list').innerHTML = '<p class="note">No open tasks to reassign.</p>';
      else $('#owner-list').innerHTML = open.map(function (t) {
        var opts = USERS.map(function (u) {
          return '<option' + (u === t.owner ? ' selected' : '') + '>' + esc(u) + '</option>';
        }).join('');
        return '<div class="field"><label>' + esc(t.task) + '</label><select class="input" data-owner-id="' + esc(t.id) + '">' + opts + '</select></div>';
      }).join('');
      $$('[data-owner-id]', el).forEach(function (sel) {
        sel.onchange = function () {
          var id = sel.getAttribute('data-owner-id'), owner = sel.value;
          busy(true, 'Saving…');
          FFApi.setTaskOwner(id, owner).then(function (r) {
            state.tasks = state.tasks.map(function (x) { return x.id === id ? Object.assign({}, x, r.task) : x; });
            busy(false); toast('Owner changed to ' + owner);
          }, fail);
        };
      });
    }
  }

  /* ---------------- online / offline ---------------- */
  function netState() { $('#offline-bar').hidden = navigator.onLine; document.body.classList.toggle('is-offline', !navigator.onLine); }
  window.addEventListener('online', function () { netState(); if (!$('#app').hidden) FFApi.flushTicks().catch(function () {}).then(function () { return load(true); }); });
  window.addEventListener('offline', netState);
  netState();

  /* ---------------- start ---------------- */
  drawDots(); state.me = null;
  if (FFApi.hasToken()) { showApp(); go('mine'); load(); } else showLock();
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    window.addEventListener('load', function () { navigator.serviceWorker.register('sw.js').catch(function () {}); });
  }
})();
