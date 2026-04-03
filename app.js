// ── STATE ────────────────────────────────────────────────
let currentUser      = null;
let authToken        = null;
let editingProductId = null;
let deleteTargetId   = null;
let imgDataUrl       = '';
let apptFilter       = 'all';
let storeCatFilter   = 'all';
let stockFilter      = 'all';

// Payment state
let pendingPayment = null;   // { type: 'appointment'|'product', data, amount, description, referenceId }
let paymentPollInterval = null;

// ── TOAST ────────────────────────────────────────────────
function toast(msg, type = 'ok') {
  const icons = { ok: '✓', err: '✕', inf: 'ℹ' };
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.innerHTML = `<span>${icons[type] || '•'}</span>${msg}`;
  document.getElementById('toast-wrap').appendChild(el);
  requestAnimationFrame(() => el.classList.add('show'));
  setTimeout(() => { el.classList.remove('show'); setTimeout(() => el.remove(), 350); }, 3500);
}

// ── API CORE ─────────────────────────────────────────────
async function api(path, method = 'GET', body = null, isFormData = false) {
  const headers = {};
  if (!isFormData) headers['Content-Type'] = 'application/json';
  if (authToken)   headers['Authorization'] = `Bearer ${authToken}`;

  const opts = { method, headers };
  if (body) opts.body = isFormData ? body : JSON.stringify(body);

  const res  = await fetch(`${API_BASE}${path}`, opts);
  if (res.status === 204) return null;

  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { message: text }; }

  if (!res.ok) {
    const msg = json?.message || json?.title || JSON.stringify(json?.errors) || `Error ${res.status}`;
    throw new Error(msg);
  }
  return json;
}

const apiGet    = (path)       => api(path, 'GET');
const apiPost   = (path, body) => api(path, 'POST',  body);
const apiPut    = (path, body) => api(path, 'PUT',   body);
const apiPatch  = (path, body) => api(path, 'PATCH', body);
const apiDelete = (path)       => api(path, 'DELETE');

// ── LOADING SPINNER ───────────────────────────────────────
function setLoading(btnId, loading, label = '') {
  const btn = document.getElementById(btnId);
  if (!btn) return;
  btn.disabled = loading;
  if (loading) {
    btn.dataset.origText = btn.textContent;
    btn.textContent = 'Loading…';
  } else {
    btn.textContent = label || btn.dataset.origText || 'Submit';
  }
}

// ── NAVIGATION ────────────────────────────────────────────
function show(id) {
  document.querySelectorAll('.page').forEach(p => p.style.display = 'none');
  const page = document.getElementById(id);
  if (page) { page.style.display = 'flex'; page.classList.add('active'); }
}

function goBack()         { show('pg-splash'); }
function selectRole(role) { show(role === 'employee' ? 'pg-emp-login' : 'pg-cust-login'); }
function showCustWelcome(){ show('pg-cust-welcome'); }

function logout() {
  currentUser = null;
  authToken   = null;
  localStorage.removeItem('authToken');
  localStorage.removeItem('currentUser');
  localStorage.removeItem('userRole');
  show('pg-splash');
  toast('Logged out.', 'inf');
}

// ── SIDEBAR (mobile) ──────────────────────────────────────
function toggleSidebar() {
  const sb = document.getElementById('sidebar');
  const ov = document.getElementById('sb-overlay');
  const open = sb?.classList.toggle('open');
  ov?.classList.toggle('on', open);
}
function closeSidebar() {
  document.getElementById('sidebar')?.classList.remove('open');
  document.getElementById('sb-overlay')?.classList.remove('on');
}

// ── UTIL ──────────────────────────────────────────────────
const $     = id  => document.getElementById(id);
const val   = id  => ($( id)?.value  || '').trim();
const cr    = id  => val(`cr-${id}`);
const ci    = id  => val(`ci-${id}`);
const er    = id  => val(`er-${id}`);
const ca    = id  => val(`ca-${id}`);
const ea    = id  => val(`ea-${id}`);

const peso  = n   => '₱' + Number(n).toLocaleString('en-PH', { minimumFractionDigits: 2 });
const fmtD  = iso => iso ? new Date(iso).toLocaleDateString('en-PH',  { month:'short', day:'numeric', year:'numeric' }) : '—';
const fmtDT = iso => iso ? new Date(iso).toLocaleString('en-PH',     { month:'short', day:'numeric', hour:'2-digit', minute:'2-digit' }) : '—';
const av    = u   => ((u?.firstName || '?')[0] + (u?.lastName || '?')[0]).toUpperCase();

function statusBadge(s) {
  const map = { Pending:'badge-amber', Confirmed:'badge-sage', Done:'badge-green', Cancelled:'badge-red' };
  return `<span class="badge ${map[s] || 'badge-sage'}">${s}</span>`;
}
function stockLabel(n) {
  if (n === 0)  return '<span class="badge badge-red">Out of Stock</span>';
  if (n <= 5)   return '<span class="badge badge-amber">Low Stock</span>';
  return '<span class="badge badge-green">In Stock</span>';
}
function stockBar(stock, max = 30) {
  const pct = Math.min(100, (stock / max) * 100);
  const col = stock === 0 ? 'var(--red)' : stock <= 5 ? 'var(--amber)' : 'var(--green)';
  return `<div class="stock-bar"><div class="stock-fill" style="width:${pct}%;background:${col}"></div></div>`;
}

// ═══════════════════════════════════════════════════════════
//  PAYMENT MODAL
// ═══════════════════════════════════════════════════════════

/**
 * Opens the payment modal.
 * @param {object} opts - { amount, description, referenceId, onSuccess }
 */
