// src/auth/session-immunity.ts
import { Page } from 'puppeteer-core';

/**
 * Client-side script injected into top-level window and all iframes (including Mobage session_iframe).
 *
 * Combines:
 * 1. Mobage Third-Party Cookie / CHIPS Session Immunity:
 *    Intercepts `session_state_change_response` postMessages in both capture and outgoing phases,
 *    forcing `status = 'unchanged'` so Granblue's `mobageSubscribeLogout` never falsely logs out.
 * 2. `puprs` / `chaser-oxide` Stealth & Visibility Evasions:
 *    - Masks `navigator.webdriver = false`
 *    - Purges `cdc_` automation markers on `window` / `document`
 *    - Forces `document.hidden = false` and `document.visibilityState = 'visible'` so headless/background
 *      tabs on low-resource VPS instances never throttle CreateJS `requestAnimationFrame` combat timers.
 */
export const MOBAGE_SESSION_IMMUNITY_SCRIPT = `
(() => {
  if (window.__gbf_session_immunity_installed__) return;
  window.__gbf_session_immunity_installed__ = true;

  // 1. puprs / chaser-oxide Stealth & Headless Visibility Shield
  try {
    Object.defineProperty(Navigator.prototype, 'webdriver', {
      get: () => false,
      configurable: true
    });
  } catch (e) {}

  try {
    Object.defineProperty(document, 'hidden', {
      get: () => false,
      configurable: true
    });
    Object.defineProperty(document, 'visibilityState', {
      get: () => 'visible',
      configurable: true
    });
  } catch (e) {}

  try {
    for (const key of Object.getOwnPropertyNames(window)) {
      if (key.indexOf('cdc_') === 0 || key.indexOf('__webdriver') === 0) {
        try {
          delete window[key];
        } catch (e) {}
      }
    }
  } catch (e) {}

  function neutralizeSessionState(msg) {
    if (!msg || typeof msg !== 'object') return false;
    let mutated = false;
    if (
      msg.topic === 'session_state_change_response' ||
      msg.type === 'notification' ||
      msg.status === 'changed' ||
      (msg.extra && msg.extra.status === 'changed')
    ) {
      if (msg.status === 'changed') {
        try {
          Object.defineProperty(msg, 'status', { value: 'unchanged', writable: true, configurable: true });
        } catch (e) {
          msg.status = 'unchanged';
        }
        mutated = true;
      }
      if (msg.extra && msg.extra.status === 'changed') {
        try {
          Object.defineProperty(msg.extra, 'status', { value: 'unchanged', writable: true, configurable: true });
        } catch (e) {
          msg.extra.status = 'unchanged';
        }
        mutated = true;
      }
    }
    return mutated;
  }

  // 2. Intercept incoming window message events on the capture phase (runs BEFORE Granblue's listener)
  window.addEventListener('message', (event) => {
    try {
      if (neutralizeSessionState(event.data)) {
        console.warn('[SessionImmunity] Suppressed false-positive Mobage logout trigger (forced status to unchanged)');
        event.stopImmediatePropagation();
      }
    } catch (e) {}
  }, true);

  // 3. Intercept outgoing postMessage calls within this frame/window
  const origPostMessage = window.postMessage;
  window.postMessage = function(message, targetOrigin, transfer) {
    try {
      if (neutralizeSessionState(message)) {
        console.warn('[SessionImmunity] Intercepted outgoing session_state_change_response; forced status to unchanged');
      }
    } catch (e) {}
    return origPostMessage.call(this, message, targetOrigin, transfer);
  };

  // 4. Intercept MessagePort.postMessage calls if used by child frames
  if (typeof MessagePort !== 'undefined' && MessagePort.prototype && MessagePort.prototype.postMessage) {
    const origPortPostMessage = MessagePort.prototype.postMessage;
    MessagePort.prototype.postMessage = function(message, transfer) {
      try {
        if (neutralizeSessionState(message)) {
          console.warn('[SessionImmunity] Intercepted outgoing MessagePort session response; forced status to unchanged');
        }
      } catch (e) {}
      return origPortPostMessage.apply(this, arguments);
    };
  }
})();
`;

/**
 * Installs the Mobage Session Immunity & Stealth Shield on a Puppeteer Page.
 * Evaluates immediately in the current document and registers Page.addScriptToEvaluateOnNewDocument
 * so all future navigations and child iframes inherit the immunity shield.
 */
export async function installMobageSessionImmunity(page: Page): Promise<void> {
  let client: any = null;
  try {
    client = await page.target().createCDPSession();
    await client.send('Page.addScriptToEvaluateOnNewDocument', {
      source: MOBAGE_SESSION_IMMUNITY_SCRIPT
    }).catch(() => null);
  } catch {
    // Ignore on mock pages or closed targets
  } finally {
    if (client && typeof client.detach === 'function') {
      await client.detach().catch(() => null);
    }
  }

  try {
    await page.evaluate(MOBAGE_SESSION_IMMUNITY_SCRIPT).catch(() => null);
  } catch {}
}
