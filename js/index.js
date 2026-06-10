const API = 'https://health-monitor-doctor.onrender.com';

// ── SESSION CHECK — chạy ngay trước khi render ──
(function checkSession(){
  try {
    const sess = localStorage.getItem('hm_session');
    if(!sess) return;
    const s = JSON.parse(sess);
    if(!s || !s.userId || !s.role) return;
    if(s.role === 'user_bs'){
      window.location.replace('health-monitor.html?doctor=' + s.userId);
    }
    // admin/sub_admin: để DOMContentLoaded xử lý bên dưới
  } catch(_){}
})();

// Tạm lưu userId khi cần đổi mật khẩu
let pendingUserId     = null;
let pendingUserRole   = null;
let pendingUserName   = null;
let pendingHospitalId = null;

// ── LOAD HOSPITALS ──
async function loadHospitals(){
  try {
    const res = await fetch(`${API}/hospitals`);
    if(!res.ok) return;
    const hospitals = await res.json();
    const sel = document.getElementById('hospital-select');
    hospitals.forEach(h => {
      const opt = document.createElement('option');
      opt.value = h.id;
      opt.textContent = h.ten_co_so;
      sel.appendChild(opt);
    });
  } catch(_){}
}
loadHospitals();

// ── ROLE CHANGE → ẩn/hiện CSYT ──
function onRoleChange(role){
  const fieldHospital = document.getElementById('field-hospital');
  // Chỉ ẩn CSYT khi chọn Admin; mặc định (chưa chọn) và các vai trò khác đều hiện
  fieldHospital.style.display = (role === 'admin') ? 'none' : 'block';
  if(role === 'admin') document.getElementById('hospital-select').value = '';
  clearLoginError();
}

// ── NAVIGATION ──
function showView(id){
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}

// ── PASS TOGGLE ──
function togglePass(inputId, btn){
  const inp = document.getElementById(inputId);
  const isPass = inp.type === 'password';
  inp.type = isPass ? 'text' : 'password';
  btn.innerHTML = isPass
    ? `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>`
    : `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`;
}

// ── PASSWORD STRENGTH ──
function checkStrength(pw){
  const bar   = document.getElementById('pw-strength');
  const fill  = document.getElementById('pw-fill');
  const label = document.getElementById('pw-label');
  bar.classList.toggle('show', pw.length > 0);
  if(!pw){ return; }
  let score = 0;
  if(pw.length >= 6)  score++;
  if(pw.length >= 10) score++;
  if(/[A-Z]/.test(pw)) score++;
  if(/[0-9]/.test(pw)) score++;
  if(/[^A-Za-z0-9]/.test(pw)) score++;
  const levels = [
    { w:'20%', c:'var(--danger)', t:'Quá yếu' },
    { w:'40%', c:'var(--warn)',   t:'Yếu' },
    { w:'60%', c:'var(--warn)',   t:'Trung bình' },
    { w:'80%', c:'var(--sky)',    t:'Khá mạnh' },
    { w:'100%',c:'var(--green)', t:'Mạnh' },
  ];
  const lv = levels[Math.min(score, 4)];
  fill.style.width      = lv.w;
  fill.style.background = lv.c;
  label.textContent     = lv.t;
  label.style.color     = lv.c;
}

// ── CLEAR ERROR ──
function clearLoginError(){
  document.getElementById('login-input').classList.remove('error');
  document.getElementById('login-pass').classList.remove('error');
  hideBanner('login-error');
}

function showBanner(id, msg){ const b=document.getElementById(id); b.classList.add('show'); const s=b.querySelector('span[id]'); if(s)s.textContent=msg; }
function hideBanner(id){ document.getElementById(id).classList.remove('show'); }
function setBtn(id, loading, text){
  const b=document.getElementById(id); b.disabled=loading;
  b.innerHTML = loading
    ? `<div class="btn-spinner"></div> ${text||'Đang xử lý...'}`
    : b.dataset.originalHtml || b.innerHTML;
}

// Save original button HTML
document.getElementById('login-btn').dataset.originalHtml = document.getElementById('login-btn').innerHTML;
document.getElementById('cp-btn').dataset.originalHtml    = document.getElementById('cp-btn').innerHTML;

