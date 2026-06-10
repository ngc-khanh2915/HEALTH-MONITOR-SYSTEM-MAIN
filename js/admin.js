// ── SUPABASE REALTIME ──
const _sb = supabase.createClient(
  'https://czgberdpnfultxkljhko.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImN6Z2JlcmRwbmZ1bHR4a2xqaGtvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ3OTY3MTEsImV4cCI6MjA5MDM3MjcxMX0.H9pv62PGbIJqJNK72yGEGB1Y9yw7HPEvk82zdxlgVYg'
);

_sb.channel('nhat-ky-realtime')
  .on('postgres_changes', {
    event: 'INSERT',
    schema: 'public',
    table: 'nhat_ky_he_thong'
  }, function(payload){
    if(document.getElementById('view-logs')?.style.display !== 'none' && logPage === 1){
      loadLogs();
    }
    if(document.getElementById('view-logs')?.style.display !== 'none' && logPage > 1){
      showNewLogToast();
    }
  })
  .subscribe(function(status){
    const badge = document.getElementById('log-realtime-badge');
    if(!badge) return;
    if(status === 'SUBSCRIBED'){
      badge.style.display = 'flex';
      badge.innerHTML = '<span style="width:7px;height:7px;border-radius:50%;background:#27ae60;display:inline-block;animation:pulse 1.5s infinite"></span> Realtime';
    } else if(status === 'CHANNEL_ERROR'){
      badge.style.display = 'flex';
      badge.innerHTML = '<span style="width:7px;height:7px;border-radius:50%;background:#e74c3c;display:inline-block"></span> Lỗi kết nối';
    }
  });

const _devDebounce = {};
function _debounce(key, fn, ms){
  clearTimeout(_devDebounce[key]);
  _devDebounce[key] = setTimeout(fn, ms||1500);
}

_sb.channel('admin-devices-rt')
  .on('postgres_changes',{event:'*',schema:'public',table:'thiet_bi_iot'},function(){
    _debounce('devices',function(){
      if(document.getElementById('view-devices')?.style.display!=='none') loadDevices();
      updateDashboard();
    });
  })
  .on('postgres_changes',{event:'*',schema:'public',table:'lich_su_gan_thiet_bi'},function(){
    _debounce('devices',function(){
      if(document.getElementById('view-devices')?.style.display!=='none') loadDevices();
    });
  })
  .subscribe();

_sb.channel('admin-hospitals-rt')
  .on('postgres_changes',{event:'*',schema:'public',table:'co_so_y_te'},function(){
    _debounce('hospitals',function(){
      if(document.getElementById('view-hospitals')?.style.display!=='none') loadHospitals();
      updateDashboard();
    });
  })
  .on('postgres_changes',{event:'*',schema:'public',table:'nguoi_dung'},function(){
    _debounce('hospitals',function(){
      if(document.getElementById('view-hospitals')?.style.display!=='none') loadHospitals();
    });
  })
  .subscribe();

function showNewLogToast(){
  let toast = document.getElementById('log-new-toast');
  if(!toast){
    toast = document.createElement('div');
    toast.id = 'log-new-toast';
    toast.style.cssText = 'position:fixed;bottom:80px;right:24px;background:var(--navy);color:#fff;padding:10px 16px;border-radius:10px;font-family:\'Sora\',sans-serif;font-size:.76rem;font-weight:600;cursor:pointer;z-index:999;box-shadow:0 4px 16px rgba(0,0,0,.2)';
    toast.onclick = function(){ logPage=1; loadLogs(); toast.remove(); };
    document.body.appendChild(toast);
  }
  toast.textContent = '🔔 Có nhật ký mới — nhấn để xem';
  clearTimeout(toast._timer);
  toast._timer = setTimeout(function(){ toast.remove(); }, 5000);
}

// ── SESSION CHECK ──
try {
  const s = JSON.parse(localStorage.getItem('hm_session')||'{}');
  const roles = s.roles || (s.role ? [s.role] : []);
  if(!s.userId || !roles.includes('admin')){
    localStorage.removeItem('hm_session');
    location.replace('index.html');
  }
} catch(_){ location.replace('index.html'); }

const AAPI = 'https://health-monitor-admin-ldk0.onrender.com';
const SESS = JSON.parse(localStorage.getItem('hm_session')||'{}');
const UID  = SESS.userId;

(function checkSessionExpiry(){
  if(!SESS.userId){ window.location.replace('index.html'); return; }
  if(SESS.expiresAt && Date.now() > SESS.expiresAt){
    localStorage.removeItem('hm_session');
    alert('Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.');
    window.location.replace('index.html');
    return;
  }
  setInterval(function(){
    const s = JSON.parse(localStorage.getItem('hm_session')||'{}');
    if(!s.userId || (s.expiresAt && Date.now() > s.expiresAt)){
      localStorage.removeItem('hm_session');
      alert('Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.');
      window.location.replace('index.html');
    }
  }, 60000);
})();

const esc = s => String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

let hospitalsCache = [];

// ── HỒ SƠ CÁ NHÂN ──
let _profileAvatarBase64 = null;
let _profileAvatarFile   = null;

function updateSidebarAvatar(src){
  const av = document.getElementById('sb-av');
  if(!av) return;
  if(src){ av.innerHTML='<img src="'+src+'" style="width:100%;height:100%;object-fit:cover;border-radius:50%"/>'; }
  else {
    const sess = JSON.parse(localStorage.getItem('hm_session')||'{}');
    av.textContent = (sess.name||'SA').split(' ').map(w=>w[0]).slice(-2).join('').toUpperCase();
  }
}

function previewAvatar(input){
  const file = input.files[0];
  if(!file) return;
  if(file.size > 5*1024*1024){ alert('Ảnh tối đa 5MB'); return; }
  _profileAvatarFile = file;
  const reader = new FileReader();
  reader.onload = function(e){
    const imgEl = document.getElementById('profile-av-img');
    imgEl.src = e.target.result; imgEl.style.display='block';
    document.getElementById('profile-av-initials').style.display='none';
  };
  reader.readAsDataURL(file);
}

async function uploadAvatarToStorage(file, userId){
  const ext  = file.name.split('.').pop().toLowerCase()||'jpg';
  const path = userId+'.'+ext;
  const allExts = ['jpg','jpeg','png','webp','gif'];
  await _sb.storage.from('avatars').remove(allExts.map(e => userId+'.'+e));
  const { error } = await _sb.storage.from('avatars').upload(path, file, {
    upsert: true, contentType: file.type,
  });
  if(error) throw new Error('Upload ảnh thất bại: '+error.message);
  const { data: urlData } = _sb.storage.from('avatars').getPublicUrl(path);
  return urlData.publicUrl + '?t=' + Date.now();
}

async function openProfile(){
  const sess = JSON.parse(localStorage.getItem('hm_session')||'{}');
  document.getElementById('pf-msg').textContent = '';
  _profileAvatarBase64 = null;
  _profileAvatarFile   = null;
  try {
    const r = await fetch(AAPI+'/profile/'+UID);
    if(r.ok){
      const d = await r.json();
      document.getElementById('pf-name').value  = d.name||sess.name||'';
      document.getElementById('pf-phone').value = d.phone||sess.phone||'';
      document.getElementById('pf-email').value = d.email||sess.email||'';
      const av = d.avatar||sess.avatar;
      const initials = (d.name||sess.name||'SA').split(' ').map(w=>w[0]).slice(-2).join('').toUpperCase();
      document.getElementById('profile-av-initials').textContent = initials;
      const imgEl = document.getElementById('profile-av-img');
      if(av){ imgEl.src=av; imgEl.style.display='block'; document.getElementById('profile-av-initials').style.display='none'; }
      else  { imgEl.style.display='none'; document.getElementById('profile-av-initials').style.display=''; }
    }
  } catch(_){
    document.getElementById('pf-name').value  = sess.name||'';
    document.getElementById('pf-phone').value = sess.phone||'';
    document.getElementById('pf-email').value = sess.email||'';
  }
  document.getElementById('modal-profile').classList.add('open');
}

