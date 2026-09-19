const API_ROOT = '/api';
const roleLabels = { super_admin: 'Super Admin', hr_admin: 'HR Administrator', manager: 'Manager', employee: 'Employee' };
const roleClasses = { super_admin: 'role-super', hr_admin: 'role-hr', manager: 'role-manager', employee: 'role-employee' };
const avatarClasses = ['avatar-indigo', 'avatar-green', 'avatar-blue', 'avatar-orange', 'avatar-pink', 'avatar-yellow', 'avatar-slate'];
let currentUser = null;
let employees = [];
let leaveRequests = [];
let attendance = {};
let payrollData = { summary: { gross: 0, deductions: 0, net: 0 }, items: [] };
let users = [];
let toastTimer;
let appEventsBound = false;

function money(value) { return '$' + Number(value || 0).toLocaleString('en-US', { maximumFractionDigits: 0 }); }
function initials(name) { return String(name || '').split(' ').map(part => part[0]).slice(0, 2).join('').toUpperCase(); }
function avatarClass(index) { return avatarClasses[index % avatarClasses.length]; }
function escapeHtml(value) { return String(value ?? '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char])); }
function can(permission) { return Boolean(currentUser && (currentUser.permissions || []).includes('*') || currentUser && (currentUser.permissions || []).includes(permission)); }
function formatDate(value) { if (!value) return 'Never'; const date = new Date(value); return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); }
function formatToday() { return new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }); }
function todayKey() { return new Date().toISOString().slice(0, 10); }
function showToast(message, type = 'success') { const toast = document.getElementById('toast'); if (!toast) return; document.getElementById('toastMessage').textContent = message; toast.querySelector('.toast-check').textContent = type === 'error' ? '!' : '✓'; toast.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => toast.classList.remove('show'), 3200); }
function showLogin(errorMessage = '') { document.getElementById('loginScreen').hidden = false; document.getElementById('appShell').hidden = true; const error = document.getElementById('loginError'); error.textContent = errorMessage; error.classList.toggle('show', Boolean(errorMessage)); document.getElementById('loginEmail').focus(); }
function showApp() { document.getElementById('loginScreen').hidden = true; document.getElementById('appShell').hidden = false; }
function openModal(id) { const modal = document.getElementById(id); modal.classList.add('open'); modal.setAttribute('aria-hidden', 'false'); const firstInput = modal.querySelector('input, select'); if (firstInput) setTimeout(() => firstInput.focus(), 40); }
function closeModal(id) { const modal = document.getElementById(id); modal.classList.remove('open'); modal.setAttribute('aria-hidden', 'true'); }

async function api(path, options = {}) {
  const response = await fetch(`${API_ROOT}${path}`, { credentials: 'same-origin', headers: { 'Content-Type': 'application/json', ...(options.headers || {}) }, ...options });
  const contentType = response.headers.get('content-type') || '';
  const data = contentType.includes('application/json') ? await response.json() : await response.text();
  if (!response.ok) { const error = new Error(data?.error || `Request failed (${response.status})`); error.status = response.status; throw error; }
  return data;
}

function employeeCell(employee) {
  return `<div class="employee-cell"><div class="avatar ${employee.avatar || avatarClass((employee.id || employee.name?.length || 0))}">${escapeHtml(employee.initials || initials(employee.name))}</div><div><strong>${escapeHtml(employee.name)}</strong><small>${escapeHtml(employee.email || 'No email added')}</small></div></div>`;
}
function updateUserChrome() {
  const name = currentUser?.name || 'User';
  const label = roleLabels[currentUser?.role] || currentUser?.role || 'User';
  const userInitials = initials(name);
  ['topUserName', 'sidebarUserName'].forEach(id => { const element = document.getElementById(id); if (element) element.textContent = name; });
  const roleElement = document.getElementById('sidebarUserRole'); if (roleElement) roleElement.textContent = label;
  ['topUserAvatar', 'sidebarUserAvatar'].forEach(id => { const element = document.getElementById(id); if (element) element.textContent = userInitials; });
  const usersNav = document.getElementById('usersNavItem'); if (usersNav) usersNav.hidden = !can('users:manage');
  const addEmployeeButtons = ['overviewAddEmployee', 'employeesAddEmployee']; addEmployeeButtons.forEach(id => { const element = document.getElementById(id); if (element) element.hidden = !can('employees:create'); });
  const leaveButtons = ['overviewRequestLeave', 'leaveRequestBtn']; leaveButtons.forEach(id => { const element = document.getElementById(id); if (element) element.hidden = !can('leave:create'); });
  const markAll = document.getElementById('markAllPresent'); if (markAll) markAll.hidden = !can('attendance:write');
}

