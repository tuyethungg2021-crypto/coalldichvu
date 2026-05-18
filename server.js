require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
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
  users: [], services: [], rentals: [], deposits: [], notifications: [], dmxProducts: [], dmxOrders: [], sepayTransactions: [], highlandsStock: [],
  settings: {
    siteName: 'Có All Dịch Vụ',
    brandText: 'Thuê sim nhanh - nhiều nhà mạng - quản lý dễ dàng',
    logoUrl: '', adUrl: '', themeColor: '#2563eb', layoutMode: 'modern',
    depositInfo: 'Ngân hàng: MB Bank\nSố tài khoản: 0123456789\nChủ tài khoản: HUNG NBYT\nNội dung: nap username',
    qrImage: '',
    sepayBankCode: process.env.SEPAY_BANK || 'MB',
    sepayAccount: process.env.SEPAY_ACCOUNT || '8006123454321',
    sepayAccountName: process.env.SEPAY_ACCOUNT_NAME || 'NGUYEN VAN HUNG',
    sepayEnabled: '1',
    legacyApiBaseUrl: 'https://chaycodeso3.com/api',
    legacyApiKey: '248c26ea0cd1371009db5dd443339ca1',
    codesimApiBaseUrl: 'https://apisim.codesim.net',
    codesimApiKey: 'eyJhbGciOiJIUzUxMiJ9.eyJzdWIiOiJudWJpYTMiLCJqdGkiOiI4NDM1NiIsImlhdCI6MTc3NzA4NDE5NiwiZXhwIjoxODM5MjkyMTk2fQ.F5SrJi-hvbhovlmaoxHyIcqshXwbnapb-nltkXkPQO2WLTG8kr5VRPHZdu8ZYdrzmi8m6pTbUZtMo1dSsI6cvA',
    apiBaseUrl: 'https://chaycodeso3.com/api',
    apiProvider: 'legacy',
    apiKey: '248c26ea0cd1371009db5dd443339ca1',
    otpTimeoutMinutes: '5'
  }
};
let db = null;

