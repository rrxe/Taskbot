let token = localStorage.getItem('admin_token') || null;

async function api(path, options = {}) {
  const res = await fetch('/admin/api' + path, {
    method: options.method || 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: 'Bearer ' + token } : {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw { status: res.status, ...data };
  return data;
}

function toast(msg) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2600);
}

function showApp() {
  document.getElementById('login-screen').classList.add('hidden');
  document.getElementById('dashboard').classList.remove('hidden');
  loadOverview();
}

document.getElementById('btn-login').addEventListener('click', async () => {
  const password = document.getElementById('login-password').value;
  try {
    const r = await api('/login', { method: 'POST', body: { password } });
    token = r.token;
    localStorage.setItem('admin_token', token);
    showApp();
  } catch (err) {
    toast('كلمة المرور غير صحيحة');
  }
});

document.getElementById('btn-logout').addEventListener('click', () => {
  localStorage.removeItem('admin_token');
  location.reload();
});

if (token) showApp();

// ---------- Tabs ----------
document.querySelectorAll('.sidebar .item[data-tab]').forEach((item) => {
  item.addEventListener('click', () => {
    document.querySelectorAll('.sidebar .item').forEach((i) => i.classList.remove('active'));
    item.classList.add('active');
    document.querySelectorAll('.tab').forEach((t) => t.classList.add('hidden'));
    document.getElementById('tab-' + item.dataset.tab).classList.remove('hidden');
    const loaders = {
      overview: loadOverview, countries: loadCountries, cpm: loadCpm,
      users: loadUsers, withdrawals: loadWithdrawals, settings: loadSettings,
      cycles: loadCycles, audit: loadAudit,
    };
    loaders[item.dataset.tab] && loaders[item.dataset.tab]();
  });
});

// ---------- Overview ----------
async function loadOverview() {
  try {
    const d = await api('/dashboard');
    document.getElementById('ov-users').textContent = d.totalUsers;
    document.getElementById('ov-countries').textContent = d.activeCountries;
    document.getElementById('ov-withdrawals').textContent = d.pendingWithdrawals.c;
    document.getElementById('ov-revenue').textContent = '$' + Number(d.currentCycle.revenue || 0).toFixed(2);
  } catch (e) { handleAuthError(e); }
}

function handleAuthError(e) {
  if (e.status === 401) {
    localStorage.removeItem('admin_token');
    location.reload();
  }
}

// ---------- Countries ----------
async function loadCountries() {
  const rows = await api('/countries');
  const tbody = document.querySelector('#countries-table tbody');
  tbody.innerHTML = '';
  rows.forEach((c) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${c.name}</td><td>${c.code}</td><td>${c.user_count}</td>
      <td><span class="badge ${c.enabled ? 'on' : 'off'}">${c.enabled ? 'مفعّلة' : 'موقوفة'}</span></td>
      <td class="row-actions">
        <button data-action="toggle" data-id="${c.id}" data-enabled="${c.enabled}">${c.enabled ? 'إيقاف' : 'تفعيل'}</button>
        <button data-action="delete" data-id="${c.id}">حذف</button>
      </td>`;
    tbody.appendChild(tr);
  });
}

document.getElementById('btn-add-country').addEventListener('click', async () => {
  const name = document.getElementById('c-name').value.trim();
  const code = document.getElementById('c-code').value.trim().toUpperCase();
  const sortOrder = Number(document.getElementById('c-order').value || 0);
  if (!name || !code) return toast('يرجى تعبئة الاسم والرمز');
  await api('/countries', { method: 'POST', body: { name, code, sortOrder } });
  document.getElementById('c-name').value = '';
  document.getElementById('c-code').value = '';
  document.getElementById('c-order').value = '';
  loadCountries();
});

document.querySelector('#countries-table').addEventListener('click', async (e) => {
  const btn = e.target.closest('button');
  if (!btn) return;
  const id = btn.dataset.id;
  if (btn.dataset.action === 'toggle') {
    await api(`/countries/${id}`, { method: 'PUT', body: { enabled: btn.dataset.enabled !== 'true' } });
    loadCountries();
  } else if (btn.dataset.action === 'delete') {
    if (!confirm('حذف هذه الدولة؟')) return;
    try {
      await api(`/countries/${id}`, { method: 'DELETE' });
      loadCountries();
    } catch (err) {
      toast('لا يمكن حذف دولة مرتبطة بمستخدمين');
    }
  }
});

// ---------- CPM ----------
async function loadCpm() {
  const dateInput = document.getElementById('cpm-date');
  if (!dateInput.value) dateInput.value = new Date().toISOString().slice(0, 10);
  const data = await api('/cpm?date=' + dateInput.value);
  const tbody = document.querySelector('#cpm-table tbody');
  tbody.innerHTML = '';
  data.rows.forEach((r) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${r.name}</td>
      <td><input type="number" step="0.01" value="${r.cpm ?? ''}" placeholder="لم يُحدد" style="width:100px" data-country="${r.country_id}" /></td>
      <td>${r.impressions}</td>
      <td>$${Number(r.revenue).toFixed(3)}</td>
      <td>$${Number(r.users_share).toFixed(3)}</td>
      <td class="row-actions"><button data-save="${r.country_id}">حفظ</button></td>`;
    tbody.appendChild(tr);
  });
}
document.getElementById('btn-load-cpm').addEventListener('click', loadCpm);

