require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const multer = require('multer');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'change-this-secret';
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'hungnbyt';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'azhung12';

const root = __dirname;
const dataDir = path.join(root, 'data');
const uploadDir = path.join(root, 'uploads');
const dbFile = path.join(dataDir, 'app-data.json');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

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
    qrImage: ''
  }
};
let db = loadDb();

function loadDb() {
  try {
    if (fs.existsSync(dbFile)) {
      const parsed = JSON.parse(fs.readFileSync(dbFile, 'utf8'));
      return { ...defaults, ...parsed, settings: { ...defaults.settings, ...(parsed.settings || {}) } };
    }
  } catch (e) { console.error('Không đọc được database JSON:', e); }
  return JSON.parse(JSON.stringify(defaults));
}
function saveDb() {
  const tmp = dbFile + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, dbFile);
}
function migrate() {
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
    ].forEach(s => db.services.push({ id: uid('s'), name: s[0], network: s[1], price: s[2], visible: 1, description: s[3], created_at: now(), updated_at: now() }));
    changed = true;
  }
  if (changed) saveDb();
}
migrate();

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use('/uploads', express.static(uploadDir));
app.use(express.static(path.join(root, 'public')));

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => cb(null, Date.now() + '_' + file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_'))
});
const upload = multer({ storage, limits: { fileSize: 5 * 1024 * 1024 } });

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

app.get('/api/health', (req, res) => res.json({ ok: true, app: 'Có All Dịch Vụ', db: 'json', time: now() }));
app.get('/api/settings', (req, res) => res.json(db.settings));

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
app.post('/api/rentals', auth, (req, res) => {
  const service = db.services.find(s => s.id === req.body.service_id && Number(s.visible) === 1);
  if (!service) return res.status(404).json({ error: 'Dịch vụ không tồn tại hoặc đang ẩn' });
  if ((req.user.balance || 0) < service.price) return res.status(400).json({ error: 'Số dư không đủ, vui lòng nạp thêm tiền' });
  req.user.balance -= service.price;
  const rental = { id: uid('r'), user_id: req.user.id, service_id: service.id, service_name: service.name, network: service.network, phone_number: '0' + Math.floor(100000000 + Math.random()*899999999), price: service.price, status: 'Đang thuê', rented_at: now(), ended_at: '', otp_code: '', note: '' };
  db.rentals.push(rental); saveDb();
  res.json({ rental, user: cleanUser(req.user) });
});
app.get('/api/rentals', auth, (req, res) => res.json(db.rentals.filter(r => r.user_id === req.user.id).sort((a,b) => b.rented_at.localeCompare(a.rented_at))));

app.post('/api/deposits', auth, upload.single('proof'), (req, res) => {
  const amount = Math.floor(Number(req.body.amount || 0));
  if (amount <= 0) return res.status(400).json({ error: 'Số tiền nạp không hợp lệ' });
  const dep = { id: uid('d'), user_id: req.user.id, amount, content: String(req.body.content || ''), proof_image: req.file ? '/uploads/' + req.file.filename : '', status: 'Chờ duyệt', admin_note: '', created_at: now(), reviewed_at: '' };
  db.deposits.push(dep);
  db.notifications.push({ id: uid('n'), type: 'deposit', message: `${req.user.username} gửi yêu cầu nạp ${amount.toLocaleString('vi-VN')}đ`, read: 0, created_at: now() });
  saveDb(); res.json(dep);
});
app.get('/api/deposits', auth, (req, res) => res.json(db.deposits.filter(d => d.user_id === req.user.id).sort((a,b) => b.created_at.localeCompare(a.created_at))));
app.post('/api/upload', auth, adminOnly, upload.single('file'), (req, res) => { if (!req.file) return res.status(400).json({ error: 'Chưa có file' }); res.json({ url: '/uploads/' + req.file.filename }); });

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
  const s = { id: uid('s'), name: String(req.body.name || '').trim(), network: String(req.body.network || '').trim(), price: Math.floor(Number(req.body.price || 0)), visible: req.body.visible ? 1 : 0, description: String(req.body.description || ''), created_at: now(), updated_at: now() };
  if (!s.name || !s.network) return res.status(400).json({ error: 'Thiếu tên dịch vụ hoặc nhà mạng' }); db.services.push(s); saveDb(); res.json(s);
});
app.patch('/api/admin/services/:id', auth, adminOnly, (req, res) => {
  const s = db.services.find(x => x.id === req.params.id); if (!s) return res.status(404).json({ error: 'Không tìm thấy dịch vụ' });
  ['name','network','description'].forEach(k => { if (req.body[k] !== undefined) s[k] = String(req.body[k]); });
  if (req.body.price !== undefined) s.price = Math.floor(Number(req.body.price || 0));
  if (req.body.visible !== undefined) s.visible = req.body.visible ? 1 : 0;
  s.updated_at = now(); saveDb(); res.json(s);
});
app.delete('/api/admin/services/:id', auth, adminOnly, (req, res) => { db.services = db.services.filter(s => s.id !== req.params.id); saveDb(); res.json({ ok: true }); });

app.get('/api/admin/rentals', auth, adminOnly, (req, res) => res.json(db.rentals.map(r => ({ ...r, username: (db.users.find(u => u.id === r.user_id) || {}).username || 'unknown' })).sort((a,b) => b.rented_at.localeCompare(a.rented_at))));
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
app.patch('/api/admin/settings', auth, adminOnly, (req, res) => { ['siteName','brandText','logoUrl','adUrl','themeColor','layoutMode','depositInfo','qrImage'].forEach(k => { if (req.body[k] !== undefined) db.settings[k] = String(req.body[k]); }); saveDb(); res.json(db.settings); });

app.get('*', (req, res) => res.sendFile(path.join(root, 'public', 'index.html')));
app.listen(PORT, () => console.log(`Có All Dịch Vụ running at http://localhost:${PORT}`));