// ── ĐĂNG NHẬP ──
async function doLogin(){
  const role       = document.getElementById('role-select').value;
  const login      = document.getElementById('login-input').value.trim();
  const pass       = document.getElementById('login-pass').value;
  const hospitalId = (role === 'admin') ? null : document.getElementById('hospital-select').value;
  clearLoginError();

  if(!role){
    showBanner('login-error', 'Vui lòng chọn vai trò của bạn');
    document.getElementById('role-select').style.borderColor = 'var(--danger)';
    return;
  }
  document.getElementById('role-select').style.borderColor = '';

  if(role !== 'admin' && !hospitalId){
    showBanner('login-error', 'Vui lòng chọn cơ sở y tế');
    document.getElementById('hospital-select').style.borderColor = 'var(--danger)';
    return;
  }
  document.getElementById('hospital-select').style.borderColor = '';

  if(!login){ showBanner('login-error','Vui lòng nhập email hoặc số điện thoại'); document.getElementById('login-input').classList.add('error'); return; }
  if(!pass)  { showBanner('login-error','Vui lòng nhập mật khẩu'); document.getElementById('login-pass').classList.add('error'); return; }

  const btn = document.getElementById('login-btn');
  btn.disabled = true;
  btn.innerHTML = `<div class="btn-spinner"></div> Đang đăng nhập...`;

  try {
    // Mỗi role gọi đúng backend của mình
    const ADMIN_API    = 'https://health-monitor-admin-ldk0.onrender.com';
    const SUBADMIN_API = 'https://health-monitor-subadmin-bhj5.onrender.com';
    const loginAPI = role === 'admin' ? ADMIN_API
                   : role === 'sub_admin' ? SUBADMIN_API
                   : API;

    const res = await fetch(`${loginAPI}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ login, password: pass, hospitalId: hospitalId || null, selectedRole: role }),
    });

    const data = await res.json();

    if(!res.ok){
      showBanner('login-error', data.error || 'Đăng nhập thất bại');
      document.getElementById('login-input').classList.add('error');
      document.getElementById('login-pass').classList.add('error');
      btn.disabled = false;
      btn.innerHTML = btn.dataset.originalHtml;
      return;
    }

    const primaryRole = data.roles?.[0] || '';

    // Đăng nhập lần đầu → đổi mật khẩu
    if(data.isFirstLogin){
      pendingUserId     = data.userId;
      pendingUserRole   = primaryRole;
      pendingUserName   = data.name;
      pendingHospitalId = data.hospitalId;
      document.getElementById('change-pass-sub').textContent =
        `Xin chào ${data.name}! Vui lòng đặt mật khẩu cá nhân để tiếp tục.`;
      btn.disabled = false;
      btn.innerHTML = btn.dataset.originalHtml;
      showView('view-change-pass');
      return;
    }

    // Redirect theo vai trò
    redirectByRole(primaryRole, data.userId, data.name, {
      token:        data.token        || null,
      hospitalId:   data.hospitalId,
      isFirstLogin: data.isFirstLogin || false,
    });

  } catch(e) {
    showBanner('login-error', 'Không thể kết nối tới máy chủ. Vui lòng thử lại.');
    btn.disabled = false;
    btn.innerHTML = btn.dataset.originalHtml;
    console.error(e);
  }
}

// ── ĐỔI MẬT KHẨU ──
async function doChangePass(){
  const np = document.getElementById('new-pass').value;
  const cp = document.getElementById('confirm-pass').value;
  hideBanner('cp-error');

  if(np.length < 6){ showBanner('cp-error','Mật khẩu phải có ít nhất 6 ký tự'); return; }
  if(np !== cp)     { showBanner('cp-error','Mật khẩu xác nhận không khớp'); return; }

  const btn = document.getElementById('cp-btn');
  btn.disabled = true;
  btn.innerHTML = `<div class="btn-spinner"></div> Đang lưu...`;

  // Chọn đúng API theo role
  const ADMIN_API    = 'https://health-monitor-admin-ldk0.onrender.com';
  const SUBADMIN_API = 'https://health-monitor-subadmin-bhj5.onrender.com';
  const changeAPI = pendingUserRole === 'admin'     ? ADMIN_API
                  : pendingUserRole === 'sub_admin' ? SUBADMIN_API
                  : API;

  try {
    const res = await fetch(`${changeAPI}/auth/change-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: pendingUserId, newPassword: np }),
    });

    const data = await res.json();

    if(!res.ok){
      showBanner('cp-error', data.error || 'Không thể đổi mật khẩu');
      btn.disabled = false;
      btn.innerHTML = btn.dataset.originalHtml;
      return;
    }

    // Đổi thành công → redirect với đầy đủ thông tin
    redirectByRole(pendingUserRole, pendingUserId, pendingUserName, {
      hospitalId:   pendingHospitalId,
      isFirstLogin: false,
    });

  } catch(e) {
    showBanner('cp-error', 'Không thể kết nối tới máy chủ');
    btn.disabled = false;
    btn.innerHTML = btn.dataset.originalHtml;
  }
}