function openPaymentModal(opts) {
  pendingPayment = opts;

  // Set amount (editable)
  const amountInput = $('pay-amount');
  if (amountInput) amountInput.value = opts.amount || 300;

  $('pay-description').textContent = opts.description || 'Meowly Payment';
  $('pay-qr-area').style.display   = 'none';
  $('pay-link-area').style.display = 'none';
  $('pay-success-area').style.display = 'none';
  $('pay-actions').style.display   = 'flex';
  $('modal-payment')?.classList.add('on');
}

function closePaymentModal() {
  $('modal-payment')?.classList.remove('on');
  stopPaymentPolling();
  pendingPayment = null;
}

async function payViaQR() {
  const amount = parseFloat($('pay-amount')?.value);
  if (!amount || amount <= 0) { toast('Enter a valid amount.', 'err'); return; }

  setLoading('btn-pay-qr', true);
  try {
    const res = await apiPost('/payments/link', {
      amount,
      description : pendingPayment?.description || 'Meowly Payment',
      referenceId : pendingPayment?.referenceId || '',
    });

    // Show QR code
    $('pay-qr-area').style.display   = 'block';
    $('pay-actions').style.display   = 'none';

    // Render QR image or raw string
    const qrArea = $('pay-qr-image');
    if (res.qrCode) {
      // Use a QR rendering library or display as text fallback
      qrArea.innerHTML = `
        <div style="text-align:center;padding:1rem;">
          <img src="https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(res.qrCode)}"
               alt="QR Code" style="width:200px;height:200px;border-radius:8px;"/>
          <p style="font-size:.8rem;color:var(--muted);margin-top:.5rem">Scan with GCash, Maya, or any bank app</p>
          <p style="font-size:.75rem;color:var(--muted)">Amount: ${peso(amount)}</p>
        </div>`;
      // Start polling for payment confirmation
      startPaymentPolling(res.sourceId);
    } else {
      qrArea.innerHTML = `<p style="color:var(--red)">Could not generate QR. Try payment link instead.</p>`;
    }
  } catch (e) {
    toast('Failed to create QR: ' + e.message, 'err');
  } finally {
    setLoading('btn-pay-qr', false, '📱 Pay via QR');
  }
}

async function payViaLink() {
  const amount = parseFloat($('pay-amount')?.value);
  if (!amount || amount <= 0) { toast('Enter a valid amount.', 'err'); return; }

  setLoading('btn-pay-link', true);
  try {
    const res = await apiPost('/payments/link', {
      amount,
      description : pendingPayment?.description || 'Meowly Payment',
      referenceId : pendingPayment?.referenceId || '',
    });

    $('pay-link-area').style.display = 'block';
    $('pay-actions').style.display   = 'none';

    $('pay-link-btn').href = res.checkoutUrl;
    $('pay-link-ref').textContent = res.referenceId || res.sourceId;

    // Open checkout in new tab automatically
    window.open(res.checkoutUrl, '_blank');

    toast('Payment link opened! Complete payment in the new tab.', 'inf');
  } catch (e) {
    toast('Failed to create payment link: ' + e.message, 'err');
  } finally {
    setLoading('btn-pay-link', false, '🔗 Pay via Link');
  }
}

function startPaymentPolling(sourceId) {
  stopPaymentPolling();
  let attempts = 0;
  const maxAttempts = 60; // poll for up to 5 minutes

  paymentPollInterval = setInterval(async () => {
    attempts++;
    if (attempts > maxAttempts) {
      stopPaymentPolling();
      toast('Payment timed out. Please try again.', 'err');
      return;
    }

    try {
      const res = await apiGet(`/payments/status/${sourceId}`);
      if (res.status === 'chargeable' || res.status === 'paid') {
        stopPaymentPolling();
        onPaymentSuccess();
      }
    } catch (e) {
      // Silent fail — keep polling
    }
  }, 5000); // poll every 5 seconds
}

function stopPaymentPolling() {
  if (paymentPollInterval) {
    clearInterval(paymentPollInterval);
    paymentPollInterval = null;
  }
}

function onPaymentSuccess() {
  $('pay-qr-area').style.display     = 'none';
  $('pay-link-area').style.display   = 'none';
  $('pay-success-area').style.display = 'block';

  toast('Payment confirmed! 🎉');

  // Call the onSuccess callback if provided
  if (pendingPayment?.onSuccess) {
    setTimeout(() => {
      pendingPayment.onSuccess();
      closePaymentModal();
    }, 2000);
  }
}

// Called when user manually confirms payment (for link payments)
function confirmPaymentManually() {
  onPaymentSuccess();
}

// ═══════════════════════════════════════════════════════════
//  CUSTOMER AUTH
// ═══════════════════════════════════════════════════════════

async function custSignUp() {
  const data = {
    firstName : cr('fn'),
    lastName  : cr('ln'),
    email     : cr('email'),
    password  : cr('pass'),
    gender    : cr('gen'),
    dob       : cr('dob'),
  };

  if (!data.firstName || !data.lastName || !data.email || !data.password || !data.gender || !data.dob) {
    toast('Please fill in all fields.', 'err'); return;
  }
  if (data.password.length < 6) { toast('Password must be 6+ characters.', 'err'); return; }

  setLoading('btn-cust-signup', true);
  try {
    await apiPost('/customers/register', data);
    toast('Account created! Please sign in.');
    show('pg-cust-login');
  } catch (e) {
    toast(e.message, 'err');
  } finally {
    setLoading('btn-cust-signup', false, 'Create Account');
  }
}

