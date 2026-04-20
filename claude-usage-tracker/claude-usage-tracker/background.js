// Background Service Worker - Claude Usage Tracker

const FREE_PLAN_LIMITS = {
  session: { messages: 30, windowHours: 5 },   // ~15-40 per 5-hour window
  daily: { messages: 60 },                       // estimated daily (2 sessions)
  weekly: { messages: 300 }                      // estimated weekly
};

// Initialize storage on install
chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.get(['usageData'], (result) => {
    if (!result.usageData) {
      const now = Date.now();
      chrome.storage.local.set({
        usageData: {
          sessions: [],         // [{start, messages, tokens}]
          daily: [],            // [{date, count}] - last 7 days
          weekly: [],           // [{weekStart, count}]
          allTime: 0,
          lastReset: now,
          sessionStart: now,
          currentSession: { messages: 0, start: now }
        },
        userPlan: 'free',
        customLimits: null
      });
    }
  });
});

// Listen for messages from content script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'MESSAGE_SENT') {
    recordMessage(message.data).then(sendResponse);
    return true;
  }

  if (message.type === 'GET_USAGE') {
    getUsageStats().then(sendResponse);
    return true;
  }

  if (message.type === 'RESET_SESSION') {
    resetSession().then(sendResponse);
    return true;
  }

  if (message.type === 'SET_PLAN') {
    chrome.storage.local.set({ userPlan: message.plan }, () => sendResponse({ ok: true }));
    return true;
  }

  if (message.type === 'RESET_ALL') {
    resetAll().then(sendResponse);
    return true;
  }
});

async function recordMessage(data) {
  const result = await chrome.storage.local.get(['usageData', 'userPlan']);
  const usage = result.usageData || {};
  const now = Date.now();

  // Check if 5-hour session has expired
  const sessionAge = (now - usage.currentSession.start) / (1000 * 60 * 60);
  if (sessionAge >= 5) {
    // Archive old session
    usage.sessions = usage.sessions || [];
    usage.sessions.push({ ...usage.currentSession, end: now });
    if (usage.sessions.length > 50) usage.sessions = usage.sessions.slice(-50);

    // Start new session
    usage.currentSession = { messages: 0, start: now };
  }

  // Record message
  usage.currentSession.messages = (usage.currentSession.messages || 0) + 1;
  usage.allTime = (usage.allTime || 0) + 1;

  // Update daily tracking
  const today = new Date().toDateString();
  usage.daily = usage.daily || [];
  const todayEntry = usage.daily.find(d => d.date === today);
  if (todayEntry) {
    todayEntry.count++;
  } else {
    usage.daily.push({ date: today, count: 1 });
    // Keep only last 30 days
    if (usage.daily.length > 30) usage.daily = usage.daily.slice(-30);
  }

  // Update weekly tracking
  const weekStart = getWeekStart();
  usage.weekly = usage.weekly || [];
  const weekEntry = usage.weekly.find(w => w.weekStart === weekStart);
  if (weekEntry) {
    weekEntry.count++;
  } else {
    usage.weekly.push({ weekStart, count: 1 });
    if (usage.weekly.length > 8) usage.weekly = usage.weekly.slice(-8);
  }

  await chrome.storage.local.set({ usageData: usage });
  return { ok: true, usage };
}

async function getUsageStats() {
  const result = await chrome.storage.local.get(['usageData', 'userPlan', 'customLimits']);
  const usage = result.usageData || {};
  const plan = result.userPlan || 'free';
  const now = Date.now();

  // Session data
  const sessionAge = (now - (usage.currentSession?.start || now)) / (1000 * 60 * 60);
  const sessionMessages = sessionAge >= 5 ? 0 : (usage.currentSession?.messages || 0);
  const sessionResetIn = sessionAge >= 5 ? 0 : Math.max(0, 5 - sessionAge);
  const sessionStart = usage.currentSession?.start || now;

  // Daily count
  const today = new Date().toDateString();
  const todayCount = (usage.daily || []).find(d => d.date === today)?.count || 0;

  // Weekly count
  const weekStart = getWeekStart();
  const weekCount = (usage.weekly || []).find(w => w.weekStart === weekStart)?.count || 0;

  // Get limits based on plan
  const limits = getLimits(plan, result.customLimits);

  return {
    session: {
      messages: sessionMessages,
      limit: limits.session,
      resetIn: sessionResetIn,
      start: sessionStart,
      percentage: Math.min(100, (sessionMessages / limits.session) * 100)
    },
    daily: {
      messages: todayCount,
      limit: limits.daily,
      percentage: Math.min(100, (todayCount / limits.daily) * 100)
    },
    weekly: {
      messages: weekCount,
      limit: limits.weekly,
      percentage: Math.min(100, (weekCount / limits.weekly) * 100)
    },
    allTime: usage.allTime || 0,
    plan
  };
}

function getLimits(plan, custom) {
  if (custom) return custom;
  const plans = {
    free:  { session: 30,  daily: 60,   weekly: 300  },
    pro:   { session: 150, daily: 300,  weekly: 1500 },
    max5x: { session: 750, daily: 1500, weekly: 7500 }
  };
  return plans[plan] || plans.free;
}

function getWeekStart() {
  const d = new Date();
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  const monday = new Date(d.setDate(diff));
  return monday.toDateString();
}

async function resetSession() {
  const result = await chrome.storage.local.get(['usageData']);
  const usage = result.usageData || {};
  usage.currentSession = { messages: 0, start: Date.now() };
  await chrome.storage.local.set({ usageData: usage });
  return { ok: true };
}

async function resetAll() {
  const now = Date.now();
  await chrome.storage.local.set({
    usageData: {
      sessions: [],
      daily: [],
      weekly: [],
      allTime: 0,
      lastReset: now,
      sessionStart: now,
      currentSession: { messages: 0, start: now }
    }
  });
  return { ok: true };
}