async function saveProfile(){
  const name = document.getElementById('pf-name').value.trim();
  const msg  = document.getElementById('pf-msg');
  if(!name){ msg.style.color='var(--danger)'; msg.textContent='Vui lòng nhập họ tên'; return; }
  const btn = document.getElementById('pf-save-btn');
  btn.disabled=true; msg.style.color='var(--muted)'; msg.textContent='Đang lưu...';
  try {
    let avatarUrl = null;
    if(_profileAvatarFile){
      msg.textContent = 'Đang upload ảnh...';
      avatarUrl = await uploadAvatarToStorage(_profileAvatarFile, UID);
    }
    const body = {
      adminId: UID, name,
      phone: document.getElementById('pf-phone').value.trim()||null,
      email: document.getElementById('pf-email').value.trim()||null,
    };
    if(avatarUrl) body.avatar = avatarUrl;
    msg.textContent = 'Đang lưu thông tin...';
    const r = await fetch(AAPI+'/profile', {
      method:'PATCH', headers:{'Content-Type':'application/json'},
      body: JSON.stringify(body)
    });
    const d = await r.json();
    if(!r.ok) throw new Error(d.error||'Lỗi');
    const sess = JSON.parse(localStorage.getItem('hm_session')||'{}');
    sess.name=name; sess.phone=body.phone; sess.email=body.email;
    if(avatarUrl) sess.avatar=avatarUrl;
    localStorage.setItem('hm_session', JSON.stringify(sess));
    document.getElementById('sb-name').textContent=name;
    updateSidebarAvatar(sess.avatar||null);
    msg.style.color='var(--green)'; msg.textContent='✅ Đã cập nhật hồ sơ';
    setTimeout(()=>closeModal('modal-profile'),1500);
  } catch(e){ msg.style.color='var(--danger)'; msg.textContent='⚠️ '+esc(e.message); }
  btn.disabled=false;
}

function validateAdminPhone(el){
  let v = el.value.replace(/[^0-9]/g, '');
  const max = parseInt(el.getAttribute('maxlength'))||15;
  if(v.length > max) v = v.slice(0, max);
  el.value = v;
  if(v.length > 0 && v[0] !== '0'){
    el.style.borderColor = 'var(--danger)';
    el.title = 'Số điện thoại phải bắt đầu bằng 0';
  } else {
    el.style.borderColor = '';
    el.title = '';
  }
}

// ── FILTER CHUNG ──
const adminFilterState = { hs: {status:''}, sa: {status:''} };

function toggleAdminFilter(prefix){
  const panel = document.getElementById(prefix+'-filter-panel');
  const btn   = document.getElementById(prefix+'-filter-btn');
  const open  = panel.classList.toggle('open');
  btn.classList.toggle('active', open);
}

function selectAdminChip(el, prefix, key){
  el.closest('.filter-chips').querySelectorAll('.filter-chip').forEach(c=>c.classList.remove('on'));
  el.classList.add('on');
  adminFilterState[prefix][key] = el.dataset.val;
  applyAdminFilter(prefix);
}

function resetAdminFilter(prefix){
  adminFilterState[prefix] = {status:''};
  document.getElementById(prefix+'-filter-panel').querySelectorAll('.filter-chips').forEach(function(group){
    group.querySelectorAll('.filter-chip').forEach(c=>c.classList.remove('on'));
    group.querySelector('.filter-chip').classList.add('on');
  });
  updateAdminBadge(prefix, 0);
  applyAdminFilter(prefix);
}

function updateAdminBadge(prefix, count){
  const badge = document.getElementById(prefix+'-filter-badge');
  if(!badge) return;
  badge.textContent = count;
  badge.classList.toggle('show', count>0);
  document.getElementById(prefix+'-filter-btn')?.classList.toggle('active', count>0);
}

function applyAdminFilter(prefix){
  const s = adminFilterState[prefix];
  const count = s.status ? 1 : 0;
  updateAdminBadge(prefix, count);
  if(prefix==='hs')  applyHsFilter();
  if(prefix==='sa')  applySaFilter();
}

function applyHsFilter(){
  const s = adminFilterState.hs;
  const q = document.getElementById('hs-srch')?.value.toLowerCase()||'';
  hsFiltered = hospitalsCache.filter(function(h){
    if(q && !(h.ten_co_so||'').toLowerCase().includes(q) && !(h.dia_chi||'').toLowerCase().includes(q)) return false;
    if(s.status==='active'  && !h.trang_thai_hoat_dong) return false;
    if(s.status==='stopped' &&  h.trang_thai_hoat_dong) return false;
    return true;
  });
  hsPage=1; renderHospitals(hsFiltered);
}

function applySaFilter(){
  const s = adminFilterState.sa;
  const q = document.getElementById('sa-srch')?.value.toLowerCase()||'';
  saFiltered = saCache.filter(function(u){
    if(q && !(u.name||'').toLowerCase().includes(q) && !(u.email||'').toLowerCase().includes(q) && !(u.hospitalName||'').toLowerCase().includes(q)) return false;
    if(s.status==='active' && !u.active)  return false;
    if(s.status==='locked' &&  u.active)  return false;
    return true;
  });
  renderSubAdmins(saFiltered);
}

function filterHospitals(q){ hsPage=1; applyHsFilter(); }
function filterSubAdmins(q){ applySaFilter(); }

// ── CÀI ĐẶT ADMIN ──
function openAdminSettings(){
  ['adm-pw-old','adm-pw-new','adm-pw-cf'].forEach(id=>document.getElementById(id).value='');
  document.getElementById('adm-pw-msg').textContent='';
  const isDark = document.documentElement.getAttribute('data-theme')==='dark';
  document.getElementById('adm-dark-tgl').style.background = isDark?'var(--navy)':'var(--border)';
  document.getElementById('adm-dark-knob').style.left = isDark?'21px':'3px';
  const fv = parseInt(localStorage.getItem('adm_font'))||14;
  const labels={12:'Nhỏ',14:'Vừa',16:'Lớn'};
  document.querySelectorAll('.adm-fb').forEach(b=>b.classList.toggle('on', b.textContent.trim()===labels[fv]));
  document.getElementById('modal-admin-settings').classList.add('open');
}

function toggleAdminDark(){
  const html = document.documentElement;
  const isDark = html.getAttribute('data-theme')==='dark';
  html.setAttribute('data-theme', isDark?'light':'dark');
  localStorage.setItem('adm_theme', isDark?'light':'dark');
  document.getElementById('adm-dark-tgl').style.background = isDark?'var(--border)':'var(--navy)';
  document.getElementById('adm-dark-knob').style.left = isDark?'3px':'21px';
}

function setAdminFont(n, b){
  const sizes={12:'87.5%',14:'100%',16:'112.5%'};
  document.documentElement.style.fontSize = sizes[n]||'100%';
  localStorage.setItem('adm_font', n);
  document.querySelectorAll('.adm-fb').forEach(x=>x.classList.remove('on'));
  if(b) b.classList.add('on');
}

async function changeAdminPassword(){
  const oldPw = document.getElementById('adm-pw-old').value;
  const newPw = document.getElementById('adm-pw-new').value;
  const cfPw  = document.getElementById('adm-pw-cf').value;
  const msg   = document.getElementById('adm-pw-msg');
  if(!oldPw){ msg.style.color='var(--danger)'; msg.textContent='Vui lòng nhập mật khẩu hiện tại'; return; }
  if(newPw.length<6){ msg.style.color='var(--danger)'; msg.textContent='Mật khẩu mới phải ≥ 6 ký tự'; return; }
  if(newPw!==cfPw){ msg.style.color='var(--danger)'; msg.textContent='Mật khẩu xác nhận không khớp'; return; }
  msg.style.color='var(--muted)'; msg.textContent='Đang xử lý...';
  try {
    const r = await fetch(AAPI+'/auth/change-password',{
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({userId:UID, currentPassword:oldPw, newPassword:newPw})
    });
    const d = await r.json();
    if(!r.ok) throw new Error(d.error||'Lỗi');
    msg.style.color='var(--green)'; msg.textContent='✅ Đổi mật khẩu thành công!';
    setTimeout(()=>closeModal('modal-admin-settings'), 1500);
  } catch(e){ msg.style.color='var(--danger)'; msg.textContent='⚠️ '+esc(e.message); }
}

(function(){
  const t = localStorage.getItem('adm_theme');
  if(t) document.documentElement.setAttribute('data-theme', t);
  const f = parseInt(localStorage.getItem('adm_font'));
  if(f){ const sizes={12:'87.5%',14:'100%',16:'112.5%'}; document.documentElement.style.fontSize=sizes[f]||'100%'; }
})();

async function doLogout(){
  if(!confirm('Đăng xuất?')) return;
  try { await fetch(AAPI+'/auth/logout',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({userId:UID})}); } catch(_){}
  localStorage.removeItem('hm_session');
  location.replace('index.html');
}

