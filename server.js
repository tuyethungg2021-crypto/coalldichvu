require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const Database = require('better-sqlite3');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'change-this-secret';
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'hungnbyt';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'azhung12';

const root = __dirname;
const dataDir = path.join(root, 'data');
const uploadDir = path.join(root, 'uploads');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const db = new Database(path.join(dataDir, 'app.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

function now() { return new Date().toISOString(); }
function uid(prefix) { return prefix + '_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8); }
function money(n) { return Number(n || 0); }

function columnExists(table, column) {
  return db.prepare(`PRAGMA table_info(${table})`).all().some(c => c.name === column);
}
function addColumn(table, definition) {
  const name = definition.split(/\s+/)[0];
  if (!columnExists(table, name)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${definition}`);
}

function migrate() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'user',
      balance INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      last_login TEXT,
      status TEXT NOT NULL DEFAULT 'active'
    );
    CREATE TABLE IF NOT EXISTS services (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      network TEXT NOT NULL,
      price INTEGER NOT NULL DEFAULT 0,
      visible INTEGER NOT NULL DEFAULT 1,
      description TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS rentals (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      service_id TEXT,
      service_name TEXT NOT NULL,
      network TEXT NOT NULL,
      phone_number TEXT NOT NULL,
      price INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'Đang thuê',
      rented_at TEXT NOT NULL,
      ended_at TEXT,
      otp_code TEXT,
      note TEXT,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS deposits (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      amount INTEGER NOT NULL,
      content TEXT,
      proof_image TEXT,
      status TEXT NOT NULL DEFAULT 'Chờ duyệt',
      admin_note TEXT,
      created_at TEXT NOT NULL,
      reviewed_at TEXT,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      message TEXT NOT NULL,
      read INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );
  `);

  // Safe future migrations: update code without deleting old database.
  addColumn('users', 'status TEXT NOT NULL DEFAULT active');
  addColumn('rentals', 'otp_code TEXT');
  addColumn('rentals', 'note TEXT');
  addColumn('deposits', 'admin_note TEXT');

  const admin = db.prepare('SELECT * FROM users WHERE username = ?').get(ADMIN_USERNAME);
  if (!admin) {
    db.prepare('INSERT INTO users (id, username, password_hash, role, balance, created_at, last_login, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(uid('u'), ADMIN_USERNAME, bcrypt.hashSync(ADMIN_PASSWORD, 10), 'admin', 0, now(), now(), 'active');
  }

  const countServices = db.prepare('SELECT COUNT(*) AS c FROM services').get().c;
  if (countServices === 0) {
    const sample = [
      ['Facebook', 'Viettel', 2500, 'Thuê sim nhận OTP Facebook'],
      ['Zalo', 'VinaPhone', 3000, 'Thuê sim nhận OTP Zalo'],
      ['Telegram', 'MobiFone', 3500, 'Thuê sim nhận OTP Telegram'],
      ['Shopee', 'Vietnamobile', 2000, 'Thuê sim nhận OTP Shopee'],
      ['Google/Gmail', 'Viettel', 4000, 'Thuê sim nhận OTP Google']
    ];
    const stmt = db.prepare('INSERT INTO services (id, name, network, price, visible, description, created_at, updated_at) VALUES (?, ?, ?, ?, 1, ?, ?, ?)');
    sample.forEach(s => stmt.run(uid('s'), s[0], s[1], s[2], s[3], now(), now()));
  }

  const defaults = {
    siteName: 'Có All Dịch Vụ',
    brandText: 'Thuê sim nhanh - nhiều nhà mạng - quản lý dễ dàng',
    logoUrl: '',
    adUrl: '',
    themeColor: '#2563eb',
    layoutMode: 'modern',
    depositInfo: 'Ngân hàng: MB Bank\nSố tài khoản: 0123456789\nChủ tài khoản: HUNG NBYT\nNội dung: nap username',
    qrImage: ''
  };
  const ins = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
  Object.entries(defaults).forEach(([k, v]) => ins.run(k, v));
}

migrate();

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use('/uploads', express.static(uploadDir));
app.use(express.static(path.join(root, 'public')));

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const safe = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
    cb(null, Date.now() + '_' + safe);
  }
});
const upload = multer({ storage, limits: { fileSize: 5 * 1024 * 1024 } });

function sign(user) {
  return jwt.sign({ id: user.id, username: user.username, role: user.role }, JWT_SECRET, { expiresIn: '7d' });
}
function cleanUser(u) {
  if (!u) return null;
  return { id: u.id, username: u.username, role: u.role, balance: u.balance, created_at: u.created_at, last_login: u.last_login, status: u.status };
}
function auth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token) return res.status(401).json({ error: 'Bạn chưa đăng nhập' });
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(decoded.id);
    if (!user || user.status !== 'active') return res.status(401).json({ error: 'Tài khoản không hợp lệ hoặc đã bị khóa/xóa' });
    req.user = user;
    next();
  } catch (e) {
    res.status(401).json({ error: 'Phiên đăng nhập hết hạn' });
  }
}
function adminOnly(req, res, next) {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Chỉ admin được dùng chức năng này' });
  next();
}
function getSettings() {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const obj = {};
  rows.forEach(r => obj[r.key] = r.value);
  return obj;
}

