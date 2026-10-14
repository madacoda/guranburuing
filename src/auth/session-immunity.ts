// src/auth/session-immunity.ts
import { Page } from 'puppeteer-core';

/**
 * Client-side script injected into top-level window and all iframes (including Mobage session_iframe).
 * 
 * Root Cause Explanation:
 * In modern Chromium, Mobage embeds connect.mobage.jp/connect/1.0/jssdk/session_iframe inside
 * game.granbluefantasy.jp as a third-party iframe. Due to Chrome's third-party cookie restrictions
 * and CHIPS partitioning, session_iframe evaluates CSSID token hash against sessionState and
 * erroneously dispatches:
 *   postMessage({ type: 'notification', topic: 'session_state_change_response', extra: { status: 'changed' } })
 * 
 * Granblue's app.js mobageSubscribeLogout listener hears status: 'changed' and executes c.logout(),
 * clearing midship and kicking the player out to #top.
 * 
 * This immunity shield intercepts session_state_change_response messages in both directions
 * (incoming capture phase listener and outgoing postMessage wrapper), forcing extra.status = 'unchanged'.
 * Granblue's logout listener is thus disarmed and never kicks the authenticated session out.
 */
export const MOBAGE_SESSION_IMMUNITY_SCRIPT = `
(() => {
  if (window.__gbf_session_immunity_installed__) return;
  window.__gbf_session_immunity_installed__ = true;

  function neutralizeSessionState(msg: any): boolean {
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
        } catch {
          msg.status = 'unchanged';
        }
        mutated = true;
      }
      if (msg.extra && msg.extra.status === 'changed') {
        try {
          Object.defineProperty(msg.extra, 'status', { value: 'unchanged', writable: true, configurable: true });
        } catch {
          msg.extra.status = 'unchanged';
        }
        mutated = true;
      }
    }
    return mutated;
  }

  // 1. Intercept incoming window message events on the capture phase (runs BEFORE Granblue's listener)
  window.addEventListener('message', (event) => {
    try {
      if (neutralizeSessionState(event.data)) {
        console.warn('[SessionImmunity] Suppressed false-positive Mobage logout trigger (forced status to unchanged)');
        event.stopImmediatePropagation();
      }
    } catch (e) {}
  }, true);

  // 2. Intercept outgoing postMessage calls within this frame/window
  const origPostMessage = window.postMessage;
  window.postMessage = function(message: any, targetOrigin: any, transfer: any) {
    try {
      if (neutralizeSessionState(message)) {
        console.warn('[SessionImmunity] Intercepted outgoing session_state_change_response; forced status to unchanged');
      }
    } catch (e) {}
    return origPostMessage.call(this, message, targetOrigin, transfer);
  };

  // 3. Intercept MessagePort.postMessage calls if used by child frames
  if (typeof MessagePort !== 'undefined' && MessagePort.prototype && MessagePort.prototype.postMessage) {
    const origPortPostMessage = MessagePort.prototype.postMessage;
    MessagePort.prototype.postMessage = function(message: any, transfer: any) {
      try {
        if (neutralizeSessionState(message)) {
          console.warn('[SessionImmunity] Intercepted outgoing MessagePort session response; forced status to unchanged');
        }
      } catch (e) {}
      return origPortPostMessage.apply(this, arguments as any);
    };
  }
})();
`;

/**
 * Installs the Mobage Session Immunity Shield on a Puppeteer Page.
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