// ── VIEW SWITCHING ──
const viewTitles = {
  dashboard:'Dashboard', hospitals:'Cơ sở y tế',
  subadmins:'Sub Admin', devices:'Thiết bị', logs:'Nhật ký hệ thống'
};
function switchView(name, btn){
  document.querySelectorAll('.sb-btn').forEach(b=>b.classList.remove('active'));
  if(btn) btn.classList.add('active');
  ['dashboard','hospitals','subadmins','devices','logs'].forEach(v=>{
    document.getElementById('view-'+v).style.display='none';
  });
  document.getElementById('view-'+name).style.display='flex';
  document.getElementById('page-title').textContent = viewTitles[name]||name;
  if(name==='dashboard')  loadDashboard();
  if(name==='hospitals')  loadHospitals();
  if(name==='subadmins')  loadSubAdmins();
  if(name==='devices')    loadDevices();
  if(name==='logs'){ loadLogs(); startLogRealtime(); }
}

// ── LOAD ADMIN INFO ──
async function loadInfo(){
  try {
    const s = JSON.parse(localStorage.getItem('hm_session')||'{}');
    if(s.name){
      document.getElementById('sb-name').textContent = s.name;
      if(s.avatar){
        updateSidebarAvatar(s.avatar);
      } else {
        const r = await fetch(AAPI+'/profile/'+UID);
        if(r.ok){
          const d = await r.json();
          if(d.avatar){
            s.avatar = d.avatar;
            localStorage.setItem('hm_session', JSON.stringify(s));
            updateSidebarAvatar(d.avatar);
          } else {
            const i = s.name.split(' ').map(w=>w[0]).slice(-2).join('').toUpperCase();
            document.getElementById('sb-av').textContent = i;
          }
        } else {
          const i = s.name.split(' ').map(w=>w[0]).slice(-2).join('').toUpperCase();
          document.getElementById('sb-av').textContent = i;
        }
      }
    }
  } catch(_){}
}

// ── DASHBOARD ──
let dashHsPage = 1;
const DASH_HS_PER_PAGE = 12;

async function loadDashboard(){
  try {
    const [rDash, rHs] = await Promise.all([
      fetch(AAPI+'/dashboard'),
      fetch(AAPI+'/hospitals'),
    ]);
    const d = rDash.ok ? await rDash.json() : {};
    hospitalsCache = rHs.ok ? await rHs.json() : [];

    document.getElementById('d-hospitals').textContent   = d.hospitals?.total  ?? '—';
    document.getElementById('d-dev-online').textContent  = d.devices?.online   ?? '—';
    document.getElementById('d-dev-total').textContent   = '/ '+(d.devices?.total ?? '—')+' thiết bị';
    document.getElementById('d-subadmins').textContent   = d.subadmins?.total  ?? '—';
    document.getElementById('d-dev-offline').textContent = d.devices?.offline  ?? '—';
    document.getElementById('last-upd').textContent     = new Date().toLocaleTimeString('vi-VN',{hour:'2-digit',minute:'2-digit'});

    dashHsPage = 1;
    renderDashHospitals();
  } catch(e){
    document.getElementById('dash-hospitals').innerHTML='<div class="loading">⚠️ '+esc(e.message)+'</div>';
  }
}

function updateDashboard(){ loadDashboard(); }

function dashHsGoPage(p){
  const total = Math.ceil(hospitalsCache.length/DASH_HS_PER_PAGE);
  if(p<1||p>total) return;
  dashHsPage = p;
  renderDashHospitals();
}

function renderDashHospitals(){
  const el = document.getElementById('dash-hospitals');
  if(!hospitalsCache.length){ el.innerHTML='<div class="loading">Chưa có cơ sở nào</div>'; return; }
  const typeLabel={'benh_vien':'Bệnh viện','phong_kham':'Phòng khám','trung_tam_y_te':'TT Y tế','vien_duong_lao':'Dưỡng lão','khac':'Khác'};
  const total = hospitalsCache.length;
  const pages = Math.ceil(total/DASH_HS_PER_PAGE);
  if(dashHsPage>pages) dashHsPage=1;
  const slice = hospitalsCache.slice((dashHsPage-1)*DASH_HS_PER_PAGE, dashHsPage*DASH_HS_PER_PAGE);

  let html = '<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Tên cơ sở</th><th>Loại hình</th><th>Thiết bị</th><th>Nhân sự</th><th>Trạng thái</th></tr></thead><tbody>'
    + slice.map(h=>'<tr>'
      +'<td style="font-weight:600">'+esc(h.ten_co_so)+'</td>'
      +'<td><span class="badge b-purple">'+esc(typeLabel[h.loai_hinh]||h.loai_hinh||'—')+'</span></td>'
      +'<td class="mono">'+h.deviceCount+' TB</td>'
      +'<td class="mono">'+h.staffCount+' người</td>'
      +'<td>'+(h.trang_thai_hoat_dong?'<span class="badge b-ok">● Hoạt động</span>':'<span class="badge b-off">○ Dừng</span>')+'</td>'
      +'</tr>').join('')
    +'</tbody></table></div>';

  if(pages>1){
    const S="font-family:'DM Mono',monospace;font-size:.72rem;font-weight:600;cursor:pointer;border-radius:7px;padding:5px 8px;";
    html+='<div style="display:flex;align-items:center;justify-content:space-between;padding:10px 16px;border-top:1px solid var(--border)">'
      +'<span style="font-size:.72rem;color:var(--muted)">Trang '+dashHsPage+'/'+pages+' — '+total+' cơ sở</span>'
      +'<div style="display:flex;gap:5px">'
      +'<button onclick="dashHsGoPage('+(dashHsPage-1)+')" '+(dashHsPage<=1?'disabled':'')+' style="'+S+'border:1.5px solid var(--border);background:var(--card);color:var(--muted)">←</button>';
    for(var i=1;i<=pages;i++){
      var a=i===dashHsPage;
      html+='<button onclick="dashHsGoPage('+i+')" style="'+S+'border:1.5px solid '+(a?'var(--navy)':'var(--border)')+';background:'+(a?'var(--navy)':'var(--card)')+';color:'+(a?'#fff':'var(--muted)')+'">'+i+'</button>';
    }
    html+='<button onclick="dashHsGoPage('+(dashHsPage+1)+')" '+(dashHsPage>=pages?'disabled':'')+' style="'+S+'border:1.5px solid var(--border);background:var(--card);color:var(--muted)">→</button>'
      +'</div></div>';
  }
  el.innerHTML = html;
}

// ── CƠ SỞ Y TẾ ──
async function loadHospitals(){
  const body = document.getElementById('hs-body');
  body.innerHTML='<div class="loading"><span class="spin"></span>Đang tải...</div>';
  try {
    const r = await fetch(AAPI+'/hospitals');
    hospitalsCache = r.ok ? await r.json() : [];
    hsFiltered = hospitalsCache;
    renderHospitals(hospitalsCache);
  } catch(e){ document.getElementById('hs-body').innerHTML='<div class="loading">⚠️ '+esc(e.message)+'</div>'; }
}

let hsFiltered = [];
let hsPage = 1;
const HS_PER_PAGE = 12;

