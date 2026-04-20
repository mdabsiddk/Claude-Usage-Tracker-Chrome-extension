// Popup Script — Claude Usage Tracker v2.2
// All DOM access is wrapped in DOMContentLoaded for safety.

'use strict';

document.addEventListener('DOMContentLoaded', () => {

  // ─── Helpers ──────────────────────────────────────────────────────────────
  const planMap = {
    free:   'FREE',
    pro:    'PRO',
    max5x:  'MAX 5×',
    max10x: 'MAX 10×',
    max20x: 'MAX 20×',
  };

  function setBar(prefix, pct, numsText, metaText) {
    const fill   = document.getElementById(`p-${prefix}-fill`);
    const numsEl = document.getElementById(`p-${prefix}-nums`);
    const metaEl = document.getElementById(`p-${prefix}-meta`);

    if (fill) {
      fill.style.width = Math.min(100, pct) + '%';
      fill.className   = 'bar-fill ' + (pct >= 90 ? 'bar-danger' : pct >= 70 ? 'bar-warning' : 'bar-ok');
    }
    if (numsEl) numsEl.textContent = numsText;
    if (metaEl) metaEl.textContent = metaText;
  }

  function showStatus(msg, isError = false) {
    const el = document.getElementById('status-msg');
    if (!el) return;
    el.textContent  = msg;
    el.style.color  = isError ? '#f87171' : '#10b981';
    setTimeout(() => { el.textContent = ''; }, 2500);
  }

  function sendMsg(payload, callback) {
    chrome.runtime.sendMessage(payload, (response) => {
      if (chrome.runtime.lastError) {
        console.warn('[CUT Popup]', chrome.runtime.lastError.message);
        return;
      }
      if (callback) callback(response);
    });
  }

  // ─── Render Stats ────────────────────────────────────────────────────────
  function renderStats(stats) {
    if (!stats) return;

    // Session
    const sh = Math.floor(stats.session.resetIn);
    const sm = Math.floor((stats.session.resetIn % 1) * 60);
    setBar(
      'session',
      stats.session.percentage,
      `${stats.session.messages} / ${stats.session.limit}`,
      stats.session.resetIn > 0
        ? `${sh}ঘণ্টা ${String(sm).padStart(2, '0')}মি পরে রিসেট`
        : 'নতুন session শুরু হয়েছে'
    );

    // Daily — countdown till midnight
    const msToMidnight = new Date().setHours(24, 0, 0, 0) - Date.now();
    const dh = Math.floor(msToMidnight / 3_600_000);
    const dm = Math.floor((msToMidnight % 3_600_000) / 60_000);
    setBar(
      'daily',
      stats.daily.percentage,
      `${stats.daily.messages} / ${stats.daily.limit}`,
      `${dh}ঘণ্টা ${dm}মি পরে midnight রিসেট`
    );

    // Weekly — days till next Monday
    const todayDay   = new Date().getDay();
    const daysTilMon = todayDay === 1 ? 7 : (todayDay === 0 ? 1 : 8 - todayDay);
    setBar(
      'weekly',
      stats.weekly.percentage,
      `${stats.weekly.messages} / ${stats.weekly.limit}`,
      `${daysTilMon} দিন পরে সোমবার রিসেট`
    );

    // All-time
    const allEl = document.getElementById('p-alltime');
    if (allEl) allEl.textContent = `মোট: ${(stats.allTime || 0).toLocaleString('bn-BD')} messages`;

    // Sync plan selector to stored value
    const planSel = document.getElementById('plan-select');
    if (planSel && stats.plan) planSel.value = stats.plan;
  }

  // ─── Load on open ─────────────────────────────────────────────────────────
  sendMsg({ type: 'GET_USAGE' }, renderStats);

  // ─── Plan change ──────────────────────────────────────────────────────────
  const planSel = document.getElementById('plan-select');
  if (planSel) {
    planSel.addEventListener('change', (e) => {
      sendMsg({ type: 'SET_PLAN', plan: e.target.value }, (res) => {
        if (res?.ok) {
          sendMsg({ type: 'GET_USAGE' }, renderStats);
          showStatus('Plan আপডেট হয়েছে ✓');
        } else {
          showStatus('Plan আপডেট ব্যর্থ।', true);
        }
      });
    });
  }

  // ─── Reset session ────────────────────────────────────────────────────────
  const resetSessionBtn = document.getElementById('reset-session');
  if (resetSessionBtn) {
    resetSessionBtn.addEventListener('click', () => {
      if (!confirm('Session ট্র্যাকিং রিসেট করবেন?')) return;
      sendMsg({ type: 'RESET_SESSION' }, (res) => {
        if (res?.ok) {
          sendMsg({ type: 'GET_USAGE' }, renderStats);
          showStatus('Session রিসেট হয়েছে ✓');
        }
      });
    });
  }

  // ─── Reset all ────────────────────────────────────────────────────────────
  const resetAllBtn = document.getElementById('reset-all');
  if (resetAllBtn) {
    resetAllBtn.addEventListener('click', () => {
      if (!confirm('সমস্ত usage ডেটা রিসেট করবেন?')) return;
      sendMsg({ type: 'RESET_ALL' }, (res) => {
        if (res?.ok) {
          sendMsg({ type: 'GET_USAGE' }, renderStats);
          showStatus('সব ডেটা রিসেট হয়েছে ✓');
        }
      });
    });
  }

}); // end DOMContentLoaded
