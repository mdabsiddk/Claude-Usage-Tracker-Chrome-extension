// Background Service Worker — Claude Usage Tracker v2.2
// Best Practices: Queue, In-Memory Cache, Single-Source Logic, Tabs Broadcast, Cross-Device Sync

'use strict';

const PLAN_LIMITS = {
  free:   { session: 30,   daily: 60,    weekly: 300   },
  pro:    { session: 150,  daily: 300,   weekly: 1500  },
  max5x:  { session: 750,  daily: 1500,  weekly: 7500  },
  max10x: { session: 1500, daily: 3000,  weekly: 15000 },
  max20x: { session: 3000, daily: 6000,  weekly: 30000 },
};

const SESSION_WINDOW_HOURS = 5;
const MAX_SESSIONS_HISTORY = 50;
const MAX_DAILY_HISTORY    = 30;
const MAX_WEEKLY_HISTORY   = 8;

let _cache        = null;  
let _plan         = 'free';
let _customLimits = null;
let _queue = Promise.resolve();

function enqueue(asyncFn) {
  _queue = _queue.then(asyncFn).catch((err) => {
    console.error('[CUT] Queue error:', err);
  });
  return _queue;
}

// ─── Startup & Merge Logic ──────────────────────────────────────────────────
chrome.runtime.onInstalled.addListener(async (details) => {
  if (details.reason !== 'install') return;
  try {
    const loc = await chrome.storage.local.get(['usageData']);
    if (!loc.usageData) {
      await chrome.storage.local.set({
        usageData: createDefaultUsageData(),
        userPlan: 'free',
        customLimits: null
      });
    }
  } catch (err) { }
});

// Load on worker wakeup
loadAndMergeData();

async function loadAndMergeData() {
  try {
    const [localData, syncData] = await Promise.all([
      chrome.storage.local.get(['usageData', 'userPlan', 'customLimits']),
      chrome.storage.sync.get(['usageData', 'userPlan', 'customLimits'])
    ]);

    const localTime = localData.usageData?.lastModified || 0;
    const syncTime = syncData.usageData?.lastModified || 0;

    if (syncTime > localTime && syncData.usageData) {
      // Sync is newer
      _cache = syncData.usageData;
      _plan = syncData.userPlan || 'free';
      _customLimits = syncData.customLimits || null;
      // Mirror back to local
      await chrome.storage.local.set({ usageData: _cache, userPlan: _plan, customLimits: _customLimits });
    } else {
      // Local is newer or equal
      _cache = localData.usageData || createDefaultUsageData();
      _plan = localData.userPlan || 'free';
      _customLimits = localData.customLimits || null;
    }
  } catch (e) {
    _cache = createDefaultUsageData();
  }
}

// ─── Storage Helpers ────────────────────────────────────────────────────────
async function saveToStorage() {
  try {
    _cache.lastModified = Date.now();
    await chrome.storage.local.set({ usageData: _cache, userPlan: _plan, customLimits: _customLimits });
    
    // Schedule a debounced push to Sync Storage using Alarms (MV3 safe)
    chrome.alarms.create('sync_push_alarm', { delayInMinutes: 5 });
  } catch (err) {
    console.error('[CUT] Storage write error:', err);
  }
}

function createDefaultUsageData() {
  const now = Date.now();
  return {
    sessions: [], daily: [], weekly: [], allTime: 0,
    lastReset: now, lastModified: now, currentSession: { messages: 0, start: now },
  };
}

// ─── Sync Push Alarm ────────────────────────────────────────────────────────
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === 'sync_push_alarm') {
    if (!_cache) await loadAndMergeData();
    try {
      await chrome.storage.sync.set({
        usageData: _cache,
        userPlan: _plan,
        customLimits: _customLimits
      });
    } catch (e) {
      console.warn('[CUT] Sync write quota exceeded or error:', e);
    }
  }
});

// ─── Listen for Real-Time Sync Changes (Other Devices) ──────────────────────
chrome.storage.onChanged.addListener(async (changes, areaName) => {
  if (areaName === 'sync' && changes.usageData) {
    const newSyncData = changes.usageData.newValue;
    if (newSyncData) {
      const syncTime = newSyncData.lastModified || 0;
      const localTime = _cache?.lastModified || 0;
      
      if (syncTime > localTime) {
        _cache = newSyncData;
        if (changes.userPlan) _plan = changes.userPlan.newValue;
        if (changes.customLimits) _customLimits = changes.customLimits.newValue;
        
        await chrome.storage.local.set({ usageData: _cache, userPlan: _plan, customLimits: _customLimits });
        broadcastToTabs(buildStatsResponse());
      }
    }
  }
});

// ─── Broadcast to Tabs ──────────────────────────────────────────────────────
function broadcastToTabs(stats) {
  chrome.tabs.query({ url: "*://claude.ai/*" }, (tabs) => {
    tabs.forEach(tab => {
      chrome.tabs.sendMessage(tab.id, { type: 'BROADCAST_UPDATE', stats }).catch(() => {});
    });
  });
}