function renderHospitals(list){
  const body = document.getElementById('hs-body');
  if(!list.length){ body.innerHTML='<div class="loading">Chưa có cơ sở nào</div>'; return; }
  const typeLabel={'benh_vien':'Bệnh viện','phong_kham':'Phòng khám','trung_tam_y_te':'TT Y tế','vien_duong_lao':'Dưỡng lão','khac':'Khác'};
  const total = list.length;
  const pages = Math.ceil(total/HS_PER_PAGE);
  if(hsPage>pages) hsPage=1;
  const slice = list.slice((hsPage-1)*HS_PER_PAGE, hsPage*HS_PER_PAGE);
  const BS = "font-size:.72rem;padding:5px 13px;border:none;border-radius:7px;font-family:'Sora',sans-serif;font-weight:600;cursor:pointer;";

  let html = '<div class="page-grid">'
    + slice.map(function(h){
      const cid  = 'hs-card-'+h.id;
      const init = (h.ten_co_so||'?').split(' ').map(function(w){return w[0];}).slice(0,2).join('').toUpperCase();
      const type = typeLabel[h.loai_hinh]||h.loai_hinh||'—';
      const statusTag = h.trang_thai_hoat_dong
        ? '<span class="card-tag" style="background:#e6f7e6;color:#2d7a2d">● Hoạt động</span>'
        : '<span class="card-tag" style="background:#f0f0f0;color:#888">○ Dừng</span>';
      return '<div class="page-card" id="'+cid+'" onclick="toggleHsCard(\''+cid+'\')">'
        +'<div class="page-card-head">'
        +'<div class="card-av" style="border-radius:10px;font-size:.8rem">'+init+'</div>'
        +'<div class="card-info">'
        +'<div class="card-name">'+esc(h.ten_co_so)+'</div>'
        +'<div class="card-sub">'+type+' · '+esc(h.dia_chi||'—')+'</div>'
        +'</div>'
        +statusTag
        +'<svg class="card-chev" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"/></svg>'
        +'</div>'
        +'<div class="page-card-body">'
        +'<div style="display:grid;grid-template-columns:1fr 1fr;gap:0 20px;margin-bottom:14px">'
        +'<div>'
        +'<div class="info-row"><span class="info-lbl">📞 Điện thoại</span><span class="info-val">'+esc(h.so_dien_thoai||'—')+'</span></div>'
        +'<div class="info-row"><span class="info-lbl">✉️ Email</span><span class="info-val" style="word-break:break-all;font-size:.7rem">'+esc(h.email_lien_he||'—')+'</span></div>'
        +'<div class="info-row"><span class="info-lbl">📍 Địa chỉ</span><span class="info-val">'+esc(h.dia_chi||'—')+'</span></div>'
        +'</div>'
        +'<div>'
        +'<div class="info-row"><span class="info-lbl">🏷️ Loại hình</span><span class="info-val">'+type+'</span></div>'
        +'<div class="info-row"><span class="info-lbl">📱 Thiết bị</span><span class="info-val">'+h.deviceCount+' thiết bị</span></div>'
        +'<div class="info-row"><span class="info-lbl">👥 Nhân sự</span><span class="info-val">'+h.staffCount+' người</span></div>'
        +'</div>'
        +'</div>'
        +'<div style="display:flex;gap:8px">'
        +'<button style="'+BS+'background:var(--navy);color:#fff" onclick="event.stopPropagation();openEditHospital(\''+h.id+'\',\''+esc(h.ten_co_so||'')+'\',\''+esc(h.dia_chi||'')+'\',\''+esc(h.so_dien_thoai||'')+'\',\''+esc(h.email_lien_he||'')+'\',\''+esc(h.loai_hinh||'')+'\')">✎ Sửa</button>'
        +'<button style="'+BS+'background:'+(h.trang_thai_hoat_dong?'#c0392b':'#27ae60')+';color:#fff" onclick="event.stopPropagation();toggleHospital(\''+h.id+'\','+h.trang_thai_hoat_dong+',\''+esc(h.ten_co_so||'')+'\')">'+(h.trang_thai_hoat_dong?'Dừng hoạt động':'Kích hoạt lại')+'</button>'
        +'</div>'
        +'</div>'
        +'</div>';
    }).join('')
  +'</div>';

  if(pages>1){
    const S="font-family:'DM Mono',monospace;font-size:.72rem;font-weight:600;cursor:pointer;border-radius:7px;padding:5px 8px;";
    html+='<div style="display:flex;align-items:center;justify-content:space-between;padding:10px 18px;border-top:1px solid var(--border)">'
      +'<span style="font-size:.72rem;color:var(--muted)">Trang '+hsPage+'/'+pages+' — '+total+' cơ sở</span>'
      +'<div style="display:flex;gap:5px">'
      +'<button onclick="hsGoPage('+(hsPage-1)+')" '+(hsPage<=1?'disabled':'')+' style="'+S+'border:1.5px solid var(--border);background:var(--card);color:var(--muted)">←</button>';
    for(var i=1;i<=pages;i++){
      var a=i===hsPage;
      html+='<button onclick="hsGoPage('+i+')" style="'+S+'border:1.5px solid '+(a?'var(--navy)':'var(--border)')+';background:'+(a?'var(--navy)':'var(--card)')+';color:'+(a?'#fff':'var(--muted)')+'">'+i+'</button>';
    }
    html+='<button onclick="hsGoPage('+(hsPage+1)+')" '+(hsPage>=pages?'disabled':'')+' style="'+S+'border:1.5px solid var(--border);background:var(--card);color:var(--muted)">→</button>'
      +'</div></div>';
  }
  body.innerHTML = html;
}

function hsGoPage(p){
  const total=Math.ceil(hsFiltered.length/HS_PER_PAGE);
  if(p<1||p>total) return;
  hsPage=p; renderHospitals(hsFiltered);
}

function toggleHsCard(id){ document.getElementById(id).classList.toggle('open'); }

// ── SỬA / XÓA SUB ADMIN ──
function openEditSubAdmin(id, name, email, phone, hospitalId){
  document.getElementById('esa-id').value    = id;
  document.getElementById('esa-name').value  = name;
  document.getElementById('esa-email').value = email;
  document.getElementById('esa-phone').value = phone;
  const sel = document.getElementById('esa-hospital');
  sel.innerHTML = '<option value="">— Chọn cơ sở —</option>'
    + hospitalsCache.map(h=>'<option value="'+h.id+'"'+(h.id===hospitalId?' selected':'')+'>'+esc(h.ten_co_so)+'</option>').join('');
  document.getElementById('esa-msg').textContent = '';
  document.getElementById('modal-edit-subadmin').classList.add('open');
}

async function saveEditSubAdmin(){
  const id   = document.getElementById('esa-id').value;
  const name = document.getElementById('esa-name').value.trim();
  const msg  = document.getElementById('esa-msg');
  if(!name){ msg.style.color='var(--danger)'; msg.textContent='Vui lòng nhập họ tên'; return; }
  const btn = document.getElementById('esa-save-btn');
  btn.disabled=true; msg.style.color='var(--muted)'; msg.textContent='Đang lưu...';
  try {
    const r = await fetch(AAPI+'/subadmins/'+id,{
      method:'PATCH', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({
        adminId:    UID,
        name:       name,
        email:      document.getElementById('esa-email').value.trim()||null,
        phone:      document.getElementById('esa-phone').value.trim()||null,
        hospitalId: document.getElementById('esa-hospital').value||null,
      })
    });
    const d = await r.json();
    if(!r.ok) throw new Error(d.error||'Lỗi');
    msg.style.color='var(--green)'; msg.textContent='✅ Đã cập nhật';
    setTimeout(()=>{ closeModal('modal-edit-subadmin'); loadSubAdmins(); }, 1200);
  } catch(e){ msg.style.color='var(--danger)'; msg.textContent='⚠️ '+esc(e.message); }
  btn.disabled=false;
}

async function deleteSubAdmin(id, name){
  if(!confirm('Xóa tài khoản Sub Admin: '+name+'?\n\nThao tác này không thể hoàn tác!')) return;
  try {
    const r = await fetch(AAPI+'/subadmins/'+id,{
      method:'DELETE', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({adminId:UID})
    });
    const d = await r.json();
    if(!r.ok) throw new Error(d.error||'Lỗi');
    loadSubAdmins();
  } catch(e){ alert('⚠️ '+e.message); }
}

// ── SỬA / XÓA THIẾT BỊ ──
function openEditDevice(id, serial, hospitalId){
  document.getElementById('ed-id').value     = id;
  document.getElementById('ed-serial').value = serial;
  const sel = document.getElementById('ed-hospital');
  sel.innerHTML = '<option value="">— Chọn cơ sở —</option>'
    + hospitalsCache.map(h=>'<option value="'+h.id+'"'+(h.id===hospitalId?' selected':'')+'>'+esc(h.ten_co_so)+'</option>').join('');
  document.getElementById('ed-msg').textContent = '';
  document.getElementById('modal-edit-device').classList.add('open');
}

async function saveEditDevice(){
  const id     = document.getElementById('ed-id').value;
  const serial = document.getElementById('ed-serial').value.trim();
  const msg    = document.getElementById('ed-msg');
  if(!serial){ msg.style.color='var(--danger)'; msg.textContent='Vui lòng nhập serial'; return; }
  const btn = document.getElementById('ed-save-btn');
  btn.disabled=true; msg.style.color='var(--muted)'; msg.textContent='Đang lưu...';
  try {
    const r = await fetch(AAPI+'/devices/'+id,{
      method:'PATCH', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({
        adminId:    UID,
        serial:     serial,
        hospitalId: document.getElementById('ed-hospital').value||null,
      })
    });
    const d = await r.json();
    if(!r.ok) throw new Error(d.error||'Lỗi');
    msg.style.color='var(--green)'; msg.textContent='✅ Đã cập nhật';
    setTimeout(()=>{ closeModal('modal-edit-device'); loadDevices(); }, 1200);
  } catch(e){ msg.style.color='var(--danger)'; msg.textContent='⚠️ '+esc(e.message); }
  btn.disabled=false;
}

async function deleteDevice(id, serial){
  if(!confirm('Xóa thiết bị: '+serial+'?\n\nLưu ý: Nếu thiết bị đang gán cho bệnh nhân, hãy thu hồi trước!\nThao tác này không thể hoàn tác!')) return;
  try {
    const r = await fetch(AAPI+'/devices/'+id,{
      method:'DELETE', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({adminId:UID})
    });
    const d = await r.json();
    if(!r.ok) throw new Error(d.error||'Lỗi');
    loadDevices();
  } catch(e){ alert('⚠️ '+e.message); }
}

