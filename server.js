require('dotenv').config();

const path = require('path');
const fs = require('fs');
const express = require('express');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const Database = require('better-sqlite3');

const app = express();
const PORT = Number(process.env.PORT || 8080);
const JWT_SECRET = process.env.JWT_SECRET || 'dev-only-change-this-secret';
const DB_FILE = path.resolve(__dirname, process.env.DB_FILE || './data/peoplepilot.sqlite');
const COOKIE_NAME = 'peoplepilot_session';
const isProduction = process.env.NODE_ENV === 'production';
if (isProduction && (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32)) {
  throw new Error('JWT_SECRET must be set to at least 32 characters in production');
}

fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });
const db = new Database(DB_FILE);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

const permissionsByRole = {
  super_admin: ['*'],
  hr_admin: ['employees:read', 'employees:create', 'employees:update', 'attendance:read', 'attendance:write', 'leave:read', 'leave:create', 'leave:approve', 'payroll:read', 'payroll:run', 'reports:read', 'settings:read', 'settings:manage', 'users:manage'],
  manager: ['employees:read', 'attendance:read', 'leave:read', 'leave:create', 'leave:approve', 'reports:read', 'settings:read'],
  employee: ['leave:create:self', 'leave:read:self', 'attendance:read:self', 'attendance:write:self', 'payroll:read:self']
};

const seedEmployees = [
  ['Maya Patel', 'maya@northstar.studio', 'Design', 'Design Lead', 'Full-time', 5200, 'MP', 'avatar-pink'],
  ['Jordan Lee', 'jordan@northstar.studio', 'Design', 'Product Designer', 'Full-time', 4400, 'JL', 'avatar-blue'],
  ['Sofia Bennett', 'sofia@northstar.studio', 'Design', 'UX Researcher', 'Full-time', 4100, 'SB', 'avatar-orange'],
  ['Noah Williams', 'noah@northstar.studio', 'Design', 'Visual Designer', 'Contractor', 3600, 'NW', 'avatar-indigo'],
  ['Emma Thompson', 'emma@northstar.studio', 'Design', 'Content Designer', 'Full-time', 3900, 'ET', 'avatar-green'],
  ['Liam Chen', 'liam@northstar.studio', 'Design', 'Junior Designer', 'Full-time', 3100, 'LC', 'avatar-yellow'],
  ['Oliver Smith', 'oliver@northstar.studio', 'Design', 'Brand Designer', 'Full-time', 4200, 'OS', 'avatar-slate'],
  ['Sam Wilson', 'sam@northstar.studio', 'Engineering', 'Engineering Manager', 'Full-time', 6800, 'SW', 'avatar-green'],
  ['Ava Garcia', 'ava@northstar.studio', 'Engineering', 'Frontend Engineer', 'Full-time', 5700, 'AG', 'avatar-orange'],
  ['Ethan Brown', 'ethan@northstar.studio', 'Engineering', 'Backend Engineer', 'Full-time', 5900, 'EB', 'avatar-blue'],
  ['Isabella Davis', 'isabella@northstar.studio', 'Engineering', 'QA Engineer', 'Full-time', 4600, 'ID', 'avatar-pink'],
  ['Lucas Martin', 'lucas@northstar.studio', 'Engineering', 'DevOps Engineer', 'Full-time', 5400, 'LM', 'avatar-indigo'],
  ['Amelia Moore', 'amelia@northstar.studio', 'Engineering', 'Software Engineer', 'Part-time', 3300, 'AM', 'avatar-yellow'],
  ['James Taylor', 'james@northstar.studio', 'Marketing', 'Marketing Manager', 'Full-time', 5100, 'JT', 'avatar-slate'],
  ['Harper Anderson', 'harper@northstar.studio', 'Marketing', 'Growth Specialist', 'Full-time', 4000, 'HA', 'avatar-green'],
  ['Benjamin Thomas', 'benjamin@northstar.studio', 'Marketing', 'Social Media Manager', 'Full-time', 3800, 'BT', 'avatar-blue'],
  ['Evelyn Jackson', 'evelyn@northstar.studio', 'Marketing', 'Copywriter', 'Contractor', 3000, 'EJ', 'avatar-pink'],
  ['Henry White', 'henry@northstar.studio', 'Marketing', 'Marketing Associate', 'Full-time', 2900, 'HW', 'avatar-orange'],
  ['Charlotte Harris', 'charlotte@northstar.studio', 'Operations', 'Operations Lead', 'Full-time', 5500, 'CH', 'avatar-indigo'],
  ['Daniel Martin', 'daniel@northstar.studio', 'Operations', 'Finance Coordinator', 'Full-time', 4300, 'DM', 'avatar-green'],
  ['Grace Thompson', 'grace@northstar.studio', 'Operations', 'People Coordinator', 'Full-time', 3700, 'GT', 'avatar-yellow'],
  ['William Robinson', 'william@northstar.studio', 'Operations', 'Office Coordinator', 'Full-time', 2800, 'WR', 'avatar-slate']
];