async function custLogin() {
  const email    = ci('email');
  const password = ci('pass');
  const terms    = $('ci-terms')?.checked;

  if (!email || !password)  { toast('Fill in all fields.', 'err'); return; }
  if (!terms)               { toast('Please agree to terms.', 'err'); return; }

  setLoading('btn-cust-login', true);
  try {
    const res   = await apiPost('/customers/login', { email, password });
    authToken   = res.token || res.accessToken || null;
    currentUser = res.customer || res.user || res;
    localStorage.setItem('authToken',   authToken);
    localStorage.setItem('currentUser', JSON.stringify(currentUser));
    localStorage.setItem('userRole',    'customer');

    $('cw-name').textContent = `Welcome, ${currentUser.firstName}!`;
    show('pg-cust-welcome');
    toast(`Welcome back, ${currentUser.firstName}!`);
  } catch (e) {
    toast(e.message || 'Login failed.', 'err');
  } finally {
    setLoading('btn-cust-login', false, 'Sign In');
  }
}

function custSelectSvc(svc) {
  if (svc === 'store') loadCustStore();
  else                 loadCustAppt();
}

// ═══════════════════════════════════════════════════════════
//  EMPLOYEE AUTH
// ═══════════════════════════════════════════════════════════

async function empSignUp() {
  const data = {
    firstName : er('fn'),
    lastName  : er('ln'),
    email     : er('email'),
    password  : er('pass'),
    gender    : er('gen'),
    dob       : er('dob'),
  };

  if (!data.firstName || !data.lastName || !data.email || !data.password || !data.gender || !data.dob) {
    toast('Please fill in all fields.', 'err'); return;
  }
  if (data.password.length < 6) { toast('Password must be 6+ characters.', 'err'); return; }

  setLoading('btn-emp-signup', true);
  try {
    const res = await apiPost('/employees/register', data);
    $('modal-id-val').textContent = res.employeeId || res.EmployeeId || '—';
    $('modal-empid').classList.add('on');
    toast('Account created! Check your Employee ID.');
  } catch (e) {
    toast(e.message, 'err');
  } finally {
    setLoading('btn-emp-signup', false, 'Create Account');
  }
}

async function empLogin() {
  const employeeId = $('ei-id')?.value.trim();
  const password   = $('ei-pass')?.value;
  const terms      = $('ei-terms')?.checked;

  if (!employeeId || !password) { toast('Fill in all fields.', 'err'); return; }
  if (!terms)                   { toast('Please agree to terms.', 'err'); return; }

  setLoading('btn-emp-login', true);
  try {
    const res   = await apiPost('/employees/login', { employeeId, password });
    authToken   = res.token || res.accessToken || null;
    currentUser = res.employee || res.user || res;
    localStorage.setItem('authToken',   authToken);
    localStorage.setItem('currentUser', JSON.stringify(currentUser));
    localStorage.setItem('userRole',    'employee');

    $('sb-name').textContent  = `${currentUser.firstName} ${currentUser.lastName}`;
    $('sb-empid').textContent = currentUser.employeeId || employeeId;
    const av_el = $('sb-avatar');
    if (av_el) av_el.textContent = av(currentUser);

    show('pg-emp-dash');
    navTo('overview');
    toast(`Welcome back, ${currentUser.firstName}!`);
  } catch (e) {
    toast(e.message || 'Login failed.', 'err');
  } finally {
    setLoading('btn-emp-login', false, 'Sign In');
  }
}

function closeEmpModal() {
  $('modal-empid')?.classList.remove('on');
  show('pg-emp-login');
}

// ═══════════════════════════════════════════════════════════
//  EMPLOYEE DASHBOARD — SIDEBAR NAV
// ═══════════════════════════════════════════════════════════
function navTo(sec) {
  closeSidebar();
  document.querySelectorAll('.nav-item').forEach(el => el.classList.toggle('active', el.dataset.nav === sec));
  document.querySelectorAll('.dash-sec').forEach(el => el.style.display = el.id === `sec-${sec}` ? 'block' : 'none');

  const titles = {
    overview    : 'Overview',
    appointments: 'Appointments',
    customers   : 'Customers',
    employees   : 'Employees',
    store       : 'Pet Store',
    stock       : 'Stock Management',
  };
  const el = $('tb-title');
  if (el) el.textContent = titles[sec] || sec;

  if (sec === 'overview')     loadOverview();
  if (sec === 'appointments') loadAppointments();
  if (sec === 'customers')    loadCustomers();
  if (sec === 'employees')    loadEmployees();
  if (sec === 'store')        loadStore();
  if (sec === 'stock')        loadStock();
}