function openEditHospital(id, name, addr, phone, email, type){
  document.getElementById('eh-id').value    = id;
  document.getElementById('eh-name').value  = name;
  document.getElementById('eh-addr').value  = addr;
  document.getElementById('eh-phone').value = phone;
  document.getElementById('eh-email').value = email;
  document.getElementById('eh-type').value  = type||'benh_vien';
  document.getElementById('eh-msg').textContent = '';
  document.getElementById('modal-edit-hospital').classList.add('open');
}

async function saveEditHospital(){
  const id   = document.getElementById('eh-id').value;
  const name = document.getElementById('eh-name').value.trim();
  const msg  = document.getElementById('eh-msg');
  if(!name){ msg.style.color='var(--danger)'; msg.textContent='Vui lòng nhập tên cơ sở'; return; }
  const btn = document.getElementById('eh-save-btn');
  btn.disabled=true; msg.style.color='var(--muted)'; msg.textContent='Đang lưu...';
  try {
    const r = await fetch(AAPI+'/hospitals/'+id,{
      method:'PATCH', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({
        adminId: UID,
        name:    name,
        address: document.getElementById('eh-addr').value.trim()||null,
        phone:   document.getElementById('eh-phone').value.trim()||null,
        email:   document.getElementById('eh-email').value.trim()||null,
        type:    document.getElementById('eh-type').value||null,
      })
    });
    const d = await r.json();
    if(!r.ok) throw new Error(d.error||'Lỗi');
    msg.style.color='var(--green)'; msg.textContent='✅ Đã cập nhật thành công';
    setTimeout(()=>{ closeModal('modal-edit-hospital'); loadHospitals(); }, 1200);
  } catch(e){ msg.style.color='var(--danger)'; msg.textContent='⚠️ '+esc(e.message); }
  btn.disabled=false;
}

let _stopHospitalId   = null;
let _stopHospitalName = null;

async function toggleHospital(id, currentActive, name){
  if(!currentActive){
    if(!confirm('Kích hoạt lại cơ sở: '+name+'?')) return;
    try {
      const r = await fetch(AAPI+'/hospitals/'+id,{
        method:'PATCH', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({adminId:UID, active:true})
      });
      if(r.ok) loadHospitals();
      else { const d=await r.json(); showStopError([d.error||'Lỗi không xác định']); }
    } catch(e){ showStopError([e.message]); }
    return;
  }
  _stopHospitalId   = id;
  _stopHospitalName = name;
  document.getElementById('confirm-stop-name').textContent = '🏥 '+name;
  document.getElementById('modal-confirm-stop').classList.add('open');
}

function closeConfirmStop(){
  document.getElementById('modal-confirm-stop').classList.remove('open');
  _stopHospitalId = null;
}

async function doStopHospital(){
  if(!_stopHospitalId) return;
  const btn = document.getElementById('confirm-stop-btn');
  btn.disabled = true; btn.textContent = 'Đang kiểm tra...';
  try {
    const r = await fetch(AAPI+'/hospitals/'+_stopHospitalId,{
      method:'PATCH', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({adminId:UID, active:false})
    });
    const d = await r.json();
    closeConfirmStop();
    if(r.ok){
      loadHospitals();
    } else if(r.status === 409){
      showStopError(d.details||[d.error||'Lỗi không xác định'], d.reason);
    } else {
      showStopError([d.error||'Lỗi không xác định']);
    }
  } catch(e){ closeConfirmStop(); showStopError([e.message]); }
  btn.disabled = false; btn.textContent = 'Xác nhận dừng';
}

function showStopError(details, reason){
  const el = document.getElementById('stop-error-details');
  const reasonEl = document.querySelector('#modal-stop-error .modal-ttl + div');
  if(reason && reasonEl) reasonEl.textContent = reason;
  el.innerHTML = details.map(function(s){
    return '<div style="display:flex;align-items:center;gap:8px;padding:8px 12px;background:var(--card);border:1px solid var(--border);border-radius:8px;font-size:.78rem;font-weight:600;color:var(--text)">'
      +'<span style="color:#c0392b;font-size:.9rem">•</span>'+esc(s)+'</div>';
  }).join('');
  document.getElementById('modal-stop-error').classList.add('open');
}

function openAddHospital(){
  ['hs-name','hs-phone','hs-addr','hs-email'].forEach(id=>document.getElementById(id).value='');
  document.getElementById('hs-type').value='benh_vien';
  document.getElementById('hs-msg').textContent='';
  document.getElementById('modal-hospital').classList.add('open');
}

async function saveHospital(){
  const name = document.getElementById('hs-name').value.trim();
  const msg  = document.getElementById('hs-msg');
  if(!name){msg.style.color='var(--danger)';msg.textContent='Vui lòng nhập tên cơ sở';return;}
  const btn = document.getElementById('hs-save-btn');
  btn.disabled=true; msg.style.color='var(--muted)'; msg.textContent='Đang tạo...';
  try {
    const r = await fetch(AAPI+'/hospitals',{
      method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({
        adminId:UID, name,
        address:document.getElementById('hs-addr').value.trim()||null,
        phone:document.getElementById('hs-phone').value.trim()||null,
        email:document.getElementById('hs-email').value.trim()||null,
        type:document.getElementById('hs-type').value,
      })
    });
    const d=await r.json();
    if(r.ok){
      msg.style.color='var(--green)'; msg.textContent='✅ Đã tạo: '+esc(name);
      setTimeout(()=>{closeModal('modal-hospital');loadHospitals();},1200);
    } else { msg.style.color='var(--danger)'; msg.textContent='⚠️ '+(d.error||'Lỗi'); }
  } catch(e){ msg.style.color='var(--danger)'; msg.textContent='⚠️ Không thể kết nối'; }
  btn.disabled=false;
}

// ── SUB ADMIN ──
let saCache    = [];
let saFiltered = [];

