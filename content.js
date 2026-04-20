// Content Script — Claude Usage Tracker v2.1
// Fixes: Network Interception for 100% accuracy, Dynamic Sync, Cross-tab Real-time Sync

(function () {
  'use strict';

  // ─── State ────────────────────────────────────────────────────────────────
  let trackerEl         = null;
  let updateIntervalId  = null;
  let inputIntercepted  = false;
  let bodyObserver      = null;

  // ─── Runtime Safety ───────────────────────────────────────────────────────
  function isRuntimeValid() {
    return typeof chrome !== 'undefined' && !!chrome.runtime?.id;
  }

  // ─── DOM: Find Input Area ─────────────────────────────────────────────────
  function findInputArea() {
    const selectors = [
      '[role="textbox"][aria-multiline="true"]',
      '[role="textbox"][aria-label]',
      '[role="textbox"]',
      'div[contenteditable="true"][data-placeholder]',
      'div[contenteditable="true"].ProseMirror',
      'div[contenteditable="true"]',
      'textarea[placeholder]',
      'fieldset',
    ];
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el) return el;
    }
    return null;
  }

  function findInsertionPoint() {
    const inputEl = findInputArea();
    if (!inputEl) return null;
    let el = inputEl;
    for (let i = 0; i < 8; i++) {
      if (!el.parentElement) break;
      el = el.parentElement;
      const tag = el.tagName?.toLowerCase();
      if (tag === 'form' || tag === 'footer') return el;
      if (el.children.length >= 2 && el.getBoundingClientRect().width > 400) return el;
    }
    return inputEl.parentElement || null;
  }

  // ─── Network Request Detection (Ultimate Fix) ─────────────────────────────
  function injectPageScript() {
    if (document.getElementById('cut-page-script')) return;
    const script = document.createElement('script');
    script.id = 'cut-page-script';
    script.src = chrome.runtime.getURL('page_script.js');
    (document.head || document.documentElement).appendChild(script);
  }

  window.addEventListener('message', (event) => {
    if (event.source !== window || !event.data) return;
    if (event.data.type === 'CUT_CLAUDE_MESSAGE_SENT_SUCCESS') {
      if (!isRuntimeValid()) return;
      chrome.runtime.sendMessage({ type: 'MESSAGE_SENT', data: {} });
      // We don't fetch immediately because background will BROADCAST_UPDATE
    }
  });

  // ─── Dynamic Sync ─────────────────────────────────────────────────────────
  let lastSyncTime = 0;
  function processDynamicSync() {
    if (!isRuntimeValid()) return;
    // Throttle checks
    if (Date.now() - lastSyncTime < 30000) return;

    // Claude sometimes puts "messages remaining" text in alert bars
    const warningEls = document.querySelectorAll('div, span, p');
    for (let i = 0; i < warningEls.length; i++) {
      const text = warningEls[i].textContent || '';
      if (text.includes('msg') || text.includes('message')) {
        // e.g. "7 messages remaining until 8 PM"
        const match = text.match(/([0-9]+)\s*messages?\s*remaining/i);
        if (match && match[1]) {
          const limitLeft = parseInt(match[1], 10);
          chrome.runtime.sendMessage({ type: 'SYNC_LIMIT', remaining: limitLeft });
          lastSyncTime = Date.now();
          break;
        }
      }
    }
  }

  // ─── Build Tracker HTML ───────────────────────────────────────────────────
  function buildBarHTML(id, label, defaultNums, defaultMeta) {
    return `
      <div class="cut-bar-row" id="cut-${id}-row"
           role="meter" aria-label="${label}" aria-valuenow="0" aria-valuemin="0" aria-valuemax="100">
        <div class="cut-bar-label">
          <span>${label}</span>
          <span class="cut-bar-nums" id="cut-${id}-nums">${defaultNums}</span>
        </div>
        <div class="cut-bar-track">
          <div class="cut-bar-fill cut-bar-ok" id="cut-${id}-fill" style="width:0%"></div>
        </div>
        <div class="cut-bar-meta" id="cut-${id}-meta">${defaultMeta}</div>
      </div>`;
  }

  function buildTracker() {
    const div = document.createElement('div');
    div.id = 'claude-usage-tracker';
    div.setAttribute('role', 'status');
    div.setAttribute('aria-label', 'Claude Usage Tracker');

    div.innerHTML = `
      <div class="cut-header">
        <span class="cut-title">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
               stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
          </svg>
          Claude Usage
        </span>
        <span class="cut-plan-badge" id="cut-plan-badge">FREE</span>
        <button class="cut-toggle" id="cut-toggle"
                aria-label="ট্র্যাকার লুকান" title="লুকান/দেখান">▲</button>
      </div>
      <div class="cut-body" id="cut-body">
        <div class="cut-bars">
          ${buildBarHTML('session', '⚡ Session (৫ঘণ্টা)', '0/30',  'লোড হচ্ছে…')}
          ${buildBarHTML('daily',   '📅 আজকে',             '0/60',  'লোড হচ্ছে…')}
          ${buildBarHTML('weekly',  '🗓️ এই সপ্তাহ',        '0/300', 'সোমবার রিসেট')}
        </div>
        <div class="cut-footer">
          <span class="cut-alltime" id="cut-alltime">মোট: ০ messages</span>
          <div class="cut-actions">
            <button class="cut-btn" id="cut-reset-session"
                    aria-label="Session রিসেট করুন">Session রিসেট</button>
            <button class="cut-btn cut-btn-danger" id="cut-reset-all"
                    aria-label="সব ডেটা রিসেট করুন">সব রিসেট</button>
          </div>
        </div>
        <div class="cut-disclaimer" role="note">
          ⚠️ ট্র্যাকিং অনুমানিত। Anthropic সঠিক সংখ্যা প্রকাশ করে না।
        </div>
      </div>`;

    let isCollapsed = false;
    const toggleBtn  = div.querySelector('#cut-toggle');
    const bodyEl     = div.querySelector('#cut-body');
    toggleBtn.addEventListener('click', () => {
      isCollapsed = !isCollapsed;
      bodyEl.style.display          = isCollapsed ? 'none' : '';
      toggleBtn.textContent         = isCollapsed ? '▼' : '▲';
      toggleBtn.setAttribute('aria-label', isCollapsed ? 'ট্র্যাকার দেখান' : 'ট্র্যাকার লুকান');
    });

    div.querySelector('#cut-reset-session').addEventListener('click', () => {
      if (!confirm('Session ট্র্যাকিং রিসেট করবেন?')) return;
      if (!isRuntimeValid()) return;
      chrome.runtime.sendMessage({ type: 'RESET_SESSION' });
    });

    div.querySelector('#cut-reset-all').addEventListener('click', () => {
      if (!confirm('সমস্ত usage ডেটা রিসেট করবেন?')) return;
      if (!isRuntimeValid()) return;
      chrome.runtime.sendMessage({ type: 'RESET_ALL' });
    });

    return div;
  }

  // ─── Render a Progress Bar ────────────────────────────────────────────────
  function renderBar(prefix, data, metaText) {
    if (!trackerEl) return;
    const fill = trackerEl.querySelector(`#cut-${prefix}-fill`);
    const nums = trackerEl.querySelector(`#cut-${prefix}-nums`);
    const meta = trackerEl.querySelector(`#cut-${prefix}-meta`);
    const row  = trackerEl.querySelector(`#cut-${prefix}-row`);
    if (!fill || !nums || !meta || !row) return;

    const pct = Math.round(data?.percentage ?? 0);

    fill.style.width     = pct + '%';
    nums.textContent     = `${data.messages}/${data.limit}`;
    if (metaText) meta.textContent = metaText;
    row.setAttribute('aria-valuenow', pct);

    fill.className = 'cut-bar-fill';
    row.className  = 'cut-bar-row';
    if (pct >= 90) {
      fill.classList.add('cut-bar-danger');
      row.classList.add('cut-row-danger');
    } else if (pct >= 70) {
      fill.classList.add('cut-bar-warning');
      row.classList.add('cut-row-warning');
    } else {
      fill.classList.add('cut-bar-ok');
    }
  }

  // ─── Update Display from Stats Object ────────────────────────────────────
  function updateDisplay(stats) {
    if (!trackerEl || !stats) return;

    const planMap = {
      free:   'FREE',
      pro:    'PRO',
      max5x:  'MAX 5×',
      max10x: 'MAX 10×',
      max20x: 'MAX 20×',
    };
    const badge = trackerEl.querySelector('#cut-plan-badge');
    if (badge) badge.textContent = planMap[stats.plan] || 'FREE';

    // Session countdown
    const sh          = Math.floor(stats.session.resetIn);
    const sm          = Math.floor((stats.session.resetIn % 1) * 60);
    const sessionMeta = stats.session.resetIn > 0
      ? `${sh}ঘণ্টা ${String(sm).padStart(2, '0')}মি পরে রিসেট`
      : 'নতুন session শুরু হয়েছে';
    renderBar('session', stats.session, sessionMeta);

    // Daily countdown till midnight
    const midnightMs  = new Date().setHours(24, 0, 0, 0) - Date.now();
    const dh          = Math.floor(midnightMs / 3_600_000);
    const dm          = Math.floor((midnightMs % 3_600_000) / 60_000);
    renderBar('daily', stats.daily, `${dh}ঘণ্টা ${dm}মি পরে midnight রিসেট`);

    // Weekly countdown till next Monday
    const todayDay   = new Date().getDay();
    const daysTilMon = todayDay === 1 ? 7 : (todayDay === 0 ? 1 : 8 - todayDay);
    renderBar('weekly', stats.weekly, `${daysTilMon} দিন পরে সোমবার রিসেট`);

    const allEl = trackerEl.querySelector('#cut-alltime');
    if (allEl) allEl.textContent = `মোট: ${(stats.allTime || 0).toLocaleString('bn-BD')} messages`;
  }

  function fetchAndUpdate() {
    if (!isRuntimeValid()) return;
    chrome.runtime.sendMessage({ type: 'GET_USAGE' }, (stats) => {
      if (chrome.runtime.lastError) return;
      updateDisplay(stats);
    });
  }

  // ─── Listen for Real-Time Broadcasts ─────────────────────────────────────
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'BROADCAST_UPDATE') {
      updateDisplay(message.stats);
    }
  });

  // ─── Inject Tracker into Page ────────────────────────────────────────────
  function injectTracker() {
    if (document.getElementById('claude-usage-tracker')) return true;
    const insertionPoint = findInsertionPoint();
    if (!insertionPoint) return false;

    trackerEl = buildTracker();
    insertionPoint.after(trackerEl);
    fetchAndUpdate();
    return true;
  }

  function tryInject() {
    if (injectTracker()) {
      if (!inputIntercepted) {
        injectPageScript();
        inputIntercepted = true;
      }
      return true;
    }
    return false;
  }

  // ─── robust observer logic (CPU friendly) ──────────────────────────────────
  function setupObserver() {
    if (bodyObserver) return;
    
    // Interval just for keeping the count down UI ticking smoothly
    clearInterval(updateIntervalId);
    updateIntervalId = setInterval(fetchAndUpdate, 60_000);

    let debounceTimer;
    bodyObserver = new MutationObserver(() => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        if (!trackerEl || !document.getElementById('claude-usage-tracker')) {
          tryInject();
        }
        processDynamicSync();
      }, 300);
    });
    bodyObserver.observe(document.body, { childList: true, subtree: true });
  }

  function handleNavigation() {
    trackerEl = null;
    tryInject();
  }

  if (!history.__cutPatched) {
    const _push    = history.pushState.bind(history);
    const _replace = history.replaceState.bind(history);

    history.pushState = function (...args) {
      _push(...args);
      handleNavigation();
    };
    history.replaceState = function (...args) {
      _replace(...args);
      handleNavigation();
    };
    history.__cutPatched = true;
  }

  window.addEventListener('popstate', handleNavigation);

  // ─── Boot ─────────────────────────────────────────────────────────────────
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      tryInject();
      setupObserver();
    });
  } else {
    tryInject();
    setupObserver();
  }

})();