document.querySelector('#cpm-table').addEventListener('click', async (e) => {
  const btn = e.target.closest('button[data-save]');
  if (!btn) return;
  const countryId = btn.dataset.save;
  const input = document.querySelector(`input[data-country="${countryId}"]`);
  const cpm = parseFloat(input.value);
  if (isNaN(cpm) || cpm < 0) return toast('قيمة CPM غير صحيحة');
  const date = document.getElementById('cpm-date').value;
  await api('/cpm', { method: 'POST', body: { countryId, date, cpm } });
  toast('تم تحديث CPM وإعادة الحساب تلقائيًا');
  loadCpm();
});

// ---------- Users ----------
async function loadUsers() {
  const search = document.getElementById('u-search').value.trim();
  const rows = await api('/users' + (search ? '?search=' + encodeURIComponent(search) : ''));
  const tbody = document.querySelector('#users-table tbody');
  tbody.innerHTML = '';
  rows.forEach((u) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${u.telegram_id}</td><td>${u.username || '-'}</td><td>${u.country || '-'}</td>
      <td>$${Number(u.balance_available).toFixed(2)}</td><td>$${Number(u.balance_paid).toFixed(2)}</td>
      <td><span class="badge ${u.status === 'active' ? 'on' : 'off'}">${u.status === 'active' ? 'نشط' : 'موقوف'}</span></td>
      <td class="row-actions"><button data-id="${u.id}" data-status="${u.status === 'active' ? 'suspended' : 'active'}">
        ${u.status === 'active' ? 'إيقاف' : 'تفعيل'}</button></td>`;
    tbody.appendChild(tr);
  });
}
document.getElementById('btn-search-users').addEventListener('click', loadUsers);

document.querySelector('#users-table').addEventListener('click', async (e) => {
  const btn = e.target.closest('button');
  if (!btn) return;
  await api(`/users/${btn.dataset.id}/status`, { method: 'PUT', body: { status: btn.dataset.status } });
  loadUsers();
});

// ---------- Withdrawals ----------
async function loadWithdrawals() {
  const rows = await api('/withdrawals');
  const tbody = document.querySelector('#withdrawals-table tbody');
  tbody.innerHTML = '';
  const statusMap = { pending: 'قيد المراجعة', approved: 'موافَق عليه', paid: 'مدفوع', rejected: 'مرفوض' };
  rows.forEach((w) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${w.username || w.telegram_id}</td><td>$${Number(w.amount).toFixed(2)}</td><td>${w.method}</td>
      <td style="max-width:180px; overflow:hidden; text-overflow:ellipsis;">${w.account_info || ''}</td>
      <td><span class="badge ${w.status === 'paid' ? 'on' : w.status === 'rejected' ? 'off' : 'pending'}">${statusMap[w.status]}</span></td>
      <td class="row-actions">
        ${w.status === 'pending' ? `<button data-id="${w.id}" data-status="approved">موافقة</button>
        <button data-id="${w.id}" data-status="rejected">رفض</button>` : ''}
        ${w.status === 'approved' ? `<button data-id="${w.id}" data-status="paid">تحديد كمدفوع</button>` : ''}
      </td>`;
    tbody.appendChild(tr);
  });
}

document.querySelector('#withdrawals-table').addEventListener('click', async (e) => {
  const btn = e.target.closest('button');
  if (!btn) return;
  await api(`/withdrawals/${btn.dataset.id}`, { method: 'PUT', body: { status: btn.dataset.status } });
  loadWithdrawals();
});