// ── SESSION HELPERS ──
function saveSession(userId, role, name, extra){
  const SESSION_HOURS = 8;
  localStorage.setItem('hm_session', JSON.stringify({
    userId, role, roles: [role], name,
    token:        extra?.token        || null,
    hospitalId:   extra?.hospitalId   || null,
    isFirstLogin: extra?.isFirstLogin || false,
    loginAt:   Date.now(),
    expiresAt: Date.now() + SESSION_HOURS * 60 * 60 * 1000,
  }));
}
function clearSession(){
  localStorage.removeItem('hm_session');
}

// ── REDIRECT THEO VAI TRÒ ──
function redirectByRole(role, userId, name, extra){
  saveSession(userId, role, name, extra);
  if(role === 'user_bs'){
    window.location.replace('health-monitor.html?doctor=' + userId);
  } else if(role === 'admin'){
    window.location.replace('admin.html');
  } else if(role === 'sub_admin'){
    window.location.replace('sub-admin.html');
  } else {
    clearSession();
    showBanner('login-error', `Tài khoản vai trò "${role}" không có quyền truy cập hệ thống này.`);
    showView('view-login');
  }
}

// ── QUÊN MẬT KHẨU ──
async function doForgotPassword(){
  const email = document.getElementById('forgot-email').value.trim();
  hideBanner('forgot-error');
  hideBanner('forgot-success');

  if(!email){ showBanner('forgot-error', 'Vui lòng nhập email'); return; }

  const btn = document.getElementById('forgot-btn');
  btn.disabled = true;
  btn.innerHTML = `<div class="btn-spinner"></div> Đang gửi...`;

  // Thử cả 3 server — server nào tìm được email sẽ gửi
  const APIS = [
    'https://health-monitor-doctor.onrender.com',
    'https://health-monitor-subadmin-bhj5.onrender.com',
    'https://health-monitor-admin-ldk0.onrender.com',
  ];

  try{
    let success = false;
    for(const api of APIS){
      try {
        const res = await fetch(`${api}/auth/forgot-password`, {
          method:'POST', headers:{'Content-Type':'application/json'},
          body: JSON.stringify({ email }),
        });
        const data = await res.json();
        if(res.ok){
          document.getElementById('forgot-email-field').style.display = 'none';
          btn.style.display = 'none';
          const successBanner = document.getElementById('forgot-success');
          successBanner.classList.add('show');
          document.getElementById('forgot-success-msg').textContent =
            'Email đã được gửi! Vui lòng kiểm tra hộp thư (kể cả thư mục Spam). Link có hiệu lực trong 1 giờ.';
          success = true;
          break;
        }
      } catch(_){}
    }
    if(!success){
      showBanner('forgot-error', 'Không tìm thấy tài khoản với email này');
    }
  }catch(e){
    showBanner('forgot-error', 'Không thể kết nối tới máy chủ');
  }

  btn.disabled = false;
  btn.innerHTML = btn.dataset.originalForgotHtml || `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M22 2L11 13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg> Gửi email đặt lại mật khẩu`;
}

// ── ĐĂNG XUẤT ──
function doLogout(){
  clearSession();
  showView('view-login');
  document.getElementById('login-input').value = '';
  document.getElementById('login-pass').value  = '';
}

// Restore session nếu admin/subadmin quay lại trang login
window.addEventListener('DOMContentLoaded', function(){
  try {
    const sess = localStorage.getItem('hm_session');
    if(!sess) return;
    const s = JSON.parse(sess);
    if(!s || !s.userId || !s.role) return;
    if(s.role === 'admin'){
      window.location.replace('admin.html');
    } else if(s.role === 'sub_admin'){
      window.location.replace('sub-admin.html');
    }
    // user_bs đã được redirect ở session check script trên đầu trang
  } catch(_){}
});

// Enter key
document.getElementById('login-input').addEventListener('keydown', e => {
  if(e.key === 'Enter') document.getElementById('login-pass').focus();
});
