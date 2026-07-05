require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const { MongoClient } = require('mongodb');
const { v2: cloudinary } = require('cloudinary');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'change-this-secret';
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'hungnbyt';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'azhung12';
const MONGODB_URI = String(process.env.MONGODB_URI || '').trim();
const MONGODB_DB = String(process.env.MONGODB_DB || 'coalldichvu').trim();
const CLOUDINARY_CLOUD_NAME = String(process.env.CLOUDINARY_CLOUD_NAME || '').trim();
const CLOUDINARY_API_KEY = String(process.env.CLOUDINARY_API_KEY || '').trim();
const CLOUDINARY_API_SECRET = String(process.env.CLOUDINARY_API_SECRET || '').trim();
const CLOUDINARY_URL = String(process.env.CLOUDINARY_URL || '').trim();

const root = __dirname;
const dataDir = process.env.DATA_DIR || path.join(root, 'data');
const uploadDir = process.env.UPLOAD_DIR || path.join(root, 'uploads');
const dbFile = path.join(dataDir, 'app-data.json');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

if (CLOUDINARY_URL) {
  cloudinary.config({ cloudinary_url: CLOUDINARY_URL });
} else {
  cloudinary.config({
    cloud_name: CLOUDINARY_CLOUD_NAME,
    api_key: CLOUDINARY_API_KEY,
    api_secret: CLOUDINARY_API_SECRET
  });
}
const useCloudinary = !!(CLOUDINARY_URL || (CLOUDINARY_CLOUD_NAME && CLOUDINARY_API_KEY && CLOUDINARY_API_SECRET));
let mongoClient = null;
let stateCollection = null;
let saveQueue = Promise.resolve();
function now() { return new Date().toISOString(); }
function uid(prefix) { return prefix + '_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8); }
function daysInactive(u) {
  const t = new Date(u.last_login || u.created_at || now()).getTime();
  return Math.max(0, Math.floor((Date.now() - t) / 86400000));
}

const defaults = {
  users: [], services: [], rentals: [], deposits: [], notifications: [], dmxProducts: [], dmxOrders: [], sepayTransactions: [], binanceTransactions: [],
  settings: {
    siteName: 'Có All Dịch Vụ',
    brandText: 'Thuê sim nhanh - nhiều nhà mạng - quản lý dễ dàng',
    logoUrl: '', adUrl: '', themeColor: '#2563eb', layoutMode: 'modern',
    legacyApiBaseUrl: 'https://chaycodeso3.com/api',
    legacyApiKey: '248c26ea0cd1371009db5dd443339ca1',
    codesimApiBaseUrl: 'https://apisim.codesim.net',
    codesimApiKey: 'eyJhbGciOiJIUzUxMiJ9.eyJzdWIiOiJudWJpYTMiLCJqdGkiOiI4NDM1NiIsImlhdCI6MTc3NzA4NDE5NiwiZXhwIjoxODM5MjkyMTk2fQ.F5SrJi-hvbhovlmaoxHyIcqshXwbnapb-nltkXkPQO2WLTG8kr5VRPHZdu8ZYdrzmi8m6pTbUZtMo1dSsI6cvA',
    apiBaseUrl: 'https://chaycodeso3.com/api',
    apiProvider: 'legacy',
    apiKey: '248c26ea0cd1371009db5dd443339ca1',
    otpTimeoutMinutes: '20',
    sepayWebhookApiKey: process.env.SEPAY_WEBHOOK_API_KEY || '',
    binanceEnabled: '0',
    binanceApiKey: '',
    binanceApiSecret: '',
    binanceUsdtVndRate: '26000',
    binanceContentPrefix: 'BNCDV',
    binanceMinUsdt: '1',
    binanceMaxUsdt: '10000',
    binancePayeeName: '',
    binanceExpiryMinutes: '30',
    binanceQrImage: '',
    binanceLastPolledAt: 0,
    binanceNextNoteId: 1
  }
};
let db = null;

function normalizeDb(parsed) {
  parsed = parsed || {};
  return { ...defaults, ...parsed, dmxProducts: parsed.dmxProducts || [], dmxOrders: parsed.dmxOrders || [], sepayTransactions: parsed.sepayTransactions || [], binanceTransactions: parsed.binanceTransactions || [], settings: { ...defaults.settings, ...(parsed.settings || {}) } };
}
async function loadDb() {
  if (MONGODB_URI) {
    mongoClient = new MongoClient(MONGODB_URI);
    await mongoClient.connect();
    stateCollection = mongoClient.db(MONGODB_DB).collection('app_state');
    const doc = await stateCollection.findOne({ _id: 'main' });
    if (doc) return normalizeDb(doc.data || doc);
    let initial = null;
    try {
      if (fs.existsSync(dbFile)) initial = JSON.parse(fs.readFileSync(dbFile, 'utf8'));
    } catch (e) { console.error('Không đọc được file JSON để import:', e); }
    const first = normalizeDb(initial || defaults);
    await stateCollection.replaceOne({ _id: 'main' }, { _id: 'main', data: first, updated_at: now() }, { upsert: true });
    return first;
  }
  try {
    if (fs.existsSync(dbFile)) return normalizeDb(JSON.parse(fs.readFileSync(dbFile, 'utf8')));
  } catch (e) { console.error('Không đọc được database JSON:', e); }
  return JSON.parse(JSON.stringify(defaults));
}
function saveDb() {
  if (stateCollection) {
    const snapshot = JSON.parse(JSON.stringify(db));
    saveQueue = saveQueue.then(() => stateCollection.replaceOne({ _id: 'main' }, { _id: 'main', data: snapshot, updated_at: now() }, { upsert: true }))
      .catch(e => console.error('Không lưu được MongoDB:', e));
    return saveQueue;
  }
  const tmp = dbFile + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, dbFile);
}
async function migrate() {
  let changed = false;
  if (!db.users.find(u => u.username === ADMIN_USERNAME)) {
    db.users.push({ id: uid('u'), username: ADMIN_USERNAME, password_hash: bcrypt.hashSync(ADMIN_PASSWORD, 10), role: 'admin', balance: 0, created_at: now(), last_login: now(), status: 'active' });
    changed = true;
  }
  if (!db.services.length) {
    [
      ['Facebook', 'Viettel', 2500, 'Thuê sim nhận OTP Facebook'],
      ['Zalo', 'VinaPhone', 3000, 'Thuê sim nhận OTP Zalo'],
      ['Telegram', 'MobiFone', 3500, 'Thuê sim nhận OTP Telegram'],
      ['Shopee', 'Vietnamobile', 2000, 'Thuê sim nhận OTP Shopee'],
      ['Google/Gmail', 'Viettel', 4000, 'Thuê sim nhận OTP Google']
    ].forEach(s => db.services.push({ id: uid('s'), name: s[0], network: s[1], price: s[2], visible: 0, description: s[3], imageUrl: '', created_at: now(), updated_at: now() }));
    changed = true;
  }
  if (changed) saveDb();
}

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use('/uploads', express.static(uploadDir));
app.use(express.static(path.join(root, 'public')));

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });
function uploadToCloudinary(file, folder = 'coalldichvu') {
  if (!file) return Promise.resolve('');
  if (!useCloudinary) {
    const filename = Date.now() + '_' + file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
    fs.writeFileSync(path.join(uploadDir, filename), file.buffer);
    return Promise.resolve('/uploads/' + filename);
  }
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream({ folder, resource_type: 'image' }, (err, result) => {
      if (err) {
        console.error('Cloudinary upload error:', err.message || err);
        return reject(new Error(err.message || 'Cloudinary upload failed'));
      }
      resolve(result.secure_url);
    });
    stream.end(file.buffer);
  });
}

