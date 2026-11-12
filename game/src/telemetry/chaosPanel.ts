/**
 * chaosPanel.ts — a tiny, admin-only DOM overlay to drive Chaos Mode.
 *
 * Why a DOM overlay (not an in-game button): Chaos Mode is an operator tool, not gameplay.
 * Keeping it out of the Phaser scene graph means it can't clash with touch controls, the
 * name field, or the cultural art, and it stays genuinely out of a normal player's way.
 *
 * Admin-only by design:
 *   - Hidden by default. Opens only via a secret key chord (Shift+C) — not discoverable by
 *     a casual player, and absent entirely when no backend is configured.
 *   - Start/Stop require the Worker's CHAOS_ADMIN_TOKEN, entered here and held
 *     only in sessionStorage (cleared when the tab closes). It is not a build-time secret.
 *   - The backend is the real gate: without a matching token the Worker returns 401/503, so
 *     this panel can never actually perturb anything it isn't authorized for.
 *
 * Offline-safe: if no backend is configured, the panel never mounts.
 */
import { getChaosStatus, startChaos, stopChaos, hasBackend, type ChaosStatus } from './api';

const TOKEN_KEY = 'cy_chaos_token';
const POLL_MS = 2000;

let mounted = false;

/** Mount the (hidden) chaos panel and its secret open chord. Call once at bootstrap. */
export function initChaosPanel(): void {
  if (mounted) return;
  if (typeof document === 'undefined' || typeof window === 'undefined') return;
  // Only an operator with a backend can use chaos; don't even attach the chord otherwise.
  if (!hasBackend()) return;
  mounted = true;

  const panel = buildPanel();
  document.body.appendChild(panel.root);

  // Secret open/close chord: Shift + C. Ignored while typing in an input/textarea.
  window.addEventListener('keydown', (e) => {
    const target = e.target as HTMLElement | null;
    const typing =
      target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);
    if (typing) return;
    if (e.shiftKey && (e.key === 'C' || e.key === 'c')) {
      e.preventDefault();
      panel.toggle();
    } else if (e.key === 'Escape' && panel.isOpen()) {
      panel.hide();
    }
  });
}

interface Panel {
  root: HTMLElement;
  toggle: () => void;
  hide: () => void;
  isOpen: () => boolean;
}