function normalizeDb(parsed) {
  parsed = parsed || {};
  return { ...defaults, ...parsed, dmxProducts: parsed.dmxProducts || [], dmxOrders: parsed.dmxOrders || [], sepayTransactions: parsed.sepayTransactions || [], highlandsStock: parsed.highlandsStock || [], settings: { ...defaults.settings, ...(parsed.settings || {}) } };
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
    ].forEach(s => db.services.push({ id: uid('s'), name: s[0], network: s[1], price: s[2], visible: 0, description: s[3], imageUrl: '', service_type: 'sim', provider: 'legacy', external_app_id: '', api_cost: 0, created_at: now(), updated_at: now() }));
    changed = true;
  }

  // Luôn tạo sẵn sản phẩm ACC Highlands nếu chưa có, kể cả database đã có dịch vụ cũ.
  // Service ID mặc định 1432 có thể sửa lại trong Admin -> Dịch vụ nếu API đổi ID.
  const hasAccHighlands = (db.services || []).some(s => String(s.name || '').trim().toLowerCase() === 'acc highlands');
  if (!hasAccHighlands) {
    db.services.push({
      id: uid('s'),
      provider: 'legacy',
      service_type: 'highlands',
      name: 'ACC Highlands',
      network: '',
      price: 5000,
      visible: 1,
      description: 'ACC Highlands: admin nhập kho số trước, hệ thống thuê lại đúng số trong lịch sử dịch vụ đã thuê rồi chờ OTP.',
      imageUrl: '',
      external_app_id: '1432',
      api_cost: 1,
      created_at: now(),
      updated_at: now()
    });
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
  const n = Number(db.settings.otpTimeoutMinutes || 5);
  return Number.isFinite(n) && n > 0 ? Math.max(1, Math.min(120, n)) : 5;
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
  data = data || {};
  if (provider === 'codesim') {
    return Number(data.status) === 200 || Number(data.code) === 200 || data.success === true || String(data.status || '').toLowerCase() === 'success';
  }
  return Number(data.ResponseCode) === 0 || data.success === true || String(data.status || '').toLowerCase() === 'success' ||
    (!!data.Result && (data.Result.Id || data.Result.ID || data.Result.id || data.Result.Number || data.Result.Phone || data.Result.Code));
}
function pick(obj, keys) {
  obj = obj || {};
  for (const k of keys) {
    if (obj[k] !== undefined && obj[k] !== null && String(obj[k]).trim() !== '') return obj[k];
  }
  return '';
}
function normalizeApiPhone(v) {
  const phone = normalizePhoneNumber(v);
  return phone && /^0\d{8,10}$/.test(phone) ? phone : '';
}
function rentPayload(provider, apiResult) {
  apiResult = apiResult || {};
  return provider === 'codesim' ? (apiResult.data || apiResult.Data || apiResult.result || apiResult.Result || {}) : (apiResult.Result || apiResult.result || apiResult.data || apiResult.Data || {});
}
function normalizeRentResult(provider, apiResult) {
  const rs = rentPayload(provider, apiResult);
  const phone = normalizeApiPhone(pick(rs, ['phone','Phone','phone_number','phoneNumber','number','Number','sim','Sim','mobile','Mobile']));
  const otpId = String(pick(rs, ['otpId','otpID','OtpId','OTPId','otp_id','id','Id','ID','request_id','requestId','order_id','orderId','rental_id','rentalId']) || '').trim();
  const simId = String(pick(rs, ['simId','SimId','sim_id','id','Id','ID','request_id','requestId','order_id','orderId','rental_id','rentalId']) || otpId || '').trim();
  const cost = Math.floor(Number(pick(rs, ['payment','Payment','price','Price','Cost','cost','amount','Amount']) || 0));
  return { raw: rs, phone, otpId, simId, cost };
}
function normalizeOtpResult(provider, apiResult) {
  const rs = rentPayload(provider, apiResult);
  const code = String(pick(rs, ['code','Code','otp','OTP','otp_code','otpCode','pin','Pin']) || '').trim();
  const sms = String(pick(rs, ['content','Content','sms','SMS','message','Message','text','Text']) || '').trim();
  return { raw: rs, code, sms };
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
  if (r.highlands_stock_id) markHighlandsStock(r.highlands_stock_id, 'free', { rental_id: '', user_id: '', released_at: now(), note: reason });
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

function normalizePhoneNumber(v) {
  let x = String(v || '').trim().replace(/[^0-9]/g, '');
  if (x.startsWith('84') && x.length >= 11) x = '0' + x.slice(2);
  // API chaycodeso3 thường trả Number không có số 0 đầu, ví dụ 812119032.
  // Chuẩn hóa về 0812119032 để so đúng với số admin nhập trong kho.
  if (/^[35789]\d{8}$/.test(x)) x = '0' + x;
  return x;
}
function getHighlandsAvailable(serviceId) {
  return (db.highlandsStock || []).filter(x => String(x.service_id) === String(serviceId) && String(x.status || 'free') === 'free');
}
function markHighlandsStock(stockId, status, extra = {}) {
  const item = (db.highlandsStock || []).find(x => x.id === stockId);
  if (!item) return null;
  item.status = status;
  Object.assign(item, extra);
  item.updated_at = now();
  return item;
}

function safeSettingsForUser(settings, isAdmin) {
  const out = { ...settings };
  if (!isAdmin) { delete out.apiKey; delete out.legacyApiKey; delete out.codesimApiKey; }
  if (isAdmin && out.legacyApiKey) out.legacyApiKeyMasked = out.legacyApiKey.slice(0, 6) + '...' + out.legacyApiKey.slice(-4);
  if (isAdmin && out.codesimApiKey) out.codesimApiKeyMasked = out.codesimApiKey.slice(0, 6) + '...' + out.codesimApiKey.slice(-4);
  if (isAdmin && out.apiKey) out.apiKeyMasked = out.apiKey.slice(0, 6) + '...' + out.apiKey.slice(-4);
  return out;
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
    const provider = service.provider || 'legacy';
    const isHighlands = String(service.service_type || '').toLowerCase() === 'highlands';
    let pickedStock = null;
    let wantedPhone = '';
    let apiResult = null;
    let result = null;
    let phone = '';
    let otpId = '';
    let simId = '';

    if (isHighlands) {
      const availableStocks = getHighlandsAvailable(service.id);
      if (!availableStocks.length) return res.status(400).json({ error: 'Kho số Highlands của dịch vụ này đã hết. Vui lòng quay lại sau.' });
      const maxTry = Math.min(availableStocks.length, 30);
      for (let i = 0; i < maxTry; i++) {
        const stock = availableStocks[i];
        const tryPhone = normalizePhoneNumber(stock.phone);
        if (!tryPhone) {
          markHighlandsStock(stock.id, 'hold', { note: 'Số không hợp lệ, admin cần kiểm tra', held_at: now() });
          continue;
        }
        try {
          const out = await simApi(provider, 'rent', { service_id: service.external_app_id, appId: service.external_app_id, carrier: networkId, network_id: networkId, phone: tryPhone });
          if (!isProviderOk(provider, out)) {
            markHighlandsStock(stock.id, 'hold', { note: out.message || out.Msg || 'API không thuê lại được số này', held_at: now() });
            continue;
          }
          const parsed = normalizeRentResult(provider, out);
          // Highlands dùng chức năng thuê lại đúng số trong kho. API legacy trả Id + Number
          // (Id này dùng để check code), không nhất thiết có field otpId riêng.
          const samePhone = normalizePhoneNumber(parsed.phone) === normalizePhoneNumber(tryPhone);
          if (!parsed.phone || !parsed.otpId || !samePhone) {
            markHighlandsStock(stock.id, 'hold', { note: 'API không thuê lại đúng số trong kho. Cần kiểm tra lịch sử hoàn thành của số này. Raw: ' + JSON.stringify(out).slice(0, 350), held_at: now() });
            continue;
          }
          pickedStock = stock; wantedPhone = tryPhone; apiResult = out; result = parsed.raw; phone = parsed.phone; otpId = parsed.otpId; simId = parsed.simId || parsed.otpId;
          break;
        } catch (err) {
          markHighlandsStock(stock.id, 'hold', { note: 'Lỗi API khi thuê lại: ' + (err.message || err), held_at: now() });
          continue;
        }
      }
      if (!pickedStock) { saveDb(); return res.status(400).json({ error: 'Không thuê lại được số Highlands nào trong kho. Các số lỗi đã chuyển sang Giữ lại để admin kiểm tra.' }); }
    } else {
      apiResult = await simApi(provider, 'rent', { service_id: service.external_app_id, appId: service.external_app_id, carrier: networkId, network_id: networkId });
      if (!isProviderOk(provider, apiResult)) return res.status(400).json({ error: apiResult.message || apiResult.Msg || 'API không cấp được số', api: apiResult });
      const parsed = normalizeRentResult(provider, apiResult);
      result = parsed.raw;
      phone = parsed.phone;
      otpId = parsed.otpId;
      simId = parsed.simId;
      if (!phone || !otpId) return res.status(400).json({ error: apiResult.message || apiResult.Msg || 'API không trả về số sim/OTP ID', api: apiResult });
    }
    const cost = Math.floor(Number(normalizeRentResult(provider, apiResult).cost || result.payment || result.Payment || result.Cost || result.cost || service.price || 0));
    req.user.balance = Math.floor(Number(req.user.balance || 0) - Number(service.price || cost));
    const displayNumber = String(phone || '');
    const rental = {
      id: uid('r'), user_id: req.user.id, service_id: service.id, service_name: service.name,
      network: networkId || service.network || '', phone_number: displayNumber, price: service.price, api_cost: cost,
      external_id: String(otpId || ''), external_sim_id: String(simId || ''), api_app_id: String(service.external_app_id), provider,
      service_type: isHighlands ? 'highlands' : (service.service_type || 'sim'), highlands_stock_id: pickedStock ? pickedStock.id : '',
      status: 'Đang chờ code', rented_at: now(), ended_at: '', otp_code: '', sms: '', note: apiResult.message || apiResult.Msg || ''
    };
    db.rentals.push(rental);
    if (pickedStock) markHighlandsStock(pickedStock.id, 'hold', { rental_id: rental.id, user_id: req.user.id, held_at: now(), last_otp_id: String(otpId || ''), note: 'Đã thuê lại đúng số, đang chờ OTP tối đa ' + getOtpTimeoutMinutes() + ' phút' });
    saveDb();
    res.json({ rental, user: cleanUser(req.user), api: apiResult });
  } catch (e) { res.status(500).json({ error: e.message || 'Không gọi được API thuê sim' }); }
});
app.get('/api/rentals', auth, async (req, res) => { await processExpiredRentals(); res.json(db.rentals.filter(r => r.user_id === req.user.id).sort((a,b) => b.rented_at.localeCompare(a.rented_at))); });