function sign(user) { return jwt.sign({ id: user.id, username: user.username, role: user.role }, JWT_SECRET, { expiresIn: '7d' }); }
function cleanUser(u) { return u ? { id: u.id, username: u.username, role: u.role, balance: u.balance || 0, created_at: u.created_at, last_login: u.last_login, status: u.status || 'active' } : null; }
function auth(req, res, next) {
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/, '');
  if (!token) return res.status(401).json({ error: 'Bạn chưa đăng nhập' });
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const user = db.users.find(u => u.id === decoded.id);
    if (!user || user.status !== 'active') return res.status(401).json({ error: 'Tài khoản không hợp lệ hoặc đã bị khóa/xóa' });
    req.user = user; next();
  } catch { res.status(401).json({ error: 'Phiên đăng nhập hết hạn' }); }
}
function adminOnly(req, res, next) { if (req.user.role !== 'admin') return res.status(403).json({ error: 'Chỉ admin được dùng chức năng này' }); next(); }
function providerCfg(provider) {
  provider = String(provider || 'legacy').toLowerCase();
  if (provider === 'codesim') return {
    provider: 'codesim',
    base: String(db.settings.codesimApiBaseUrl || 'https://apisim.codesim.net').trim().replace(/\/+$/, ''),
    key: String(db.settings.codesimApiKey || process.env.CODESIM_API_KEY || '').trim()
  };
  return {
    provider: 'legacy',
    base: String(db.settings.legacyApiBaseUrl || db.settings.apiBaseUrl || 'https://chaycodeso3.com/api').trim().replace(/\/+$/, ''),
    key: String(db.settings.legacyApiKey || db.settings.apiKey || process.env.SIM_API_KEY || '').trim()
  };
}
function getOtpTimeoutMinutes() {
  const n = Number(db.settings.otpTimeoutMinutes || 20);
  return Number.isFinite(n) && n > 0 ? n : 20;
}
function buildUrlWithBase(base, pathname, params = {}) {
  const url = new URL(base + pathname);
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && String(v) !== '') url.searchParams.set(k, String(v));
  });
  return url;
}
async function fetchJson(url) {
  const r = await fetch(url.toString(), {
    method: 'GET',
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36',
      'Accept': 'application/json,text/plain,*/*'
    }
  });
  const text = await r.text();
  let data;
  try { data = JSON.parse(text); } catch { throw new Error('API trả về không phải JSON: ' + text.slice(0, 160)); }
  if (!r.ok) throw new Error(data.message || data.Msg || ('API lỗi HTTP ' + r.status));
  return data;
}
function isProviderOk(provider, data) {
  return provider === 'codesim' ? Number(data.status) === 200 : Number(data.ResponseCode) === 0;
}
async function simApi(provider, action, params = {}) {
  const cfg = providerCfg(provider);
  if (!cfg.key) throw new Error('Admin chưa cài API key cho ' + cfg.provider);
  if (cfg.provider === 'codesim') {
    if (action === 'account') return fetchJson(buildUrlWithBase(cfg.base, '/yourself/information-by-api-key', { api_key: cfg.key }));
    if (action === 'services') return fetchJson(buildUrlWithBase(cfg.base, '/service/get_service_by_api_key', { api_key: cfg.key }));
    if (action === 'networks') return fetchJson(buildUrlWithBase(cfg.base, '/network/get-network-by-api-key', { api_key: cfg.key }));
    if (action === 'rent') return fetchJson(buildUrlWithBase(cfg.base, '/sim/get_sim', { api_key: cfg.key, service_id: params.service_id, network_id: params.network_id, phone: params.phone }));
    if (action === 'code') return fetchJson(buildUrlWithBase(cfg.base, '/otp/get_otp_by_phone_api_key', { api_key: cfg.key, otp_id: params.otp_id }));
    if (action === 'cancel') return fetchJson(buildUrlWithBase(cfg.base, '/sim/cancel_api_key/' + encodeURIComponent(params.sim_id || ''), { api_key: cfg.key }));
  }
  const url = new URL(cfg.base);
  const actMap = { account: 'account', services: 'app', rent: 'number', code: 'code', cancel: 'expired' };
  Object.entries({ ...params, act: actMap[action] || action, apik: cfg.key }).forEach(([k, v]) => {
    if (v !== undefined && v !== null && String(v) !== '') url.searchParams.set(k, String(v));
  });
  return fetchJson(url);
}
function normalizeServices(provider, data) {
  const arr = provider === 'codesim' ? (Array.isArray(data.data) ? data.data : []) : (Array.isArray(data.Result) ? data.Result : []);
  return arr.map(a => ({
    provider,
    external_app_id: String(provider === 'codesim' ? (a.id || a.Id || '') : (a.Id || a.id || '')).trim(),
    name: String(provider === 'codesim' ? (a.name || a.Name || '') : (a.Name || a.name || '')).trim(),
    api_cost: Math.floor(Number(provider === 'codesim' ? (a.price || a.Cost || 0) : (a.Cost || a.price || 0)))
  })).filter(x => x.external_app_id && x.name);
}
async function cancelExternalRental(r) {
  if (r.cancelled_external || !r.external_sim_id) return null;
  try {
    const out = await simApi(r.provider || 'legacy', 'cancel', { sim_id: r.external_sim_id, id: r.external_sim_id });
    r.cancelled_external = 1;
    return out;
  } catch (e) {
    r.note = (r.note ? r.note + ' | ' : '') + 'Không hủy được sim API: ' + e.message;
    return null;
  }
}
async function refundRental(r, reason = 'Hết thời gian chờ OTP, đã tự hoàn tiền') {
  if (!r || r.refunded || r.otp_code || r.status === 'Đã nhận code') return false;
  const owner = db.users.find(u => u.id === r.user_id);
  if (owner) owner.balance = Math.floor(Number(owner.balance || 0) + Number(r.price || 0));
  r.refunded = 1;
  r.status = 'Không nhận được code';
  r.ended_at = r.ended_at || now();
  r.note = reason;
  await cancelExternalRental(r);
  return true;
}
async function processExpiredRentals() {
  const timeoutMs = getOtpTimeoutMinutes() * 60 * 1000;
  let changed = false;
  for (const r of db.rentals || []) {
    const waiting = !r.otp_code && !r.refunded && !r.ended_at && String(r.status || '').toLowerCase().includes('chờ');
    if (!waiting) continue;
    const t = new Date(r.rented_at || r.created_at || now()).getTime();
    if (Date.now() - t >= timeoutMs) {
      await refundRental(r);
      changed = true;
    }
  }
  if (changed) saveDb();
}
function safeSettingsForUser(settings, isAdmin) {
  const out = { ...settings };
  if (!isAdmin) { delete out.apiKey; delete out.legacyApiKey; delete out.codesimApiKey; delete out.sepayWebhookApiKey; delete out.binanceApiKey; delete out.binanceApiSecret; }
  if (isAdmin && out.legacyApiKey) out.legacyApiKeyMasked = out.legacyApiKey.slice(0, 6) + '...' + out.legacyApiKey.slice(-4);
  if (isAdmin && out.codesimApiKey) out.codesimApiKeyMasked = out.codesimApiKey.slice(0, 6) + '...' + out.codesimApiKey.slice(-4);
  if (isAdmin && out.apiKey) out.apiKeyMasked = out.apiKey.slice(0, 6) + '...' + out.apiKey.slice(-4);
  if (isAdmin && out.sepayWebhookApiKey) out.sepayWebhookApiKeyMasked = out.sepayWebhookApiKey.slice(0, 6) + '...' + out.sepayWebhookApiKey.slice(-4);
  if (isAdmin) {
    const effKey = (typeof getBinanceApiKey === 'function') ? getBinanceApiKey() : '';
    const effSecret = (typeof getBinanceApiSecret === 'function') ? getBinanceApiSecret() : '';
    if (effKey) out.binanceApiKeyMasked = effKey.slice(0, 6) + '...' + effKey.slice(-4);
    if (effSecret) out.binanceApiSecretMasked = effSecret.slice(0, 6) + '...' + effSecret.slice(-4);
    out.binanceApiKeyFromEnv = (typeof isBinanceApiKeyFromEnv === 'function') ? isBinanceApiKeyFromEnv() : false;
    out.binanceApiSecretFromEnv = (typeof isBinanceApiSecretFromEnv === 'function') ? isBinanceApiSecretFromEnv() : false;
  }
  return out;
}