function renderEmployeeTable(query = '') {
  const body = document.getElementById('employeeTableBody'); if (!body) return;
  const normalized = query.trim().toLowerCase();
  const filtered = employees.filter(employee => [employee.name, employee.role, employee.department, employee.email].join(' ').toLowerCase().includes(normalized));
  document.getElementById('employeeCountLabel').textContent = `${filtered.length} employee${filtered.length === 1 ? '' : 's'}`;
  body.innerHTML = filtered.length ? filtered.map(employee => `<tr><td>${employeeCell(employee)}</td><td>${escapeHtml(employee.department)}</td><td>${escapeHtml(employee.role)}</td><td>${escapeHtml(employee.type)}</td><td><span class="status status-approved">${escapeHtml(employee.status || 'Active')}</span></td><td><button class="table-action" title="More actions">•••</button></td></tr>`).join('') : '<tr><td colspan="6" class="empty-row">No employees match your search.</td></tr>';
}
function employeeById(id) { return employees.find(employee => Number(employee.id) === Number(id)); }
function employeeByName(name) { return employees.find(employee => employee.name === name) || {}; }
function renderLeaveLists() {
  const pending = leaveRequests.filter(request => request.status === 'Pending');
  const overview = document.getElementById('overviewLeaveList');
  if (overview) overview.innerHTML = pending.slice(0, 3).map(request => `<div class="leave-item"><div class="avatar ${request.avatarClass || 'avatar-indigo'}">${escapeHtml(request.avatar || initials(request.employee))}</div><div class="leave-copy"><strong>${escapeHtml(request.employee)}</strong><span>${escapeHtml(request.type)} · ${escapeHtml(request.dates)}</span></div><span class="leave-days">${escapeHtml(request.duration)}</span></div>`).join('') || '<p class="muted empty-row">No pending requests.</p>';
  const body = document.getElementById('leaveTableBody');
  if (!body) return;
  body.innerHTML = leaveRequests.map(request => `<tr><td>${employeeCell({ name: request.employee, email: employeeByName(request.employee).email || 'Workspace employee', initials: request.avatar || initials(request.employee), avatar: request.avatarClass || 'avatar-indigo' })}</td><td>${escapeHtml(request.type)}</td><td>${escapeHtml(request.dates)}</td><td>${escapeHtml(request.duration)}</td><td>${escapeHtml(request.reason || '—')}</td><td><span class="status status-${request.status.toLowerCase()}">${escapeHtml(request.status)}</span></td><td>${request.status === 'Pending' && can('leave:approve') ? `<button class="text-btn approve-leave" data-id="${request.id}">Approve</button>` : '<span class="muted">—</span>'}</td></tr>`).join('') || '<tr><td colspan="7" class="empty-row">No leave requests found.</td></tr>';
  body.querySelectorAll('.approve-leave').forEach(button => button.addEventListener('click', async () => { try { await api(`/leave/${button.dataset.id}/approve`, { method: 'PATCH', body: JSON.stringify({ status: 'Approved' }) }); await loadWorkspace(); showToast('Leave request approved'); } catch (error) { showToast(error.message, 'error'); } }));
  const balance = document.getElementById('pendingLeaveBalance'); if (balance) balance.innerHTML = `${pending.length} <small>requests</small>`;
}
function renderAttendance() {
  const body = document.getElementById('attendanceTableBody'); if (!body) return;
  body.innerHTML = employees.map(employee => { const record = attendance[employee.id] || { status: 'Absent', clockIn: '—', clockOut: '—', hours: '0h 00m' }; const statusClass = String(record.status).toLowerCase(); const action = record.status === 'Absent' && can('attendance:write') ? `<button class="text-btn check-in" data-id="${employee.id}">Check in</button>` : '<span class="muted">Updated</span>'; return `<tr><td>${employeeCell(employee)}</td><td>${escapeHtml(record.clockIn)}</td><td>${escapeHtml(record.clockOut)}</td><td>${escapeHtml(record.hours)}</td><td><span class="status status-${statusClass}">${escapeHtml(record.status)}</span></td><td>${action}</td></tr>`; }).join('') || '<tr><td colspan="6" class="empty-row">No attendance records found.</td></tr>';
  body.querySelectorAll('.check-in').forEach(button => button.addEventListener('click', () => markAttendance(button.dataset.id)));
}
function renderPayroll() {
  const body = document.getElementById('payrollTableBody'); if (!body) return;
  const items = payrollData.items || [];
  body.innerHTML = items.map(item => `<tr><td>${employeeCell({ name: item.employee, email: item.email, initials: item.initials, avatar: item.avatar })}</td><td>${money(item.baseSalary)}</td><td>${money(item.allowances)}</td><td>${money(item.deductions)}</td><td><strong>${money(item.netPay)}</strong></td><td><span class="status status-draft">${escapeHtml(payrollData.run?.status || 'Draft')}</span></td></tr>`).join('') || '<tr><td colspan="6" class="empty-row">Payroll data is not available for this account.</td></tr>';
  const summary = payrollData.summary || {}; const gross = document.getElementById('payrollGross'); const deductions = document.getElementById('payrollDeductions'); const net = document.getElementById('payrollNet'); if (gross) gross.textContent = money(summary.gross); if (deductions) deductions.textContent = money(summary.deductions); if (net) net.textContent = money(summary.net); const total = document.getElementById('payrollTotal'); if (total) total.textContent = money(summary.gross);
}
function isTodayInRange(request) { const date = todayKey(); return request.startDate <= date && request.endDate >= date; }
function updateDashboardMetrics() {
  const total = employees.length;
  const present = Object.values(attendance).filter(record => record.status === 'Present').length;
  const late = Object.values(attendance).filter(record => record.status === 'Late').length;
  const absent = Math.max(0, total - present - late);
  const onLeave = leaveRequests.filter(request => request.status === 'Approved' && isTodayInRange(request)).length;
  const values = { totalEmployees: total, presentEmployees: present, leaveEmployees: onLeave, legendPresent: present, legendAbsent: absent, attendancePresentSummary: present };
  Object.entries(values).forEach(([id, value]) => { const element = document.getElementById(id); if (element) element.textContent = value; });
  const percent = document.getElementById('attendancePercent'); if (percent) percent.textContent = `${Math.round((present / Math.max(total, 1)) * 100)}%`;
  const payrollTotal = document.getElementById('payrollTotal'); if (payrollTotal) payrollTotal.textContent = money(payrollData.summary?.gross);
  const navCount = document.querySelector('.nav-item[data-view="employees"] .nav-count'); if (navCount) navCount.textContent = total;
}
function populateLeaveEmployeeSelect() { const select = document.getElementById('leaveEmployeeSelect'); if (select) select.innerHTML = employees.map(employee => `<option value="${employee.id}">${escapeHtml(employee.name)}</option>`).join(''); }
function fillSettings(settings) { const map = { company_name: 'companyName', industry: 'companyIndustry', currency: 'companyCurrency', pay_frequency: 'payFrequency' }; Object.entries(map).forEach(([key, id]) => { const element = document.getElementById(id); if (element && settings[key] !== undefined) element.value = settings[key]; }); }