function isoDate(date) { return date.toISOString().slice(0, 10); }
function addDays(date, amount) { const result = new Date(date); result.setDate(result.getDate() + amount); return result; }
function monthKey(date = new Date()) { return date.toISOString().slice(0, 7); }
function prettyDateRange(start, end) {
  const startDate = new Date(`${start}T00:00:00`);
  const endDate = new Date(`${end}T00:00:00`);
  const fmt = value => value.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  return start === end ? fmt(startDate) : `${fmt(startDate)} – ${fmt(endDate)}`;
}
function durationDays(start, end) { return Math.max(1, Math.round((new Date(`${end}T00:00:00`) - new Date(`${start}T00:00:00`)) / 86400000) + 1); }
function initials(name) { return name.split(' ').map(part => part[0]).slice(0, 2).join('').toUpperCase(); }
function serializeUser(user) { return { id: user.id, name: user.name, email: user.email, role: user.role, status: user.status, permissions: permissionsByRole[user.role] || [] }; }
function hasPermission(user, permission) { const permissions = permissionsByRole[user.role] || []; return permissions.includes('*') || permissions.includes(permission); }
function publicEmployee(row) { return { id: row.id, name: row.name, email: row.email, department: row.department, role: row.role, type: row.employment_type, salary: row.salary, initials: row.initials, avatar: row.avatar_class, status: row.status }; }
function publicLeave(row) { return { id: row.id, employeeId: row.employee_id, employee: row.employee_name, type: row.leave_type, dates: prettyDateRange(row.start_date, row.end_date), startDate: row.start_date, endDate: row.end_date, duration: `${row.duration_days} day${row.duration_days === 1 ? '' : 's'}`, reason: row.reason || '—', status: row.status, avatar: row.initials, avatarClass: row.avatar_class }; }
function publicAttendance(row) { return { id: row.id, employeeId: row.employee_id, employee: row.employee_name, email: row.email, initials: row.initials, avatar: row.avatar_class, status: row.status, clockIn: row.clock_in || '—', clockOut: row.clock_out || '—', hours: row.hours || '0h 00m' }; }
function logAction(userId, action, entity, entityId, metadata = {}) { db.prepare('INSERT INTO audit_logs (user_id, action, entity, entity_id, metadata) VALUES (?, ?, ?, ?, ?)').run(userId, action, entity, entityId || null, JSON.stringify(metadata)); }

function createSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE COLLATE NOCASE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('super_admin', 'hr_admin', 'manager', 'employee')),
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      last_login TEXT
    );
    CREATE TABLE IF NOT EXISTS employees (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE COLLATE NOCASE,
      department TEXT NOT NULL,
      role TEXT NOT NULL,
      employment_type TEXT NOT NULL,
      salary REAL NOT NULL DEFAULT 0,
      initials TEXT NOT NULL,
      avatar_class TEXT NOT NULL DEFAULT 'avatar-indigo',
      status TEXT NOT NULL DEFAULT 'Active',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS attendance (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
      attendance_date TEXT NOT NULL,
      clock_in TEXT,
      clock_out TEXT,
      hours TEXT,
      status TEXT NOT NULL CHECK (status IN ('Present', 'Late', 'Absent')),
      UNIQUE(employee_id, attendance_date)
    );
    CREATE TABLE IF NOT EXISTS leave_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
      leave_type TEXT NOT NULL,
      start_date TEXT NOT NULL,
      end_date TEXT NOT NULL,
      duration_days INTEGER NOT NULL,
      reason TEXT,
      status TEXT NOT NULL DEFAULT 'Pending' CHECK (status IN ('Pending', 'Approved', 'Rejected')),
      requested_by INTEGER REFERENCES users(id),
      reviewed_by INTEGER REFERENCES users(id),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS payroll_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      month TEXT NOT NULL UNIQUE,
      pay_date TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'Draft',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS payroll_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id INTEGER NOT NULL REFERENCES payroll_runs(id) ON DELETE CASCADE,
      employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
      base_salary REAL NOT NULL,
      allowances REAL NOT NULL DEFAULT 0,
      deductions REAL NOT NULL DEFAULT 0,
      net_pay REAL NOT NULL,
      UNIQUE(run_id, employee_id)
    );
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER REFERENCES users(id),
      action TEXT NOT NULL,
      entity TEXT NOT NULL,
      entity_id INTEGER,
      metadata TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
}