function getBinanceApiKey() {
  return String(process.env.BINANCE_API_KEY || (db && db.settings && db.settings.binanceApiKey) || '').trim();
}
function getBinanceApiSecret() {
  return String(process.env.BINANCE_API_SECRET || (db && db.settings && db.settings.binanceApiSecret) || '').trim();
}
function isBinanceApiKeyFromEnv() {
  return !!String(process.env.BINANCE_API_KEY || '').trim();
}
function isBinanceApiSecretFromEnv() {
  return !!String(process.env.BINANCE_API_SECRET || '').trim();
}
function escapeRegex(str) {
  return String(str || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
async function signedBinanceRequest(reqPath, params = {}) {
  const apiKey = getBinanceApiKey();
  const apiSecret = getBinanceApiSecret();
  if (!apiKey || !apiSecret) return { ok: false, code: -1, msg: 'Binance API key/secret chưa cấu hình' };
  const merged = { ...params, recvWindow: 5000, timestamp: Date.now() };
  const qs = Object.entries(merged)
    .filter(([, v]) => v !== undefined && v !== null && String(v) !== '')
    .map(([k, v]) => encodeURIComponent(k) + '=' + encodeURIComponent(String(v)))
    .join('&');
  const signature = crypto.createHmac('sha256', apiSecret).update(qs).digest('hex');
  const url = 'https://api.binance.com' + reqPath + '?' + qs + '&signature=' + signature;
  try {
    const r = await fetch(url, { method: 'GET', headers: { 'X-MBX-APIKEY': apiKey, 'Accept': 'application/json' } });
    const text = await r.text();
    let data;
    try { data = JSON.parse(text); } catch { return { ok: false, code: r.status, msg: 'Binance trả về không phải JSON: ' + text.slice(0, 200) }; }
    if (!r.ok) return { ok: false, code: data.code || r.status, msg: data.msg || ('HTTP ' + r.status) };
    return { ok: true, data };
  } catch (e) {
    return { ok: false, code: -2, msg: e.message || 'Network error' };
  }
}

app.get('/api/health', (req, res) => res.json({ ok: true, app: 'Có All Dịch Vụ', db: stateCollection ? 'mongodb' : 'json', cloudinary: useCloudinary, time: now() }));
app.get('/api/settings', (req, res) => {
  let isAdmin = false;
  try {
    const token = (req.headers.authorization || '').replace(/^Bearer\s+/, '');
    if (token) {
      const decoded = jwt.verify(token, JWT_SECRET);
      const u = db.users.find(x => x.id === decoded.id);
      isAdmin = !!u && u.role === 'admin';
    }
  } catch {}
  res.json(safeSettingsForUser(db.settings, isAdmin));
});

app.post('/api/register', (req, res) => {
  const username = String(req.body.username || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  if (!/^[a-z0-9_]{3,30}$/.test(username)) return res.status(400).json({ error: 'Tên đăng nhập chỉ gồm chữ thường, số, dấu _, từ 3-30 ký tự' });
  if (password.length < 6) return res.status(400).json({ error: 'Mật khẩu tối thiểu 6 ký tự' });
  if (db.users.some(u => u.username === username)) return res.status(400).json({ error: 'Tên đăng nhập đã tồn tại' });
  const user = { id: uid('u'), username, password_hash: bcrypt.hashSync(password, 10), role: 'user', balance: 0, created_at: now(), last_login: now(), status: 'active' };
  db.users.push(user); saveDb();
  res.json({ token: sign(user), user: cleanUser(user) });
});

app.post('/api/login', (req, res) => {
  const username = String(req.body.username || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  const user = db.users.find(u => u.username === username);
  if (!user || !bcrypt.compareSync(password, user.password_hash)) return res.status(400).json({ error: 'Sai tài khoản hoặc mật khẩu' });
  if (user.status !== 'active') return res.status(403).json({ error: 'Tài khoản đã bị khóa/xóa' });
  user.last_login = now(); saveDb();
  res.json({ token: sign(user), user: cleanUser(user) });
});
app.get('/api/me', auth, (req, res) => res.json({ user: cleanUser(req.user) }));

app.get('/api/services', auth, (req, res) => {
  const rows = db.services.filter(s => req.user.role === 'admin' || Number(s.visible) === 1).sort((a,b) => (b.visible-a.visible) || a.name.localeCompare(b.name));
  res.json(rows);
});
app.post('/api/rentals', auth, async (req, res) => {
  try {
    const service = db.services.find(s => s.id === req.body.service_id && Number(s.visible) === 1);
    if (!service) return res.status(404).json({ error: 'Dịch vụ không tồn tại hoặc đang ẩn' });
    if (!service.external_app_id) return res.status(400).json({ error: 'Dịch vụ này chưa gắn Service ID API. Admin hãy đồng bộ API hoặc nhập Service ID.' });
    if ((req.user.balance || 0) < service.price) return res.status(400).json({ error: 'Số dư web không đủ, vui lòng nạp thêm tiền' });
    const networkId = String(req.body.carrier || '').trim();
    const apiResult = await simApi(service.provider || 'legacy', 'rent', { service_id: service.external_app_id, appId: service.external_app_id, carrier: networkId, network_id: networkId });
    if (!isProviderOk(service.provider || 'legacy', apiResult)) return res.status(400).json({ error: apiResult.message || apiResult.Msg || 'API không cấp được số', api: apiResult });
    const result = (service.provider === 'codesim') ? (apiResult.data || {}) : (apiResult.Result || {});
    const phone = service.provider === 'codesim' ? result.phone : (String(result.Number || '').startsWith('0') ? String(result.Number || '') : ('0' + String(result.Number || '')));
    const otpId = service.provider === 'codesim' ? result.otpId : result.Id;
    const simId = service.provider === 'codesim' ? result.simId : result.Id;
    if (!phone || !otpId) return res.status(400).json({ error: apiResult.message || apiResult.Msg || 'API không trả về số sim/OTP ID', api: apiResult });
    const cost = Math.floor(Number(result.payment || result.Cost || service.price || 0));
    req.user.balance = Math.floor(Number(req.user.balance || 0) - Number(service.price || cost));
    const displayNumber = String(phone || '');
    const rental = {
      id: uid('r'), user_id: req.user.id, service_id: service.id, service_name: service.name,
      network: networkId || 'Mặc định', phone_number: displayNumber, price: service.price, api_cost: cost,
      external_id: String(otpId || ''), external_sim_id: String(simId || ''), api_app_id: String(service.external_app_id), provider: service.provider || 'legacy',
      status: 'Đang chờ code', rented_at: now(), ended_at: '', otp_code: '', sms: '', note: apiResult.message || apiResult.Msg || ''
    };
    db.rentals.push(rental); saveDb();
    res.json({ rental, user: cleanUser(req.user), api: apiResult });
  } catch (e) { res.status(500).json({ error: e.message || 'Không gọi được API thuê sim' }); }
});
app.get('/api/rentals', auth, async (req, res) => { await processExpiredRentals(); res.json(db.rentals.filter(r => r.user_id === req.user.id).sort((a,b) => b.rented_at.localeCompare(a.rented_at))); });
app.get('/api/rentals/stats', auth, async (req, res) => { await processExpiredRentals(); res.json(buildDailyStats(String(req.query.date || '').trim(), req.user.id)); });

app.post('/api/rentals/:id/check-code', auth, async (req, res) => {
  try {
    await processExpiredRentals();
    const r = db.rentals.find(x => x.id === req.params.id && (x.user_id === req.user.id || req.user.role === 'admin'));
    if (!r) return res.status(404).json({ error: 'Không tìm thấy lượt thuê' });
    if (r.refunded) return res.json({ rental: r, api: { message: r.note || 'Đã tự hoàn tiền' }, user: cleanUser(req.user) });
    if (!r.external_id) return res.status(400).json({ error: 'Lượt thuê này không có OTP ID API' });
    const apiResult = await simApi(r.provider || 'legacy', 'code', { otp_id: r.external_id, id: r.external_id });
    const provider = r.provider || 'legacy';
    if (provider === 'codesim' && isProviderOk(provider, apiResult) && apiResult.data && apiResult.data.code) {
      const result = apiResult.data || {};
      r.status = 'Đã nhận code'; r.otp_code = String(result.code || ''); r.sms = String(result.content || ''); r.ended_at = now(); r.note = apiResult.message || '';
    } else if (provider === 'legacy' && isProviderOk(provider, apiResult) && apiResult.Result && apiResult.Result.Code) {
      const result = apiResult.Result || {};
      r.status = 'Đã nhận code'; r.otp_code = String(result.Code || ''); r.sms = String(result.SMS || ''); r.ended_at = now(); r.note = apiResult.Msg || '';
    } else {
      r.note = apiResult.message || apiResult.Msg || 'Chưa có OTP, vui lòng thử lại sau';
    }
    saveDb();
    res.json({ rental: r, api: apiResult, user: cleanUser(req.user) });
  } catch (e) { res.status(500).json({ error: e.message || 'Không lấy được code' }); }
});
app.post('/api/rentals/:id/cancel', auth, async (req, res) => {
  try {
    const r = db.rentals.find(x => x.id === req.params.id && (x.user_id === req.user.id || req.user.role === 'admin'));
    if (!r) return res.status(404).json({ error: 'Không tìm thấy lượt thuê' });
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'User không được hủy sim đang thuê. Hệ thống sẽ tự hoàn tiền nếu hết thời gian chờ OTP mà chưa nhận được OTP.' });
    if (!r.external_sim_id) return res.status(400).json({ error: 'Lượt thuê này không có Sim ID API' });
    const apiResult = await simApi(r.provider || 'legacy', 'cancel', { sim_id: r.external_sim_id, id: r.external_sim_id });
    if (isProviderOk(r.provider || 'legacy', apiResult)) { r.status = 'Đã hủy'; r.ended_at = now(); r.cancelled_external = 1; }
    r.note = apiResult.message || apiResult.Msg || r.note || ''; saveDb();
    res.json({ rental: r, api: apiResult });
  } catch (e) { res.status(500).json({ error: e.message || 'Không hủy được lượt thuê' }); }
});




function onlyDigits(v) { return String(v ?? '').replace(/[^0-9]/g, ''); }
function normText(v) { return String(v ?? '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9_]+/g, ' ').trim(); }
function makeSepayCode(username) { return ('NAP ' + String(username || '').toLowerCase() + ' ' + Math.random().toString(36).slice(2, 7).toUpperCase()).trim(); }
function buildSepayQr(amount, content) {
  const bank = String(db.settings.sepayBankCode || process.env.SEPAY_BANK || 'MB').trim();
  const account = String(db.settings.sepayAccount || process.env.SEPAY_ACCOUNT || '').trim();
  const name = String(db.settings.sepayAccountName || process.env.SEPAY_ACCOUNT_NAME || '').trim();
  if (!bank || !account) return '';
  const q = new URLSearchParams();
  if (amount) q.set('amount', String(Math.floor(Number(amount || 0))));
  q.set('addInfo', String(content || ''));
  if (name) q.set('accountName', name);
  return `https://img.vietqr.io/image/${encodeURIComponent(bank)}-${encodeURIComponent(account)}-compact2.png?${q.toString()}`;
}
function extractSepayPayload(body) {
  const b = body || {};
  const amount = Math.floor(Number(b.transferAmount ?? b.amount ?? b.money ?? b.creditAmount ?? b.transactionAmount ?? b.value ?? 0));
  const content = String(b.content ?? b.description ?? b.transferContent ?? b.transactionContent ?? b.transaction_content ?? b.memo ?? b.note ?? '');
  const ref = String(b.id ?? b.referenceCode ?? b.reference_code ?? b.transactionId ?? b.transaction_id ?? b.gatewayTransactionId ?? b.code ?? b.transactionDate ?? '');
  const type = String(b.transferType ?? b.type ?? b.direction ?? '').toLowerCase();
  return { amount, content, ref, type };
}
function findUserBySepayContent(content) {
  const normalized = normText(content);
  return (db.users || []).find(u => normalized.includes(normText(u.username)));
}
function approveDeposit(dep, transactionRef, rawPayload) {
  if (!dep || dep.status === 'Đã duyệt') return false;
  const u = db.users.find(x => x.id === dep.user_id);
  if (!u) return false;
  u.balance = Math.floor(Number(u.balance || 0) + Number(dep.amount || 0));
  dep.status = 'Đã duyệt';
  dep.admin_note = 'Tự động cộng tiền qua SePay' + (transactionRef ? ` (${transactionRef})` : '');
  dep.reviewed_at = now();
  dep.sepay_ref = transactionRef || dep.sepay_ref || '';
  dep.sepay_payload = rawPayload || dep.sepay_payload || null;
  db.notifications.push({ id: uid('n'), type: 'deposit_auto', message: `Đã tự cộng ${Number(dep.amount||0).toLocaleString('vi-VN')}đ cho ${(u||{}).username || 'user'} qua SePay`, read: 0, created_at: now() });
  return true;
}

app.post('/api/deposits/auto', auth, async (req, res) => {
  try {
    const amount = Math.floor(Number(req.body.amount || 0));
    if (amount < 1000) return res.status(400).json({ error: 'Số tiền nạp tối thiểu 1.000đ' });
    const code = makeSepayCode(req.user.username);
    const qrUrl = buildSepayQr(amount, code);
    const dep = { id: uid('d'), user_id: req.user.id, amount, content: code, proof_image: '', status: 'Chờ thanh toán', admin_note: 'Đang chờ SePay xác nhận', created_at: now(), reviewed_at: '', method: 'sepay', sepay_code: code, sepay_qr: qrUrl };
    db.deposits.push(dep);
    saveDb();
    res.json({ deposit: dep, qrUrl, transferContent: code, bank: db.settings.sepayBankCode, account: db.settings.sepayAccount, accountName: db.settings.sepayAccountName });
  } catch (e) { res.status(500).json({ error: e.message || 'Không tạo được lệnh nạp SePay' }); }
});

app.post('/api/sepay/webhook', async (req, res) => {
  try {
    const webhookKey = String(process.env.SEPAY_WEBHOOK_API_KEY || db.settings.sepayWebhookApiKey || '').trim();
    const authHeader = String(req.headers['authorization'] || '').trim();
    const providedKey = authHeader.replace(/^Apikey\s+/i, '').trim();

    if (!webhookKey) {
      console.warn('SEPAY WEBHOOK: No API key configured — rejecting request for security');
      return res.status(401).json({ success: false, error: 'Webhook not configured' });
    }
    if (providedKey !== webhookKey) {
      console.warn('SEPAY WEBHOOK: Invalid API key');
      return res.status(401).json({ success: false, error: 'Unauthorized' });
    }

    db.sepayTransactions = db.sepayTransactions || [];
    const payload = req.body || {};
    console.log('SEPAY WEBHOOK RECEIVED:', JSON.stringify(payload).slice(0, 1500));
    const { amount, content, ref, type } = extractSepayPayload(payload);
    if (type && type.includes('out')) return res.json({ success: true, ignored: 'outgoing' });
    if (!amount || amount <= 0 || !Number.isInteger(amount)) return res.json({ success: true, ignored: 'invalid_payload' });
    if (!content || !String(content).trim()) return res.json({ success: true, ignored: 'invalid_payload' });
    const txKey = ref || `${amount}:${content}:${JSON.stringify(payload).slice(0,200)}`;
    if (db.sepayTransactions.some(t => t.key === txKey)) return res.json({ success: true, duplicate: true });

    const normalized = normText(content);
    let dep = (db.deposits || [])
      .filter(d => ['Chờ thanh toán','Chờ duyệt'].includes(String(d.status || '')) && Math.floor(Number(d.amount || 0)) === amount)
      .find(d => d.sepay_code && normalized.includes(normText(d.sepay_code)));

    if (!dep) {
      const user = findUserBySepayContent(content);
      if (user) {
        dep = (db.deposits || [])
          .filter(d => ['Chờ thanh toán','Chờ duyệt'].includes(String(d.status || '')) && d.user_id === user.id && Math.floor(Number(d.amount || 0)) === amount)
          .sort((a,b) => String(b.created_at).localeCompare(String(a.created_at)))[0];
      }
    }

    const credited = approveDeposit(dep, txKey, payload);
    db.sepayTransactions.push({ key: txKey, amount, content, credited, deposit_id: dep ? dep.id : '', created_at: now(), payload });
    saveDb();
    return res.json({ success: true, credited, deposit_id: dep ? dep.id : null });
  } catch (e) {
    console.error('SEPAY WEBHOOK ERROR:', e);
    return res.status(200).json({ success: false, error: e.message || 'Webhook error' });
  }
});

// ---------- Binance Pay deposit ----------
function getBinanceConfig() {
  const s = (db && db.settings) || {};
  return {
    enabled: String(s.binanceEnabled || '0') === '1',
    apiKey: getBinanceApiKey(),
    apiSecret: getBinanceApiSecret(),
    rate: Number(s.binanceUsdtVndRate || 0),
    prefix: String(s.binanceContentPrefix || 'BNCDV').trim().toUpperCase(),
    minUsdt: Number(s.binanceMinUsdt || 0),
    maxUsdt: Number(s.binanceMaxUsdt || 0),
    payeeName: String(s.binancePayeeName || ''),
    expiryMinutes: Math.max(1, Math.floor(Number(s.binanceExpiryMinutes || 30))),
    nextNoteId: Math.max(1, Math.floor(Number(s.binanceNextNoteId || 1)))
  };
}
function binanceStatusOf(dep) {
  if (!dep) return 'unknown';
  const s = String(dep.status || '');
  if (s === 'Đã duyệt') return 'paid';
  if (s === 'Hết hạn') return 'expired';
  return 'pending';
}
let binanceWorkerStarted = false;
let binanceWorkerHandle = null;
let binanceWorkerBusy = false;

app.post('/api/deposits/binance', auth, async (req, res) => {
  try {
    const cfg = getBinanceConfig();
    if (!cfg.enabled) return res.status(400).json({ error: 'Binance Pay đang tắt' });
    if (!cfg.apiKey || !cfg.apiSecret) return res.status(400).json({ error: 'Binance API key/secret chưa cấu hình' });
    if (!cfg.rate || cfg.rate <= 0) return res.status(400).json({ error: 'Rate USDT-VND chưa được cấu hình' });
    if (!/^[A-Z0-9]{2,10}$/.test(cfg.prefix)) return res.status(400).json({ error: 'Prefix nội dung Binance chưa hợp lệ' });
    const vnd = Math.floor(Number(req.body.vndAmount ?? req.body.amount ?? 0));
    if (!vnd || vnd <= 0) return res.status(400).json({ error: 'Số tiền nạp không hợp lệ' });
    const usdtAmount = Math.ceil((vnd / cfg.rate) * 100) / 100;
    if (cfg.minUsdt > 0 && usdtAmount < cfg.minUsdt) return res.status(400).json({ error: `Số USDT phải tối thiểu ${cfg.minUsdt}` });
    if (cfg.maxUsdt > 0 && usdtAmount > cfg.maxUsdt) return res.status(400).json({ error: `Số USDT vượt quá tối đa ${cfg.maxUsdt}` });
    const noteId = cfg.nextNoteId;
    db.settings.binanceNextNoteId = noteId + 1;
    const note = cfg.prefix + String(noteId);
    const expiresAt = new Date(Date.now() + cfg.expiryMinutes * 60 * 1000).toISOString();
    const dep = {
      id: uid('d'), user_id: req.user.id, amount: vnd, content: note, proof_image: '',
      status: 'Chờ thanh toán', admin_note: 'Đang chờ Binance xác nhận',
      created_at: now(), reviewed_at: '',
      method: 'binance',
      usdt_amount: usdtAmount,
      rate_used: cfg.rate,
      binance_note: note,
      binance_note_id: noteId,
      binance_tx_id: '',
      expires_at: expiresAt
    };
    db.deposits.push(dep);
    saveDb();
    res.json({
      deposit: dep,
      id: dep.id,
      note,
      usdtAmount,
      rate: cfg.rate,
      payeeName: cfg.payeeName,
      qrImage: String(db.settings.binanceQrImage || ''),
      expiresAt,
      vndAmount: vnd
    });
  } catch (e) { res.status(500).json({ error: e.message || 'Không tạo được lệnh nạp Binance' }); }
});

app.get('/api/deposits/binance/:id/status', auth, (req, res) => {
  const dep = db.deposits.find(d => d.id === req.params.id);
  if (!dep) return res.status(404).json({ error: 'Không tìm thấy lệnh nạp' });
  if (dep.user_id !== req.user.id && req.user.role !== 'admin') return res.status(403).json({ error: 'Không có quyền xem lệnh nạp này' });
  if (dep.method !== 'binance') return res.status(400).json({ error: 'Lệnh nạp này không phải Binance' });
  const status = binanceStatusOf(dep);
  const out = { status, expiresAt: dep.expires_at || '' };
  if (status === 'paid') {
    out.vndAmount = Number(dep.amount || 0);
    out.usdtAmount = Number(dep.usdt_amount || 0);
    out.txId = dep.binance_tx_id || '';
  }
  res.json(out);
});

async function processBinancePayments() {
  if (binanceWorkerBusy) return { matched: 0, expired: 0, errors: ['busy'] };
  binanceWorkerBusy = true;
  const summary = { matched: 0, expired: 0, errors: [] };
  try {
    const cfg = getBinanceConfig();
    // Expiry sweep always runs (independent of API config)
    const nowMs = Date.now();
    let changed = false;
    for (const d of db.deposits || []) {
      if (d.method === 'binance' && d.status === 'Chờ thanh toán' && d.expires_at) {
        const t = new Date(d.expires_at).getTime();
        if (Number.isFinite(t) && nowMs > t) {
          d.status = 'Hết hạn';
          d.admin_note = 'Tự động hết hạn (Binance không nhận được tx khớp)';
          d.reviewed_at = now();
          summary.expired++;
          changed = true;
        }
      }
    }

    if (!cfg.enabled) {
      if (changed) saveDb();
      return summary;
    }
    if (!cfg.apiKey || !cfg.apiSecret) {
      summary.errors.push('Thiếu apiKey/apiSecret');
      if (changed) saveDb();
      return summary;
    }
    if (!cfg.rate || cfg.rate <= 0) {
      summary.errors.push('Thiếu rate USDT-VND');
      if (changed) saveDb();
      return summary;
    }

    const last = Number(db.settings.binanceLastPolledAt || 0);
    const fallback = nowMs - 24 * 60 * 60 * 1000;
    const startTime = Math.max(0, (last || fallback) - 5 * 60 * 1000);
    const endTime = nowMs;
    const result = await signedBinanceRequest('/sapi/v1/pay/transactions', { startTime, endTime, limit: 100 });
    if (!result.ok) {
      summary.errors.push('Binance API: ' + (result.msg || result.code));
      if (changed) saveDb();
      return summary;
    }
    db.settings.binanceLastPolledAt = endTime;
    changed = true;

    const list = (result.data && Array.isArray(result.data.data)) ? result.data.data : [];
    db.binanceTransactions = db.binanceTransactions || [];
    const prefixRe = new RegExp('^' + escapeRegex(cfg.prefix) + '(\\d+)$', 'i');

    for (const tx of list) {
      try {
        const currency = String(tx.currency || tx.coin || tx.fiatCurrency || '').toUpperCase();
        if (currency !== 'USDT') continue;
        const transactionId = String(tx.transactionId || tx.orderId || tx.tradeId || tx.id || '');
        if (!transactionId) continue;
        if (db.binanceTransactions.some(t => String(t.transactionId) === transactionId)) continue;
        const noteRaw = String(tx.transactionAttribute && tx.transactionAttribute.note ? tx.transactionAttribute.note : (tx.note || tx.message || tx.remark || tx.payerNote || tx.fundsDetail || ''));
        const m = noteRaw.match(prefixRe);
        if (!m) continue;
        const noteIdNum = Number(m[1]);
        const usdtParsed = Number(tx.amount || tx.totalAmount || tx.transactionAmount || 0);
        if (!Number.isFinite(usdtParsed) || usdtParsed <= 0) continue;
        const dep = (db.deposits || []).find(d =>
          d.method === 'binance' &&
          d.status === 'Chờ thanh toán' &&
          Number(d.binance_note_id) === noteIdNum &&
          Math.abs(Number(d.usdt_amount || 0) - usdtParsed) <= 0.01
        );
        if (!dep) continue;
        const user = db.users.find(u => u.id === dep.user_id);
        if (!user) continue;
        const vndCredit = Math.floor(Number(dep.amount || 0));
        user.balance = Math.floor(Number(user.balance || 0) + vndCredit);
        dep.status = 'Đã duyệt';
        dep.admin_note = 'Tự động cộng tiền qua Binance Pay (' + transactionId + ')';
        dep.reviewed_at = now();
        dep.binance_tx_id = transactionId;
        db.binanceTransactions.push({
          transactionId,
          depositId: dep.id,
          userId: user.id,
          username: user.username,
          usdtAmount: usdtParsed,
          vndAmount: vndCredit,
          rate: Number(dep.rate_used || cfg.rate),
          payerName: String(tx.payerName || tx.counterparty || tx.payerInfo && tx.payerInfo.name || ''),
          note: noteRaw,
          createdAt: now(),
          raw: tx
        });
        db.notifications.push({ id: uid('n'), type: 'deposit_auto', message: `Đã tự cộng ${vndCredit.toLocaleString('vi-VN')}đ cho ${user.username || 'user'} qua Binance Pay`, read: 0, created_at: now() });
        summary.matched++;
        changed = true;
      } catch (innerErr) {
        summary.errors.push('Tx error: ' + (innerErr.message || innerErr));
      }
    }

    if (changed) saveDb();
    return summary;
  } catch (e) {
    console.error('BINANCE WORKER ERROR:', e);
    summary.errors.push(e.message || String(e));
    return summary;
  } finally {
    binanceWorkerBusy = false;
  }
}

app.post('/api/admin/binance/check-now', auth, adminOnly, async (req, res) => {
  try {
    const out = await processBinancePayments();
    res.json({ ok: true, ...out });
  } catch (e) { res.status(500).json({ error: e.message || 'Không quét được Binance' }); }
});
app.get('/api/admin/binance/transactions', auth, adminOnly, (req, res) => {
  const rows = (db.binanceTransactions || []).slice().sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
  res.json(rows);
});
app.post('/api/admin/binance/test', auth, adminOnly, async (req, res) => {
  try {
    const cfg = getBinanceConfig();
    if (!cfg.apiKey || !cfg.apiSecret) return res.json({ ok: false, error: 'Chưa cấu hình apiKey/apiSecret' });
    const endTime = Date.now();
    const startTime = endTime - 24 * 60 * 60 * 1000;
    const out = await signedBinanceRequest('/sapi/v1/pay/transactions', { startTime, endTime, limit: 1 });
    if (out.ok) return res.json({ ok: true, code: out.data && out.data.code, msg: out.data && out.data.message, sample: (out.data && Array.isArray(out.data.data)) ? out.data.data.slice(0, 1) : [] });
    return res.json({ ok: false, code: out.code, error: out.msg });
  } catch (e) { res.status(500).json({ ok: false, error: e.message || 'Không gọi được Binance API' }); }
});

app.post('/api/deposits', auth, upload.single('proof'), async (req, res) => {
  try {
    const amount = Math.floor(Number(req.body.amount || 0));
    if (amount <= 0) return res.status(400).json({ error: 'Số tiền nạp không hợp lệ' });
    const proofUrl = req.file ? await uploadToCloudinary(req.file, 'coalldichvu/deposits') : '';
    const dep = { id: uid('d'), user_id: req.user.id, amount, content: String(req.body.content || ''), proof_image: proofUrl, status: 'Chờ duyệt', admin_note: '', created_at: now(), reviewed_at: '' };
    db.deposits.push(dep);
    db.notifications.push({ id: uid('n'), type: 'deposit', message: `${req.user.username} gửi yêu cầu nạp ${amount.toLocaleString('vi-VN')}đ`, read: 0, created_at: now() });
    saveDb(); res.json(dep);
  } catch (e) { res.status(500).json({ error: e.message || 'Không upload được ảnh chứng từ' }); }
});
app.get('/api/deposits', auth, (req, res) => res.json(db.deposits.filter(d => d.user_id === req.user.id).sort((a,b) => b.created_at.localeCompare(a.created_at))));
app.post('/api/upload', auth, adminOnly, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Chưa có file' });
    const url = await uploadToCloudinary(req.file, 'coalldichvu/admin');
    res.json({ url });
  } catch (e) { res.status(500).json({ error: e.message || 'Không upload được ảnh' }); }
});

app.get('/api/admin/users', auth, adminOnly, (req, res) => res.json(db.users.map(u => ({ ...cleanUser(u), days_inactive: daysInactive(u) })).sort((a,b) => a.role.localeCompare(b.role) || a.username.localeCompare(b.username))));
app.patch('/api/admin/users/:id', auth, adminOnly, (req, res) => {
  const user = db.users.find(u => u.id === req.params.id); if (!user) return res.status(404).json({ error: 'Không tìm thấy user' });
  if (req.body.balance !== undefined) user.balance = Math.floor(Number(req.body.balance || 0));
  if (req.body.addBalance !== undefined) user.balance = Math.floor(Number(user.balance || 0) + Number(req.body.addBalance || 0));
  if (req.body.password) user.password_hash = bcrypt.hashSync(String(req.body.password), 10);
  if (req.body.status) user.status = String(req.body.status);
  saveDb(); res.json(cleanUser(user));
});
app.delete('/api/admin/users/:id', auth, adminOnly, (req, res) => {
  if (req.params.id === req.user.id) return res.status(400).json({ error: 'Không thể xóa chính bạn' });
  db.users = db.users.filter(u => u.id !== req.params.id); db.rentals = db.rentals.filter(r => r.user_id !== req.params.id); db.deposits = db.deposits.filter(d => d.user_id !== req.params.id); db.dmxOrders = (db.dmxOrders||[]).filter(o => o.user_id !== req.params.id); saveDb(); res.json({ ok: true });
});

app.post('/api/admin/services', auth, adminOnly, (req, res) => {
  const s = { id: uid('s'), provider: String(req.body.provider || 'legacy'), name: String(req.body.name || '').trim(), network: String(req.body.network || '').trim(), price: Math.floor(Number(req.body.price || 0)), visible: req.body.visible ? 1 : 0, description: String(req.body.description || ''), imageUrl: String(req.body.imageUrl || ''), external_app_id: String(req.body.external_app_id || '').trim(), api_cost: Math.floor(Number(req.body.api_cost || 0)), created_at: now(), updated_at: now() };
  if (!s.name) return res.status(400).json({ error: 'Thiếu tên dịch vụ' }); db.services.push(s); saveDb(); res.json(s);
});
app.post('/api/admin/services/hide-all', auth, adminOnly, (req, res) => {
  db.services.forEach(s => { s.visible = 0; s.updated_at = now(); });
  saveDb();
  res.json({ ok: true, hidden: db.services.length });
});

app.patch('/api/admin/services/:id', auth, adminOnly, (req, res) => {
  const s = db.services.find(x => x.id === req.params.id); if (!s) return res.status(404).json({ error: 'Không tìm thấy dịch vụ' });
  ['name','network','description','external_app_id','imageUrl','provider'].forEach(k => { if (req.body[k] !== undefined) s[k] = String(req.body[k]); });
  if (req.body.price !== undefined) s.price = Math.floor(Number(req.body.price || 0));
  if (req.body.visible !== undefined) s.visible = req.body.visible ? 1 : 0;
  if (req.body.api_cost !== undefined) s.api_cost = Math.floor(Number(req.body.api_cost || 0));
  s.updated_at = now(); saveDb(); res.json(s);
});
app.delete('/api/admin/services/:id', auth, adminOnly, (req, res) => { db.services = db.services.filter(s => s.id !== req.params.id); saveDb(); res.json({ ok: true }); });

function vnDateKey(value) {
  const d = value ? new Date(value) : new Date();
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}
function isRentalSuccess(r) {
  const st = String(r.status || '').toLowerCase();
  return !r.refunded && (!!r.otp_code || st.includes('đã nhận code') || st.includes('da nhan code') || st.includes('thành công') || st.includes('thanh cong'));
}
function isRentalExpired(r) {
  const st = String(r.status || '').toLowerCase();
  const note = String(r.note || '').toLowerCase();
  return !!r.refunded || st.includes('hết hạn') || st.includes('het han') || st.includes('hoàn tiền') || st.includes('hoan tien') || note.includes('hết thời gian') || note.includes('het thoi gian');
}
function buildDailyStats(dateKey, userId = '') {
  const target = dateKey || vnDateKey(new Date());
  const rentals = (db.rentals || []).filter(r => (!userId || r.user_id === userId) && vnDateKey(r.rented_at || r.created_at) === target);
  const rentalServices = {};
  const userRows = {};
  const ensureUserRow = (uid) => {
    if (!uid) uid = 'unknown';
    if (!userRows[uid]) {
      const u = (db.users || []).find(x => x.id === uid) || {};
      userRows[uid] = { user_id: uid, username: u.username || 'unknown', rental_total: 0, success: 0, expired: 0, other: 0, rental_revenue: 0, dmx_orders: 0, dmx_quantity: 0, dmx_revenue: 0, total_revenue: 0 };
    }
    return userRows[uid];
  };
  for (const r of rentals) {
    const name = String(r.service_name || 'Không rõ dịch vụ');
    if (!rentalServices[name]) rentalServices[name] = { service_name: name, price: Number(r.price || 0), total: 0, success: 0, expired: 0, other: 0, revenue: 0 };
    const row = rentalServices[name];
    const ur = ensureUserRow(r.user_id);
    row.total += 1;
    ur.rental_total += 1;
    row.price = Number(r.price || row.price || 0);
    if (isRentalSuccess(r)) { row.success += 1; row.revenue += Number(r.price || 0); ur.success += 1; ur.rental_revenue += Number(r.price || 0); ur.total_revenue += Number(r.price || 0); }
    else if (isRentalExpired(r)) { row.expired += 1; ur.expired += 1; }
    else { row.other += 1; ur.other += 1; }
  }
  const rentalRows = Object.values(rentalServices).sort((a,b) => b.revenue - a.revenue || b.success - a.success || a.service_name.localeCompare(b.service_name));
  const rentalRevenue = rentalRows.reduce((sum, x) => sum + Number(x.revenue || 0), 0);
  const rentalTotal = rentalRows.reduce((sum, x) => sum + Number(x.total || 0), 0);
  const rentalSuccess = rentalRows.reduce((sum, x) => sum + Number(x.success || 0), 0);
  const rentalExpired = rentalRows.reduce((sum, x) => sum + Number(x.expired || 0), 0);
  const rentalOther = rentalRows.reduce((sum, x) => sum + Number(x.other || 0), 0);

  const dmxOrders = (db.dmxOrders || []).filter(o => (!userId || o.user_id === userId) && vnDateKey(o.created_at) === target);
  const dmxProducts = {};
  for (const o of dmxOrders) {
    const name = String(o.product_name || 'Không rõ sản phẩm');
    if (!dmxProducts[name]) dmxProducts[name] = { product_name: name, quantity: 0, orders: 0, revenue: 0 };
    const qty = Number(o.quantity || 0);
    const total = Number(o.total || 0);
    dmxProducts[name].orders += 1;
    dmxProducts[name].quantity += qty;
    dmxProducts[name].revenue += total;
    const ur = ensureUserRow(o.user_id);
    ur.dmx_orders += 1;
    ur.dmx_quantity += qty;
    ur.dmx_revenue += total;
    ur.total_revenue += total;
  }
  const dmxRows = Object.values(dmxProducts).sort((a,b) => b.revenue - a.revenue || b.quantity - a.quantity || a.product_name.localeCompare(b.product_name));
  const dmxRevenue = dmxRows.reduce((sum, x) => sum + Number(x.revenue || 0), 0);
  const dmxTotalOrders = dmxRows.reduce((sum, x) => sum + Number(x.orders || 0), 0);
  const dmxTotalQuantity = dmxRows.reduce((sum, x) => sum + Number(x.quantity || 0), 0);
  const users = Object.values(userRows).sort((a,b) => b.total_revenue - a.total_revenue || b.success - a.success || String(a.username).localeCompare(String(b.username)));

  return {
    date: target,
    revenue: rentalRevenue + dmxRevenue,
    rentals: { total: rentalTotal, success: rentalSuccess, expired: rentalExpired, other: rentalOther, revenue: rentalRevenue, services: rentalRows },
    dmx: { orders: dmxTotalOrders, quantity: dmxTotalQuantity, revenue: dmxRevenue, products: dmxRows },
    users
  };
}
function buildAdminDailyStats(dateKey) { return buildDailyStats(dateKey); }
app.get('/api/admin/rentals', auth, adminOnly, async (req, res) => { await processExpiredRentals(); res.json(db.rentals.map(r => ({ ...r, username: (db.users.find(u => u.id === r.user_id) || {}).username || 'unknown' })).sort((a,b) => b.rented_at.localeCompare(a.rented_at))); });
app.get('/api/admin/rentals/stats', auth, adminOnly, async (req, res) => { await processExpiredRentals(); res.json(buildAdminDailyStats(String(req.query.date || '').trim())); });
app.patch('/api/admin/rentals/:id', auth, adminOnly, (req, res) => {
  const r = db.rentals.find(x => x.id === req.params.id); if (!r) return res.status(404).json({ error: 'Không tìm thấy lượt thuê' });
  ['status','otp_code','note','ended_at'].forEach(k => { if (req.body[k] !== undefined) r[k] = String(req.body[k]); }); saveDb(); res.json(r);
});
app.get('/api/admin/deposits', auth, adminOnly, (req, res) => res.json(db.deposits.map(d => ({ ...d, username: (db.users.find(u => u.id === d.user_id) || {}).username || 'unknown' })).sort((a,b) => b.created_at.localeCompare(a.created_at))));
app.patch('/api/admin/deposits/:id', auth, adminOnly, (req, res) => {
  const d = db.deposits.find(x => x.id === req.params.id); if (!d) return res.status(404).json({ error: 'Không tìm thấy yêu cầu nạp' });
  const newStatus = String(req.body.status || d.status);
  if (d.status !== 'Đã duyệt' && newStatus === 'Đã duyệt') { const u = db.users.find(u => u.id === d.user_id); if (u) u.balance = Math.floor(Number(u.balance || 0) + Number(d.amount || 0)); }
  d.status = newStatus; d.admin_note = String(req.body.admin_note || d.admin_note || ''); d.reviewed_at = now(); saveDb(); res.json(d);
});
app.get('/api/admin/notifications', auth, adminOnly, (req, res) => res.json(db.notifications.sort((a,b) => b.created_at.localeCompare(a.created_at)).slice(0,100)));
app.patch('/api/admin/notifications/read', auth, adminOnly, (req, res) => { db.notifications.forEach(n => n.read = 1); saveDb(); res.json({ ok: true }); });
app.patch('/api/admin/settings', auth, adminOnly, (req, res) => {
  if (req.body.binanceContentPrefix !== undefined) {
    const raw = String(req.body.binanceContentPrefix || '').trim().toUpperCase();
    if (!/^[A-Z0-9]{2,10}$/.test(raw)) return res.status(400).json({ error: 'Prefix phải là 2-10 ký tự alphanumeric viết hoa' });
    req.body.binanceContentPrefix = raw;
  }
  ['binanceUsdtVndRate','binanceMinUsdt','binanceMaxUsdt'].forEach(k => {
    if (req.body[k] !== undefined && req.body[k] !== '') {
      const n = Number(req.body[k]);
      if (!Number.isFinite(n) || n < 0) {
        req.body[k + '__invalid'] = true;
      }
    }
  });
  if (req.body.binanceUsdtVndRate__invalid || req.body.binanceMinUsdt__invalid || req.body.binanceMaxUsdt__invalid) {
    return res.status(400).json({ error: 'Rate/Min/Max USDT phải là số không âm' });
  }
  if (req.body.binanceApiKey !== undefined && isBinanceApiKeyFromEnv()) {
    return res.status(400).json({ error: 'Binance API key đang lấy từ biến môi trường BINANCE_API_KEY, không thể chỉnh từ web' });
  }
  if (req.body.binanceApiSecret !== undefined && isBinanceApiSecretFromEnv()) {
    return res.status(400).json({ error: 'Binance API secret đang lấy từ biến môi trường BINANCE_API_SECRET, không thể chỉnh từ web' });
  }
  ['siteName','brandText','logoUrl','adUrl','themeColor','layoutMode','depositInfo','qrImage','apiBaseUrl','apiKey','apiProvider','legacyApiBaseUrl','legacyApiKey','codesimApiBaseUrl','codesimApiKey','otpTimeoutMinutes','sepayBankCode','sepayAccount','sepayAccountName','sepayEnabled','sepayWebhookApiKey','binanceEnabled','binanceApiKey','binanceApiSecret','binanceUsdtVndRate','binanceContentPrefix','binanceMinUsdt','binanceMaxUsdt','binancePayeeName','binanceExpiryMinutes','binanceQrImage'].forEach(k => { if (req.body[k] !== undefined) db.settings[k] = String(req.body[k]); });
  saveDb();
  res.json(safeSettingsForUser(db.settings, true));
});
app.get('/api/admin/sim-api/account', auth, adminOnly, async (req, res) => {
  try {
    const provider = String(req.query.provider || 'legacy');
    res.json(await simApi(provider, 'account'));
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.get('/api/admin/sim-api/apps', auth, adminOnly, async (req, res) => {
  try {
    const provider = String(req.query.provider || 'legacy');
    res.json(await simApi(provider, 'services'));
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.post('/api/admin/sim-api/sync-apps', auth, adminOnly, async (req, res) => {
  try {
    const providers = ['legacy','codesim'];
    const results = await Promise.allSettled(providers.map(p => simApi(p, 'services')));
    let added = 0, updated = 0, total = 0;
    const errors = [];
    results.forEach((r, idx) => {
      const provider = providers[idx];
      if (r.status !== 'fulfilled') { errors.push(provider + ': ' + r.reason.message); return; }
      const data = r.value;
      if (!isProviderOk(provider, data)) { errors.push(provider + ': ' + (data.message || data.Msg || 'API không OK')); return; }
      const apps = normalizeServices(provider, data);
      total += apps.length;
      apps.forEach(a => {
        let s = db.services.find(x => String(x.provider || 'legacy') === provider && String(x.external_app_id || '') === a.external_app_id);
        if (s) { s.name = a.name; s.api_cost = a.api_cost; if (!s.price || Number(req.body.overwritePrice)) s.price = a.api_cost; s.provider = provider; s.updated_at = now(); updated++; }
        else { db.services.push({ id: uid('s'), provider, name: a.name, network: '', price: a.api_cost, visible: 0, description: '', imageUrl: '', external_app_id: a.external_app_id, api_cost: a.api_cost, created_at: now(), updated_at: now() }); added++; }
      });
    });
    saveDb(); res.json({ ok: true, added, updated, total, errors });
  } catch (e) { res.status(500).json({ error: e.message || 'Không đồng bộ được app API' }); }
});


// DMX shop products and orders
function parseStockCodes(text) {
  return String(text || '').split(/\r?\n/).map(x => x.trim()).filter(Boolean);
}
function dmxPrice(product, qty) {
  qty = Math.max(1, Math.floor(Number(qty || 1)));
  const normal = Math.max(0, Math.floor(Number(product.price || 0)));
  const minQty = Math.floor(Number(product.bulkMinQty || 0));
  const bulk = Math.floor(Number(product.bulkPrice || 0));
  const unit = minQty > 0 && bulk > 0 && qty >= minQty ? bulk : normal;
  return { unitPrice: unit, total: unit * qty };
}
app.get('/api/dmx/products', auth, (req, res) => {
  let rows = (db.dmxProducts || []).filter(p => req.user.role === 'admin' || Number(p.visible) === 1)
    .sort((a,b) => String(a.category||'').localeCompare(String(b.category||'')) || String(a.name||'').localeCompare(String(b.name||'')));
  rows = rows.map(p => {
    const stockCodes = Array.isArray(p.stockCodes) ? p.stockCodes : [];
    if (req.user.role === 'admin') return { ...p, stockCodes, stockCount: stockCodes.length };
    const { stockCodes: _hidden, ...safe } = p;
    return { ...safe, stockCount: stockCodes.length };
  });
  res.json(rows);
});
app.get('/api/dmx/orders', auth, (req, res) => {
  const rows = (db.dmxOrders || []).filter(o => o.user_id === req.user.id)
    .sort((a,b) => String(b.created_at).localeCompare(String(a.created_at)));
  res.json(rows);
});
app.post('/api/dmx/orders', auth, (req, res) => {
  const product = (db.dmxProducts || []).find(p => p.id === req.body.product_id && Number(p.visible) === 1);
  if (!product) return res.status(404).json({ error: 'Sản phẩm không tồn tại hoặc đang ẩn' });
  const quantity = Math.max(1, Math.floor(Number(req.body.quantity || 1)));
  const price = dmxPrice(product, quantity);
  if ((req.user.balance || 0) < price.total) return res.status(400).json({ error: 'Số dư không đủ để mua sản phẩm' });
  product.stockCodes = Array.isArray(product.stockCodes) ? product.stockCodes : [];
  let voucherCodes = [];
  if (product.stockCodes.length > 0) {
    if (product.stockCodes.length < quantity) return res.status(400).json({ error: `Kho voucher không đủ. Còn ${product.stockCodes.length} mã.` });
    voucherCodes = product.stockCodes.splice(0, quantity);
  }
  req.user.balance = Math.floor(Number(req.user.balance || 0) - price.total);
  const order = {
    id: uid('dmxo'), user_id: req.user.id, product_id: product.id,
    product_name: product.name, category: product.category || '', imageUrl: product.imageUrl || '',
    quantity, unit_price: price.unitPrice, total: price.total, voucherCodes,
    status: 'Đã mua', note: String(req.body.note || ''), created_at: now()
  };
  db.dmxOrders = db.dmxOrders || [];
  db.dmxOrders.push(order);
  db.notifications.push({ id: uid('n'), type: 'dmx_order', message: `${req.user.username} mua ${quantity} x ${product.name} (${price.total.toLocaleString('vi-VN')}đ)`, read: 0, created_at: now() });
  saveDb();
  res.json({ order, user: cleanUser(req.user) });
});
app.get('/api/admin/dmx/orders', auth, adminOnly, (req, res) => {
  const rows = (db.dmxOrders || []).map(o => ({ ...o, username: (db.users.find(u => u.id === o.user_id) || {}).username || 'unknown' }))
    .sort((a,b) => String(b.created_at).localeCompare(String(a.created_at)));
  const revenue = rows.reduce((sum,o)=>sum+Number(o.total||0),0);
  res.json({ rows, stats: { totalOrders: rows.length, revenue } });
});
app.post('/api/admin/dmx/products', auth, adminOnly, (req, res) => {
  const p = {
    id: uid('dmxp'), name: String(req.body.name || '').trim(), category: String(req.body.category || '').trim(),
    price: Math.floor(Number(req.body.price || 0)), bulkMinQty: Math.floor(Number(req.body.bulkMinQty || 0)),
    bulkPrice: Math.floor(Number(req.body.bulkPrice || 0)), visible: req.body.visible ? 1 : 0,
    description: String(req.body.description || ''), imageUrl: String(req.body.imageUrl || ''),
    stockCodes: parseStockCodes(req.body.stockText),
    created_at: now(), updated_at: now()
  };
  if (!p.name) return res.status(400).json({ error: 'Thiếu tên sản phẩm' });
  if (p.price <= 0) return res.status(400).json({ error: 'Giá sản phẩm không hợp lệ' });
  db.dmxProducts = db.dmxProducts || [];
  db.dmxProducts.push(p); saveDb(); res.json(p);
});
app.patch('/api/admin/dmx/products/:id', auth, adminOnly, (req, res) => {
  const p = (db.dmxProducts || []).find(x => x.id === req.params.id);
  if (!p) return res.status(404).json({ error: 'Không tìm thấy sản phẩm' });
  ['name','category','description','imageUrl'].forEach(k => { if (req.body[k] !== undefined) p[k] = String(req.body[k]); });
  if (req.body.price !== undefined) p.price = Math.floor(Number(req.body.price || 0));
  if (req.body.bulkMinQty !== undefined) p.bulkMinQty = Math.floor(Number(req.body.bulkMinQty || 0));
  if (req.body.bulkPrice !== undefined) p.bulkPrice = Math.floor(Number(req.body.bulkPrice || 0));
  if (req.body.visible !== undefined) p.visible = req.body.visible ? 1 : 0;
  if (req.body.stockText !== undefined) {
    const addCodes = parseStockCodes(req.body.stockText);
    if (addCodes.length) p.stockCodes = (Array.isArray(p.stockCodes) ? p.stockCodes : []).concat(addCodes);
  }
  p.updated_at = now(); saveDb(); res.json(p);
});
app.delete('/api/admin/dmx/products/:id', auth, adminOnly, (req, res) => {
  db.dmxProducts = (db.dmxProducts || []).filter(p => p.id !== req.params.id);
  saveDb(); res.json({ ok: true });
});

app.get('*', (req, res) => res.sendFile(path.join(root, 'public', 'index.html')));

async function start() {
  db = await loadDb();
  await migrate();
  app.listen(PORT, () => console.log(`Có All Dịch Vụ running at http://localhost:${PORT} - DB: ${stateCollection ? 'MongoDB' : 'JSON'} - Upload: ${useCloudinary ? 'Cloudinary' : 'local'}`));
  if (!binanceWorkerStarted) {
    binanceWorkerStarted = true;
    binanceWorkerHandle = setInterval(() => {
      processBinancePayments().catch(e => console.error('Binance tick error:', e && e.message));
    }, 60 * 1000);
    setTimeout(() => {
      processBinancePayments().catch(e => console.error('Binance initial tick error:', e && e.message));
    }, 5000);
  }
}
start().catch(err => {
  console.error('Không khởi động được server:', err);
  process.exit(1);
});