async function loadWorkspace() {
  const results = await Promise.allSettled([api('/employees'), api('/leave'), api('/attendance'), api('/payroll/current'), api('/settings')]);
  const [employeesResult, leaveResult, attendanceResult, payrollResult, settingsResult] = results;
  employees = employeesResult.status === 'fulfilled' ? employeesResult.value : [];
  leaveRequests = leaveResult.status === 'fulfilled' ? leaveResult.value : [];
  attendance = {};
  if (attendanceResult.status === 'fulfilled') attendanceResult.value.forEach(record => { attendance[record.employeeId] = record; });
  payrollData = payrollResult.status === 'fulfilled' ? payrollResult.value : { summary: {}, items: [] };
  if (settingsResult.status === 'fulfilled') fillSettings(settingsResult.value);
  renderEmployeeTable(document.getElementById('employeeSearch')?.value || ''); renderLeaveLists(); renderAttendance(); renderPayroll(); populateLeaveEmployeeSelect(); updateDashboardMetrics();
  if (can('users:manage')) await loadUsers();
}
async function loadUsers() { try { users = await api('/users'); renderUsers(); } catch (error) { if (error.status !== 403) showToast(error.message, 'error'); } }

function renderUsers() {
  const body = document.getElementById('usersTableBody'); if (!body) return;
  const label = document.getElementById('usersCountLabel'); if (label) label.textContent = `${users.length} user${users.length === 1 ? '' : 's'}`;
  const roleOptions = Object.entries(roleLabels).map(([value, label]) => `<option value="${value}">${label}</option>`).join('');
  body.innerHTML = users.map(user => `<tr><td>${employeeCell({ name: user.name, email: user.email, initials: initials(user.name), avatar: avatarClass(user.id) })}</td><td><select class="role-select" data-user-role="${user.id}" ${user.id === currentUser.id ? 'disabled' : ''}>${roleOptions}</select></td><td><span class="status ${user.status === 'active' ? 'user-status-active' : 'user-status-suspended'}">${escapeHtml(user.status)}</span></td><td>${escapeHtml(formatDate(user.last_login))}</td><td>${user.id === currentUser.id ? '<span class="muted">Your account</span>' : `<button class="suspend-btn" data-user-status="${user.id}" data-status="${user.status === 'active' ? 'suspended' : 'active'}">${user.status === 'active' ? 'Suspend' : 'Activate'}</button>`}</td></tr>`).join('') || '<tr><td colspan="5" class="empty-row">No users found.</td></tr>';
  body.querySelectorAll('[data-user-role]').forEach(select => { select.value = users.find(user => String(user.id) === String(select.dataset.userRole))?.role || 'employee'; select.addEventListener('change', async () => { try { await api(`/users/${select.dataset.userRole}/role`, { method: 'PATCH', body: JSON.stringify({ role: select.value }) }); await loadUsers(); showToast('User role updated'); } catch (error) { showToast(error.message, 'error'); await loadUsers(); } }); });
  body.querySelectorAll('[data-user-status]').forEach(button => button.addEventListener('click', async () => { try { await api(`/users/${button.dataset.userStatus}/status`, { method: 'PATCH', body: JSON.stringify({ status: button.dataset.status }) }); await loadUsers(); showToast(button.dataset.status === 'active' ? 'User access restored' : 'User suspended'); } catch (error) { showToast(error.message, 'error'); } }));
}

