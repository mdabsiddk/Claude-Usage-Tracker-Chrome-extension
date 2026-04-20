// Popup Script - Claude Usage Tracker

function setBar(prefix, pct, nums, meta) {
  const fill = document.getElementById(`p-${prefix}-fill`);
  const numsEl = document.getElementById(`p-${prefix}-nums`);
  const metaEl = document.getElementById(`p-${prefix}-meta`);

  if (fill) {
    fill.style.width = pct + '%';
    fill.className = 'bar-fill ' + (pct >= 90 ? 'bar-danger' : pct >= 70 ? 'bar-warning' : 'bar-ok');
  }
  if (numsEl) numsEl.textContent = nums;
  if (metaEl) metaEl.textContent = meta;
}

function showStatus(msg, isError = false) {
  const el = document.getElementById('status-msg');
  if (el) {
    el.textContent = msg;
    el.style.color = isError ? '#f87171' : '#10b981';
    setTimeout(() => { el.textContent = ''; }, 2500);
  }
}

function renderStats(stats) {
  if (!stats) return;

  // Session
  const sh = Math.floor(stats.session.resetIn);
  const sm = Math.floor((stats.session.resetIn % 1) * 60);
  setBar(
    'session',
    stats.session.percentage,
    `${stats.session.messages} / ${stats.session.limit}`,
    stats.session.resetIn > 0 ? `${sh}h ${String(sm).padStart(2,'0')}m পরে রিসেট` : 'নতুন session'
  );

  // Daily
  const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate()+1); tomorrow.setHours(0,0,0,0);
  const hLeft = Math.floor((tomorrow - Date.now()) / 3600000);
  const mLeft = Math.floor(((tomorrow - Date.now()) % 3600000) / 60000);
  setBar(
    'daily',
    stats.daily.percentage,
    `${stats.daily.messages} / ${stats.daily.limit}`,
    `${hLeft}h ${mLeft}m পরে midnight reset`
  );

  // Weekly
  const nextMon = new Date(); const daysTil = (8 - nextMon.getDay()) % 7 || 7;
  setBar(
    'weekly',
    stats.weekly.percentage,
    `${stats.weekly.messages} / ${stats.weekly.limit}`,
    `${daysTil} দিন পরে সোমবার reset`
  );

  const alltime = document.getElementById('p-alltime');
  if (alltime) alltime.textContent = `মোট: ${stats.allTime} messages`;

  // Set plan select
  const planSel = document.getElementById('plan-select');
  if (planSel && stats.plan) planSel.value = stats.plan;
}

// Load stats on open
chrome.runtime.sendMessage({ type: 'GET_USAGE' }, renderStats);

// Plan change
document.getElementById('plan-select').addEventListener('change', (e) => {
  chrome.runtime.sendMessage({ type: 'SET_PLAN', plan: e.target.value }, () => {
    chrome.runtime.sendMessage({ type: 'GET_USAGE' }, renderStats);
    showStatus('Plan আপডেট হয়েছে!');
  });
});

// Reset session
document.getElementById('reset-session').addEventListener('click', () => {
  if (confirm('Session ট্র্যাকিং রিসেট করবেন?')) {
    chrome.runtime.sendMessage({ type: 'RESET_SESSION' }, () => {
      chrome.runtime.sendMessage({ type: 'GET_USAGE' }, renderStats);
      showStatus('Session রিসেট হয়েছে!');
    });
  }
});

// Reset all
document.getElementById('reset-all').addEventListener('click', () => {
  if (confirm('সমস্ত usage ডেটা রিসেট করবেন?')) {
    chrome.runtime.sendMessage({ type: 'RESET_ALL' }, () => {
      chrome.runtime.sendMessage({ type: 'GET_USAGE' }, renderStats);
      showStatus('সব ডেটা রিসেট হয়েছে!');
    });
  }
});