// ---------- Settings ----------
async function loadSettings() {
  const s = await api('/settings');
  document.getElementById('s-daily-limit').value = s.daily_ad_limit || '';
  document.getElementById('s-min-interval').value = s.min_ad_interval_seconds || '';
  document.getElementById('s-min-withdraw').value = s.min_withdraw_amount || '';
  document.getElementById('s-user-share').value = s.user_share_percent || '';
  updateWithdrawToggleUI(s.withdrawals_open === 'true');

  const ads = await api('/ads-config');
  const rewardBadge = document.getElementById('ads-reward-badge');
  rewardBadge.textContent = ads.rewardConfigured ? 'مُعرَّف' : 'غير مُعرَّف';
  rewardBadge.className = 'badge ' + (ads.rewardConfigured ? 'on' : 'off');
  const intBadge = document.getElementById('ads-int-badge');
  intBadge.textContent = ads.interstitialConfigured ? 'مُعرَّف' : 'غير مُعرَّف';
  intBadge.className = 'badge ' + (ads.interstitialConfigured ? 'on' : 'off');
}

function updateWithdrawToggleUI(open) {
  const btn = document.getElementById('btn-toggle-withdraw');
  btn.textContent = open ? '🔓 السحب مفتوح — إغلاق' : '🔒 السحب مغلق — فتح';
  btn.className = 'btn ' + (open ? 'danger' : 'warn');
  btn.dataset.open = open ? 'true' : 'false';
}

document.getElementById('btn-toggle-withdraw').addEventListener('click', async (e) => {
  const currentlyOpen = e.target.dataset.open === 'true';
  const r = await api('/withdrawals-toggle', { method: 'POST', body: { open: !currentlyOpen } });
  updateWithdrawToggleUI(r.open);
  toast(r.open ? 'تم فتح السحب لجميع المستخدمين' : 'تم إغلاق السحب');
});

document.getElementById('btn-save-settings').addEventListener('click', async () => {
  await api('/settings', {
    method: 'PUT',
    body: {
      daily_ad_limit: document.getElementById('s-daily-limit').value,
      min_ad_interval_seconds: document.getElementById('s-min-interval').value,
      min_withdraw_amount: document.getElementById('s-min-withdraw').value,
      user_share_percent: document.getElementById('s-user-share').value,
      platform_share_percent: 100 - Number(document.getElementById('s-user-share').value),
    },
  });
  toast('تم حفظ الإعدادات');
});

// ---------- Cycles ----------
async function loadCycles() {
  const preview = await api('/cycles/current-preview');
  document.getElementById('cycle-preview').innerHTML = `
    <h3>الدورة الحالية: ${preview.cycle.month_label}</h3>
    <div class="grid4">
      <div class="box"><div class="num">${preview.impressions}</div><div class="lbl">إجمالي المشاهدات</div></div>
      <div class="box"><div class="num">$${Number(preview.revenue).toFixed(2)}</div><div class="lbl">إجمالي الإيراد</div></div>
      <div class="box"><div class="num">$${Number(preview.users_share).toFixed(2)}</div><div class="lbl">حصة المستخدمين</div></div>
      <div class="box"><div class="num">$${Number(preview.pending_payments).toFixed(2)}</div><div class="lbl">مستحقات معلّقة</div></div>
    </div>`;

  const rows = await api('/cycles');
  const tbody = document.querySelector('#cycles-table tbody');
  tbody.innerHTML = '';
  rows.forEach((c) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${c.month_label}</td><td>${c.status === 'open' ? 'مفتوحة' : 'مغلقة'}</td>
      <td>${c.total_impressions}</td><td>$${Number(c.total_revenue).toFixed(2)}</td><td>$${Number(c.users_share).toFixed(2)}</td>`;
    tbody.appendChild(tr);
  });
}

document.getElementById('btn-end-month').addEventListener('click', async () => {
  if (!confirm('هل تم دفع مستحقات المستخدمين؟ سيتم إغلاق الشهر الحالي وبدء دورة جديدة ولن يمكن التراجع.')) return;
  try {
    await api('/cycles/end-month', { method: 'POST' });
    toast('تم إنهاء الشهر وبدء دورة جديدة');
    loadCycles();
  } catch (err) {
    toast('تعذر إنهاء الشهر');
  }
});

// ---------- Audit ----------
async function loadAudit() {
  const rows = await api('/audit-log');
  const tbody = document.querySelector('#audit-table tbody');
  tbody.innerHTML = '';
  rows.forEach((r) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${new Date(r.created_at).toLocaleString('ar')}</td><td>${r.action}</td><td>${r.entity || ''} ${r.entity_id || ''}</td>
      <td style="max-width:260px; overflow:hidden; text-overflow:ellipsis;">${r.new_value ? JSON.stringify(r.new_value) : ''}</td>`;
    tbody.appendChild(tr);
  });
}