// ═══════════════════════════════════════════════════════════
//  OVERVIEW
// ═══════════════════════════════════════════════════════════
async function loadOverview() {
  try {
    const [bookings, customers, products] = await Promise.all([
      apiGet('/appointments'),
      apiGet('/customers'),
      apiGet('/products'),
    ]);

    const bkArr  = Array.isArray(bookings)  ? bookings  : bookings?.data  || [];
    const cuArr  = Array.isArray(customers) ? customers : customers?.data || [];
    const prArr  = Array.isArray(products)  ? products  : products?.data  || [];

    const pending  = bkArr.filter(b => b.status === 'Pending');
    const today    = bkArr.filter(b => new Date(b.dateTime).toDateString() === new Date().toDateString());
    const lowStock = prArr.filter(p => p.stock <= 5);

    setText('ov-bk', bkArr.length);
    setText('ov-pd', pending.length);
    setText('ov-cu', cuArr.length);
    setText('ov-td', today.length);

    const recent = bkArr.slice(0, 6);
    setHTML('ov-recent', recent.length
      ? recent.map(b => `<tr>
          <td><strong>${b.id || b.bookingId || '—'}</strong></td>
          <td>${b.ownerName || b.owner || '—'}</td>
          <td>${b.petName || b.pet || '—'} <span style="color:var(--muted);font-size:.74rem">(${b.petType || b.type || '—'})</span></td>
          <td>${b.service || '—'}</td>
          <td>${statusBadge(b.status)}</td>
        </tr>`).join('')
      : '<tr><td colspan="5" style="text-align:center;color:var(--muted);padding:2rem">No bookings yet.</td></tr>');

    const upcoming = bkArr
      .filter(b => b.status !== 'Cancelled' && new Date(b.dateTime) >= new Date())
      .sort((a, b) => new Date(a.dateTime) - new Date(b.dateTime))
      .slice(0, 5);
    const cols = ['var(--sage)', 'var(--terra)', 'var(--amber)', 'var(--green)', 'var(--sage-l)'];
    setHTML('ov-upcoming', upcoming.length
      ? upcoming.map((b, i) => `<li>
          <div class="ml-l"><div class="ml-dot" style="background:${cols[i % 5]}"></div>
            <div><div class="ml-name">${b.petName || b.pet || '—'}</div>
            <div class="ml-sub">${b.service || '—'} · ${b.ownerName || b.owner || '—'}</div></div>
          </div>
          <div class="ml-time">${fmtDT(b.dateTime)}</div>
        </li>`).join('')
      : '<li style="color:var(--muted);font-size:.84rem;padding:.8rem 0">No upcoming appointments.</li>');

    setHTML('ov-lowstock', lowStock.length
      ? lowStock.map(p => `<li>
          <div class="ml-l"><span style="font-size:1.1rem">${p.icon || '📦'}</span>
            <div><div class="ml-name">${p.name}</div><div class="ml-sub">Stock: ${p.stock}</div></div>
          </div>${stockLabel(p.stock)}
        </li>`).join('')
      : '<li style="color:var(--muted);font-size:.84rem;padding:.8rem 0">All products well-stocked ✓</li>');

    const badge = $('nb-appt');
    if (badge) { badge.textContent = pending.length; badge.style.display = pending.length ? 'inline' : 'none'; }

  } catch (e) {
    toast('Failed to load overview: ' + e.message, 'err');
  }
}

function setText(id, val) { const el=$(id); if(el) el.textContent = val; }
function setHTML(id, html) { const el=$(id); if(el) el.innerHTML  = html; }

// ═══════════════════════════════════════════════════════════
//  APPOINTMENTS
// ═══════════════════════════════════════════════════════════
async function loadAppointments(filter) {
  if (filter !== undefined) apptFilter = filter;
  document.querySelectorAll('#sec-appointments .pill-tab').forEach(t =>
    t.classList.toggle('active', t.dataset.f === apptFilter));

  setHTML('appt-tbody', '<tr><td colspan="8" style="text-align:center;color:var(--muted);padding:2rem">Loading…</td></tr>');
  try {
    let bks = await apiGet('/appointments');
    bks = Array.isArray(bks) ? bks : bks?.data || [];

    if (apptFilter === 'grooming') bks = bks.filter(b => (b.service || '').toLowerCase().includes('grooming'));
    if (apptFilter === 'clinic')   bks = bks.filter(b => (b.service || '').toLowerCase().includes('clinic'));
    if (apptFilter === 'pending')  bks = bks.filter(b => b.status === 'Pending');

    setText('appt-count', `${bks.length} record${bks.length !== 1 ? 's' : ''}`);

    setHTML('appt-tbody', bks.length
      ? bks.map(b => `<tr>
          <td><strong>${b.id || b.bookingId || '—'}</strong></td>
          <td>${b.ownerName || b.owner || '—'}</td>
          <td>${b.petName || b.pet || '—'} <span style="color:var(--muted);font-size:.74rem">(${b.petType || b.type || '—'})</span></td>
          <td>${b.service || '—'}</td>
          <td>${fmtDT(b.dateTime)}</td>
          <td>${b.payment || b.paymentMethod || '—'}</td>
          <td>${statusBadge(b.status)}</td>
          <td>
            <select onchange="updateBookingStatus('${b.id || b.bookingId}', this.value)"
              style="border:1.5px solid var(--cream-3);border-radius:var(--r-xs);padding:.25rem .5rem;font-size:.76rem;background:var(--cream);cursor:pointer;">
              <option ${b.status==='Pending'   ?'selected':''}>Pending</option>
              <option ${b.status==='Confirmed' ?'selected':''}>Confirmed</option>
              <option ${b.status==='Done'      ?'selected':''}>Done</option>
              <option ${b.status==='Cancelled' ?'selected':''}>Cancelled</option>
            </select>
          </td>
        </tr>`).join('')
      : '<tr><td colspan="8" style="text-align:center;color:var(--muted);padding:2.5rem">No bookings found.</td></tr>');
  } catch (e) {
    toast('Failed to load appointments: ' + e.message, 'err');
    setHTML('appt-tbody', '<tr><td colspan="8" style="text-align:center;color:var(--red);padding:2rem">Error loading data.</td></tr>');
  }
}

async function updateBookingStatus(id, status) {
  try {
    await apiPatch(`/appointments/${id}/status`, { status });
    toast(`Booking ${id} → ${status}`);
    loadAppointments();
    loadOverview();
  } catch (e) {
    toast('Failed to update status: ' + e.message, 'err');
  }
}