app.post('/api/rentals/:id/check-code', auth, async (req, res) => {
  try {
    await processExpiredRentals();
    const r = db.rentals.find(x => x.id === req.params.id && (x.user_id === req.user.id || req.user.role === 'admin'));
    if (!r) return res.status(404).json({ error: 'Không tìm thấy lượt thuê' });
    if (r.refunded) return res.json({ rental: r, api: { message: r.note || 'Đã tự hoàn tiền' }, user: cleanUser(req.user) });
    if (!r.external_id) return res.status(400).json({ error: 'Lượt thuê này không có OTP ID API' });
    const apiResult = await simApi(r.provider || 'legacy', 'code', { otp_id: r.external_id, id: r.external_id });
    const provider = r.provider || 'legacy';
    const otp = normalizeOtpResult(provider, apiResult);
    if (isProviderOk(provider, apiResult) && otp.code) {
      r.status = 'Đã nhận code';
      r.otp_code = otp.code;
      r.sms = otp.sms;
      r.ended_at = now();
      r.note = apiResult.message || apiResult.Msg || 'Đã nhận OTP';
      if (r.highlands_stock_id) markHighlandsStock(r.highlands_stock_id, 'sold', { sold_at: now(), note: 'Đã nhận OTP, chốt bán' });
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
function normalizeVietQrBank(v) {
  const raw = String(v || '').trim();
  const key = raw.toLowerCase().replace(/[^a-z0-9]/g, '');
  const map = { mbbank: 'MB', mb: 'MB', mbs: 'MB', vietcombank: 'VCB', vcb: 'VCB', techcombank: 'TCB', tcb: 'TCB', acb: 'ACB', bidv: 'BIDV', vietinbank: 'ICB', icb: 'ICB', vpbank: 'VPB', vpb: 'VPB', tpbank: 'TPB', tpb: 'TPB', momo: 'MOMO' };
  return map[key] || raw.toUpperCase();
}
function buildSepayQrUrl(amount, content, template, ext) {
  const bank = normalizeVietQrBank(db.settings.sepayBankCode || process.env.SEPAY_BANK || 'MB');
  const account = onlyDigits(db.settings.sepayAccount || process.env.SEPAY_ACCOUNT || '');
  const name = String(db.settings.sepayAccountName || process.env.SEPAY_ACCOUNT_NAME || '').trim();
  const money = Math.floor(Number(amount || 0));
  if (!bank || !account || money <= 0) return '';
  const q = new URLSearchParams();
  q.set('amount', String(money));
  q.set('addInfo', String(content || ''));
  if (name) q.set('accountName', name);
  return `https://img.vietqr.io/image/${encodeURIComponent(bank)}-${encodeURIComponent(account)}-${template}.${ext}?${q.toString()}`;
}
function buildSepayQr(amount, content) {
  return buildSepayQrUrl(amount, content, 'compact2', 'png');
}
function buildSepayQrAlt(amount, content) {
  return buildSepayQrUrl(amount, content, 'print', 'png');
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
    const qrUrlAlt = buildSepayQrAlt(amount, code);
    if (!qrUrl) return res.status(400).json({ error: 'Admin chưa cấu hình mã ngân hàng hoặc số tài khoản nhận tiền trong Nạp tiền admin.' });
    const dep = { id: uid('d'), user_id: req.user.id, amount, content: code, proof_image: '', status: 'Chờ thanh toán', admin_note: 'Đang chờ SePay xác nhận', created_at: now(), reviewed_at: '', method: 'sepay', sepay_code: code, sepay_qr: qrUrl, sepay_qr_alt: qrUrlAlt };
    db.deposits.push(dep);
    saveDb();
    res.json({ deposit: dep, qrUrl, qrUrlAlt, transferContent: code, bank: db.settings.sepayBankCode, account: db.settings.sepayAccount, accountName: db.settings.sepayAccountName });
  } catch (e) { res.status(500).json({ error: e.message || 'Không tạo được lệnh nạp SePay' }); }
});

app.post('/api/sepay/webhook', async (req, res) => {
  try {
    db.sepayTransactions = db.sepayTransactions || [];
    const payload = req.body || {};
    console.log('SEPAY WEBHOOK RECEIVED:', JSON.stringify(payload).slice(0, 1500));
    const { amount, content, ref, type } = extractSepayPayload(payload);
    if (type && type.includes('out')) return res.json({ success: true, ignored: 'outgoing' });
    if (!amount || amount <= 0) return res.json({ success: true, ignored: 'no_amount' });
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
        if (!dep) {
          dep = { id: uid('d'), user_id: user.id, amount, content, proof_image: '', status: 'Chờ thanh toán', admin_note: '', created_at: now(), reviewed_at: '', method: 'sepay', sepay_code: '', sepay_qr: '' };
          db.deposits.push(dep);
        }
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
  const serviceType = String(req.body.service_type || req.body.type || 'sim').trim().toLowerCase() === 'highlands' ? 'highlands' : 'sim';
  const s = {
    id: uid('s'),
    provider: String(req.body.provider || 'legacy'),
    service_type: serviceType,
    name: String(req.body.name || '').trim(),
    network: String(req.body.network || '').trim(),
    price: Math.floor(Number(req.body.price || 0)),
    visible: req.body.visible ? 1 : 0,
    description: String(req.body.description || ''),
    imageUrl: String(req.body.imageUrl || ''),
    external_app_id: String(req.body.external_app_id || '').trim(),
    api_cost: Math.floor(Number(req.body.api_cost || 0)),
    created_at: now(),
    updated_at: now()
  };
  if (!s.name) return res.status(400).json({ error: 'Thiếu tên dịch vụ' });
  db.services.push(s);
  saveDb();
  res.json(s);
});
app.post('/api/admin/services/hide-all', auth, adminOnly, (req, res) => {
  db.services.forEach(s => { s.visible = 0; s.updated_at = now(); });
  saveDb();
  res.json({ ok: true, hidden: db.services.length });
});

app.patch('/api/admin/services/:id', auth, adminOnly, (req, res) => {
  const s = db.services.find(x => x.id === req.params.id); if (!s) return res.status(404).json({ error: 'Không tìm thấy dịch vụ' });
  ['name','network','description','external_app_id','imageUrl','provider'].forEach(k => { if (req.body[k] !== undefined) s[k] = String(req.body[k]); });
  if (req.body.service_type !== undefined || req.body.type !== undefined) {
    const serviceType = String(req.body.service_type ?? req.body.type ?? 'sim').trim().toLowerCase();
    s.service_type = serviceType === 'highlands' ? 'highlands' : 'sim';
  }
  if (req.body.price !== undefined) s.price = Math.floor(Number(req.body.price || 0));
  if (req.body.visible !== undefined) s.visible = req.body.visible ? 1 : 0;
  if (req.body.api_cost !== undefined) s.api_cost = Math.floor(Number(req.body.api_cost || 0));
  s.updated_at = now(); saveDb(); res.json(s);
});
app.delete('/api/admin/services/:id', auth, adminOnly, (req, res) => { db.services = db.services.filter(s => s.id !== req.params.id); saveDb(); res.json({ ok: true }); });


app.get('/api/admin/highlands-stock', auth, adminOnly, (req, res) => {
  const serviceId = String(req.query.service_id || '').trim();
  let rows = db.highlandsStock || [];
  if (serviceId) rows = rows.filter(x => String(x.service_id) === serviceId);
  res.json(rows.map(x => ({ ...x, service_name: (db.services.find(s => s.id === x.service_id) || {}).name || '' })).sort((a,b) => (a.status||'').localeCompare(b.status||'') || b.created_at.localeCompare(a.created_at)));
});
app.post('/api/admin/highlands-stock/import', auth, adminOnly, (req, res) => {
  const serviceId = String(req.body.service_id || '').trim();
  const service = db.services.find(s => s.id === serviceId);
  if (!service) return res.status(404).json({ error: 'Không tìm thấy dịch vụ để nhập kho' });
  if (String(service.service_type || 'sim') !== 'highlands') return res.status(400).json({ error: 'Dịch vụ này chưa được đặt loại Highlands. Vào Dịch vụ admin -> Loại -> Highlands rồi bấm Lưu.' });
  const raw = String(req.body.phones || '');
  const phones = raw.split(/[\s,;]+/).map(normalizePhoneNumber).filter(x => /^0\d{8,10}$/.test(x));
  let added = 0, skipped = 0;
  db.highlandsStock = db.highlandsStock || [];
  for (const phone of phones) {
    if (db.highlandsStock.some(x => String(x.service_id) === serviceId && normalizePhoneNumber(x.phone) === phone && String(x.status || 'free') !== 'deleted')) { skipped++; continue; }
    db.highlandsStock.push({ id: uid('hl'), service_id: serviceId, phone, status: 'free', note: '', created_at: now(), updated_at: now(), rental_id: '', user_id: '' });
    added++;
  }
  saveDb();
  res.json({ ok: true, added, skipped, total: (db.highlandsStock || []).filter(x => x.service_id === serviceId && x.status !== 'deleted').length });
});
app.patch('/api/admin/highlands-stock/:id', auth, adminOnly, (req, res) => {
  const item = (db.highlandsStock || []).find(x => x.id === req.params.id);
  if (!item) return res.status(404).json({ error: 'Không tìm thấy số Highlands' });
  if (req.body.status !== undefined) item.status = String(req.body.status || 'free');
  if (req.body.note !== undefined) item.note = String(req.body.note || '');
  item.updated_at = now(); saveDb(); res.json(item);
});
app.post('/api/admin/highlands-stock/bulk-delete', auth, adminOnly, (req, res) => {
  const ids = Array.isArray(req.body.ids) ? req.body.ids.map(String) : [];
  const serviceId = String(req.body.service_id || '').trim();
  const status = String(req.body.status || '').trim();
  const deleteAll = !!req.body.delete_all;
  const before = (db.highlandsStock || []).length;
  db.highlandsStock = (db.highlandsStock || []).filter(x => {
    if (ids.length) return !ids.includes(String(x.id));
    if (serviceId && String(x.service_id) !== serviceId) return true;
    if (status && String(x.status || 'free') !== status) return true;
    if (deleteAll || serviceId || status) return false;
    return true;
  });
  const deleted = before - (db.highlandsStock || []).length;
  saveDb();
  res.json({ ok: true, deleted });
});

app.delete('/api/admin/highlands-stock/:id', auth, adminOnly, (req, res) => {
  db.highlandsStock = (db.highlandsStock || []).filter(x => x.id !== req.params.id);
  saveDb(); res.json({ ok: true });
});

app.get('/api/admin/highlands-orders', auth, adminOnly, async (req, res) => {
  await processExpiredRentals();
  const rows = (db.rentals || [])
    .filter(r => String(r.service_type || '').toLowerCase() === 'highlands')
    .map(r => ({ ...r, username: (db.users.find(u => u.id === r.user_id) || {}).username || 'unknown' }))
    .sort((a,b) => String(b.rented_at || '').localeCompare(String(a.rented_at || '')));
  res.json(rows);
});

app.get('/api/admin/rentals', auth, adminOnly, async (req, res) => { await processExpiredRentals(); res.json(db.rentals.map(r => ({ ...r, username: (db.users.find(u => u.id === r.user_id) || {}).username || 'unknown' })).sort((a,b) => b.rented_at.localeCompare(a.rented_at))); });
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
app.patch('/api/admin/settings', auth, adminOnly, (req, res) => { ['siteName','brandText','logoUrl','adUrl','themeColor','layoutMode','depositInfo','qrImage','apiBaseUrl','apiKey','apiProvider','legacyApiBaseUrl','legacyApiKey','codesimApiBaseUrl','codesimApiKey','otpTimeoutMinutes','sepayBankCode','sepayAccount','sepayAccountName','sepayEnabled'].forEach(k => { if (req.body[k] !== undefined) db.settings[k] = String(req.body[k]); }); saveDb(); res.json(safeSettingsForUser(db.settings, true)); });
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
}
start().catch(err => {
  console.error('Không khởi động được server:', err);
  process.exit(1);
});
