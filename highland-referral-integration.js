const express = require('express');

const ACTIVE_RUN_STATUSES = new Set(['creating_remote_job', 'queued', 'running']);
const TERMINAL_REMOTE_STATUSES = new Set(['done', 'failed', 'timeout', 'cancelled']);
const REFERRAL_CODE_RE = /^[A-Za-z0-9_-]{4,64}$/;
const HIGHLAND_TARGET_SUCCESS_COUNT = 1;
const HIGHLAND_MAX_ACTIVE_RUNS_PER_USER = 5;

function createHighlandReferralRouter(deps) {
  const {
    getDb,
    saveDb,
    auth,
    adminOnly,
    uid,
    now,
    cleanUser
  } = deps;
  const router = express.Router();
  const purchaseLocks = new Set();
  const runLocks = new Set();

  function db() {
    return getDb();
  }

  async function persist() {
    await Promise.resolve(saveDb());
  }

  function ensureHighlandState() {
    const state = db();
    state.highlandReferralPurchases = Array.isArray(state.highlandReferralPurchases) ? state.highlandReferralPurchases : [];
    state.highlandReferralRuns = Array.isArray(state.highlandReferralRuns) ? state.highlandReferralRuns : [];
    state.users = Array.isArray(state.users) ? state.users : [];
    state.users.forEach(ensureUserCredits);
    return state;
  }

  function ensureUserCredits(user) {
    if (!user) return 0;
    const credits = Math.max(0, Math.floor(Number(user.highlandReferralCredits || 0)));
    user.highlandReferralCredits = credits;
    return credits;
  }

  function cfg() {
    const settings = (db() && db().settings) || {};
    const priceRaw = Math.floor(Number(settings.highlandReferralPrice || 0));
    const cooldownRaw = Math.floor(Number(settings.highlandReferralCooldownSeconds || 2));
    const timeoutRaw = Math.floor(Number(settings.highlandReferralRunTimeoutMinutes || 40));
    return {
      enabled: String(settings.highlandReferralEnabled || '0') === '1',
      price: Number.isFinite(priceRaw) ? Math.max(0, priceRaw) : 0,
      remoteBaseUrl: normalizeRemoteBaseUrl(settings.highlandReferralRemoteBaseUrl),
      remoteApiKey: String(settings.highlandReferralRemoteApiKey || '').trim(),
      cooldownSeconds: Number.isFinite(cooldownRaw) ? Math.max(0, Math.min(86400, cooldownRaw)) : 2,
      timeoutMinutes: Number.isFinite(timeoutRaw) ? Math.max(1, Math.min(240, timeoutRaw)) : 40
    };
  }

  function normalizeRemoteBaseUrl(value) {
    let base = String(value || '').trim().replace(/\/+$/, '');
    base = base.replace(/\/api\/jobs$/i, '');
    base = base.replace(/\/api$/i, '');
    return base.replace(/\/+$/, '');
  }

  function maskValue(value, head = 2, tail = 2) {
    const text = String(value || '');
    if (!text) return '';
    if (text.length <= head + tail) return '*'.repeat(text.length);
    return text.slice(0, head) + '*'.repeat(Math.max(3, text.length - head - tail)) + text.slice(-tail);
  }

  function safeSettings(isAdmin = false) {
    const c = cfg();
    const out = {
      enabled: c.enabled,
      price: c.price,
      cooldownSeconds: c.cooldownSeconds,
      timeoutMinutes: c.timeoutMinutes
    };
    if (isAdmin) {
      out.remoteBaseUrl = c.remoteBaseUrl;
      out.remoteApiKeyMasked = c.remoteApiKey ? maskValue(c.remoteApiKey, 6, 4) : '';
      out.remoteApiKeyConfigured = !!c.remoteApiKey;
    }
    return out;
  }

  function safeUser(user) {
    return { ...cleanUser(user), highlandReferralCredits: ensureUserCredits(user) };
  }

  function safeRun(run, isAdmin = false) {
    if (!run) return null;
    const out = {
      id: run.id,
      status: run.status,
      remoteStatus: run.remoteStatus || '',
      referralCode: run.referralCode || '',
      referralCodeMasked: run.referralCodeMasked || '',
      remoteJobId: run.remoteJobId || '',
      reservedCredit: !!run.reservedCredit,
      creditFinalized: !!run.creditFinalized,
      creditReleased: !!run.creditReleased,
      safeMessage: run.safeMessage || '',
      safeError: run.safeError || '',
      attemptCount: Math.floor(Number(run.attemptCount || 0)),
      successCount: Math.floor(Number(run.successCount || 0)),
      failureCount: Math.floor(Number(run.failureCount || 0)),
      targetSuccessCount: Math.max(1, Math.floor(Number(run.targetSuccessCount || HIGHLAND_TARGET_SUCCESS_COUNT))),
      created_at: run.created_at || '',
      started_at: run.started_at || '',
      finished_at: run.finished_at || '',
      expires_at: run.expires_at || ''
    };
    if (isAdmin) {
      out.user_id = run.user_id;
      out.username = run.username || '';
    }
    return out;
  }

  function safeRunsForUser(user, limit = 20) {
    ensureHighlandState();
    return db().highlandReferralRuns
      .filter(r => r.user_id === user.id)
      .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')))
      .slice(0, limit)
      .map(r => safeRun(r, false));
  }

  function activeRunForUser(userId) {
    return activeRunsForUser(userId)[0] || null;
  }

  function activeRunsForUser(userId) {
    ensureHighlandState();
    return db().highlandReferralRuns
      .filter(r => r.user_id === userId && ACTIVE_RUN_STATUSES.has(String(r.status || '')))
      .sort((a, b) => String(a.created_at || '').localeCompare(String(b.created_at || '')));
  }

  function latestFinishedRun(userId) {
    ensureHighlandState();
    return db().highlandReferralRuns
      .filter(r => r.user_id === userId && r.finished_at)
      .sort((a, b) => String(b.finished_at || '').localeCompare(String(a.finished_at || '')))[0] || null;
  }

  function assertCooldownPassed(userId) {
    const c = cfg();
    if (!c.cooldownSeconds) return;
    const latest = latestFinishedRun(userId);
    if (!latest) return;
    const t = new Date(latest.finished_at).getTime();
    if (!Number.isFinite(t)) return;
    const remaining = c.cooldownSeconds - Math.floor((Date.now() - t) / 1000);
    if (remaining > 0) throw Object.assign(new Error(`Vui lòng chờ ${remaining}s trước khi chạy lượt tiếp theo`), { status: 429 });
  }

  async function withUserLock(lockSet, userId, fn) {
    if (lockSet.has(userId)) throw Object.assign(new Error('Yêu cầu trước đó vẫn đang xử lý, vui lòng thử lại sau'), { status: 429 });
    lockSet.add(userId);
    try {
      return await fn();
    } finally {
      lockSet.delete(userId);
    }
  }

  function sanitizeError(err, fallback = 'Không xử lý được yêu cầu') {
    if (!err) return fallback;
    const msg = String(err.message || err.error || err || fallback);
    return msg.slice(0, 220);
  }

  async function remoteFetch(pathname, options = {}) {
    const c = cfg();
    if (!c.remoteBaseUrl || !c.remoteApiKey) {
      throw Object.assign(new Error('Quản trị viên chưa cấu hình API từ xa cho Highlands Coffee'), { status: 400 });
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options.timeoutMs || 20000);
    try {
      const res = await fetch(c.remoteBaseUrl + pathname, {
        method: options.method || 'GET',
        headers: {
          'content-type': 'application/json',
          'x-api-key': c.remoteApiKey,
          ...(options.headers || {})
        },
        body: options.body ? JSON.stringify(options.body) : undefined,
        signal: controller.signal
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.ok === false) {
        if (res.status === 404) {
          throw Object.assign(new Error('Địa chỉ API từ xa không đúng endpoint. Hãy nhập URL gốc của remote API, ví dụ https://your-api.onrender.com, không thêm /api hoặc /api/jobs'), { status: 502 });
        }
        throw Object.assign(new Error(data.error || data.safeMessage || ('API từ xa lỗi HTTP ' + res.status)), { status: res.status || 502 });
      }
      return data;
    } catch (err) {
      if (err.name === 'AbortError') throw Object.assign(new Error('API từ xa quá thời gian chờ'), { status: 504 });
      throw err;
    } finally {
      clearTimeout(timeout);
    }
  }

  function releaseReservedCredit(run, reason) {
    if (!run || !run.reservedCredit || run.creditFinalized || run.creditReleased) return false;
    const user = db().users.find(u => u.id === run.user_id);
    if (!user) return false;
    user.highlandReferralCredits = ensureUserCredits(user) + 1;
    run.reservedCredit = false;
    run.creditReleased = true;
    run.safeMessage = reason || run.safeMessage || 'Đã hoàn lại lượt sử dụng';
    return true;
  }

  function finalizeReservedCredit(run) {
    if (!run || !run.reservedCredit || run.creditFinalized || run.creditReleased) return false;
    run.reservedCredit = false;
    run.creditFinalized = true;
    run.safeMessage = 'Hoàn tất';
    return true;
  }

  function markRunTerminal(run, status, message) {
    run.status = status;
    run.remoteStatus = run.remoteStatus || status;
    run.finished_at = run.finished_at || now();
    if (message) run.safeError = message;
  }

  function cleanupStaleRuns() {
    ensureHighlandState();
    let changed = false;
    for (const run of db().highlandReferralRuns) {
      if (!ACTIVE_RUN_STATUSES.has(String(run.status || ''))) continue;
      const expires = new Date(run.expires_at || 0).getTime();
      if (Number.isFinite(expires) && Date.now() > expires) {
        releaseReservedCredit(run, 'Đã hoàn lại lượt do phiên xử lý quá hạn');
        markRunTerminal(run, 'timeout', 'Phiên xử lý quá hạn');
        changed = true;
      }
    }
    return changed;
  }

  async function syncRemoteRun(run) {
    if (!run || !run.remoteJobId || !ACTIVE_RUN_STATUSES.has(String(run.status || ''))) return run;
    if (cleanupStaleRuns()) await persist();
    if (!ACTIVE_RUN_STATUSES.has(String(run.status || ''))) return run;

    let remote;
    try {
      remote = await remoteFetch('/api/jobs/' + encodeURIComponent(run.remoteJobId), { timeoutMs: 15000 });
    } catch (err) {
      run.safeError = sanitizeError(err, 'Không kết nối được API từ xa');
      await persist();
      return run;
    }

    const remoteStatus = String(remote.status || '').toLowerCase();
    run.remoteStatus = remoteStatus;
    run.attemptCount = Math.floor(Number(remote.attemptCount || run.attemptCount || 0));
    run.successCount = Math.floor(Number(remote.successCount || run.successCount || 0));
    run.failureCount = Math.floor(Number(remote.failureCount || run.failureCount || 0));
    run.targetSuccessCount = Math.max(1, Math.floor(Number(remote.targetSuccesses || remote.targetSuccessCount || run.targetSuccessCount || HIGHLAND_TARGET_SUCCESS_COUNT)));
    run.safeMessage = String(remote.safeMessage || run.safeMessage || '');

    if (remoteStatus === 'done') {
      finalizeReservedCredit(run);
      markRunTerminal(run, 'done', '');
      run.result = remote.result || null;
    } else if (TERMINAL_REMOTE_STATUSES.has(remoteStatus)) {
      releaseReservedCredit(run, 'Đã hoàn lại lượt vì lượt xử lý từ xa không hoàn thành');
      markRunTerminal(run, remoteStatus === 'timeout' ? 'timeout' : 'failed', sanitizeError(remote.safeError || remote.error || remote.safeMessage, 'Lượt xử lý từ xa không hoàn thành'));
    } else {
      run.status = remoteStatus === 'queued' ? 'queued' : 'running';
      run.updated_at = now();
    }
    await persist();
    return run;
  }

  router.get('/api/highland-referral/status', auth, async (req, res) => {
    try {
      ensureHighlandState();
      if (cleanupStaleRuns()) await persist();
      for (const run of activeRunsForUser(req.user.id)) {
        await syncRemoteRun(run);
      }
      const activeRuns = activeRunsForUser(req.user.id);
      const active = activeRuns[0] || null;
      res.json({
        settings: safeSettings(false),
        credits: ensureUserCredits(req.user),
        activeRun: safeRun(active, false),
        activeRuns: activeRuns.map(r => safeRun(r, false)),
        maxActiveRuns: HIGHLAND_MAX_ACTIVE_RUNS_PER_USER,
        runs: safeRunsForUser(req.user),
        user: safeUser(req.user)
      });
    } catch (err) {
      res.status(err.status || 500).json({ error: sanitizeError(err) });
    }
  });

  router.post('/api/highland-referral/purchase', auth, async (req, res) => {
    try {
      const out = await withUserLock(purchaseLocks, req.user.id, async () => {
        ensureHighlandState();
        const c = cfg();
        const quantity = Math.floor(Number(req.body.quantity || 0));
        if (!c.enabled) throw Object.assign(new Error('Dịch vụ Highlands Coffee đang tắt'), { status: 400 });
        if (!Number.isFinite(quantity) || quantity < 1 || quantity > 100) throw Object.assign(new Error('Số lượng mua không hợp lệ'), { status: 400 });
        if (c.price <= 0) throw Object.assign(new Error('Quản trị viên chưa cài giá Highlands Coffee'), { status: 400 });
        const total = c.price * quantity;
        if (Math.floor(Number(req.user.balance || 0)) < total) throw Object.assign(new Error('Số dư không đủ để mua lượt Highlands Coffee'), { status: 400 });
        req.user.balance = Math.floor(Number(req.user.balance || 0) - total);
        req.user.highlandReferralCredits = ensureUserCredits(req.user) + quantity;
        const purchase = {
          id: uid('hrp'),
          user_id: req.user.id,
          username: req.user.username,
          quantity,
          unit_price: c.price,
          total,
          created_at: now()
        };
        db().highlandReferralPurchases.push(purchase);
        db().notifications.push({ id: uid('n'), type: 'highland_referral_purchase', message: `${req.user.username} mua ${quantity} lượt Highlands Coffee (${total.toLocaleString('vi-VN')}đ)`, read: 0, created_at: now() });
        await persist();
        return { purchase, user: safeUser(req.user), credits: ensureUserCredits(req.user) };
      });
      res.json(out);
    } catch (err) {
      res.status(err.status || 500).json({ error: sanitizeError(err, 'Không mua được lượt Highlands Coffee') });
    }
  });

  router.post('/api/highland-referral/run', auth, async (req, res) => {
    try {
      const out = await withUserLock(runLocks, req.user.id, async () => {
        ensureHighlandState();
        if (cleanupStaleRuns()) await persist();
        const c = cfg();
        const referralCode = String(req.body.referralCode || '').trim();
        if (!c.enabled) throw Object.assign(new Error('Dịch vụ Highlands Coffee đang tắt'), { status: 400 });
        if (!c.remoteBaseUrl || !c.remoteApiKey) throw Object.assign(new Error('Quản trị viên chưa cấu hình API từ xa'), { status: 400 });
        if (!REFERRAL_CODE_RE.test(referralCode)) throw Object.assign(new Error('Mã giới thiệu không hợp lệ'), { status: 400 });
        if (ensureUserCredits(req.user) <= 0) throw Object.assign(new Error('Bạn chưa có lượt Highlands Coffee'), { status: 400 });
        const activeRuns = activeRunsForUser(req.user.id);
        if (activeRuns.length >= HIGHLAND_MAX_ACTIVE_RUNS_PER_USER) {
          throw Object.assign(new Error(`Bạn chỉ được có tối đa ${HIGHLAND_MAX_ACTIVE_RUNS_PER_USER} lượt Highlands Coffee đang chờ/chạy`), { status: 409 });
        }
        if (!activeRuns.length) assertCooldownPassed(req.user.id);

        req.user.highlandReferralCredits = ensureUserCredits(req.user) - 1;
        const run = {
          id: uid('hrr'),
          user_id: req.user.id,
          username: req.user.username,
          referralCode,
          referralCodeMasked: maskValue(referralCode),
          status: 'creating_remote_job',
          remoteStatus: '',
          remoteJobId: '',
          reservedCredit: true,
          creditFinalized: false,
          creditReleased: false,
          safeMessage: 'Đang tạo lượt xử lý từ xa',
          safeError: '',
          attemptCount: 0,
          successCount: 0,
          failureCount: 0,
          targetSuccessCount: HIGHLAND_TARGET_SUCCESS_COUNT,
          result: null,
          created_at: now(),
          started_at: now(),
          finished_at: '',
          expires_at: new Date(Date.now() + c.timeoutMinutes * 60 * 1000).toISOString(),
          updated_at: now()
        };
        db().highlandReferralRuns.push(run);
        await persist();

        try {
          const remote = await remoteFetch('/api/jobs', {
            method: 'POST',
            body: { clientRunId: run.id, referralCode },
            timeoutMs: 20000
          });
          run.remoteJobId = String(remote.jobId || remote.id || '');
          if (!run.remoteJobId) throw new Error('API từ xa không trả mã lượt xử lý');
          run.status = String(remote.status || 'queued').toLowerCase();
          run.remoteStatus = run.status;
          run.safeMessage = 'Đã tạo lượt xử lý từ xa';
          run.updated_at = now();
          await persist();
        } catch (err) {
          releaseReservedCredit(run, 'Đã hoàn lại lượt vì không tạo được lượt xử lý từ xa');
          markRunTerminal(run, 'failed', sanitizeError(err, 'Không tạo được lượt xử lý từ xa'));
          await persist();
        }
        return { run: safeRun(run, false), user: safeUser(req.user), credits: ensureUserCredits(req.user) };
      });
      res.json(out);
    } catch (err) {
      res.status(err.status || 500).json({ error: sanitizeError(err, 'Không chạy được Highlands Coffee') });
    }
  });

  router.get('/api/highland-referral/runs/:id', auth, async (req, res) => {
    try {
      ensureHighlandState();
      const run = db().highlandReferralRuns.find(r => r.id === req.params.id && (r.user_id === req.user.id || req.user.role === 'admin'));
      if (!run) return res.status(404).json({ error: 'Không tìm thấy lượt Highlands Coffee' });
      await syncRemoteRun(run);
      res.json({ run: safeRun(run, req.user.role === 'admin'), user: req.user.role === 'admin' ? undefined : safeUser(req.user) });
    } catch (err) {
      res.status(err.status || 500).json({ error: sanitizeError(err, 'Không tải được trạng thái Highlands Coffee') });
    }
  });

  router.get('/api/admin/highland-referral/settings', auth, adminOnly, (req, res) => {
    ensureHighlandState();
    res.json({ settings: safeSettings(true) });
  });

  router.patch('/api/admin/highland-referral/settings', auth, adminOnly, async (req, res) => {
    try {
      ensureHighlandState();
      const settings = db().settings;
      if (req.body.highlandReferralEnabled !== undefined) settings.highlandReferralEnabled = String(req.body.highlandReferralEnabled) === '1' ? '1' : '0';
      if (req.body.highlandReferralPrice !== undefined) {
        const price = Math.floor(Number(req.body.highlandReferralPrice || 0));
        if (!Number.isFinite(price) || price < 0) return res.status(400).json({ error: 'Giá Highlands Coffee không hợp lệ' });
        settings.highlandReferralPrice = String(price);
      }
      if (req.body.highlandReferralCooldownSeconds !== undefined) {
        const n = Math.floor(Number(req.body.highlandReferralCooldownSeconds || 0));
        if (!Number.isFinite(n) || n < 0 || n > 86400) return res.status(400).json({ error: 'Thời gian chờ phải từ 0 đến 86400 giây' });
        settings.highlandReferralCooldownSeconds = String(n);
      }
      if (req.body.highlandReferralRunTimeoutMinutes !== undefined) {
        const n = Math.floor(Number(req.body.highlandReferralRunTimeoutMinutes || 0));
        if (!Number.isFinite(n) || n < 1 || n > 240) return res.status(400).json({ error: 'Thời gian quá hạn phải từ 1 đến 240 phút' });
        settings.highlandReferralRunTimeoutMinutes = String(n);
      }
      if (req.body.highlandReferralRemoteBaseUrl !== undefined) {
        const base = normalizeRemoteBaseUrl(req.body.highlandReferralRemoteBaseUrl);
        if (base && !/^https?:\/\//i.test(base)) return res.status(400).json({ error: 'Địa chỉ API từ xa phải bắt đầu bằng http hoặc https' });
        settings.highlandReferralRemoteBaseUrl = base;
      }
      if (req.body.highlandReferralRemoteApiKey !== undefined) {
        settings.highlandReferralRemoteApiKey = String(req.body.highlandReferralRemoteApiKey || '').trim();
      }
      await persist();
      res.json({ settings: safeSettings(true) });
    } catch (err) {
      res.status(err.status || 500).json({ error: sanitizeError(err, 'Không lưu được cấu hình Highlands Coffee') });
    }
  });

  router.get('/api/admin/highland-referral/health', auth, adminOnly, async (req, res) => {
    try {
      const c = cfg();
      if (!c.remoteBaseUrl) return res.status(400).json({ ok: false, error: 'Chưa cấu hình địa chỉ API từ xa' });
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 12000);
      try {
        const r = await fetch(c.remoteBaseUrl + '/health', { headers: c.remoteApiKey ? { 'x-api-key': c.remoteApiKey } : {}, signal: controller.signal });
        const data = await r.json().catch(() => ({}));
        return res.status(r.ok ? 200 : 502).json({ ok: r.ok, status: r.status, data });
      } finally {
        clearTimeout(timeout);
      }
    } catch (err) {
      res.status(502).json({ ok: false, error: sanitizeError(err, 'Không kết nối được API từ xa') });
    }
  });

  router.get('/api/admin/highland-referral/runs', auth, adminOnly, (req, res) => {
    ensureHighlandState();
    const rows = db().highlandReferralRuns
      .slice()
      .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')))
      .slice(0, 100)
      .map(r => safeRun(r, true));
    res.json(rows);
  });

  return router;
}

module.exports = { createHighlandReferralRouter };
