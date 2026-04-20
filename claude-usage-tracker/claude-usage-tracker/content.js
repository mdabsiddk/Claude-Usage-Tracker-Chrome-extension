// Content Script - Claude Usage Tracker
// Injects usage progress bars below the chat input box on claude.ai

(function () {
  'use strict';

  let trackerEl = null;
  let lastInputBox = null;
  let updateInterval = null;
  let injectionAttempts = 0;
  const MAX_ATTEMPTS = 60;

  // ─── Find the chat input area ───────────────────────────────────────────────
  function findInputArea() {
    // Claude.ai uses a contenteditable div or a textarea
    const selectors = [
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
    // Try to find the form/footer containing the input
    const inputEl = findInputArea();
    if (!inputEl) return null;

    // Walk up to find a good container (form or a parent div)
    let el = inputEl;
    for (let i = 0; i < 8; i++) {
      if (!el.parentElement) break;
      el = el.parentElement;
      const tag = el.tagName?.toLowerCase();
      if (tag === 'form' || tag === 'footer') return el;
      // Check if this element is the main input wrapper
      if (el.children.length >= 2 && el.getBoundingClientRect().width > 400) {
        return el;
      }
    }
    return inputEl.parentElement || null;
  }

  // ─── Build the tracker UI ────────────────────────────────────────────────────
  function buildTracker() {
    const div = document.createElement('div');
    div.id = 'claude-usage-tracker';
    div.innerHTML = `
      <div class="cut-header">
        <span class="cut-title">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
          </svg>
          Claude Usage Tracker
        </span>
        <span class="cut-plan-badge" id="cut-plan-badge">FREE</span>
        <button class="cut-toggle" id="cut-toggle" title="Collapse">▲</button>
      </div>
      <div class="cut-body" id="cut-body">
        <div class="cut-bars">
          <div class="cut-bar-row" id="cut-session-row">
            <div class="cut-bar-label">
              <span>⚡ Session (5h)</span>
              <span class="cut-bar-nums" id="cut-session-nums">0/30</span>
            </div>
            <div class="cut-bar-track">
              <div class="cut-bar-fill" id="cut-session-fill" style="width:0%"></div>
            </div>
            <div class="cut-bar-meta" id="cut-session-meta">Resets in 5h 00m</div>
          </div>

          <div class="cut-bar-row" id="cut-daily-row">
            <div class="cut-bar-label">
              <span>📅 আজকে</span>
              <span class="cut-bar-nums" id="cut-daily-nums">0/60</span>
            </div>
            <div class="cut-bar-track">
              <div class="cut-bar-fill" id="cut-daily-fill" style="width:0%"></div>
            </div>
            <div class="cut-bar-meta" id="cut-daily-meta">Resets at midnight</div>
          </div>

          <div class="cut-bar-row" id="cut-weekly-row">
            <div class="cut-bar-label">
              <span>🗓️ এই সপ্তাহ</span>
              <span class="cut-bar-nums" id="cut-weekly-nums">0/300</span>
            </div>
            <div class="cut-bar-track">
              <div class="cut-bar-fill" id="cut-weekly-fill" style="width:0%"></div>
            </div>
            <div class="cut-bar-meta" id="cut-weekly-meta">Resets Monday</div>
          </div>
        </div>

        <div class="cut-footer">
          <span class="cut-alltime" id="cut-alltime">মোট: 0 messages</span>
          <div class="cut-actions">
            <button class="cut-btn" id="cut-reset-session">Session রিসেট</button>
            <button class="cut-btn cut-btn-danger" id="cut-reset-all">সব রিসেট</button>
          </div>
        </div>

        <div class="cut-disclaimer">⚠️ এই ট্র্যাকিং অনুমানিত। Anthropic সঠিক সংখ্যা প্রকাশ করে না।</div>
      </div>
    `;

    // Toggle collapse
    let collapsed = false;
    div.querySelector('#cut-toggle').addEventListener('click', () => {
      collapsed = !collapsed;
      const body = div.querySelector('#cut-body');
      const btn = div.querySelector('#cut-toggle');
      body.style.display = collapsed ? 'none' : 'block';
      btn.textContent = collapsed ? '▼' : '▲';
    });

    // Reset buttons
    div.querySelector('#cut-reset-session').addEventListener('click', () => {
      if (confirm('Session ট্র্যাকিং রিসেট করবেন?')) {
        chrome.runtime.sendMessage({ type: 'RESET_SESSION' }, updateDisplay);
      }
    });

    div.querySelector('#cut-reset-all').addEventListener('click', () => {
      if (confirm('সমস্ত usage ডেটা রিসেট করবেন?')) {
        chrome.runtime.sendMessage({ type: 'RESET_ALL' }, updateDisplay);
      }
    });

    return div;
  }

  // ─── Update the display ──────────────────────────────────────────────────────
  function updateDisplay(stats) {
    if (!trackerEl || !stats) return;

    const planMap = { free: 'FREE', pro: 'PRO', max5x: 'MAX 5x' };
    const planEl = trackerEl.querySelector('#cut-plan-badge');
    if (planEl) planEl.textContent = planMap[stats.plan] || 'FREE';

    function setBar(prefix, data, extra) {
      const fill = trackerEl.querySelector(`#cut-${prefix}-fill`);
      const nums = trackerEl.querySelector(`#cut-${prefix}-nums`);
      const meta = trackerEl.querySelector(`#cut-${prefix}-meta`);
      const row  = trackerEl.querySelector(`#cut-${prefix}-row`);
      if (!fill || !nums || !meta || !row) return;

      const pct = data.percentage || 0;
      fill.style.width = pct + '%';
      nums.textContent = `${data.messages}/${data.limit}`;

      // Color coding
      fill.className = 'cut-bar-fill';
      row.className = 'cut-bar-row';
      if (pct >= 90) {
        fill.classList.add('cut-bar-danger');
        row.classList.add('cut-row-danger');
      } else if (pct >= 70) {
        fill.classList.add('cut-bar-warning');
        row.classList.add('cut-row-warning');
      } else {
        fill.classList.add('cut-bar-ok');
      }

      if (meta && extra) meta.textContent = extra;
    }

    // Session bar with countdown
    const sessionHours = Math.floor(stats.session.resetIn);
    const sessionMins  = Math.floor((stats.session.resetIn % 1) * 60);
    const sessionMeta  = stats.session.resetIn > 0
      ? `${sessionHours}h ${String(sessionMins).padStart(2,'0')}m পরে রিসেট`
      : 'নতুন session শুরু হয়েছে';
    setBar('session', stats.session, sessionMeta);

    // Daily bar
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(0, 0, 0, 0);
    const msLeft = tomorrow - Date.now();
    const hLeft = Math.floor(msLeft / 3600000);
    const mLeft = Math.floor((msLeft % 3600000) / 60000);
    setBar('daily', stats.daily, `${hLeft}h ${mLeft}m পরে রিসেট (midnight)`);

    // Weekly bar
    const weekDays = ['রবিবার','সোমবার','মঙ্গলবার','বুধবার','বৃহস্পতিবার','শুক্রবার','শনিবার'];
    const nextMonday = new Date();
    const daysTil = (8 - nextMonday.getDay()) % 7 || 7;
    setBar('weekly', stats.weekly, `${daysTil} দিন পরে রিসেট (সোমবার)`);

    const alltime = trackerEl.querySelector('#cut-alltime');
    if (alltime) alltime.textContent = `মোট: ${stats.allTime} messages`;
  }

  function fetchAndUpdate() {
    chrome.runtime.sendMessage({ type: 'GET_USAGE' }, (stats) => {
      if (chrome.runtime.lastError) return;
      updateDisplay(stats);
    });
  }

  // ─── Intercept message sends ─────────────────────────────────────────────────
  function interceptSendButton() {
    // Watch for button clicks and Enter key on the input
    document.addEventListener('click', (e) => {
      const btn = e.target.closest('button');
      if (!btn) return;
      // Claude's send button usually has an svg arrow icon
      const isSend = btn.getAttribute('aria-label')?.toLowerCase().includes('send') ||
                     btn.type === 'submit' ||
                     btn.querySelector('svg') && btn.closest('form');
      if (isSend) {
        const inputEl = findInputArea();
        if (inputEl && inputEl.textContent?.trim()) {
          chrome.runtime.sendMessage({ type: 'MESSAGE_SENT', data: {} }, fetchAndUpdate);
        }
      }
    }, true);

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        const inputEl = findInputArea();
        if (inputEl && (inputEl.textContent?.trim() || inputEl.value?.trim())) {
          setTimeout(() => {
            chrome.runtime.sendMessage({ type: 'MESSAGE_SENT', data: {} }, fetchAndUpdate);
          }, 200);
        }
      }
    }, true);
  }

  // ─── Observe DOM for AI responses (alternative detection) ────────────────────
  function observeResponses() {
    // Watch for new assistant message elements being added
    let lastCount = 0;
    const observer = new MutationObserver(() => {
      const msgs = document.querySelectorAll(
        '[data-testid^="human-turn"], .human-turn, [class*="human"], ' +
        'div[data-is-streaming], [class*="HumanMessage"]'
      );
      if (msgs.length > lastCount) {
        const diff = msgs.length - lastCount;
        lastCount = msgs.length;
        for (let i = 0; i < diff; i++) {
          chrome.runtime.sendMessage({ type: 'MESSAGE_SENT', data: {} });
        }
        setTimeout(fetchAndUpdate, 500);
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  // ─── Inject the tracker ──────────────────────────────────────────────────────
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
      interceptSendButton();
      observeResponses();
      // Update countdown every minute
      updateInterval = setInterval(fetchAndUpdate, 60000);
      return;
    }
    injectionAttempts++;
    if (injectionAttempts < MAX_ATTEMPTS) {
      setTimeout(tryInject, 500);
    }
  }

  // ─── Watch for SPA navigation ────────────────────────────────────────────────
  let lastUrl = location.href;
  new MutationObserver(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      trackerEl = null;
      injectionAttempts = 0;
      setTimeout(tryInject, 1000);
    }
  }).observe(document, { subtree: true, childList: true });

  // Start
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', tryInject);
  } else {
    tryInject();
  }
})();