async function empConfirmBook() {
  const data = {
    ownerName   : ea('owner'),
    petName     : ea('pet'),
    petType     : ea('type'),
    contact     : ea('contact'),
    dateTime    : $('ea-dt')?.value,
    service     : $('ea-service-val')?.value,
    payment     : ea('pay'),
    bookedBy    : currentUser?.employeeId,
    status      : 'Confirmed',
  };

  if (!data.ownerName || !data.petName || !data.petType || !data.contact || !data.dateTime || !data.payment) {
    toast('Fill in all fields.', 'err'); return;
  }

  try {
    const res = await apiPost('/appointments', data);
    const bookingId = res.id || res.bookingId || '';
    toast(`Booking ${bookingId} added!`);
    empCancelBook();
    loadAppointments();
    loadOverview();
  } catch (e) {
    toast('Failed to add booking: ' + e.message, 'err');
  }
}

function empBook(svc) {
  $('ea-service-label').textContent = svc === 'grooming' ? 'Pet Grooming' : 'Pet Clinic';
  $('ea-service-val').value         = svc === 'grooming' ? 'Pet Grooming' : 'Pet Clinic';
  $('ea-form-area').style.display   = 'block';
  $('ea-form-area').scrollIntoView({ behavior: 'smooth', block: 'center' });
}
function empCancelBook() { $('ea-form-area').style.display = 'none'; }

// ═══════════════════════════════════════════════════════════
//  CUSTOMER APPOINTMENT  (with payment)
// ═══════════════════════════════════════════════════════════
function loadCustAppt() {
  show('pg-cust-appt');
  $('ca-form-area').style.display = 'none';
  if (currentUser) $('ca-owner').value = `${currentUser.firstName} ${currentUser.lastName}`;
}

function custBook(svc) {
  $('ca-service-label').textContent = svc === 'grooming' ? 'Pet Grooming' : 'Pet Clinic';
  $('ca-service-val').value         = svc === 'grooming' ? 'Pet Grooming' : 'Pet Clinic';
  $('ca-form-area').style.display   = 'block';
  $('ca-form-area').scrollIntoView({ behavior: 'smooth', block: 'center' });
}
function custCancelBook() { $('ca-form-area').style.display = 'none'; }

async function custConfirmBook() {
  const data = {
    ownerName   : ca('owner'),
    petName     : ca('pet'),
    petType     : ca('type'),
    contact     : ca('contact'),
    dateTime    : $('ca-dt')?.value,
    service     : $('ca-service-val')?.value,
    payment     : 'Online Payment',
    customerId  : currentUser?.id || currentUser?.customerId,
    status      : 'Pending',
  };

  if (!data.ownerName || !data.petName || !data.petType || !data.contact || !data.dateTime) {
    toast('Fill in all fields.', 'err'); return;
  }

  try {
    // 1. Create the booking first
    const res       = await apiPost('/appointments', data);
    const bookingId = res.id || res.bookingId || '';

    // 2. Open payment modal — default ₱300, but user can change
    openPaymentModal({
      amount      : 300,
      description : `${data.service} — ${data.petName}`,
      referenceId : bookingId,
      onSuccess   : async () => {
        // Auto-confirm booking after payment
        await apiPatch(`/appointments/${bookingId}/status`, { status: 'Confirmed' });
        toast(`Booking confirmed! ID: ${bookingId}`);
        custCancelBook();
        ['ca-pet','ca-type','ca-contact','ca-dt','ca-pay'].forEach(id => { const el=$(id); if(el) el.value=''; });
      }
    });
  } catch (e) {
    toast('Booking failed: ' + e.message, 'err');
  }
}

// ═══════════════════════════════════════════════════════════
//  CUSTOMERS
// ═══════════════════════════════════════════════════════════
async function loadCustomers() {
  setHTML('cust-tbody', '<tr><td colspan="5" style="text-align:center;color:var(--muted);padding:2rem">Loading…</td></tr>');
  try {
    let data = await apiGet('/customers');
    data = Array.isArray(data) ? data : data?.data || [];
    setText('cust-count', `${data.length} registered`);
    setHTML('cust-tbody', data.length
      ? data.map(u => `<tr>
          <td><div style="display:flex;align-items:center;gap:.7rem;">
            <div style="width:30px;height:30px;border-radius:50%;background:var(--terra-pale);color:var(--terra);font-family:Fraunces,serif;font-weight:700;display:flex;align-items:center;justify-content:center;font-size:.8rem;flex-shrink:0;">${av(u)}</div>
            <strong>${u.firstName} ${u.lastName}</strong></div></td>
          <td>${u.email || '—'}</td>
          <td>${u.gender || '—'}</td>
          <td>${fmtD(u.dob || u.dateOfBirth)}</td>
          <td>${fmtD(u.createdAt || u.dateCreated)}</td>
        </tr>`).join('')
      : '<tr><td colspan="5" style="text-align:center;color:var(--muted);padding:2rem">No customers yet.</td></tr>');
  } catch (e) {
    toast('Failed to load customers: ' + e.message, 'err');
  }
}