async function markAttendance(employeeId) { try { await api('/attendance/mark', { method: 'POST', body: JSON.stringify({ employeeId: Number(employeeId), status: 'Present', clockIn: 'Now', clockOut: '—', hours: '—' }) }); await loadWorkspace(); const employee = employeeById(employeeId); showToast(`${employee?.name || 'Employee'} marked present`); } catch (error) { showToast(error.message, 'error'); } }
function setView(view) { const target = document.getElementById(`view-${view}`); if (!target || (view === 'users' && !can('users:manage'))) return; document.querySelectorAll('.view').forEach(section => section.classList.toggle('active', section.id === `view-${view}`)); document.querySelectorAll('.nav-item').forEach(item => item.classList.toggle('active', item.dataset.view === view)); const label = view === 'users' ? 'Users & permissions' : view.charAt(0).toUpperCase() + view.slice(1); document.getElementById('breadcrumbCurrent').textContent = label; document.title = `PeoplePilot HR — ${label}`; window.scrollTo({ top: 0, behavior: 'smooth' }); document.getElementById('sidebar').classList.remove('open'); }

function bindAppEvents() {
  if (appEventsBound) return;
  appEventsBound = true;
  document.querySelectorAll('.nav-item').forEach(button => button.addEventListener('click', () => setView(button.dataset.view)));
  document.querySelectorAll('[data-view-target]').forEach(button => button.addEventListener('click', () => setView(button.dataset.viewTarget)));
  document.getElementById('employeeSearch').addEventListener('input', event => renderEmployeeTable(event.target.value));
  document.getElementById('openSidebar').addEventListener('click', () => document.getElementById('sidebar').classList.add('open'));
  document.getElementById('closeSidebar').addEventListener('click', () => document.getElementById('sidebar').classList.remove('open'));
  document.getElementById('logoutBtn').addEventListener('click', logout);
  document.getElementById('sidebarLogoutBtn').addEventListener('click', logout);
  ['overviewAddEmployee', 'employeesAddEmployee'].forEach(id => document.getElementById(id).addEventListener('click', () => openModal('employeeModal')));
  ['overviewRequestLeave', 'leaveRequestBtn'].forEach(id => document.getElementById(id).addEventListener('click', () => openModal('leaveModal')));
  document.getElementById('refreshUsers').addEventListener('click', async () => { await loadUsers(); showToast('User list refreshed'); });
  document.querySelectorAll('[data-close-modal]').forEach(button => button.addEventListener('click', () => closeModal(button.dataset.closeModal)));
  document.querySelectorAll('.modal-backdrop').forEach(backdrop => backdrop.addEventListener('click', event => { if (event.target === backdrop) closeModal(backdrop.id); }));
  document.addEventListener('keydown', event => { if (event.key === 'Escape') document.querySelectorAll('.modal-backdrop.open').forEach(modal => closeModal(modal.id)); });

  document.getElementById('employeeForm').addEventListener('submit', async event => {
    event.preventDefault(); const data = new FormData(event.target); const button = event.target.querySelector('button[type="submit"]'); button.disabled = true;
    try { await api('/employees', { method: 'POST', body: JSON.stringify({ name: data.get('name').trim(), email: data.get('email').trim(), department: data.get('department'), role: data.get('role').trim(), type: data.get('type'), salary: Number(data.get('salary')) }) }); event.target.reset(); closeModal('employeeModal'); await loadWorkspace(); setView('employees'); showToast('Employee added to your team'); } catch (error) { showToast(error.message, 'error'); } finally { button.disabled = false; }
  });
  document.getElementById('leaveForm').addEventListener('submit', async event => {
    event.preventDefault(); const data = new FormData(event.target); const button = event.target.querySelector('button[type="submit"]'); button.disabled = true;
    try { await api('/leave', { method: 'POST', body: JSON.stringify({ employeeId: Number(data.get('employee')), leaveType: data.get('leaveType'), startDate: data.get('start'), endDate: data.get('end'), reason: data.get('reason') }) }); event.target.reset(); closeModal('leaveModal'); await loadWorkspace(); setView('leave'); showToast('Leave request submitted for review'); } catch (error) { showToast(error.message, 'error'); } finally { button.disabled = false; }
  });
  document.getElementById('runPayrollBtn').addEventListener('click', async () => { try { await api('/payroll/run', { method: 'POST', body: '{}' }); await loadWorkspace(); showToast('Payroll draft is ready for review'); } catch (error) { showToast(error.message, 'error'); } });
  document.getElementById('reviewPayrollBtn').addEventListener('click', () => setView('payroll'));
  document.getElementById('markAllPresent').addEventListener('click', async () => { const button = document.getElementById('markAllPresent'); button.disabled = true; try { await Promise.all(employees.map(employee => api('/attendance/mark', { method: 'POST', body: JSON.stringify({ employeeId: employee.id, status: 'Present', clockIn: '08:55 AM', clockOut: '—', hours: '—' }) }))); await loadWorkspace(); showToast('All employees marked present'); } catch (error) { showToast(error.message, 'error'); } finally { button.disabled = false; } });
  document.getElementById('saveSettings').addEventListener('click', async () => { try { await api('/settings', { method: 'PUT', body: JSON.stringify({ company_name: document.getElementById('companyName').value, industry: document.getElementById('companyIndustry').value, currency: document.getElementById('companyCurrency').value, pay_frequency: document.getElementById('payFrequency').value }) }); showToast('Workspace settings saved'); } catch (error) { showToast(error.message, 'error'); } });
}

