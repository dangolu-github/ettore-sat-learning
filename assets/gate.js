(() => {
  const sessionAccessKey = 'ettore-sat-access';
  const trustedBrowserKey = 'ettore-sat-trusted-browser-v1';
  const deviceTokenKey = 'ettore-sat-device-token-v1';
  const tokenKey = 'ettore-sat-access-token';
  const expiryKey = 'ettore-sat-access-expires-at';
  const teacherTestKey = 'ettore-sat-teacher-test-token';
  // The course password is checked by the course service only; this page holds no copy or hash of it.
  // A remembered browser keeps its credential: only an explicit "not recognized" or "signed out" answer asks for the
  // password again. A connection problem keeps the credential and offers Try again.
  const portalConfig = window.ETTORE_PORTAL_CONFIG || {};
  let resolveReady;
  let renewal = null;
  let retryTimer = null;
  const ready = new Promise((resolve) => { resolveReady = resolve; });

  window.EttorePortalAccess = {
    ready,
    ensureFreshAccess: (force) => ensureFreshAccess(force),
    request: (action, parameters) => authenticatedRequest(action, parameters),
    getToken: () => {
      try { return window.sessionStorage.getItem(tokenKey) || ''; }
      catch { return ''; }
    },
    getDeviceToken: () => getDeviceToken(),
    teacherTestToken: () => readStorage(window.sessionStorage, teacherTestKey)
  };

  const readStorage = (storage, key) => {
    try { return storage.getItem(key) || ''; }
    catch { return ''; }
  };

  const writeStorage = (storage, key, value) => {
    try { storage.setItem(key, value); return true; }
    catch { return false; }
  };

  const getDeviceToken = () => readStorage(window.localStorage, deviceTokenKey);

  // Saves and submissions to the course service also carry the remembered-browser credential, so an expired short
  // access token never loses work or asks for the password (the service accepts either).
  if (typeof window.fetch === 'function' && portalConfig.submissionEndpoint) {
    const nativeFetch = window.fetch.bind(window);
    window.fetch = (resource, init) => {
      try {
        if (init && typeof init.body === 'string' && String(resource).indexOf(portalConfig.submissionEndpoint) === 0) {
          const body = JSON.parse(init.body);
          const device = getDeviceToken();
          if (body && typeof body === 'object' && 'accessToken' in body && !body.deviceToken && device) {
            init = Object.assign({}, init, { body: JSON.stringify(Object.assign(body, { deviceToken: device })) });
          }
        }
      } catch {}
      return nativeFetch(resource, init);
    };
  }

  const setAccess = (token, deviceToken, expiresIn) => {
    writeStorage(window.sessionStorage, sessionAccessKey, 'granted');
    if (token) writeStorage(window.sessionStorage, tokenKey, token);
    if (token) writeStorage(window.sessionStorage, expiryKey, String(Date.now() + Number(expiresIn || 21600) * 1000));
    writeStorage(window.localStorage, trustedBrowserKey, 'granted');
    if (deviceToken) writeStorage(window.localStorage, deviceTokenKey, deviceToken);
  };

  const clearDevice = () => {
    try { window.localStorage.removeItem(deviceTokenKey); window.localStorage.removeItem(trustedBrowserKey); } catch {}
    try { window.sessionStorage.removeItem(tokenKey); window.sessionStorage.removeItem(expiryKey); } catch {}
  };

  // Teacher links bring the teacher's remembered-browser credential and, for test links, the teacher test token in the
  // fragment. Both are kept in this browser and removed from the address bar at once.
  const consumeTrustedDevice = () => {
    try {
      const parameters = new URLSearchParams(window.location.hash.replace(/^#/, ''));
      const token = String(parameters.get('ettore-trusted-device') || '').replace(/[^a-f0-9]/gi, '').slice(0, 128);
      const teacherTest = String(parameters.get('teacherAnswerToken') || '').replace(/[^a-f0-9]/gi, '').slice(0, 64);
      if (!token && !teacherTest) return '';
      if (teacherTest) writeStorage(window.sessionStorage, teacherTestKey, teacherTest);
      window.history.replaceState(null, '', window.location.pathname + window.location.search);
      return token;
    }
    catch { return ''; }
  };

  const requestData = (action, parameters) => new Promise((resolve, reject) => {
    if (!portalConfig.submissionEndpoint) {
      reject(new Error('Access is unavailable.'));
      return;
    }
    const callbackName = `__ettoreAccess${Date.now()}${Math.random().toString(16).slice(2)}`;
    const script = document.createElement('script');
    const timeout = window.setTimeout(() => {
      cleanup();
      reject(new Error('Course access timed out.'));
    }, 12000);
    const cleanup = () => {
      window.clearTimeout(timeout);
      delete window[callbackName];
      script.remove();
    };
    window[callbackName] = (data) => {
      cleanup();
      resolve(data);
    };
    script.onerror = () => {
      cleanup();
      reject(new Error('Course access service could not be reached.'));
    };
    const query = new URLSearchParams(Object.assign({}, parameters, { action, callback: callbackName, _: String(Date.now()) }));
    script.src = `${portalConfig.submissionEndpoint}?${query.toString()}`;
    document.head.appendChild(script);
  });

  // A refusal is explicit only when the service says the browser is unknown or signed out; anything else
  // (no answer, a timeout, a temporary fault) keeps the stored credential.
  const explicitRefusal = (data) => Boolean(data && data.ok === false && (data.reason === 'unknown' || data.reason === 'revoked' || /not recognized|signed out/i.test(data.error || '')));

  const requestAccess = async (action, parameters) => {
    const data = await requestData(action, parameters);
    if (!data || !data.ok || !data.accessToken) {
      const error = new Error((data && data.error) || 'Access could not be confirmed.');
      error.explicit = action === 'renewAccess' ? explicitRefusal(data) : Boolean(data && data.ok === false);
      throw error;
    }
    return data;
  };

  const authorize = (code) => requestAccess('authorizeAccess', { code });
  const renewAccess = (deviceToken) => requestAccess('renewAccess', { deviceToken });

  async function ensureFreshAccess(force) {
    if (renewal) return renewal;
    const token = window.EttorePortalAccess.getToken();
    const expiresAt = Number(readStorage(window.sessionStorage, expiryKey));
    if (!force && token && expiresAt > Date.now() + 60000) return token;
    const device = getDeviceToken();
    if (!device) {
      showGate();
      throw new Error('Please enter your course password again. Your answers are still here.');
    }
    renewal = renewAccess(device).then((access) => {
      setAccess(access.accessToken, device, access.expiresIn);
      hideRetry();
      reveal();
      resolveReady();
      return access.accessToken;
    }).catch((error) => {
      if (error && error.explicit) {
        clearDevice();
        showGate();
        throw new Error('Please enter your course password again. Your answers are still here.');
      }
      showRetry();
      throw new Error('We couldn’t connect just now. Your answers are still here. Please try again.');
    }).finally(() => { renewal = null; });
    return renewal;
  }

  async function authenticatedRequest(action, parameters) {
    let token = await ensureFreshAccess(false);
    let data = await requestData(action, Object.assign({}, parameters, { accessToken: token }));
    if (data && !data.ok && /course access expired/i.test(data.error || '')) {
      token = await ensureFreshAccess(true);
      data = await requestData(action, Object.assign({}, parameters, { accessToken: token }));
    }
    if (!data || !data.ok) throw new Error((data && data.error) || 'The request could not be confirmed. Please try again.');
    return data;
  }

  const reveal = () => {
    document.body.dataset.access = 'granted';
    document.documentElement.classList.remove('access-pending');
    document.body.classList.remove('access-locked');
    document.querySelectorAll('body > [inert]').forEach((node) => { node.inert = false; });
    document.querySelector('.access-gate')?.remove();
  };

  const showGate = () => {
    hideRetry();
    if (document.querySelector('.access-gate')) return;
    document.body.dataset.access = 'locked';
    document.body.classList.add('access-locked');
    Array.from(document.body.children).forEach((node) => { node.inert = true; });

    const gate = document.createElement('div');
    gate.className = 'access-gate';
    gate.setAttribute('role', 'dialog');
    gate.setAttribute('aria-modal', 'true');
    gate.setAttribute('aria-labelledby', 'access-title');
    gate.innerHTML = `
      <form class="access-card">
        <p class="access-kicker">Ettore · SAT Reading & Writing</p>
        <h1 id="access-title">Welcome back</h1>
        <p>Enter your course password.</p>
        <label for="course-password">Password</label>
        <div class="access-row">
          <input id="course-password" name="password" type="password" autocomplete="current-password" required>
          <button type="submit">Continue</button>
        </div>
        <p class="access-error" role="alert" aria-live="polite"></p>
      </form>`;
    document.body.append(gate);
    gate.inert = false;
    document.documentElement.classList.remove('access-pending');

    const form = gate.querySelector('form');
    const input = gate.querySelector('input');
    const error = gate.querySelector('.access-error');
    input.focus();

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      error.textContent = '';
      const button = form.querySelector('button');
      button.disabled = true;
      button.textContent = 'Opening…';
      const code = input.value.trim();
      try {
        const access = await authorize(code);
        setAccess(access.accessToken, access.deviceToken, access.expiresIn);
      } catch (accessError) {
        if (accessError && accessError.explicit) {
          error.textContent = /too many/i.test(accessError.message || '')
            ? 'Too many tries. Please wait a few minutes and try again.'
            : 'That password does not match. Please try again.';
          input.select();
          button.disabled = false;
          button.textContent = 'Continue';
          return;
        }
        error.textContent = 'We could not connect to your course. Your saved answers are safe. Check your connection and try again.';
        button.disabled = false;
        button.textContent = 'Try again';
        return;
      }
      reveal();
      resolveReady();
      document.querySelector('main, .page')?.focus?.();
    });
  };

  // No answer from the course service: the browser stays remembered and no password is asked for.
  function showRetry() {
    if (document.querySelector('.access-gate:not(.access-retry)')) return;
    window.clearTimeout(retryTimer);
    retryTimer = window.setTimeout(() => { ensureFreshAccess(true).catch(() => {}); }, 20000);
    if (document.querySelector('.access-retry')) return;
    const pending = document.documentElement.classList.contains('access-pending');
    const card = document.createElement('div');
    card.className = pending ? 'access-gate access-retry' : 'access-retry access-retry-banner';
    card.setAttribute('role', pending ? 'dialog' : 'status');
    card.setAttribute('aria-live', 'polite');
    card.innerHTML = `
      <div class="access-card">
        <p class="access-kicker">Ettore · SAT Reading & Writing</p>
        <h1>We couldn’t connect just now</h1>
        <p>Your saved answers are safe. Check your connection, then try again.</p>
        <div class="access-row"><button type="button">Try again</button></div>
      </div>`;
    document.body.append(card);
    document.documentElement.classList.remove('access-pending');
    const button = card.querySelector('button');
    button.addEventListener('click', () => {
      button.disabled = true;
      button.textContent = 'Connecting…';
      ensureFreshAccess(true).catch(() => { button.disabled = false; button.textContent = 'Try again'; });
    });
    if (pending) button.focus();
  }

  function hideRetry() {
    window.clearTimeout(retryTimer);
    document.querySelector('.access-retry')?.remove();
  }

  const trustedDevice = consumeTrustedDevice() || getDeviceToken();
  if (trustedDevice) {
    if (trustedDevice !== getDeviceToken()) writeStorage(window.localStorage, deviceTokenKey, trustedDevice);
    ensureFreshAccess(true).catch(() => {});
    return;
  }

  showGate();
})();