function seedDatabase() {
  const employeeCount = db.prepare('SELECT COUNT(*) AS count FROM employees').get().count;
  if (!employeeCount) {
    const insert = db.prepare('INSERT INTO employees (name, email, department, role, employment_type, salary, initials, avatar_class) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
    const transaction = db.transaction(() => seedEmployees.forEach(employee => insert.run(...employee)));
    transaction();
  }

  const userCount = db.prepare('SELECT COUNT(*) AS count FROM users').get().count;
  if (!userCount) {
    const insertUser = db.prepare('INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)');
    const users = [
      ['Alex Morgan', process.env.ADMIN_EMAIL || 'admin@northstar.studio', process.env.ADMIN_PASSWORD || 'Admin@12345', 'hr_admin'],
      ['Morgan Reed', process.env.MANAGER_EMAIL || 'manager@northstar.studio', process.env.MANAGER_PASSWORD || 'Manager@12345', 'manager'],
      ['Taylor Smith', process.env.EMPLOYEE_EMAIL || 'employee@northstar.studio', process.env.EMPLOYEE_PASSWORD || 'Employee@12345', 'employee'],
      ['System Owner', process.env.SUPER_ADMIN_EMAIL || 'owner@northstar.studio', process.env.SUPER_ADMIN_PASSWORD || 'Owner@12345', 'super_admin']
    ];
    const transaction = db.transaction(() => users.forEach(([name, email, password, role]) => insertUser.run(name, email.toLowerCase(), bcrypt.hashSync(password, 12), role)));
    transaction();
  }

  const superAdminEmail = (process.env.SUPER_ADMIN_EMAIL || 'owner@northstar.studio').toLowerCase();
  const superAdminExists = db.prepare('SELECT id FROM users WHERE email = ?').get(superAdminEmail);
  if (!superAdminExists) {
    const superAdminPassword = process.env.SUPER_ADMIN_PASSWORD || 'Owner@12345';
    const result = db.prepare('INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)').run('System Owner', superAdminEmail, bcrypt.hashSync(superAdminPassword, 12), 'super_admin');
    console.log(`Seeded super admin account: ${superAdminEmail}`);
  }

  const today = new Date();
  const todayKey = isoDate(today);
  const attendanceCount = db.prepare('SELECT COUNT(*) AS count FROM attendance WHERE attendance_date = ?').get(todayKey).count;
  if (!attendanceCount) {
    const insert = db.prepare('INSERT INTO attendance (employee_id, attendance_date, clock_in, clock_out, hours, status) VALUES (?, ?, ?, ?, ?, ?)');
    const allEmployees = db.prepare('SELECT id FROM employees ORDER BY id').all();
    const transaction = db.transaction(() => allEmployees.forEach((employee, index) => {
      if (index === 8 || index === 19) insert.run(employee.id, todayKey, null, null, '0h 00m', 'Absent');
      else if (index === 4 || index === 15) insert.run(employee.id, todayKey, '09:24 AM', null, '—', 'Late');
      else insert.run(employee.id, todayKey, index % 3 === 0 ? '08:47 AM' : '08:58 AM', '05:31 PM', index % 3 === 0 ? '8h 44m' : '8h 33m', 'Present');
    }));
    transaction();
  }

  const leaveCount = db.prepare('SELECT COUNT(*) AS count FROM leave_requests').get().count;
  if (!leaveCount) {
    const ids = db.prepare('SELECT id, name, initials FROM employees ORDER BY id').all();
    const byName = name => ids.find(employee => employee.name === name).id;
    const adminId = db.prepare('SELECT id FROM users ORDER BY id LIMIT 1').get().id;
    const todayDate = new Date();
    const requests = [
      [byName('Maya Patel'), 'Annual leave', isoDate(addDays(todayDate, 3)), isoDate(addDays(todayDate, 7)), 'Family holiday', 'Pending'],
      [byName('Sam Wilson'), 'Personal leave', isoDate(addDays(todayDate, 5)), isoDate(addDays(todayDate, 5)), 'Personal appointment', 'Pending'],
      [byName('Jordan Lee'), 'Annual leave', isoDate(addDays(todayDate, -3)), isoDate(addDays(todayDate, -2)), 'Rest and recovery', 'Approved'],
      [byName('Ava Garcia'), 'Sick leave', isoDate(addDays(todayDate, -7)), isoDate(addDays(todayDate, -7)), 'Unwell', 'Approved']
    ];
    const insert = db.prepare('INSERT INTO leave_requests (employee_id, leave_type, start_date, end_date, duration_days, reason, status, requested_by, reviewed_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
    const transaction = db.transaction(() => requests.forEach(([employeeId, type, start, end, reason, status]) => insert.run(employeeId, type, start, end, durationDays(start, end), reason, status, adminId, status === 'Approved' ? adminId : null)));
    transaction();
  }

  const settingsCount = db.prepare('SELECT COUNT(*) AS count FROM settings').get().count;
  if (!settingsCount) {
    const insert = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)');
    insert.run('company_name', 'Northstar Studio');
    insert.run('industry', 'Creative & Design');
    insert.run('currency', 'USD');
    insert.run('pay_frequency', 'Monthly');
  }
  ensurePayrollRun();
}

function ensurePayrollRun() {
  const month = monthKey();
  const existing = db.prepare('SELECT id FROM payroll_runs WHERE month = ?').get(month);
  if (existing) return existing.id;
  const now = new Date();
  const payDate = isoDate(new Date(now.getFullYear(), now.getMonth() + 1, 0));
  const run = db.prepare('INSERT INTO payroll_runs (month, pay_date, status) VALUES (?, ?, ?)').run(month, payDate, 'Draft');
  const employees = db.prepare('SELECT id, salary FROM employees WHERE status = ?').all('Active');
  const insertItem = db.prepare('INSERT INTO payroll_items (run_id, employee_id, base_salary, allowances, deductions, net_pay) VALUES (?, ?, ?, ?, ?, ?)');
  const transaction = db.transaction(() => employees.forEach(employee => { const deductions = Math.round(employee.salary * 0.2 * 100) / 100; insertItem.run(run.lastInsertRowid, employee.id, employee.salary, 0, deductions, employee.salary - deductions); }));
  transaction();
  return run.lastInsertRowid;
}

createSchema();
seedDatabase();

app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: '200kb' }));
app.use(cookieParser());