// ═══════════════════════════════════════════════════════════
//  EMPLOYEES
// ═══════════════════════════════════════════════════════════
async function loadEmployees() {
  setHTML('emp-tbody', '<tr><td colspan="5" style="text-align:center;color:var(--muted);padding:2rem">Loading…</td></tr>');
  try {
    let data = await apiGet('/employees');
    data = Array.isArray(data) ? data : data?.data || [];
    setText('emp-count', `${data.length} on staff`);
    setHTML('emp-tbody', data.length
      ? data.map(u => `<tr>
          <td><div style="display:flex;align-items:center;gap:.7rem;">
            <div style="width:30px;height:30px;border-radius:50%;background:var(--sage-pale);color:var(--sage);font-family:Fraunces,serif;font-weight:700;display:flex;align-items:center;justify-content:center;font-size:.8rem;flex-shrink:0;">${av(u)}</div>
            <strong>${u.firstName} ${u.lastName}</strong></div></td>
          <td><code style="background:var(--cream-2);padding:.2rem .5rem;border-radius:var(--r-xs);font-size:.8rem;">${u.employeeId || '—'}</code></td>
          <td>${u.email || '—'}</td>
          <td>${u.gender || '—'}</td>
          <td>${fmtD(u.createdAt || u.dateCreated)}</td>
        </tr>`).join('')
      : '<tr><td colspan="5" style="text-align:center;color:var(--muted);padding:2rem">No employees yet.</td></tr>');
  } catch (e) {
    toast('Failed to load employees: ' + e.message, 'err');
  }
}

// ═══════════════════════════════════════════════════════════
//  PET STORE  (Employee)
// ═══════════════════════════════════════════════════════════
const CATEGORIES = [
  { id:'food',        label:'Food & Treats',  icon:'🥫' },
  { id:'grooming',    label:'Grooming',        icon:'✂️' },
  { id:'health',      label:'Health & Meds',   icon:'💊' },
  { id:'toys',        label:'Toys & Play',     icon:'🦴' },
  { id:'accessories', label:'Accessories',     icon:'🎀' },
  { id:'housing',     label:'Housing & Beds',  icon:'🏠' },
];
function catLabel(id) { return CATEGORIES.find(c => c.id === id)?.label || id; }
function catIcon(id)  { return CATEGORIES.find(c => c.id === id)?.icon  || '📦'; }

async function loadStore(cat) {
  if (cat !== undefined) storeCatFilter = cat;
  document.querySelectorAll('#store-cat-strip .cat-chip').forEach(c =>
    c.classList.toggle('active', c.dataset.cat === storeCatFilter));

  setHTML('prod-grid', '<div style="grid-column:1/-1;text-align:center;color:var(--muted);padding:3rem">Loading products…</div>');
  try {
    const query  = storeCatFilter !== 'all' ? `?category=${storeCatFilter}` : '';
    let products = await apiGet(`/products${query}`);
    products = Array.isArray(products) ? products : products?.data || [];

    setText('store-count', `${products.length} item${products.length !== 1 ? 's' : ''}`);

    setHTML('prod-grid', products.length
      ? products.map(p => {
          const low = p.stock <= 5 && p.stock > 0;
          const out = p.stock === 0;
          return `<div class="product-card ${out ? 'out-stock' : low ? 'low-stock' : ''}">
            <div class="p-thumb">
              ${p.imageUrl || p.image ? `<img src="${p.imageUrl || p.image}" alt="${p.name}"/>` : `<span>${p.icon || catIcon(p.category)}</span>`}
              <div class="p-cat-badge">${catLabel(p.category)}</div>
            </div>
            <div class="p-body">
              <div class="p-name">${p.name}</div>
              <div class="p-price">${peso(p.price)}</div>
              <div class="p-stock-info">Stock: ${p.stock} ${stockLabel(p.stock)}</div>
              ${stockBar(p.stock)}
              <div class="p-actions" style="margin-top:.7rem;">
                <button class="btn btn-ghost btn-sm" onclick='openEditProduct(${JSON.stringify(p)})'>✏️ Edit</button>
                <button class="btn btn-red btn-sm" onclick="confirmDelete('${p.id || p.productId}','${p.name?.replace(/'/g,"\\'")}')">🗑</button>
              </div>
            </div>
          </div>`;
        }).join('')
      : '<div class="empty-state" style="grid-column:1/-1"><div class="e-ico">📦</div><h3>No products</h3><p>Add your first product to get started.</p></div>');

    buildCatStrip('store-cat-strip', storeCatFilter, 'loadStore');
  } catch (e) {
    toast('Failed to load products: ' + e.message, 'err');
  }
}

// ── ADD / EDIT PRODUCT ────────────────────────────────────
imgDataUrl = '';

function openAddProduct() {
  editingProductId = null;
  imgDataUrl = '';
  clearDrawerForm();
  $('drawer-title').textContent      = 'Add New Product';
  $('drawer-submit-btn').textContent = 'Add Product';
  $('drawer').classList.add('on');
}

function openEditProduct(product) {
  editingProductId = product.id || product.productId;
  imgDataUrl       = product.imageUrl || product.image || '';
  clearDrawerForm();
  $('drawer-title').textContent      = 'Edit Product';
  $('drawer-submit-btn').textContent = 'Save Changes';
  $('dp-name').value  = product.name        || '';
  $('dp-cat').value   = product.category    || 'food';
  $('dp-price').value = product.price       || '';
  $('dp-stock').value = product.stock       || '';
  $('dp-desc').value  = product.description || '';
  $('dp-icon').value  = product.icon        || '';
  if (imgDataUrl) { $('img-preview').src = imgDataUrl; $('img-preview').classList.add('shown'); }
  $('drawer').classList.add('on');
}

function closeDrawer() {
  $('drawer')?.classList.remove('on');
  editingProductId = null;
  imgDataUrl = '';
}

function clearDrawerForm() {
  ['dp-name','dp-price','dp-stock','dp-desc','dp-icon'].forEach(id => { const el=$(id); if(el) el.value=''; });
  const cat = $('dp-cat'); if(cat) cat.value = 'food';
  const prev = $('img-preview');
  if(prev) { prev.src=''; prev.classList.remove('shown'); }
}

function handleImgUpload(input) {
  const file = input.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    imgDataUrl = e.target.result;
    const prev = $('img-preview');
    prev.src = imgDataUrl;
    prev.classList.add('shown');
  };
  reader.readAsDataURL(file);
}