function renderSubAdmins(list){
  const body = document.getElementById('sa-body');
  if(!list.length){ body.innerHTML='<div class="loading">Chưa có Sub Admin nào</div>'; return; }
  const BS = "font-size:.72rem;padding:5px 13px;border:none;border-radius:7px;font-family:'Sora',sans-serif;font-weight:600;cursor:pointer;";
  body.innerHTML = '<div class="page-grid">'
    + list.map(function(u){
      const cid  = 'sa-card-'+u.id;
      const init = (u.name||'SA').split(' ').map(function(w){return w[0];}).slice(-2).join('').toUpperCase();
      const lastLogin = u.lastLogin ? new Date(u.lastLogin).toLocaleString('vi-VN',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'}) : 'Chưa đăng nhập';
      const statusTag = u.active
        ? '<span class="card-tag" style="background:#e6f7e6;color:#2d7a2d">● Hoạt động</span>'
        : '<span class="card-tag" style="background:#fdeaea;color:#c0392b">○ Đã khoá</span>';
      return '<div class="page-card" id="'+cid+'" onclick="toggleSaCard(\''+cid+'\')">'
        +'<div class="page-card-head">'
        +'<div class="card-av">'+init+'</div>'
        +'<div class="card-info">'
        +'<div class="card-name">'+esc(u.name)+'</div>'
        +'<div class="card-sub">'+esc(u.hospitalName||'Chưa gán')+'</div>'
        +'</div>'
        +statusTag
        +'<svg class="card-chev" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"/></svg>'
        +'</div>'
        +'<div class="page-card-body">'
        +'<div style="display:grid;grid-template-columns:1fr 1fr;gap:0 20px;margin-bottom:14px">'
        +'<div>'
        +'<div class="info-row"><span class="info-lbl">✉️ Email</span><span class="info-val" style="word-break:break-all;font-size:.7rem">'+esc(u.email||'—')+'</span></div>'
        +'<div class="info-row"><span class="info-lbl">📞 SĐT</span><span class="info-val">'+esc(u.phone||'—')+'</span></div>'
        +'</div>'
        +'<div>'
        +'<div class="info-row"><span class="info-lbl">🏥 Cơ sở</span><span class="info-val">'+esc(u.hospitalName||'—')+'</span></div>'
        +'<div class="info-row"><span class="info-lbl">🕐 Đăng nhập</span><span class="info-val" style="font-size:.7rem">'+lastLogin+'</span></div>'
        +'</div>'
        +'</div>'
        +'<div style="display:flex;gap:8px">'
        +'<button style="'+BS+'background:var(--navy);color:#fff" onclick="event.stopPropagation();openEditSubAdmin(\''+u.id+'\',\''+esc(u.name)+'\',\''+esc(u.email||'')+'\',\''+esc(u.phone||'')+'\',\''+u.hospitalId+'\')">✎ Sửa</button>'
        +'<button style="'+BS+'background:'+(u.active?'#c0392b':'#27ae60')+';color:#fff" onclick="event.stopPropagation();toggleSubAdmin(\''+u.id+'\','+u.active+')">'+(u.active?'Khoá':'Mở khoá')+'</button>'
        +'<button style="'+BS+'background:#7f8c8d;color:#fff" onclick="event.stopPropagation();deleteSubAdmin(\''+u.id+'\',\''+esc(u.name)+'\')">✕ Xóa</button>'
        +'</div>'
        +'</div>'
        +'</div>';
    }).join('')
  +'</div>';
}

function toggleSaCard(id){ document.getElementById(id).classList.toggle('open'); }

async function loadSubAdmins(){
  const body = document.getElementById('sa-body');
  body.innerHTML='<div class="loading"><span class="spin"></span>Đang tải...</div>';
  try {
    const r = await fetch(AAPI+'/subadmins');
    saCache = r.ok ? await r.json() : [];
    saFiltered = saCache;
    renderSubAdmins(saCache);
  } catch(e){ body.innerHTML='<div class="loading">⚠️ '+esc(e.message)+'</div>'; }
}

async function toggleSubAdmin(id, currentActive){
  if(!confirm((currentActive?'Khoá':'Mở khoá')+' tài khoản này?')) return;
  try {
    const r = await fetch(AAPI+'/subadmins/'+id,{
      method:'PATCH',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({adminId:UID, active:!currentActive})
    });
    if(r.ok) loadSubAdmins();
    else alert('⚠️ Lỗi');
  } catch(e){ alert('⚠️ '+e.message); }
}

function openAddSubAdmin(){
  ['sa-name','sa-email','sa-phone'].forEach(id=>document.getElementById(id).value='');
  document.getElementById('sa-pw').value='123456';
  document.getElementById('sa-msg').textContent='';
  const sel=document.getElementById('sa-hospital');
  sel.innerHTML='<option value="">— Chọn cơ sở —</option>'
    +hospitalsCache.filter(h=>h.trang_thai_hoat_dong).map(h=>'<option value="'+h.id+'">'+esc(h.ten_co_so)+'</option>').join('');
  document.getElementById('modal-subadmin').classList.add('open');
}

async function saveSubAdmin(){
  const name  = document.getElementById('sa-name').value.trim();
  const email = document.getElementById('sa-email').value.trim();
  const hsId  = document.getElementById('sa-hospital').value;
  const msg   = document.getElementById('sa-msg');
  if(!name||!email||!hsId){msg.style.color='var(--danger)';msg.textContent='Vui lòng điền đủ thông tin bắt buộc';return;}
  const btn=document.getElementById('sa-save-btn');
  btn.disabled=true; msg.style.color='var(--muted)'; msg.textContent='Đang tạo...';
  try {
    const r=await fetch(AAPI+'/subadmins',{
      method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({
        adminId:UID, name, email,
        phone:document.getElementById('sa-phone').value.trim()||null,
        password:document.getElementById('sa-pw').value.trim()||'123456',
        hospitalId:hsId,
      })
    });
    const d=await r.json();
    if(r.ok){
      msg.style.color='var(--green)'; msg.textContent='✅ Đã tạo: '+esc(name);
      setTimeout(()=>{closeModal('modal-subadmin');loadSubAdmins();},1200);
    } else { msg.style.color='var(--danger)'; msg.textContent='⚠️ '+(d.error||'Lỗi'); }
  } catch(e){ msg.style.color='var(--danger)'; msg.textContent='⚠️ Không thể kết nối'; }
  btn.disabled=false;
}

// ── THIẾT BỊ ──
let devAllData   = [];
let devFiltered  = [];
let devPage      = 1;
const DEV_PER_PAGE = 20;

async function loadDevices(){
  const tbody = document.getElementById('dev-tbody');
  tbody.innerHTML='<tr><td colspan="7"><div class="loading"><span class="spin"></span>Đang tải...</div></td></tr>';
  try {
    const r = await fetch(AAPI+'/devices');
    devAllData = r.ok ? await r.json() : [];

    const sel = document.getElementById('flt-hospital');
    const hsSet = new Map();
    devAllData.forEach(d=>{ if(d.hospitalId) hsSet.set(d.hospitalId, d.hospitalName); });
    sel.innerHTML = '<option value="">Tất cả cơ sở</option>'
      + [...hsSet.entries()].map(([id,name])=>'<option value="'+id+'">'+esc(name)+'</option>').join('');

    devPage = 1;
    applyDevFilter();
  } catch(e){
    document.getElementById('dev-tbody').innerHTML='<tr><td colspan="7"><div class="loading">⚠️ '+esc(e.message)+'</div></td></tr>';
  }
}

function applyDevFilter(){
  const serial    = (document.getElementById('flt-serial')?.value||'').toLowerCase().trim();
  const hsId      = document.getElementById('flt-hospital')?.value||'';
  const status    = document.getElementById('flt-status')?.value||'';
  const battery   = document.getElementById('flt-battery')?.value||'';
  const dateFrom  = document.getElementById('flt-date-from')?.value||'';
  const dateTo    = document.getElementById('flt-date-to')?.value||'';

  const isFiltering = serial||hsId||status||battery||dateFrom||dateTo;
  document.getElementById('dev-filter-badge').style.display = isFiltering ? 'inline' : 'none';

  devFiltered = devAllData.filter(function(d){
    if(serial && !((d.serial||'').toLowerCase().includes(serial))) return false;
    if(hsId && d.hospitalId !== hsId) return false;
    if(status === 'online' && !d.online) return false;
    if(status === 'offline' && d.online) return false;
    const bat = d.battery;
    if(battery === 'critical' && !(bat != null && bat < 10))    return false;
    if(battery === 'low'      && !(bat != null && bat >= 10 && bat < 20))  return false;
    if(battery === 'medium'   && !(bat != null && bat >= 20 && bat <= 50)) return false;
    if(battery === 'high'     && !(bat != null && bat > 50))    return false;
    if(dateFrom || dateTo){
      const regDate = d.registeredAt ? new Date(d.registeredAt) : null;
      if(!regDate) return false;
      if(dateFrom && regDate < new Date(dateFrom+'T00:00:00')) return false;
      if(dateTo   && regDate > new Date(dateTo+'T23:59:59'))   return false;
    }
    return true;
  });

  document.getElementById('dev-count').textContent = devFiltered.length;
  devPage = 1;
  renderDevPage();
}

function renderDevPage(){
  const tbody = document.getElementById('dev-tbody');
  const total = devFiltered.length;
  const pages = Math.max(1, Math.ceil(total/DEV_PER_PAGE));
  if(devPage>pages) devPage=pages;
  const start = (devPage-1)*DEV_PER_PAGE;
  const slice = devFiltered.slice(start, start+DEV_PER_PAGE);

  if(!slice.length){
    tbody.innerHTML='<tr><td colspan="7"><div class="loading">Không có thiết bị nào phù hợp</div></td></tr>';
  } else {
    tbody.innerHTML = slice.map(function(d){
      const bat = d.battery;
      const batColor = bat!=null?(bat<10?'var(--danger)':bat<20?'var(--warn)':'var(--green)'):'var(--muted)';
      const batBar = bat!=null
        ?'<div style="display:flex;align-items:center;gap:6px">'
          +'<div style="width:44px;height:6px;background:var(--border);border-radius:3px;overflow:hidden">'
          +'<div style="height:100%;width:'+bat+'%;background:'+batColor+';border-radius:3px"></div></div>'
          +'<span style="font-family:\'DM Mono\',monospace;font-size:.74rem;font-weight:700;color:'+batColor+'">'+bat+'%</span>'
          +'</div>'
        :'<span class="mono">—</span>';
      return '<tr>'
        +'<td style="font-family:\'DM Mono\',monospace;font-weight:700;color:var(--navy)">'+esc(d.serial)+'</td>'
        +'<td><span class="badge b-purple">'+esc(d.hospitalName||'—')+'</span></td>'
        +'<td>'+batBar+'</td>'
        +'<td>'+(d.online?'<span class="badge b-ok">● Online</span>':'<span class="badge b-off">○ Offline</span>')+'</td>'
        +'<td class="mono">'+(d.lastOnline?new Date(d.lastOnline).toLocaleString('vi-VN',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'}):'—')+'</td>'
        +'<td class="mono">'+(d.registeredAt?new Date(d.registeredAt).toLocaleDateString('vi-VN'):'—')+'</td>'
        +'<td style="display:flex;gap:5px">'
        +'<button style="font-size:.7rem;padding:4px 10px;border:none;border-radius:7px;background:var(--navy);color:#fff;font-family:\'Sora\',sans-serif;font-weight:600;cursor:pointer" onclick="openEditDevice(\''+d.id+'\',\''+esc(d.serial)+'\',\''+esc(d.hospitalId||'')+'\')">✎ Sửa</button>'
        +'<button style="font-size:.7rem;padding:4px 10px;border:none;border-radius:7px;background:#c0392b;color:#fff;font-family:\'Sora\',sans-serif;font-weight:600;cursor:pointer" onclick="deleteDevice(\''+d.id+'\',\''+esc(d.serial)+'\')">✕ Xóa</button>'
        +'</td>'
        +'</tr>';
    }).join('');
  }

  const from = total===0?0:start+1, to = Math.min(start+DEV_PER_PAGE,total);
  document.getElementById('dev-page-info').textContent =
    'Trang '+devPage+' / '+pages+' — hiển thị '+from+'–'+to+' trong '+total+' thiết bị';

  const pgDiv = document.getElementById('dev-page-btns');
  const S = "font-family:'DM Mono',monospace;font-size:.74rem;font-weight:600;cursor:pointer;border-radius:7px;padding:5px 8px;";
  let btns = '<button onclick="goDevPage('+(devPage-1)+')" '+(devPage<=1?'disabled':'')+' style="'+S+'border:1.5px solid var(--border);background:var(--card);color:var(--muted)">← Trước</button>';
  const range = getPageRange(devPage, pages);
  range.forEach(function(p){
    if(p==='...'){ btns+='<span style="padding:5px 4px;color:var(--muted);font-size:.8rem">···</span>'; }
    else { var a=p===devPage; btns+='<button onclick="goDevPage('+p+')" style="'+S+'border:1.5px solid '+(a?'var(--navy)':'var(--border)')+';background:'+(a?'var(--navy)':'var(--card)')+';color:'+(a?'#fff':'var(--muted)')+'">'+p+'</button>'; }
  });
  btns+='<button onclick="goDevPage('+(devPage+1)+')" '+(devPage>=pages?'disabled':'')+' style="'+S+'border:1.5px solid var(--border);background:var(--card);color:var(--muted)">Tiếp →</button>';
  pgDiv.innerHTML = btns;
}

function goDevPage(p){
  const pages = Math.max(1, Math.ceil(devFiltered.length / DEV_PER_PAGE));
  if(p < 1 || p > pages) return;
  devPage = p;
  renderDevPage();
  document.getElementById('view-devices').scrollTo({top:0,behavior:'smooth'});
}

function getPageRange(current, total){
  if(total <= 7) return Array.from({length:total},(_,i)=>i+1);
  const range = [];
  if(current <= 4){
    for(let i=1;i<=5;i++) range.push(i);
    range.push('...'); range.push(total);
  } else if(current >= total-3){
    range.push(1); range.push('...');
    for(let i=total-4;i<=total;i++) range.push(i);
  } else {
    range.push(1); range.push('...');
    for(let i=current-1;i<=current+1;i++) range.push(i);
    range.push('...'); range.push(total);
  }
  return range;
}

function resetDevFilter(){
  ['flt-serial','flt-date-from','flt-date-to'].forEach(id=>{
    const el=document.getElementById(id); if(el) el.value='';
  });
  ['flt-hospital','flt-status','flt-battery'].forEach(id=>{
    const el=document.getElementById(id); if(el) el.value='';
  });
  applyDevFilter();
}

function openAddDevice(){
  document.getElementById('dev-serial').value='';
  document.getElementById('dev-fw').value='';
  document.getElementById('dev-msg').textContent='';
  const sel=document.getElementById('dev-hospital');
  sel.innerHTML='<option value="">— Chọn cơ sở —</option>'
    +hospitalsCache.filter(h=>h.trang_thai_hoat_dong).map(h=>'<option value="'+h.id+'">'+esc(h.ten_co_so)+'</option>').join('');
  document.getElementById('modal-device').classList.add('open');
  setTimeout(()=>document.getElementById('dev-serial').focus(),100);
}

async function saveDevice(){
  const serial=document.getElementById('dev-serial').value.trim();
  const hsId=document.getElementById('dev-hospital').value;
  const msg=document.getElementById('dev-msg');
  if(!serial||!hsId){msg.style.color='var(--danger)';msg.textContent='Vui lòng nhập serial và chọn cơ sở';return;}
  const btn=document.getElementById('dev-save-btn');
  btn.disabled=true; msg.style.color='var(--muted)'; msg.textContent='Đang đăng ký...';
  try {
    const r=await fetch(AAPI+'/devices',{
      method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({adminId:UID,serial,hospitalId:hsId,firmware:document.getElementById('dev-fw').value.trim()||null})
    });
    const d=await r.json();
    if(r.ok){
      msg.style.color='var(--green)'; msg.textContent='✅ Đã đăng ký: '+serial;
      document.getElementById('dev-serial').value='';
      document.getElementById('dev-fw').value='';
      loadDevices();
    } else { msg.style.color='var(--danger)'; msg.textContent='⚠️ '+(d.error||'Lỗi'); }
  } catch(e){ msg.style.color='var(--danger)'; msg.textContent='⚠️ Không thể kết nối'; }
  btn.disabled=false;
}

// ── NHẬT KÝ ──
let logPage = 1;
const LOG_PER_PAGE = 8;

const TABLE_LABEL = {
  nguoi_dung:'Người dùng', thiet_bi_iot:'Thiết bị IoT',
  lien_ket_bac_si:'Liên kết bác sĩ', lien_ket_nguoi_nha:'Liên kết người nhà',
  lich_su_gan_thiet_bi:'Gán thiết bị', co_so_y_te:'Cơ sở y tế',
  ho_so_benh_nhan:'Hồ sơ bệnh nhân',
};
const ACTION_LABEL = {
  CREATE:'Hệ thống tự động — Tạo mới', UPDATE:'Hệ thống tự động — Cập nhật', DELETE:'Hệ thống tự động — Xóa',
  LOGIN:'Đăng nhập',
  CREATE_HOSPITAL:'Tạo cơ sở y tế', UPDATE_HOSPITAL:'Cập nhật CSYT',
  CREATE_SUBADMIN:'Tạo tài khoản Sub Admin', UPDATE_SUBADMIN:'Cập nhật Sub Admin', DELETE_SUBADMIN:'Xóa Sub Admin',
  UPDATE_DEVICE:'Cập nhật thiết bị', DELETE_DEVICE:'Xóa thiết bị', CREATE_DEVICE:'Thêm thiết bị',
  CHANGE_PASSWORD:'Đổi mật khẩu', LOGOUT:'Đăng xuất',
  CREATE_PATIENT:'Tiếp nhận bệnh nhân mới', UPDATE_PATIENT:'Cập nhật bệnh nhân', DELETE_PATIENT:'Xóa bệnh nhân',
  CREATE_DOCTOR:'Tạo tài khoản bác sĩ', UPDATE_DOCTOR:'Cập nhật bác sĩ',
  CREATE_FAMILY:'Tạo tài khoản người nhà', UPDATE_FAMILY:'Cập nhật người nhà', DELETE_FAMILY:'Xóa liên kết người nhà',
  ASSIGN_DOCTOR:'Phân công bác sĩ', ASSIGN_DEVICE:'Gán thiết bị',
};
const ACTION_CLASS = {
  CREATE:'CREATE', UPDATE:'UPDATE', DELETE:'DELETE', LOGIN:'LOGIN',
  CREATE_HOSPITAL:'CREATE', UPDATE_HOSPITAL:'UPDATE',
  CREATE_SUBADMIN:'CREATE', UPDATE_SUBADMIN:'UPDATE', DELETE_SUBADMIN:'DELETE',
  UPDATE_DEVICE:'UPDATE', DELETE_DEVICE:'DELETE', CREATE_DEVICE:'CREATE',
  CHANGE_PASSWORD:'OTHER', LOGOUT:'LOGIN',
  CREATE_PATIENT:'CREATE', UPDATE_PATIENT:'UPDATE', DELETE_PATIENT:'DELETE',
  CREATE_DOCTOR:'CREATE', UPDATE_DOCTOR:'UPDATE',
  CREATE_FAMILY:'CREATE', UPDATE_FAMILY:'UPDATE', DELETE_FAMILY:'DELETE',
  ASSIGN_DOCTOR:'UPDATE', ASSIGN_DEVICE:'UPDATE',
};

function resetLogFilter(){
  ['log-flt-action','log-flt-target','log-flt-from','log-flt-to'].forEach(function(id){
    document.getElementById(id).value='';
  });
  logPage=1; loadLogs();
}

function logGoPage(p){ logPage=p; loadLogs(); }

async function loadLogs(){
  const body = document.getElementById('log-body');
  body.innerHTML='<div class="loading"><span class="spin"></span>Đang tải nhật ký...</div>';

  const action   = document.getElementById('log-flt-action').value;
  const target   = document.getElementById('log-flt-target').value;
  const dateFrom = document.getElementById('log-flt-from').value;
  const dateTo   = document.getElementById('log-flt-to').value;

  let url = AAPI+'/logs?page='+logPage+'&limit='+LOG_PER_PAGE;
  if(action)   url+='&action='+encodeURIComponent(action);
  if(target)   url+='&target='+encodeURIComponent(target);
  if(dateFrom) url+='&dateFrom='+dateFrom;
  if(dateTo)   url+='&dateTo='+dateTo;

  try {
    const r = await fetch(url);
    const res = r.ok ? await r.json() : {data:[],total:0};
    const list = res.data||[];
    const total = res.total||0;
    const pages = Math.max(1, Math.ceil(total/LOG_PER_PAGE));

    if(!list.length){
      body.innerHTML='<div class="loading" style="padding:24px">Chưa có nhật ký nào phù hợp</div>';
      document.getElementById('log-pagination').style.display='none';
      return;
    }

    body.innerHTML = list.map(function(l){
      const ac = ACTION_CLASS[l.action]||'OTHER';
      const time = l.time ? new Date(l.time).toLocaleString('vi-VN',{
        day:'2-digit',month:'2-digit',year:'numeric',
        hour:'2-digit',minute:'2-digit',second:'2-digit'
      }) : '—';

      let detail = null;
      try { detail = l.detail ? (typeof l.detail==='string' ? JSON.parse(l.detail) : l.detail) : null; } catch(_){}

      function getSmartLabel(){
        const base = ACTION_LABEL[l.action]||l.action;
        if(l.action !== 'CREATE' && l.action !== 'UPDATE' && l.action !== 'DELETE') return base;
        const d = detail?.after || detail || {};
        const hoTen = d.ho_ten || '';
        if(l.targetType==='nguoi_dung'){
          if(l.action==='CREATE') return 'Tạo tài khoản'+(hoTen?' — '+hoTen:'');
          if(l.action==='UPDATE') return 'Cập nhật tài khoản'+(hoTen?' — '+hoTen:'');
          if(l.action==='DELETE') return 'Xóa tài khoản'+(hoTen?' — '+hoTen:'');
        }
        if(l.targetType==='co_so_y_te'){
          const ten = d.ten_co_so||'';
          if(l.action==='CREATE') return 'Tạo cơ sở y tế'+(ten?' — '+ten:'');
          if(l.action==='UPDATE') return 'Cập nhật CSYT'+(ten?' — '+ten:'');
        }
        if(l.targetType==='lien_ket_bac_si') return l.action==='CREATE'?'Tạo liên kết BS—BN':'Xóa liên kết BS—BN';
        if(l.targetType==='lien_ket_nguoi_nha'){
          if(l.action==='CREATE') return 'Tạo liên kết người nhà—BN';
          if(l.action==='UPDATE') return 'Cập nhật liên kết người nhà';
          if(l.action==='DELETE') return 'Xóa liên kết người nhà—BN';
        }
        if(l.targetType==='lich_su_gan_thiet_bi') return l.action==='CREATE'?'Gán thiết bị':'Cập nhật gán thiết bị';
        if(l.targetType==='ho_so_benh_nhan') return l.action==='CREATE'?'Tạo hồ sơ BN':'Cập nhật hồ sơ BN';
        if(l.targetType==='thiet_bi_iot'){
          const serial = d.so_seri||'';
          if(l.action==='CREATE') return 'Thêm thiết bị'+(serial?' — '+serial:'');
          if(l.action==='UPDATE') return 'Cập nhật thiết bị'+(serial?' — '+serial:'');
        }
        return base;
      }

      function getDetail(){
        if(!detail) return '<span style="color:var(--muted);font-size:.7rem">—</span>';
        const d = detail?.after || detail || {};
        const parts = [];
        if(d.ho_ten)        parts.push('<span class="mono" style="font-weight:600;color:var(--navy)">'+esc(d.ho_ten)+'</span>');
        if(d.so_dien_thoai) parts.push('📞 '+esc(d.so_dien_thoai));
        if(d.email)         parts.push('✉️ '+esc(d.email));
        if(d.ten_co_so)     parts.push('🏥 '+esc(d.ten_co_so));
        if(d.so_seri)       parts.push('<span class="mono">'+esc(d.so_seri)+'</span>');
        return parts.length
          ? '<div style="display:flex;flex-wrap:wrap;gap:6px;font-size:.7rem;color:var(--text)">'+parts.join('')+'</div>'
          : '<span style="color:var(--muted);font-size:.7rem">'+esc(l.targetType||'—')+'</span>';
      }

      const smartLabel = getSmartLabel();
      const tableLabel = TABLE_LABEL[l.targetType]||l.targetType||'—';
      const userName   = l.userName||'Hệ thống';
      const initials   = userName.split(' ').map(function(w){return w[0];}).slice(-2).join('').toUpperCase();

      return '<tr>'
        +'<td class="mono" style="font-size:.7rem;color:var(--muted);white-space:nowrap">'+time+'</td>'
        +'<td>'
        +(l.userName
          ?'<div style="display:flex;align-items:center;gap:7px">'
            +'<div style="width:28px;height:28px;border-radius:50%;background:var(--navy);color:#fff;display:flex;align-items:center;justify-content:center;font-size:.62rem;font-weight:800;flex-shrink:0">'+initials+'</div>'
            +'<div><div style="font-size:.76rem;font-weight:600;color:var(--text)">'+esc(l.userName)+'</div>'
            +(l.userEmail?'<div style="font-size:.64rem;color:var(--muted)">'+esc(l.userEmail)+'</div>':'')
            +'</div></div>'
          :'<span style="font-size:.7rem;color:var(--muted);font-style:italic">Hệ thống tự động</span>')
        +'</td>'
        +'<td><span class="log-action-badge '+ac+'" style="font-size:.68rem">'+esc(smartLabel)+'</span>'
        +'<div style="font-size:.62rem;color:var(--muted);margin-top:3px">🗂 '+esc(tableLabel)+'</div></td>'
        +'<td>'+getDetail()+'</td>'
        +'</tr>';
    }).join('');

    const pgEl = document.getElementById('log-pagination');
    const S = "font-family:'DM Mono',monospace;font-size:.72rem;font-weight:600;cursor:pointer;border-radius:7px;padding:5px 8px;";
    document.getElementById('log-page-info').textContent = 'Trang '+logPage+'/'+pages+' — '+total+' bản ghi';
    let btns = '<button onclick="logGoPage('+(logPage-1)+')" '+(logPage<=1?'disabled':'')+' style="'+S+'border:1.5px solid var(--border);background:var(--card);color:var(--muted)">←</button>';
    const range = getPageRange(logPage, pages);
    range.forEach(function(p){
      if(p==='...'){ btns+='<span style="padding:5px 2px;color:var(--muted)">···</span>'; }
      else { var a=p===logPage; btns+='<button onclick="logGoPage('+p+')" style="'+S+'border:1.5px solid '+(a?'var(--navy)':'var(--border)')+';background:'+(a?'var(--navy)':'var(--card)')+';color:'+(a?'#fff':'var(--muted)')+'">'+p+'</button>'; }
    });
    btns+='<button onclick="logGoPage('+(logPage+1)+')" '+(logPage>=pages?'disabled':'')+' style="'+S+'border:1.5px solid var(--border);background:var(--card);color:var(--muted)">→</button>';
    document.getElementById('log-page-btns').innerHTML = btns;
    pgEl.style.display = pages>1 ? 'flex' : 'none';

  } catch(e){ body.innerHTML='<div class="loading">⚠️ '+esc(e.message)+'</div>'; }
}

function startLogRealtime(){ /* subscription khởi tạo khi load page */ }

function filterTable(tbodyId, q){
  const kw=q.toLowerCase();
  document.querySelectorAll('#'+tbodyId+' tr').forEach(function(row){
    row.style.display=kw===''||row.textContent.toLowerCase().includes(kw)?'':'none';
  });
}

function closeModal(id){ document.getElementById(id).classList.remove('open'); }

// INIT
loadInfo();
loadDashboard();
fetch(AAPI+'/hospitals').then(r=>r.ok?r.json():[]).then(d=>{hospitalsCache=d;}).catch(()=>{});