function readUser(req, res, next) {
  const token = req.cookies[COOKIE_NAME];
  if (!token) return next();
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const user = db.prepare('SELECT id, name, email, role, status FROM users WHERE id = ?').get(payload.id);
    if (user && user.status === 'active') req.user = user;
  } catch (error) {
    res.clearCookie(COOKIE_NAME);
  }
  next();
}
function requireAuth(req, res, next) { if (!req.user) return res.status(401).json({ error: 'Authentication required' }); next(); }
function requirePermission(permission) { return (req, res, next) => { if (!req.user) return res.status(401).json({ error: 'Authentication required' }); if (!hasPermission(req.user, permission)) return res.status(403).json({ error: `Permission denied: ${permission}` }); next(); }; }
function validateText(value, field, max = 160) { if (typeof value !== 'string' || !value.trim() || value.length > max) throw new Error(`${field} is required`); return value.trim(); }
function validateDate(value, field) { if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) throw new Error(`${field} must be a valid date`); return value; }

app.use('/api', readUser);
app.get('/api/health', (req, res) => res.json({ ok: true, database: 'sqlite', time: new Date().toISOString() }));

app.post('/api/auth/login', (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  if (!email || !password) return res.status(400).json({ error: 'Email and password are required' });
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  if (!user || user.status !== 'active' || !bcrypt.compareSync(password, user.password_hash)) return res.status(401).json({ error: 'Invalid email or password' });
  db.prepare('UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = ?').run(user.id);
  const token = jwt.sign({ id: user.id, role: user.role }, JWT_SECRET, { expiresIn: '8h' });
  res.cookie(COOKIE_NAME, token, { httpOnly: true, sameSite: 'lax', secure: isProduction, maxAge: 8 * 60 * 60 * 1000, path: '/' });
  logAction(user.id, 'login', 'auth', user.id);
  res.json({ user: serializeUser(user) });
});
app.post('/api/auth/logout', (req, res) => { if (req.user) logAction(req.user.id, 'logout', 'auth', req.user.id); res.clearCookie(COOKIE_NAME, { httpOnly: true, sameSite: 'lax', secure: isProduction, path: '/' }); res.json({ ok: true }); });
app.get('/api/auth/me', requireAuth, (req, res) => res.json({ user: serializeUser(req.user) }));

