(() => {
  const sessionAccessKey = 'ettore-sat-access';
  const trustedBrowserKey = 'ettore-sat-trusted-browser-v1';
  const deviceTokenKey = 'ettore-sat-device-token-v1';
  const tokenKey = 'ettore-sat-access-token';
  const expiryKey = 'ettore-sat-access-expires-at';
  const expectedHash = '9140365e9ecf7dc63c5bd38ff54c099c695ad2e5c0177c9434c31535642855c8';
  const portalConfig = window.ETTORE_PORTAL_CONFIG || {};
  let resolveReady;
  let renewal = null;
  const ready = new Promise((resolve) => { resolveReady = resolve; });

  window.EttorePortalAccess = {
    ready,
    ensureFreshAccess: (force) => ensureFreshAccess(force),
    request: (action, parameters) => authenticatedRequest(action, parameters),
    getToken: () => {
      try { return window.sessionStorage.getItem(tokenKey) || ''; }
      catch { return ''; }
    }
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

  const setAccess = (token, deviceToken, expiresIn) => {
    writeStorage(window.sessionStorage, sessionAccessKey, 'granted');
    if (token) writeStorage(window.sessionStorage, tokenKey, token);
    if (token) writeStorage(window.sessionStorage, expiryKey, String(Date.now() + Number(expiresIn || 21600) * 1000));
    writeStorage(window.localStorage, trustedBrowserKey, 'granted');
    if (deviceToken) writeStorage(window.localStorage, deviceTokenKey, deviceToken);
  };

  const consumeTrustedDevice = () => {
    try {
      const parameters = new URLSearchParams(window.location.hash.replace(/^#/, ''));
      const token = String(parameters.get('ettore-trusted-device') || '').replace(/[^a-f0-9]/gi, '').slice(0, 128);
      if (!token) return '';
      window.history.replaceState(null, '', window.location.pathname + window.location.search);
      return token;
    }
    catch { return ''; }
  };

  const digest = async (value) => {
    const data = new TextEncoder().encode(value);
    const hash = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, '0')).join('');
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

  const requestAccess = async (action, parameters) => {
    const data = await requestData(action, parameters);
    if (!data || !data.ok || !data.accessToken) throw new Error((data && data.error) || 'Access could not be confirmed.');
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
      reveal();
      resolveReady();
      return access.accessToken;
    }).catch(() => {
      showGate();
      throw new Error('We could not reconnect. Check your connection and enter your course password again. Your answers are still here.');
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
      const submittedHash = await digest(code);
      if (submittedHash !== expectedHash) {
        error.textContent = 'That password does not match. Please try again.';
        input.select();
        button.disabled = false;
        button.textContent = 'Continue';
        return;
      }
      try {
        const access = await authorize(code);
        setAccess(access.accessToken, access.deviceToken, access.expiresIn);
      } catch (accessError) {
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

  const trustedDevice = consumeTrustedDevice() || getDeviceToken();
  if (trustedDevice) {
    renewAccess(trustedDevice).then((access) => {
      setAccess(access.accessToken, trustedDevice, access.expiresIn);
      reveal();
      resolveReady();
    }).catch(() => {
      showGate();
    });
    return;
  }

  showGate();
})();
