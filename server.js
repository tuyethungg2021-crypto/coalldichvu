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
  users: [], services: [], rentals: [], deposits: [], notifications: [],
  settings: {
    siteName: 'Có All Dịch Vụ',
    brandText: 'Thuê sim nhanh - nhiều nhà mạng - quản lý dễ dàng',
    logoUrl: '', adUrl: '', themeColor: '#2563eb', layoutMode: 'modern',
    depositInfo: 'Ngân hàng: MB Bank\nSố tài khoản: 0123456789\nChủ tài khoản: HUNG NBYT\nNội dung: nap username',
    qrImage: '',
    apiBaseUrl: 'https://apisim.codesim.net',
    apiProvider: 'codesim',
    apiKey: 'eyJhbGciOiJIUzUxMiJ9.eyJzdWIiOiJudWJpYTMiLCJqdGkiOiI4NDM1NiIsImlhdCI6MTc3NzA4NDE5NiwiZXhwIjoxODM5MjkyMTk2fQ.F5SrJi-hvbhovlmaoxHyIcqshXwbnapb-nltkXkPQO2WLTG8kr5VRPHZdu8ZYdrzmi8m6pTbUZtMo1dSsI6cvA',
    otpTimeoutMinutes: '20'
  }
};
let db = null;

function normalizeDb(parsed) {
  parsed = parsed || {};
  return { ...defaults, ...parsed, settings: { ...defaults.settings, ...(parsed.settings || {}) } };
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
function getApiKey() { return String(db.settings.apiKey || process.env.SIM_API_KEY || '').trim(); }
function getApiBase() { return String(db.settings.apiBaseUrl || 'https://apisim.codesim.net').trim().replace(/\/+$/, ''); }
function getApiProvider() { return String(db.settings.apiProvider || 'codesim').trim().toLowerCase(); }
function getOtpTimeoutMinutes() {
  const n = Number(db.settings.otpTimeoutMinutes || 20);
  return Number.isFinite(n) && n > 0 ? n : 20;
}
function buildUrl(pathname, params = {}) {
  const url = new URL(getApiBase() + pathname);
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && String(v) !== '') url.searchParams.set(k, String(v));
  });
  return url;
}
async function fetchJson(url) {
  const r = await fetch(url.toString(), { method: 'GET' });
  const text = await r.text();
  let data;
  try { data = JSON.parse(text); } catch { throw new Error('API trả về không phải JSON: ' + text.slice(0, 160)); }
  if (!r.ok) throw new Error(data.message || data.Msg || ('API lỗi HTTP ' + r.status));
  return data;
}
function isCodesimOk(data) { return Number(data.status) === 200; }
async function simApi(action, params = {}) {
  const key = getApiKey();
  if (!key) throw new Error('Admin chưa cài API key');
  if (getApiProvider() === 'codesim' || getApiBase().includes('apisim.codesim.net')) {
    if (action === 'account') return fetchJson(buildUrl('/yourself/information-by-api-key', { api_key: key }));
    if (action === 'services') return fetchJson(buildUrl('/service/get_service_by_api_key', { api_key: key }));
    if (action === 'networks') return fetchJson(buildUrl('/network/get-network-by-api-key', { api_key: key }));
    if (action === 'rent') return fetchJson(buildUrl('/sim/get_sim', { api_key: key, service_id: params.service_id, network_id: params.network_id, phone: params.phone }));
    if (action === 'code') return fetchJson(buildUrl('/otp/get_otp_by_phone_api_key', { api_key: key, otp_id: params.otp_id }));
    if (action === 'cancel') return fetchJson(buildUrl('/sim/cancel_api_key/' + encodeURIComponent(params.sim_id || ''), { api_key: key }));
    if (action === 'reuse') return fetchJson(buildUrl('/sim/reuse_by_phone_api_key', { api_key: key, phone: params.phone, service_id: params.service_id }));
  }
  // Legacy chaycodeso3 adapter
  const url = new URL(getApiBase());
  Object.entries({ ...params, act: action, apik: key }).forEach(([k, v]) => {
    if (v !== undefined && v !== null && String(v) !== '') url.searchParams.set(k, String(v));
  });
  return fetchJson(url);
}
async function cancelExternalRental(r) {
  if (r.cancelled_external || !r.external_sim_id) return null;
  try {
    const out = await simApi('cancel', { sim_id: r.external_sim_id });
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
  if (!isAdmin) delete out.apiKey;
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
    const apiResult = await simApi('rent', { service_id: service.external_app_id, network_id: networkId });
    if (!isCodesimOk(apiResult)) return res.status(400).json({ error: apiResult.message || 'API không cấp được số', api: apiResult });
    const result = apiResult.data || {};
    if (!result.phone || !result.otpId) return res.status(400).json({ error: apiResult.message || 'API không trả về số sim/OTP ID', api: apiResult });
    const cost = Math.floor(Number(result.payment || service.price || 0));
    req.user.balance = Math.floor(Number(req.user.balance || 0) - Number(service.price || cost));
    const displayNumber = String(result.phone || '');
    const rental = {
      id: uid('r'), user_id: req.user.id, service_id: service.id, service_name: service.name,
      network: networkId || service.network || '', phone_number: displayNumber, price: service.price, api_cost: cost,
      external_id: String(result.otpId || ''), external_sim_id: String(result.simId || ''), api_app_id: String(service.external_app_id),
      status: 'Đang chờ code', rented_at: now(), ended_at: '', otp_code: '', sms: '', note: apiResult.message || ''
    };
    db.rentals.push(rental); saveDb();
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
    const apiResult = await simApi('code', { otp_id: r.external_id });
    if (isCodesimOk(apiResult) && apiResult.data && apiResult.data.code) {
      const result = apiResult.data || {};
      r.status = 'Đã nhận code'; r.otp_code = String(result.code || ''); r.sms = String(result.content || ''); r.ended_at = now(); r.note = apiResult.message || '';
    } else {
      r.note = apiResult.message || 'Chưa có OTP, vui lòng thử lại sau ít nhất 4 giây';
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
    const apiResult = await simApi('cancel', { sim_id: r.external_sim_id });
    if (isCodesimOk(apiResult)) { r.status = 'Đã hủy'; r.ended_at = now(); r.cancelled_external = 1; }
    r.note = apiResult.message || r.note || ''; saveDb();
    res.json({ rental: r, api: apiResult });
  } catch (e) { res.status(500).json({ error: e.message || 'Không hủy được lượt thuê' }); }
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
  db.users = db.users.filter(u => u.id !== req.params.id); db.rentals = db.rentals.filter(r => r.user_id !== req.params.id); db.deposits = db.deposits.filter(d => d.user_id !== req.params.id); saveDb(); res.json({ ok: true });
});