app.get('/api/employees', requirePermission('employees:read'), (req, res) => {
  res.json(db.prepare('SELECT * FROM employees ORDER BY name').all().map(publicEmployee));
});
app.post('/api/employees', requirePermission('employees:create'), (req, res) => {
  try {
    const name = validateText(req.body.name, 'Name');
    const email = validateText(req.body.email, 'Email', 200).toLowerCase();
    const department = validateText(req.body.department, 'Department');
    const role = validateText(req.body.role, 'Role');
    const type = validateText(req.body.type, 'Employment type');
    const salary = Number(req.body.salary);
    if (!Number.isFinite(salary) || salary < 0) return res.status(400).json({ error: 'Salary must be a positive number' });
    const result = db.prepare('INSERT INTO employees (name, email, department, role, employment_type, salary, initials, avatar_class) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(name, email, department, role, type, salary, initials(name), 'avatar-indigo');
    const employee = db.prepare('SELECT * FROM employees WHERE id = ?').get(result.lastInsertRowid);
    logAction(req.user.id, 'create', 'employee', employee.id, { name, email });
    res.status(201).json(publicEmployee(employee));
  } catch (error) { res.status(error.code === 'SQLITE_CONSTRAINT_UNIQUE' ? 409 : 400).json({ error: error.code === 'SQLITE_CONSTRAINT_UNIQUE' ? 'An employee with this email already exists' : error.message }); }
});

app.get('/api/attendance', requirePermission('attendance:read'), (req, res) => {
  const date = req.query.date || isoDate(new Date());
  const rows = db.prepare(`SELECT a.*, e.name AS employee_name, e.email, e.initials, e.avatar_class FROM attendance a JOIN employees e ON e.id = a.employee_id WHERE a.attendance_date = ? ORDER BY e.name`).all(date);
  res.json(rows.map(publicAttendance));
});
app.post('/api/attendance/mark', requirePermission('attendance:write'), (req, res) => {
  const employeeId = Number(req.body.employeeId);
  const status = ['Present', 'Late', 'Absent'].includes(req.body.status) ? req.body.status : 'Present';
  if (!Number.isInteger(employeeId)) return res.status(400).json({ error: 'employeeId is required' });
  const employee = db.prepare('SELECT id FROM employees WHERE id = ?').get(employeeId);
  if (!employee) return res.status(404).json({ error: 'Employee not found' });
  const today = isoDate(new Date());
  const values = status === 'Absent' ? [null, null, '0h 00m'] : [req.body.clockIn || 'Now', req.body.clockOut || '—', req.body.hours || '—'];
  db.prepare(`INSERT INTO attendance (employee_id, attendance_date, clock_in, clock_out, hours, status) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(employee_id, attendance_date) DO UPDATE SET clock_in=excluded.clock_in, clock_out=excluded.clock_out, hours=excluded.hours, status=excluded.status`).run(employeeId, today, ...values, status);
  logAction(req.user.id, 'update', 'attendance', employeeId, { status });
  res.json({ ok: true });
});

app.get('/api/leave', requirePermission('leave:read'), (req, res) => {
  const rows = db.prepare(`SELECT l.*, e.name AS employee_name, e.initials, e.avatar_class FROM leave_requests l JOIN employees e ON e.id = l.employee_id ORDER BY CASE l.status WHEN 'Pending' THEN 0 ELSE 1 END, l.created_at DESC`).all();
  res.json(rows.map(publicLeave));
});
app.post('/api/leave', requirePermission('leave:create'), (req, res) => {
  try {
    const employeeId = Number(req.body.employeeId);
    const leaveType = validateText(req.body.leaveType, 'Leave type');
    const start = validateDate(req.body.startDate, 'Start date');
    const end = validateDate(req.body.endDate, 'End date');
    if (!Number.isInteger(employeeId)) throw new Error('Employee is required');
    if (end < start) throw new Error('End date cannot be before start date');
    if (!db.prepare('SELECT id FROM employees WHERE id = ?').get(employeeId)) return res.status(404).json({ error: 'Employee not found' });
    const result = db.prepare('INSERT INTO leave_requests (employee_id, leave_type, start_date, end_date, duration_days, reason, requested_by) VALUES (?, ?, ?, ?, ?, ?, ?)').run(employeeId, leaveType, start, end, durationDays(start, end), String(req.body.reason || '').trim(), req.user.id);
    logAction(req.user.id, 'create', 'leave_request', result.lastInsertRowid, { employeeId });
    const row = db.prepare(`SELECT l.*, e.name AS employee_name, e.initials, e.avatar_class FROM leave_requests l JOIN employees e ON e.id = l.employee_id WHERE l.id = ?`).get(result.lastInsertRowid);
    res.status(201).json(publicLeave(row));
  } catch (error) { res.status(400).json({ error: error.message }); }
});
app.patch('/api/leave/:id/approve', requirePermission('leave:approve'), (req, res) => {
  const id = Number(req.params.id);
  const status = req.body.status === 'Rejected' ? 'Rejected' : 'Approved';
  const result = db.prepare('UPDATE leave_requests SET status = ?, reviewed_by = ? WHERE id = ? AND status = ?').run(status, req.user.id, id, 'Pending');
  if (!result.changes) return res.status(404).json({ error: 'Pending leave request not found' });
  logAction(req.user.id, status === 'Approved' ? 'approve' : 'reject', 'leave_request', id);
  res.json({ ok: true, status });
});

app.get('/api/payroll/current', requirePermission('payroll:read'), (req, res) => {
  const runId = ensurePayrollRun();
  const run = db.prepare('SELECT * FROM payroll_runs WHERE id = ?').get(runId);
  const items = db.prepare(`SELECT p.*, e.name AS employee_name, e.email, e.initials, e.avatar_class FROM payroll_items p JOIN employees e ON e.id = p.employee_id WHERE p.run_id = ? ORDER BY e.name`).all(runId);
  const gross = items.reduce((sum, item) => sum + item.base_salary + item.allowances, 0);
  const deductions = items.reduce((sum, item) => sum + item.deductions, 0);
  res.json({ run: { id: run.id, month: run.month, payDate: run.pay_date, status: run.status }, summary: { gross, deductions, net: gross - deductions }, items: items.map(item => ({ employeeId: item.employee_id, employee: item.employee_name, email: item.email, initials: item.initials, avatar: item.avatar_class, baseSalary: item.base_salary, allowances: item.allowances, deductions: item.deductions, netPay: item.net_pay })) });
});
app.post('/api/payroll/run', requirePermission('payroll:run'), (req, res) => { const runId = ensurePayrollRun(); db.prepare('UPDATE payroll_runs SET status = ? WHERE id = ?').run('Draft', runId); logAction(req.user.id, 'run', 'payroll', runId, { month: monthKey() }); res.json({ ok: true, runId }); });

app.get('/api/reports/summary', requirePermission('reports:read'), (req, res) => {
  const departments = db.prepare('SELECT department, COUNT(*) AS count FROM employees WHERE status = ? GROUP BY department ORDER BY count DESC').all('Active');
  const total = db.prepare('SELECT COUNT(*) AS count FROM employees WHERE status = ?').get('Active').count;
  const present = db.prepare('SELECT COUNT(*) AS count FROM attendance WHERE attendance_date = ? AND status = ?').get(isoDate(new Date()), 'Present').count;
  res.json({ totalEmployees: total, presentToday: present, departments });
});

app.get('/api/settings', requirePermission('settings:read'), (req, res) => { const rows = db.prepare('SELECT key, value FROM settings').all(); res.json(Object.fromEntries(rows.map(row => [row.key, row.value]))); });
app.put('/api/settings', requirePermission('settings:manage'), (req, res) => { const allowed = ['company_name', 'industry', 'currency', 'pay_frequency']; const update = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'); const transaction = db.transaction(() => allowed.forEach(key => { if (req.body[key] !== undefined) update.run(key, String(req.body[key]).slice(0, 160)); })); transaction(); logAction(req.user.id, 'update', 'settings', null, req.body); res.json({ ok: true }); });

app.get('/api/users', requirePermission('users:manage'), (req, res) => { res.json(db.prepare('SELECT id, name, email, role, status, created_at, last_login FROM users ORDER BY name').all().map(user => ({ ...user, permissions: permissionsByRole[user.role] || [] }))); });
app.patch('/api/users/:id/role', requirePermission('users:manage'), (req, res) => {
  const id = Number(req.params.id);
  const role = req.body.role;
  if (!Number.isInteger(id) || !permissionsByRole[role]) return res.status(400).json({ error: 'A valid user and role are required' });
  if (id === req.user.id) return res.status(400).json({ error: 'You cannot change your own role' });
  const user = db.prepare('SELECT id FROM users WHERE id = ?').get(id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, id);
  logAction(req.user.id, 'update_role', 'user', id, { role });
  res.json({ ok: true, role });
});
app.patch('/api/users/:id/status', requirePermission('users:manage'), (req, res) => {
  const id = Number(req.params.id); const status = req.body.status === 'suspended' ? 'suspended' : 'active';
  if (id === req.user.id) return res.status(400).json({ error: 'You cannot suspend your own account' });
  const result = db.prepare('UPDATE users SET status = ? WHERE id = ?').run(status, id);
  if (!result.changes) return res.status(404).json({ error: 'User not found' });
  logAction(req.user.id, 'update_status', 'user', id, { status }); res.json({ ok: true, status });
});

app.use(express.static(__dirname, { extensions: ['html'] }));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.use((error, req, res, next) => { console.error(error); res.status(500).json({ error: 'Internal server error' }); });

const server = app.listen(PORT, () => {
  console.log(`PeoplePilot HR running at http://localhost:${PORT}`);
  console.log(`Database: ${DB_FILE}`);
  console.log(`Admin login: ${process.env.ADMIN_EMAIL || 'admin@northstar.studio'} / ${process.env.ADMIN_PASSWORD || 'Admin@12345'}`);
});
function shutdown() { server.close(() => { db.close(); process.exit(0); }); }
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