app.get('/api/health', (req, res) => res.json({ ok: true, app: 'Có All Dịch Vụ', time: now() }));

app.post('/api/register', (req, res) => {
  const username = String(req.body.username || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  if (!/^[a-z0-9_]{3,30}$/.test(username)) return res.status(400).json({ error: 'Tên đăng nhập chỉ gồm chữ thường, số, dấu _, từ 3-30 ký tự' });
  if (password.length < 6) return res.status(400).json({ error: 'Mật khẩu tối thiểu 6 ký tự' });
  try {
    const user = { id: uid('u'), username, password_hash: bcrypt.hashSync(password, 10), role: 'user', balance: 0, created_at: now(), last_login: now(), status: 'active' };
    db.prepare('INSERT INTO users (id, username, password_hash, role, balance, created_at, last_login, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(user.id, user.username, user.password_hash, user.role, user.balance, user.created_at, user.last_login, user.status);
    res.json({ token: sign(user), user: cleanUser(user) });
  } catch (e) {
    res.status(400).json({ error: 'Tên đăng nhập đã tồn tại' });
  }
});

app.post('/api/login', (req, res) => {
  const username = String(req.body.username || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user || !bcrypt.compareSync(password, user.password_hash)) return res.status(400).json({ error: 'Sai tài khoản hoặc mật khẩu' });
  if (user.status !== 'active') return res.status(403).json({ error: 'Tài khoản đã bị khóa/xóa' });
  db.prepare('UPDATE users SET last_login = ? WHERE id = ?').run(now(), user.id);
  user.last_login = now();
  res.json({ token: sign(user), user: cleanUser(user) });
});

app.get('/api/me', auth, (req, res) => res.json({ user: cleanUser(req.user) }));
app.get('/api/settings', (req, res) => res.json(getSettings()));

app.get('/api/services', auth, (req, res) => {
  const rows = req.user.role === 'admin'
    ? db.prepare('SELECT * FROM services ORDER BY visible DESC, name ASC').all()
    : db.prepare('SELECT * FROM services WHERE visible = 1 ORDER BY name ASC, network ASC').all();
  res.json(rows);
});

app.post('/api/rentals', auth, (req, res) => {
  const service = db.prepare('SELECT * FROM services WHERE id = ? AND visible = 1').get(req.body.service_id);
  if (!service) return res.status(404).json({ error: 'Dịch vụ không tồn tại hoặc đang ẩn' });
  if (req.user.balance < service.price) return res.status(400).json({ error: 'Số dư không đủ, vui lòng nạp thêm tiền' });
  const phone = '0' + Math.floor(100000000 + Math.random() * 899999999);
  const rental = { id: uid('r'), user_id: req.user.id, service_id: service.id, service_name: service.name, network: service.network, phone_number: phone, price: service.price, status: 'Đang thuê', rented_at: now(), otp_code: '', note: '' };
  const tx = db.transaction(() => {
    db.prepare('UPDATE users SET balance = balance - ? WHERE id = ?').run(service.price, req.user.id);
    db.prepare('INSERT INTO rentals (id, user_id, service_id, service_name, network, phone_number, price, status, rented_at, otp_code, note) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(rental.id, rental.user_id, rental.service_id, rental.service_name, rental.network, rental.phone_number, rental.price, rental.status, rental.rented_at, rental.otp_code, rental.note);
  });
  tx();
  res.json({ rental, user: cleanUser(db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id)) });
});

app.get('/api/rentals', auth, (req, res) => {
  const rows = db.prepare('SELECT * FROM rentals WHERE user_id = ? ORDER BY rented_at DESC').all(req.user.id);
  res.json(rows);
});

app.post('/api/deposits', auth, upload.single('proof'), (req, res) => {
  const amount = Math.floor(Number(req.body.amount || 0));
  if (amount <= 0) return res.status(400).json({ error: 'Số tiền nạp không hợp lệ' });
  const proof = req.file ? '/uploads/' + req.file.filename : '';
  const dep = { id: uid('d'), user_id: req.user.id, amount, content: String(req.body.content || ''), proof_image: proof, status: 'Chờ duyệt', created_at: now() };
  const tx = db.transaction(() => {
    db.prepare('INSERT INTO deposits (id, user_id, amount, content, proof_image, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(dep.id, dep.user_id, dep.amount, dep.content, dep.proof_image, dep.status, dep.created_at);
    db.prepare('INSERT INTO notifications (id, type, message, read, created_at) VALUES (?, ?, ?, 0, ?)')
      .run(uid('n'), 'deposit', `${req.user.username} gửi yêu cầu nạp ${amount.toLocaleString('vi-VN')}đ`, now());
  });
  tx();
  res.json(dep);
});

app.get('/api/deposits', auth, (req, res) => {
  const rows = db.prepare('SELECT * FROM deposits WHERE user_id = ? ORDER BY created_at DESC').all(req.user.id);
  res.json(rows);
});

app.post('/api/upload', auth, adminOnly, upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Chưa có file' });
  res.json({ url: '/uploads/' + req.file.filename });
});

// Admin APIs
app.get('/api/admin/users', auth, adminOnly, (req, res) => {
  const rows = db.prepare(`
    SELECT id, username, role, balance, created_at, last_login, status,
    CAST((julianday('now') - julianday(COALESCE(last_login, created_at))) AS INTEGER) AS days_inactive
    FROM users ORDER BY role ASC, username ASC
  `).all();
  res.json(rows);
});
app.patch('/api/admin/users/:id', auth, adminOnly, (req, res) => {
  const id = req.params.id;
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!user) return res.status(404).json({ error: 'Không tìm thấy user' });
  if (req.body.balance !== undefined) db.prepare('UPDATE users SET balance = ? WHERE id = ?').run(Math.floor(Number(req.body.balance || 0)), id);
  if (req.body.addBalance !== undefined) db.prepare('UPDATE users SET balance = balance + ? WHERE id = ?').run(Math.floor(Number(req.body.addBalance || 0)), id);
  if (req.body.password) db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(bcrypt.hashSync(String(req.body.password), 10), id);
  if (req.body.status) db.prepare('UPDATE users SET status = ? WHERE id = ?').run(String(req.body.status), id);
  res.json(cleanUser(db.prepare('SELECT * FROM users WHERE id = ?').get(id)));
});
app.delete('/api/admin/users/:id', auth, adminOnly, (req, res) => {
  const id = req.params.id;
  if (id === req.user.id) return res.status(400).json({ error: 'Không thể xóa chính bạn' });
  db.prepare('DELETE FROM users WHERE id = ?').run(id);
  res.json({ ok: true });
});

app.post('/api/admin/services', auth, adminOnly, (req, res) => {
  const s = { id: uid('s'), name: String(req.body.name || '').trim(), network: String(req.body.network || '').trim(), price: Math.floor(Number(req.body.price || 0)), visible: req.body.visible ? 1 : 0, description: String(req.body.description || ''), created_at: now(), updated_at: now() };
  if (!s.name || !s.network) return res.status(400).json({ error: 'Thiếu tên dịch vụ hoặc nhà mạng' });
  db.prepare('INSERT INTO services (id, name, network, price, visible, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(s.id, s.name, s.network, s.price, s.visible, s.description, s.created_at, s.updated_at);
  res.json(s);
});
app.patch('/api/admin/services/:id', auth, adminOnly, (req, res) => {
  const old = db.prepare('SELECT * FROM services WHERE id = ?').get(req.params.id);
  if (!old) return res.status(404).json({ error: 'Không tìm thấy dịch vụ' });
  const s = { name: req.body.name ?? old.name, network: req.body.network ?? old.network, price: req.body.price !== undefined ? Math.floor(Number(req.body.price || 0)) : old.price, visible: req.body.visible !== undefined ? (req.body.visible ? 1 : 0) : old.visible, description: req.body.description ?? old.description };
  db.prepare('UPDATE services SET name = ?, network = ?, price = ?, visible = ?, description = ?, updated_at = ? WHERE id = ?')
    .run(s.name, s.network, s.price, s.visible, s.description, now(), req.params.id);
  res.json(db.prepare('SELECT * FROM services WHERE id = ?').get(req.params.id));
});
app.delete('/api/admin/services/:id', auth, adminOnly, (req, res) => {
  db.prepare('DELETE FROM services WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

app.get('/api/admin/rentals', auth, adminOnly, (req, res) => {
  const rows = db.prepare(`SELECT rentals.*, users.username FROM rentals JOIN users ON rentals.user_id = users.id ORDER BY rented_at DESC`).all();
  res.json(rows);
});
app.patch('/api/admin/rentals/:id', auth, adminOnly, (req, res) => {
  const old = db.prepare('SELECT * FROM rentals WHERE id = ?').get(req.params.id);
  if (!old) return res.status(404).json({ error: 'Không tìm thấy lượt thuê' });
  db.prepare('UPDATE rentals SET status = ?, otp_code = ?, note = ?, ended_at = ? WHERE id = ?')
    .run(req.body.status ?? old.status, req.body.otp_code ?? old.otp_code, req.body.note ?? old.note, req.body.ended_at ?? old.ended_at, req.params.id);
  res.json(db.prepare('SELECT * FROM rentals WHERE id = ?').get(req.params.id));
});

app.get('/api/admin/deposits', auth, adminOnly, (req, res) => {
  const rows = db.prepare(`SELECT deposits.*, users.username FROM deposits JOIN users ON deposits.user_id = users.id ORDER BY created_at DESC`).all();
  res.json(rows);
});
app.patch('/api/admin/deposits/:id', auth, adminOnly, (req, res) => {
  const dep = db.prepare('SELECT * FROM deposits WHERE id = ?').get(req.params.id);
  if (!dep) return res.status(404).json({ error: 'Không tìm thấy yêu cầu nạp' });
  const status = String(req.body.status || dep.status);
  const note = String(req.body.admin_note || dep.admin_note || '');
  const tx = db.transaction(() => {
    if (dep.status !== 'Đã duyệt' && status === 'Đã duyệt') db.prepare('UPDATE users SET balance = balance + ? WHERE id = ?').run(dep.amount, dep.user_id);
    db.prepare('UPDATE deposits SET status = ?, admin_note = ?, reviewed_at = ? WHERE id = ?').run(status, note, now(), dep.id);
  });
  tx();
  res.json(db.prepare('SELECT * FROM deposits WHERE id = ?').get(req.params.id));
});

app.get('/api/admin/notifications', auth, adminOnly, (req, res) => {
  res.json(db.prepare('SELECT * FROM notifications ORDER BY created_at DESC LIMIT 100').all());
});
app.patch('/api/admin/notifications/read', auth, adminOnly, (req, res) => {
  db.prepare('UPDATE notifications SET read = 1').run();
  res.json({ ok: true });
});

app.patch('/api/admin/settings', auth, adminOnly, (req, res) => {
  const allowed = ['siteName','brandText','logoUrl','adUrl','themeColor','layoutMode','depositInfo','qrImage'];
  const stmt = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
  allowed.forEach(k => { if (req.body[k] !== undefined) stmt.run(k, String(req.body[k])); });
  res.json(getSettings());
});

app.get('*', (req, res) => res.sendFile(path.join(root, 'public', 'index.html')));

app.listen(PORT, () => console.log(`Có All Dịch Vụ running at http://localhost:${PORT}`));