app.post('/api/admin/services', auth, adminOnly, (req, res) => {
  const s = { id: uid('s'), name: String(req.body.name || '').trim(), network: String(req.body.network || '').trim(), price: Math.floor(Number(req.body.price || 0)), visible: req.body.visible ? 1 : 0, description: String(req.body.description || ''), imageUrl: String(req.body.imageUrl || ''), external_app_id: String(req.body.external_app_id || '').trim(), api_cost: Math.floor(Number(req.body.api_cost || 0)), created_at: now(), updated_at: now() };
  if (!s.name) return res.status(400).json({ error: 'Thiếu tên dịch vụ' }); db.services.push(s); saveDb(); res.json(s);
});
app.post('/api/admin/services/hide-all', auth, adminOnly, (req, res) => {
  db.services.forEach(s => { s.visible = 0; s.updated_at = now(); });
  saveDb();
  res.json({ ok: true, hidden: db.services.length });
});

app.patch('/api/admin/services/:id', auth, adminOnly, (req, res) => {
  const s = db.services.find(x => x.id === req.params.id); if (!s) return res.status(404).json({ error: 'Không tìm thấy dịch vụ' });
  ['name','network','description','external_app_id','imageUrl'].forEach(k => { if (req.body[k] !== undefined) s[k] = String(req.body[k]); });
  if (req.body.price !== undefined) s.price = Math.floor(Number(req.body.price || 0));
  if (req.body.visible !== undefined) s.visible = req.body.visible ? 1 : 0;
  if (req.body.api_cost !== undefined) s.api_cost = Math.floor(Number(req.body.api_cost || 0));
  s.updated_at = now(); saveDb(); res.json(s);
});
app.delete('/api/admin/services/:id', auth, adminOnly, (req, res) => { db.services = db.services.filter(s => s.id !== req.params.id); saveDb(); res.json({ ok: true }); });

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
app.patch('/api/admin/settings', auth, adminOnly, (req, res) => { ['siteName','brandText','logoUrl','adUrl','themeColor','layoutMode','depositInfo','qrImage','apiBaseUrl','apiKey','apiProvider','otpTimeoutMinutes'].forEach(k => { if (req.body[k] !== undefined) db.settings[k] = String(req.body[k]); }); saveDb(); res.json(safeSettingsForUser(db.settings, true)); });
app.get('/api/admin/sim-api/account', auth, adminOnly, async (req, res) => {
  try { res.json(await simApi('account')); } catch (e) { res.status(500).json({ error: e.message }); }
});
app.get('/api/admin/sim-api/apps', auth, adminOnly, async (req, res) => {
  try { res.json(await simApi('services')); } catch (e) { res.status(500).json({ error: e.message }); }
});
app.post('/api/admin/sim-api/sync-apps', auth, adminOnly, async (req, res) => {
  try {
    const data = await simApi('services');
    if (!isCodesimOk(data)) return res.status(400).json({ error: data.message || 'API không trả danh sách dịch vụ', api: data });
    const apps = Array.isArray(data.data) ? data.data : [];
    let added = 0, updated = 0;
    apps.forEach(a => {
      const appId = String(a.id || a.Id || '').trim(); if (!appId) return;
      const name = String(a.name || a.Name || ('Service ' + appId));
      const apiCost = Math.floor(Number(a.price || a.Cost || 0));
      let s = db.services.find(x => String(x.external_app_id || '') === appId);
      if (s) { s.name = name; s.api_cost = apiCost; if (!s.price || Number(req.body.overwritePrice)) s.price = apiCost; s.updated_at = now(); updated++; }
      else { db.services.push({ id: uid('s'), name, network: '', price: apiCost, visible: 0, description: '', imageUrl: '', external_app_id: appId, api_cost: apiCost, created_at: now(), updated_at: now() }); added++; }
    });
    saveDb(); res.json({ ok: true, added, updated, total: apps.length });
  } catch (e) { res.status(500).json({ error: e.message || 'Không đồng bộ được app API' }); }
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