function buildPanel(): Panel {
  const root = document.createElement('div');
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-label', 'Chaos Mode admin control');
  root.setAttribute('aria-hidden', 'true');
  Object.assign(root.style, {
    position: 'fixed',
    right: '12px',
    bottom: '12px',
    zIndex: '99999',
    width: '280px',
    padding: '14px 16px',
    font: '13px/1.4 system-ui, sans-serif',
    color: '#e8eef5',
    background: 'rgba(18, 24, 33, 0.96)',
    border: '1px solid #37506b',
    borderRadius: '10px',
    boxShadow: '0 8px 30px rgba(0,0,0,0.5)',
    display: 'none',
  } as CSSStyleDeclaration);

  root.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
      <strong style="font-size:14px">⚡ Chaos Mode</strong>
      <span data-cy="dot" style="width:10px;height:10px;border-radius:50%;background:#3a4a5c"></span>
    </div>
    <div data-cy="status" style="margin-bottom:6px;color:#9fb4c7">Idle</div>
    <div style="margin-bottom:10px;color:#7f93a7;font-size:11.5px">
      Deliberately slows our own backend (+latency, ~25% errors) for ~60s so the live
      dashboard shows an incident and its recovery. Gameplay keeps working.
    </div>
    <form data-cy="form" autocomplete="off">
    <input type="text" name="username" value="chaos-admin" autocomplete="username" hidden />
    <label for="cy-chaos-token" style="display:block;margin-bottom:6px;color:#9fb4c7">Admin token</label>
    <input id="cy-chaos-token" data-cy="token" type="password" autocomplete="current-password" spellcheck="false"
      placeholder="Admin token"
      style="width:100%;box-sizing:border-box;padding:7px 9px;margin-bottom:10px;border-radius:7px;border:1px solid #37506b;background:#0f1620;color:#e8eef5" />
    <div style="display:flex;gap:8px">
      <button type="submit" data-cy="start" style="flex:1;padding:8px;border:0;border-radius:7px;background:#c0392b;color:#fff;cursor:pointer;font-weight:600">Start ~60s</button>
      <button type="button" data-cy="stop" style="flex:1;padding:8px;border:0;border-radius:7px;background:#2e4257;color:#e8eef5;cursor:pointer;font-weight:600">Stop</button>
    </div>
    </form>
    <div data-cy="msg" style="min-height:16px;margin-top:8px;color:#e0b050;font-size:12px"></div>
    <div style="margin-top:8px;color:#6b7f93;font-size:11px">Shift+C to toggle · Esc to close</div>
  `;

  const q = <T extends HTMLElement>(sel: string): T => root.querySelector(`[data-cy="${sel}"]`) as T;
  const tokenInput = q<HTMLInputElement>('token');
  const form = q<HTMLFormElement>('form');
  const startBtn = q<HTMLButtonElement>('start');
  const stopBtn = q<HTMLButtonElement>('stop');
  const statusEl = q<HTMLDivElement>('status');
  const msgEl = q<HTMLDivElement>('msg');
  const dot = q<HTMLSpanElement>('dot');

  // Restore a stored token (session only — cleared when the tab closes).
  try {
    tokenInput.value = sessionStorage.getItem(TOKEN_KEY) ?? '';
  } catch {
    /* ignore */
  }

  const saveToken = (): void => {
    try {
      sessionStorage.setItem(TOKEN_KEY, tokenInput.value.trim());
    } catch {
      /* ignore */
    }
  };

  const render = (s: ChaosStatus): void => {
    if (s.active) {
      const secs = Math.ceil(s.remainingMs / 1000);
      statusEl.textContent = `ACTIVE · ${secs}s left · ${Math.round(s.profile.errorRate * 100)}% errors · +${s.profile.latencyMs}ms`;
      dot.style.background = '#e74c3c';
    } else {
      statusEl.textContent = 'Idle';
      dot.style.background = '#3a4a5c';
    }
  };

  const errText = (e?: string): string => {
    switch (e) {
      case 'unauthorized':
        return 'Token rejected. Check the admin token and try again.';
      case 'disabled':
        return 'Chaos Mode is not enabled on the server.';
      case 'no_token':
        return 'Enter the admin token first.';
      case 'no_backend':
        return 'No backend configured.';
      default:
        return 'Network error — try again.';
    }
  };

  const setBusy = (busy: boolean): void => {
    startBtn.disabled = busy;
    stopBtn.disabled = busy;
    startBtn.style.opacity = stopBtn.style.opacity = busy ? '0.6' : '1';
  };

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    saveToken();
    setBusy(true);
    msgEl.style.color = '#e0b050';
    msgEl.textContent = 'Starting…';
    const res = await startChaos(tokenInput.value.trim());
    setBusy(false);
    if (res.ok) {
      render(res.status);
      msgEl.style.color = '#7fd18b';
      msgEl.textContent = '✓ Storm started. Watch the red banner in-game and the dashboard below (~10–30s to show).';
    } else {
      msgEl.style.color = '#ff8a7a';
      msgEl.textContent = errText(res.error);
    }
  });

  stopBtn.addEventListener('click', async () => {
    saveToken();
    setBusy(true);
    msgEl.style.color = '#e0b050';
    msgEl.textContent = 'Stopping…';
    const res = await stopChaos(tokenInput.value.trim());
    setBusy(false);
    if (res.ok) {
      render(res.status);
      msgEl.style.color = '#7fd18b';
      msgEl.textContent = '✓ Skies cleared. The dashboard will show the recovery.';
    } else {
      msgEl.style.color = '#ff8a7a';
      msgEl.textContent = errText(res.error);
    }
  });

  // Poll status while open so the countdown/auto-expire is visible.
  let timer: number | undefined;
  const poll = async (): Promise<void> => {
    render(await getChaosStatus());
  };
  const startPolling = (): void => {
    void poll();
    timer = window.setInterval(() => void poll(), POLL_MS);
  };
  const stopPolling = (): void => {
    if (timer !== undefined) window.clearInterval(timer);
    timer = undefined;
  };

  let open = false;
  const show = (): void => {
    open = true;
    root.style.display = 'block';
    root.setAttribute('aria-hidden', 'false');
    startPolling();
    tokenInput.focus();
  };
  const hide = (): void => {
    open = false;
    root.style.display = 'none';
    root.setAttribute('aria-hidden', 'true');
    stopPolling();
  };
  const toggle = (): void => (open ? hide() : show());

  return { root, toggle, hide, isOpen: () => open };
}
