/**
 * Sign-in for the Emberwake website and game.
 *
 * Two backends share one interface:
 *  - Firebase Authentication (Google, email + password) when
 *    AUTH_CONFIG.firebase.apiKey is set.
 *  - A local demo backend otherwise: email accounts live in this browser's
 *    localStorage with PBKDF2-hashed passwords. Nothing leaves the device.
 *
 * Exposes window.SiteAuth and renders the header button and sign-in dialog.
 */
(function () {
  const CONFIG = window.AUTH_CONFIG || { firebase: {}, providers: {} };
  const FIREBASE_SDK = 'https://www.gstatic.com/firebasejs/10.12.2/';
  const PROVIDER_NAMES = { google: 'Google', email: 'Email' };

  const listeners = new Set();
  let currentUser = null;
  let backend = null;
  let resolveReady;
  const ready = new Promise((r) => (resolveReady = r));

  function setUser(user) {
    currentUser = user;
    listeners.forEach((fn) => fn(user));
  }

  // ---------------------------------------------------------------- Firebase
  async function createFirebaseBackend() {
    const [{ initializeApp }, fb] = await Promise.all([
      import(FIREBASE_SDK + 'firebase-app.js'),
      import(FIREBASE_SDK + 'firebase-auth.js'),
    ]);
    const app = initializeApp(CONFIG.firebase);
    const auth = fb.getAuth(app);
    auth.useDeviceLanguage();

    const toUser = (u) => {
      if (!u) return null;
      const pid = (u.providerData[0] && u.providerData[0].providerId) || 'password';
      const provider = pid === 'google.com' ? 'google' : 'email';
      return {
        uid: u.uid,
        name: u.displayName || (u.email ? u.email.split('@')[0] : 'Developer'),
        email: u.email || '',
        photo: u.photoURL || '',
        provider,
        emailVerified: u.emailVerified,
        createdAt: u.metadata.creationTime,
      };
    };

    fb.onAuthStateChanged(auth, (u) => setUser(toUser(u)));
    await auth.authStateReady();

    function makeProvider(name) {
      if (name === 'google') {
        const p = new fb.GoogleAuthProvider();
        p.setCustomParameters({ prompt: 'select_account' });
        return p;
      }
      throw new Error('Unknown provider');
    }

    return {
      mode: 'firebase',
      async signInWith(name) {
        const provider = makeProvider(name);
        try {
          await fb.signInWithPopup(auth, provider);
        } catch (err) {
          if (err.code === 'auth/popup-blocked') return fb.signInWithRedirect(auth, provider);
          throw err;
        }
      },
      async signInEmail(email, password) {
        await fb.signInWithEmailAndPassword(auth, email, password);
      },
      async signUpEmail(name, email, password) {
        const cred = await fb.createUserWithEmailAndPassword(auth, email, password);
        await fb.updateProfile(cred.user, { displayName: name });
        await fb.sendEmailVerification(cred.user);
        setUser(toUser(auth.currentUser));
      },
      async resetPassword(email) {
        await fb.sendPasswordResetEmail(auth, email);
      },
      async signOut() {
        await fb.signOut(auth);
      },
      async deleteAccount() {
        await fb.deleteUser(auth.currentUser);
      },
    };
  }

  // -------------------------------------------------------------------- Demo
  function createDemoBackend() {
    const USERS = 'ew.demo.users';
    const SESSION = 'ew.demo.session';

    const read = (key, fallback) => {
      try { return JSON.parse(localStorage.getItem(key)) || fallback; } catch { return fallback; }
    };
    const write = (key, value) => {
      try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage unavailable */ }
    };

    const hex = (buf) => Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');

    async function hashPassword(password, saltHex) {
      if (!window.crypto || !crypto.subtle) throw codeError('demo/insecure-context');
      const salt = new Uint8Array(saltHex.match(/../g).map((h) => parseInt(h, 16)));
      const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
      const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 150000 }, key, 256);
      return hex(bits);
    }

    const publicUser = (rec) => rec && ({
      uid: rec.uid, name: rec.name, email: rec.email, photo: '', provider: 'email',
      emailVerified: false, createdAt: rec.createdAt,
    });

    function restore() {
      const users = read(USERS, {});
      const email = read(SESSION, null);
      setUser(email && users[email] ? publicUser(users[email]) : null);
    }
    restore();
    window.addEventListener('storage', (e) => { if (e.key === USERS || e.key === SESSION) restore(); });

    return {
      mode: 'demo',
      async signInWith() {
        throw codeError('demo/provider-unavailable');
      },
      async signInEmail(email, password) {
        const users = read(USERS, {});
        const rec = users[email.toLowerCase()];
        if (!rec || (await hashPassword(password, rec.salt)) !== rec.hash) throw codeError('auth/invalid-credential');
        write(SESSION, rec.email);
        setUser(publicUser(rec));
      },
      async signUpEmail(name, email, password) {
        email = email.toLowerCase();
        const users = read(USERS, {});
        if (users[email]) throw codeError('auth/email-already-in-use');
        if (password.length < 8) throw codeError('auth/weak-password');
        const salt = hex(crypto.getRandomValues(new Uint8Array(16)));
        const rec = {
          uid: 'local-' + hex(crypto.getRandomValues(new Uint8Array(8))),
          name, email, salt,
          hash: await hashPassword(password, salt),
          createdAt: new Date().toUTCString(),
        };
        users[email] = rec;
        write(USERS, users);
        write(SESSION, email);
        setUser(publicUser(rec));
      },
      async resetPassword() {
        throw codeError('demo/reset-unavailable');
      },
      async signOut() {
        try { localStorage.removeItem(SESSION); } catch { /* ignore */ }
        setUser(null);
      },
      async deleteAccount() {
        const users = read(USERS, {});
        if (currentUser) delete users[currentUser.email];
        write(USERS, users);
        try { localStorage.removeItem(SESSION); } catch { /* ignore */ }
        setUser(null);
      },
    };
  }

  function codeError(code) {
    const err = new Error(code);
    err.code = code;
    return err;
  }

  const MESSAGES = {
    'auth/invalid-credential': 'That email and password don’t match an account.',
    'auth/wrong-password': 'That email and password don’t match an account.',
    'auth/user-not-found': 'That email and password don’t match an account.',
    'auth/invalid-email': 'Enter a valid email address.',
    'auth/email-already-in-use': 'An account with this email already exists. Try signing in.',
    'auth/weak-password': 'Use at least 8 characters for your password.',
    'auth/too-many-requests': 'Too many attempts. Wait a minute and try again.',
    'auth/popup-closed-by-user': 'The sign-in window was closed before finishing.',
    'auth/cancelled-popup-request': 'The sign-in window was closed before finishing.',
    'auth/account-exists-with-different-credential': 'This email is already linked to another sign-in method. Use that one instead.',
    'auth/unauthorized-domain': 'This domain isn’t authorized for sign-in yet. Add it in Firebase → Authentication → Settings → Authorized domains.',
    'auth/operation-not-allowed': 'This sign-in method isn’t enabled in Firebase yet.',
    'auth/network-request-failed': 'Network error. Check your connection and try again.',
    'auth/requires-recent-login': 'For security, sign in again before deleting your account.',
    'demo/provider-unavailable': 'Google sign-in needs a Firebase project. Use email for now, or see README.md to set it up.',
    'demo/reset-unavailable': 'Password reset emails need Firebase. In demo mode, create a new account instead.',
    'demo/insecure-context': 'Your browser blocked secure hashing on this page. Open the site through a local server (see README.md).',
    'demo/backend-failed': 'Sign-in couldn’t load. Check your connection and Firebase settings.',
  };
  const messageFor = (err) => MESSAGES[err && err.code] || 'Something went wrong. Please try again.';

  async function init() {
    const useFirebase = CONFIG.firebase && CONFIG.firebase.apiKey;
    try {
      backend = useFirebase ? await createFirebaseBackend() : createDemoBackend();
    } catch (err) {
      console.error('Firebase failed to load, falling back to demo mode.', err);
      backend = createDemoBackend();
      backend.loadError = true;
    }
    resolveReady();
  }

  const call = (method) => async (...args) => {
    await ready;
    return backend[method](...args);
  };

  window.SiteAuth = {
    ready,
    get mode() { return backend ? backend.mode : 'loading'; },
    get user() { return currentUser; },
    providerName: (p) => PROVIDER_NAMES[p] || p,
    onChange(fn) { listeners.add(fn); fn(currentUser); return () => listeners.delete(fn); },
    signInWith: call('signInWith'),
    signInEmail: call('signInEmail'),
    signUpEmail: call('signUpEmail'),
    resetPassword: call('resetPassword'),
    signOut: call('signOut'),
    deleteAccount: call('deleteAccount'),
    messageFor,
    open: (view) => openDialog(view),
  };

  // ======================================================================= UI
  const ICONS = {
    google: '<svg viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.6 5.4 2.6 13.2l7.9 6.2C12.4 13.6 17.7 9.5 24 9.5z"/><path fill="#4285F4" d="M46.1 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.4c-.5 2.9-2.2 5.3-4.6 6.9l7.4 5.8c4.3-4 6.9-9.9 6.9-17.2z"/><path fill="#FBBC05" d="M10.5 28.6c-.5-1.4-.8-3-.8-4.6s.3-3.2.8-4.6l-7.9-6.2C1 16.5 0 20.1 0 24s1 7.5 2.6 10.8l7.9-6.2z"/><path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.4-5.8c-2.1 1.4-4.8 2.3-8.5 2.3-6.3 0-11.6-4.1-13.5-9.9l-7.9 6.2C6.6 42.6 14.6 48 24 48z"/></svg>',
  };

  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const initials = (name) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('') || '?';

  let dialog, lastFocus;

  function buildDialog() {
    const p = CONFIG.providers || {};
    // Google refuses sign-in inside embedded app windows (desktop and Android
    // apps), so offer it only in a real browser.
    const embedded = /Electron/.test(navigator.userAgent) || !!window.Capacitor;
    const social = ['google'].filter((k) => p[k] !== false && !embedded)
      .map((k) => `<button type="button" class="social-btn social-${k}" data-provider="${k}">${ICONS[k]}<span>Continue with ${PROVIDER_NAMES[k]}</span></button>`)
      .join('');

    const el = document.createElement('div');
    el.className = 'modal-overlay';
    el.id = 'authDialog';
    el.innerHTML = `
      <div class="modal auth-modal" role="dialog" aria-modal="true" aria-labelledby="authTitle">
        <button type="button" class="modal-x" data-close aria-label="Close">&times;</button>
        <img src="${rootPath()}assets/icons/logo.svg" alt="" class="auth-logo" width="40" height="40">
        <h2 id="authTitle" class="auth-title">Sign in</h2>
        <p class="auth-sub" id="authSub">Keep your stats and play online under your name.</p>

        <div class="social-list">${social}</div>
        ${social && p.email !== false ? '<div class="auth-divider"><span>or</span></div>' : ''}

        <form class="auth-form" id="authForm" novalidate>
          <label class="field" data-only="signup"><span>Full name</span>
            <input name="name" type="text" autocomplete="name" maxlength="80"></label>
          <label class="field"><span>Email</span>
            <input name="email" type="email" autocomplete="email" required></label>
          <label class="field" data-hide="reset"><span>Password</span>
            <input name="password" type="password" autocomplete="current-password" minlength="8" required></label>
          <button type="button" class="link-btn forgot" data-only="signin" data-view="reset">Forgot password?</button>
          <p class="auth-error" id="authError" role="alert" hidden></p>
          <p class="auth-ok" id="authOk" role="status" hidden></p>
          <button type="submit" class="btn btn-primary btn-block" id="authSubmit">Sign in</button>
        </form>

        <p class="auth-switch" data-only="signin">New here? <button type="button" class="link-btn" data-view="signup">Create an account</button></p>
        <p class="auth-switch" data-only="signup">Already have an account? <button type="button" class="link-btn" data-view="signin">Sign in</button></p>
        <p class="auth-switch" data-only="reset"><button type="button" class="link-btn" data-view="signin">Back to sign in</button></p>

        <p class="auth-legal">By continuing you agree to the <a href="${rootPath()}terms.html">Terms of Use</a> and acknowledge the <a href="${rootPath()}privacy.html">Privacy Policy</a>.</p>
        <p class="auth-demo" id="authDemo" hidden>Demo mode: accounts are saved only in this browser.</p>
        ${embedded && p.google !== false ? '<p class="auth-demo">Google sign-in is available on the website. In the app, use your email.</p>' : ''}
      </div>`;
    document.body.appendChild(el);

    el.addEventListener('click', (e) => {
      if (e.target === el || e.target.closest('[data-close]')) closeDialog();
      const v = e.target.closest('[data-view]');
      if (v) setView(v.dataset.view);
      const s = e.target.closest('[data-provider]');
      if (s) run(s, () => SiteAuth.signInWith(s.dataset.provider));
    });
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closeDialog();
      if (e.key === 'Tab') trapFocus(e, el.querySelector('.modal'));
    });
    el.querySelector('#authForm').addEventListener('submit', onSubmit);
    return el;
  }

  function setView(view) {
    dialog.dataset.view = view;
    const titles = { signin: 'Sign in to Emberwake', signup: 'Create your account', reset: 'Reset your password' };
    const subs = {
      signin: 'Keep your stats and play online under your name.',
      signup: 'Free, takes a few seconds. No credit card.',
      reset: 'Enter your account email and we’ll send you a reset link.',
    };
    dialog.querySelector('#authTitle').textContent = titles[view];
    dialog.querySelector('#authSub').textContent = subs[view];
    dialog.querySelector('#authSubmit').textContent = { signin: 'Sign in', signup: 'Create account', reset: 'Send reset link' }[view];
    dialog.querySelectorAll('[data-only]').forEach((n) => (n.hidden = n.dataset.only !== view));
    dialog.querySelectorAll('[data-hide]').forEach((n) => (n.hidden = n.dataset.hide === view));
    dialog.querySelector('.social-list').hidden = view === 'reset';
    const div = dialog.querySelector('.auth-divider');
    if (div) div.hidden = view === 'reset';
    const pw = dialog.querySelector('[name=password]');
    pw.autocomplete = view === 'signup' ? 'new-password' : 'current-password';
    pw.required = view !== 'reset';
    dialog.querySelector('[name=name]').required = view === 'signup';
    showError('');
    showOk('');
  }

  function showError(msg) {
    const n = dialog.querySelector('#authError');
    n.textContent = msg;
    n.hidden = !msg;
  }
  function showOk(msg) {
    const n = dialog.querySelector('#authOk');
    n.textContent = msg;
    n.hidden = !msg;
  }

  async function run(button, fn) {
    showError('');
    showOk('');
    button.disabled = true;
    button.classList.add('is-busy');
    try {
      await fn();
      return true;
    } catch (err) {
      showError(messageFor(err));
      return false;
    } finally {
      button.disabled = false;
      button.classList.remove('is-busy');
    }
  }

  async function onSubmit(e) {
    e.preventDefault();
    const form = e.currentTarget;
    const view = dialog.dataset.view;
    const name = form.name.value.trim();
    const email = form.email.value.trim();
    const password = form.password.value;

    if (view === 'signup' && !name) return showError('Enter your name.');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return showError('Enter a valid email address.');
    if (view !== 'reset' && password.length < (view === 'signup' ? 8 : 1)) {
      return showError(view === 'signup' ? 'Use at least 8 characters for your password.' : 'Enter your password.');
    }

    const btn = form.querySelector('#authSubmit');
    if (view === 'reset') {
      if (await run(btn, () => SiteAuth.resetPassword(email))) showOk('If an account exists for that email, a reset link is on its way.');
      return;
    }
    const ok = await run(btn, () => (view === 'signup' ? SiteAuth.signUpEmail(name, email, password) : SiteAuth.signInEmail(email, password)));
    if (ok) form.reset();
  }

  function trapFocus(e, root) {
    const items = [...root.querySelectorAll('button, a[href], input')].filter((n) => !n.disabled && n.offsetParent !== null);
    if (!items.length) return;
    const first = items[0], last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) { last.focus(); e.preventDefault(); }
    else if (!e.shiftKey && document.activeElement === last) { first.focus(); e.preventDefault(); }
  }

  function openDialog(view = 'signin') {
    if (!dialog) dialog = buildDialog();
    lastFocus = document.activeElement;
    setView(view);
    dialog.querySelector('#authDemo').hidden = SiteAuth.mode !== 'demo';
    dialog.classList.add('open');
    document.body.classList.add('no-scroll');
    setTimeout(() => dialog.querySelector('.social-btn, input[name=email]').focus(), 50);
  }

  function closeDialog() {
    if (!dialog) return;
    dialog.classList.remove('open');
    document.body.classList.remove('no-scroll');
    if (lastFocus) lastFocus.focus();
  }

  function rootPath() {
    const s = document.querySelector('script[src$="js/auth.js"]');
    return s ? s.getAttribute('src').replace(/js\/auth\.js$/, '') : '';
  }

  function renderSlot(user) {
    const slot = document.getElementById('authSlot');
    if (!slot) return;
    if (!user) {
      slot.innerHTML = '<button type="button" class="btn btn-header" id="signInBtn">Sign in</button>';
      slot.querySelector('#signInBtn').addEventListener('click', () => openDialog('signin'));
      return;
    }
    const avatar = user.photo
      ? `<img src="${esc(user.photo)}" alt="" referrerpolicy="no-referrer">`
      : `<span>${esc(initials(user.name))}</span>`;
    slot.innerHTML = `
      <div class="user-menu">
        <button type="button" class="avatar-btn" aria-haspopup="true" aria-expanded="false" aria-label="Account menu for ${esc(user.name)}">${avatar}</button>
        <div class="user-dropdown" role="menu" hidden>
          <div class="ud-head"><strong>${esc(user.name)}</strong><small>${esc(user.email)}</small></div>
          <a role="menuitem" href="${rootPath()}account.html">Your account</a>
          <a role="menuitem" href="${rootPath()}play.html">Play</a>
          <button role="menuitem" type="button" data-signout>Sign out</button>
        </div>
      </div>`;
    const btn = slot.querySelector('.avatar-btn');
    const menu = slot.querySelector('.user-dropdown');
    const toggle = (open) => { menu.hidden = !open; btn.setAttribute('aria-expanded', String(open)); };
    btn.addEventListener('click', (e) => { e.stopPropagation(); toggle(menu.hidden); });
    document.addEventListener('click', (e) => { if (!slot.contains(e.target)) toggle(false); });
    slot.addEventListener('keydown', (e) => { if (e.key === 'Escape') { toggle(false); btn.focus(); } });
    menu.querySelector('[data-signout]').addEventListener('click', () => SiteAuth.signOut());
  }

  SiteAuth.onChange((user) => {
    renderSlot(user);
    if (user && dialog && dialog.classList.contains('open')) closeDialog();
  });

  document.addEventListener('click', (e) => {
    const t = e.target.closest('[data-auth]');
    if (t) { e.preventDefault(); openDialog(t.dataset.auth); }
  });

  init();
})();