// ─── Message Router ─────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  switch (message.type) {
    case 'MESSAGE_SENT':
      enqueue(async () => {
        const stats = await recordMessage(message.data || {});
        broadcastToTabs(stats);
        return stats;
      }).then(sendResponse);
      return true;

    case 'GET_USAGE':
      enqueue(async () => {
        if (!_cache) await loadAndMergeData();
        checkAndExpireSession(Date.now());
        return buildStatsResponse();
      }).then(sendResponse);
      return true;

    case 'RESET_SESSION':
      enqueue(async () => {
        if (!_cache) await loadAndMergeData();
        _cache.currentSession = { messages: 0, start: Date.now() };
        await saveToStorage();
        const stats = buildStatsResponse();
        broadcastToTabs(stats);
        return { ok: true };
      }).then(sendResponse);
      return true;

    case 'RESET_ALL':
      enqueue(async () => {
        _cache = createDefaultUsageData();
        await saveToStorage();
        const stats = buildStatsResponse();
        broadcastToTabs(stats);
        return { ok: true };
      }).then(sendResponse);
      return true;

    case 'SET_PLAN':
      enqueue(async () => {
        if (!PLAN_LIMITS[message.plan] && message.plan !== 'custom') {
          return { ok: false, error: 'Unknown plan' };
        }
        _plan = message.plan;
        await saveToStorage();
        const stats = buildStatsResponse();
        broadcastToTabs(stats);
        return { ok: true };
      }).then(sendResponse);
      return true;

    case 'SYNC_LIMIT':
      enqueue(async () => {
        await syncLimit(message.remaining);
        const stats = buildStatsResponse();
        broadcastToTabs(stats);
      });
      sendResponse({ ok: true });
      return true;

    default:
      return false;
  }
});

// ─── Dynamic Sync Logic ─────────────────────────────────────────────────────
async function syncLimit(remaining) {
  if (!_cache) await loadAndMergeData();
  checkAndExpireSession(Date.now());
  
  const limits = getLimits(_plan, _customLimits);
  const correctedMessages = Math.max(0, limits.session - remaining);
  
  if (correctedMessages > _cache.currentSession.messages) {
    _cache.currentSession.messages = correctedMessages;
    await saveToStorage();
  }
}

// ─── Record a Message ───────────────────────────────────────────────────────
async function recordMessage(_data) {
  if (!_cache) await loadAndMergeData();

  const now = Date.now();
  checkAndExpireSession(now);

  _cache.currentSession.messages += 1;
  _cache.allTime                 += 1;

  const todayKey = getTodayKey();
  const dayEntry = _cache.daily.find((d) => d.date === todayKey);
  if (dayEntry) {
    dayEntry.count += 1;
  } else {
    _cache.daily.push({ date: todayKey, count: 1 });
    if (_cache.daily.length > MAX_DAILY_HISTORY) _cache.daily = _cache.daily.slice(-MAX_DAILY_HISTORY);
  }

  const weekKey   = getWeekStartKey();
  const weekEntry = _cache.weekly.find((w) => w.weekStart === weekKey);
  if (weekEntry) {
    weekEntry.count += 1;
  } else {
    _cache.weekly.push({ weekStart: weekKey, count: 1 });
    if (_cache.weekly.length > MAX_WEEKLY_HISTORY) _cache.weekly = _cache.weekly.slice(-MAX_WEEKLY_HISTORY);
  }

  await saveToStorage();
  return buildStatsResponse();
}

// ─── Build Stats Response Object ────────────────────────────────────────────
function buildStatsResponse() {
  const now    = Date.now();
  const limits = getLimits(_plan, _customLimits);

  const sessionAgeHours = (now - _cache.currentSession.start) / 3_600_000;
  const sessionExpired  = sessionAgeHours >= SESSION_WINDOW_HOURS;
  const sessionMsgs     = sessionExpired ? 0 : _cache.currentSession.messages;
  const sessionResetIn  = sessionExpired ? 0 : Math.max(0, SESSION_WINDOW_HOURS - sessionAgeHours);

  const todayCount = _cache.daily.find((d) => d.date === getTodayKey())?.count || 0;
  const weekCount  = _cache.weekly.find((w) => w.weekStart === getWeekStartKey())?.count || 0;

  return {
    session: {
      messages:   sessionMsgs,
      limit:      limits.session,
      resetIn:    sessionResetIn,
      start:      _cache.currentSession.start,
      percentage: Math.min(100, (sessionMsgs / limits.session) * 100),
    },
    daily: {
      messages:   todayCount,
      limit:      limits.daily,
      percentage: Math.min(100, (todayCount / limits.daily) * 100),
    },
    weekly: {
      messages:   weekCount,
      limit:      limits.weekly,
      percentage: Math.min(100, (weekCount / limits.weekly) * 100),
    },
    allTime: _cache.allTime,
    plan:    _plan,
  };
}

// ─── Session Expiry ─────────────────────────────────────────────────────────
function checkAndExpireSession(now) {
  const ageHours = (now - _cache.currentSession.start) / 3_600_000;
  if (ageHours < SESSION_WINDOW_HOURS) return;

  _cache.sessions.push({ ..._cache.currentSession, end: now });
  if (_cache.sessions.length > MAX_SESSIONS_HISTORY) {
    _cache.sessions = _cache.sessions.slice(-MAX_SESSIONS_HISTORY);
  }

  _cache.currentSession = { messages: 0, start: now };
}

// ─── Date Helpers ───────────────────────────────────────────────────────────
function getTodayKey() { return new Date().toDateString(); }

function getWeekStartKey() {
  const now  = new Date();
  const day  = now.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  const mon  = new Date(now.getFullYear(), now.getMonth(), now.getDate() + diff);
  return mon.toDateString();
}

function getLimits(plan, custom) {
  if (custom) return custom;
  return PLAN_LIMITS[plan] || PLAN_LIMITS.free;
}