async function submitProduct() {
  const name  = val('dp-name');
  const cat   = val('dp-cat');
  const price = parseFloat($('dp-price')?.value);
  const stock = parseInt($('dp-stock')?.value);
  const desc  = val('dp-desc');
  const icon  = val('dp-icon') || catIcon(cat);

  if (!name || !cat || isNaN(price) || isNaN(stock)) { toast('Fill in all required fields.', 'err'); return; }
  if (price < 0 || stock < 0)                        { toast('Price and stock must be positive.', 'err'); return; }

  const payload = { name, category: cat, price, stock, description: desc, icon, image: imgDataUrl };

  setLoading('drawer-submit-btn', true);
  try {
    if (editingProductId) {
      await apiPut(`/products/${editingProductId}`, payload);
      toast('Product updated!');
    } else {
      await apiPost('/products', payload);
      toast('Product added!');
    }
    closeDrawer();
    loadStore();
    loadOverview();
  } catch (e) {
    toast(e.message, 'err');
  } finally {
    setLoading('drawer-submit-btn', false, editingProductId ? 'Save Changes' : 'Add Product');
  }
}

// ── DELETE PRODUCT ────────────────────────────────────────
function confirmDelete(id, name) {
  deleteTargetId = id;
  const el = $('del-product-name'); if(el) el.textContent = name || 'this product';
  $('modal-delete')?.classList.add('on');
}
function cancelDelete()  { $('modal-delete')?.classList.remove('on'); deleteTargetId = null; }

async function executeDelete() {
  if (!deleteTargetId) return;
  try {
    await apiDelete(`/products/${deleteTargetId}`);
    toast('Product deleted.', 'inf');
    cancelDelete();
    loadStore();
    loadOverview();
  } catch (e) {
    toast('Failed to delete: ' + e.message, 'err');
  }
}

// ═══════════════════════════════════════════════════════════
//  STOCK MANAGEMENT
// ═══════════════════════════════════════════════════════════
let _allProducts = [];

async function loadStock(filter) {
  if (filter !== undefined) stockFilter = filter;
  document.querySelectorAll('#sec-stock .pill-tab').forEach(t =>
    t.classList.toggle('active', t.dataset.f === stockFilter));

  setHTML('stock-tbody', '<tr><td colspan="5" style="text-align:center;color:var(--muted);padding:2rem">Loading…</td></tr>');
  try {
    let prods = await apiGet('/products');
    _allProducts = Array.isArray(prods) ? prods : prods?.data || [];

    setText('stock-summary-total', _allProducts.length);
    setText('stock-summary-low',   _allProducts.filter(p => p.stock <= 5 && p.stock > 0).length);
    setText('stock-summary-out',   _allProducts.filter(p => p.stock === 0).length);

    let view = _allProducts;
    if (stockFilter === 'low') view = view.filter(p => p.stock <= 5 && p.stock > 0);
    if (stockFilter === 'out') view = view.filter(p => p.stock === 0);

    setHTML('stock-tbody', view.length
      ? view.map(p => `<tr>
          <td>
            <div style="display:flex;align-items:center;gap:.7rem;">
              <span style="font-size:1.4rem">${p.icon || catIcon(p.category)}</span>
              <div><div style="font-weight:600">${p.name}</div>
              <div style="font-size:.72rem;color:var(--muted)">${catLabel(p.category)}</div></div>
            </div>
          </td>
          <td>${peso(p.price)}</td>
          <td>
            <div style="display:flex;align-items:center;gap:.6rem;">
              <input class="stock-input" type="number" min="0" value="${p.stock}"
                id="si-${p.id || p.productId}"
                style="width:72px;"
                onchange="markDirty('${p.id || p.productId}')"/>
              <div style="width:80px">${stockBar(p.stock)}</div>
            </div>
          </td>
          <td>${stockLabel(p.stock)}</td>
          <td>
            <div style="display:flex;gap:.4rem;flex-wrap:wrap;">
              <button class="btn btn-ghost btn-sm" onclick="adjustStock('${p.id || p.productId}',10)">+10</button>
              <button class="btn btn-ghost btn-sm" onclick="adjustStock('${p.id || p.productId}',1)">+1</button>
              <button class="btn btn-red   btn-sm" onclick="adjustStock('${p.id || p.productId}',-1)">−1</button>
              <button class="btn btn-sage  btn-sm" onclick="saveStockRow('${p.id || p.productId}')">Save</button>
            </div>
          </td>
        </tr>`).join('')
      : '<tr><td colspan="5" style="text-align:center;color:var(--muted);padding:2rem">No products found.</td></tr>');
  } catch (e) {
    toast('Failed to load stock: ' + e.message, 'err');
  }
}

function markDirty(id) {
  const el = $(`si-${id}`);
  if (el) el.style.borderColor = 'var(--amber)';
}

function adjustStock(id, delta) {
  const input = $(`si-${id}`);
  if (!input) return;
  input.value = Math.max(0, (parseInt(input.value) || 0) + delta);
  markDirty(id);
}

async function saveStockRow(id) {
  const input = $(`si-${id}`);
  if (!input) return;
  const stock = Math.max(0, parseInt(input.value) || 0);
  try {
    await apiPatch(`/products/${id}/stock`, { stock });
    toast('Stock updated!');
    input.style.borderColor = '';
    loadStock();
    loadOverview();
  } catch (e) {
    toast('Failed to update stock: ' + e.message, 'err');
  }
}