async function login(event) {
  event.preventDefault(); const form = event.target; const button = document.getElementById('loginSubmit'); const error = document.getElementById('loginError'); button.disabled = true; button.innerHTML = 'Signing in…'; error.classList.remove('show');
  try { const data = await api('/auth/login', { method: 'POST', body: JSON.stringify({ email: form.email.value, password: form.password.value }) }); currentUser = data.user; showApp(); updateUserChrome(); bindAppEvents(); await loadWorkspace(); showToast(`Welcome back, ${currentUser.name.split(' ')[0]}`); } catch (requestError) { error.textContent = requestError.message === 'Failed to fetch' ? 'The server is not running. Start it with: pnpm start' : requestError.message; error.classList.add('show'); } finally { button.disabled = false; button.innerHTML = 'Sign in <span>→</span>'; }
}
async function logout() { try { await api('/auth/logout', { method: 'POST', body: '{}' }); } catch (error) { /* session may already be expired */ } currentUser = null; showLogin('You have been signed out.'); }
async function boot() {
  document.getElementById('currentDate').textContent = formatToday();
  document.getElementById('loginForm').addEventListener('submit', login);
  document.getElementById('togglePassword').addEventListener('click', event => { const input = document.getElementById('loginPassword'); input.type = input.type === 'password' ? 'text' : 'password'; event.target.textContent = input.type === 'password' ? 'Show' : 'Hide'; });
  document.getElementById('forgotPassword').addEventListener('click', event => { event.preventDefault(); document.getElementById('loginError').textContent = 'Please contact your HR administrator to reset your password.'; document.getElementById('loginError').classList.add('show'); });
  try { const data = await api('/auth/me'); currentUser = data.user; showApp(); updateUserChrome(); bindAppEvents(); await loadWorkspace(); } catch (error) { showLogin(); }
}

document.addEventListener('DOMContentLoaded', boot);