async function saveBulkStock() {
  const updates = _allProducts
    .map(p => {
      const input = $(`si-${p.id || p.productId}`);
      return input ? { id: p.id || p.productId, stock: Math.max(0, parseInt(input.value) || 0) } : null;
    })
    .filter(Boolean);

  try {
    try {
      await apiPatch('/products/stock/bulk', { updates });
    } catch {
      await Promise.all(updates.map(u => apiPatch(`/products/${u.id}/stock`, { stock: u.stock })));
    }
    toast('All stock levels saved!');
    loadStock();
    loadOverview();
  } catch (e) {
    toast('Failed to save stock: ' + e.message, 'err');
  }
}

// ═══════════════════════════════════════════════════════════
//  CUSTOMER STORE  (with payment)
// ═══════════════════════════════════════════════════════════
async function loadCustStore() {
  show('pg-cust-store');
  buildCatStrip('cust-cat-strip', 'all', 'renderCustStore');
  renderCustStore('all');
}

async function renderCustStore(cat) {
  document.querySelectorAll('#cust-cat-strip .cat-chip').forEach(c =>
    c.classList.toggle('active', c.dataset.cat === cat));

  const grid = $('cust-product-grid');
  if (grid) grid.innerHTML = '<div style="grid-column:1/-1;text-align:center;color:var(--muted);padding:3rem">Loading…</div>';

  try {
    const query = cat !== 'all' ? `?category=${cat}` : '';
    let prods   = await apiGet(`/products${query}`);
    prods = (Array.isArray(prods) ? prods : prods?.data || []).filter(p => p.stock > 0);

    if (!grid) return;
    grid.innerHTML = prods.length
      ? prods.map(p => `
          <div class="product-card">
            <div class="p-thumb">
              ${p.imageUrl || p.image ? `<img src="${p.imageUrl || p.image}" alt="${p.name}"/>` : `<span>${p.icon || catIcon(p.category)}</span>`}
              <div class="p-cat-badge">${catLabel(p.category)}</div>
            </div>
            <div class="p-body">
              <div class="p-name">${p.name}</div>
              <div class="p-price">${peso(p.price)}</div>
              <div class="p-stock-info">Stock: ${p.stock}</div>
              <button class="btn btn-sage btn-sm" style="margin-top:.7rem;width:100%"
                onclick='buyProduct(${JSON.stringify(p)})'>
                🛒 Buy Now
              </button>
            </div>
          </div>`).join('')
      : '<div class="empty-state" style="grid-column:1/-1"><div class="e-ico">🛒</div><h3>No products found</h3></div>';
  } catch (e) {
    toast('Failed to load store: ' + e.message, 'err');
  }
}

function buyProduct(product) {
  openPaymentModal({
    amount      : product.price,
    description : `Purchase: ${product.name}`,
    referenceId : product.id || product.productId,
    onSuccess   : async () => {
      // Deduct stock by 1 after successful payment
      try {
        const newStock = Math.max(0, (product.stock || 1) - 1);
        await apiPatch(`/products/${product.id || product.productId}/stock`, { stock: newStock });
        toast(`${product.name} purchased! 🎉`);
        renderCustStore('all');
      } catch (e) {
        toast('Stock update failed: ' + e.message, 'err');
      }
    }
  });
}

// ═══════════════════════════════════════════════════════════
//  CATEGORY STRIP BUILDER
// ═══════════════════════════════════════════════════════════
function buildCatStrip(stripId, active, fn) {
  const el = $(stripId);
  if (!el) return;
  el.innerHTML =
    `<div class="cat-chip ${active==='all'?'active':''}" data-cat="all" onclick="${fn}('all')"><span class="cc-icon">🏷️</span> All</div>` +
    CATEGORIES.map(c =>
      `<div class="cat-chip ${active===c.id?'active':''}" data-cat="${c.id}" onclick="${fn}('${c.id}')"><span class="cc-icon">${c.icon}</span> ${c.label}</div>`
    ).join('');
}

// ═══════════════════════════════════════════════════════════
//  INIT
// ═══════════════════════════════════════════════════════════
window.onload = () => {
  const savedToken = localStorage.getItem('authToken');
  const savedUser  = localStorage.getItem('currentUser');
  const savedRole  = localStorage.getItem('userRole');

  if (savedToken && savedUser) {
    authToken   = savedToken;
    currentUser = JSON.parse(savedUser);

    if (savedRole === 'employee') {
      $('sb-name').textContent  = `${currentUser.firstName} ${currentUser.lastName}`;
      $('sb-empid').textContent = currentUser.employeeId || '';
      const av_el = $('sb-avatar');
      if (av_el) av_el.textContent = av(currentUser);
      show('pg-emp-dash');
      navTo('overview');
    } else {
      $('cw-name').textContent = `Welcome, ${currentUser.firstName}!`;
      show('pg-cust-welcome');
    }
  } else {
    show('pg-splash');
  }

  // Check if returning from payment redirect
  const urlParams = new URLSearchParams(window.location.search);
  const payStatus = urlParams.get('payment');
  if (payStatus === 'success') {
    toast('Payment successful! Your booking is confirmed. 🎉');
    // Clean URL
    window.history.replaceState({}, document.title, window.location.pathname);
  } else if (payStatus === 'failed') {
    toast('Payment was not completed. Please try again.', 'err');
    window.history.replaceState({}, document.title, window.location.pathname);
  }

  buildCatStrip('store-cat-strip', 'all', 'loadStore');
  buildCatStrip('cust-cat-strip',  'all', 'renderCustStore');

  const tb = $('tb-date');
  if (tb) tb.textContent = new Date().toLocaleDateString('en-PH', {
    weekday:'short', month:'short', day:'numeric', year:'numeric'
  });
};