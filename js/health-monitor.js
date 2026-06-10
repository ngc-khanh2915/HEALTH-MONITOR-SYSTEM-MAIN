// SESSION CHECK
try {
  const s = JSON.parse(localStorage.getItem('hm_session')||'{}');
  if(!s.userId || s.role !== 'user_bs'){ localStorage.removeItem('hm_session'); location.replace('index.html'); }
} catch(_){ location.replace('index.html'); }

const API = 'https://health-monitor-doctor.onrender.com';
const SESS = JSON.parse(localStorage.getItem('hm_session')||'{}');
const DID = SESS.userId;

function authHeader(extra){
  const h = { 'Content-Type': 'application/json', ...extra };
  if(SESS.token) h['Authorization'] = `Bearer ${SESS.token}`;
  return h;
}

// Kiểm tra session hết hạn
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

// ── SUPABASE REALTIME ──
const _sb = supabase.createClient(
  'https://czgberdpnfultxkljhko.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImN6Z2JlcmRwbmZ1bHR4a2xqaGtvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ3OTY3MTEsImV4cCI6MjA5MDM3MjcxMX0.H9pv62PGbIJqJNK72yGEGB1Y9yw7HPEvk82zdxlgVYg'
);

// Realtime indicator
function showRealtimePulse(){
  const el = document.getElementById('last-upd');
  if(!el) return;
  el.style.color = 'var(--green)';
  setTimeout(()=>{ el.style.color = ''; }, 1000);
}

// Xử lý khi có bản ghi vitals mới
async function onNewVital(payload){
  const v = payload.new;
  if(!v) return;
  showRealtimePulse();

  // 1. Cập nhật live data của bệnh nhân trong danh sách
  const pid = v.nguoi_dung_tb_id;
  const pt = pts.find(p => p.id === pid);
  if(pt){
    pt.hr         = v.nhip_tim   ?? pt.hr;
    pt.spo2       = v.spo2       ?? pt.spo2;
    pt.last       = v.thoi_gian_do;
    // Tính lại alertLevel từ data mới
    const hr = pt.hr != null ? Number(pt.hr) : null;
    const sp = pt.spo2 != null ? Number(pt.spo2) : null;
    if(hr==null && sp==null) pt.alertLevel = 'binh_thuong';
    else if((sp!=null&&sp<90)||(hr!=null&&(hr>120||hr<45))) pt.alertLevel = 'nguy_hiem';
    else if((sp!=null&&sp<94)||(hr!=null&&(hr>100||hr<50))) pt.alertLevel = 'canh_bao';
    else pt.alertLevel = 'binh_thuong';
    renderPts(pts, document.getElementById('srch').value);
    updSum();
    document.getElementById('last-upd').textContent =
      new Date().toLocaleTimeString('vi-VN',{hour:'2-digit',minute:'2-digit',second:'2-digit'}) + ' ●';
  }

  // 2. Nếu đang xem trang chi tiết đúng bệnh nhân này → thêm row vào bảng
  if(selPid === pid && document.getElementById('view-patient').style.display !== 'none'){
    const cache = vcache[pid];
    if(cache){
      const row = {
        hr:   v.nhip_tim,
        spo2: v.spo2,
        dHR:  v.delta_nhip_tim,
        dS:   v.delta_spo2,
        mode: v.che_do_lay_mau,
        time: v.thoi_gian_do,
      };
      if(row.time){
        const d = new Date(new Date(row.time).getTime() + 7*3600000);
        const k = d.toISOString().slice(0,10);
        if(!cache.byDate[k]){ cache.byDate[k]=[]; cache.dates.unshift(k); cache.dates.sort((a,b)=>b.localeCompare(a)); }
        const exists = cache.byDate[k].some(x=>x.time===row.time);
        if(!exists){
          cache.byDate[k].unshift(row);
          // Re-render nếu đang xem đúng ngày này
          const showing = ptSelDate || cache.dates[0];
          if(showing === k){
            renderVT(cache.byDate[k]);
            updPatientSum(pid);
          }
          renderPtCal();
        }
      }
    }
  }
}

// Xử lý khi có cảnh báo mới
function onNewAlert(payload){
  const a = payload.new;
  if(!a) return;
  showRealtimePulse();
  // Refresh lại summary để cập nhật số cảnh báo
  updSum();
}

// Subscribe Realtime — lắng nghe INSERT vào du_lieu_sinh_ton và canh_bao_suc_khoe
// ── CẢNH BÁO BELL ──
let alertCache = [];

async function loadActiveAlerts(){
  try {
    const r = await fetch(`${API}/doctor/${DID}/active-alerts`, { headers: authHeader() });
    if(!r.ok){
      const err = await r.json().catch(()=>({}));
      console.warn('[active-alerts] Server error:', err);
      // Vẫn render popup với cache cũ, không clear
      return;
    }
    alertCache = await r.json();
    renderAlertPopup();
    updateBellBadge();
  } catch(e){
    console.warn('[active-alerts] Fetch error:', e.message);
    // Nếu popup đang mở, hiện thông báo lỗi kết nối
    const body = document.getElementById('alert-popup-body');
    if(body && document.getElementById('alert-popup').classList.contains('open')){
      body.innerHTML='<div style="padding:24px;text-align:center;color:var(--muted);font-size:.78rem">⚠️ Không thể tải dữ liệu cảnh báo</div>';
    }
  }
}

function updateBellBadge(){
  // Đếm số bệnh nhân đang có cảnh báo active (thiet_bi_het_gio, không có thiet_bi_bam_nut)
  const activePids = new Set();
  (alertCache||[]).forEach(function(a){
    const methods = a.methods||[];
    if(methods.includes('thiet_bi_het_gio') && !methods.includes('thiet_bi_bam_nut')){
      activePids.add(a.patientId);
    }
  });
  const n = activePids.size;
  const btn   = document.getElementById('bell-btn');
  const badge = document.getElementById('bell-badge');
  const countBadge = document.getElementById('alert-count-badge');
  if(n > 0){
    btn.classList.add('has-alert');
    badge.style.display='flex';
    badge.textContent = n > 99 ? '99+' : n;
    if(countBadge) countBadge.textContent = n;
  } else {
    btn.classList.remove('has-alert');
    badge.style.display='none';
    if(countBadge) countBadge.textContent = '0';
  }
}

function renderAlertPopup(){
  const body = document.getElementById('alert-popup-body');
  if(!pts.length){
    body.innerHTML='<div style="padding:24px;text-align:center;color:var(--muted);font-size:.78rem">Chưa có bệnh nhân</div>';
    return;
  }

  // Map alertCache theo patientId để check trạng thái nhanh
  const alertMap = {};
  (alertCache||[]).forEach(function(a){
    // Chỉ bật tam giác nếu có thiet_bi_het_gio và KHÔNG có thiet_bi_bam_nut
    const methods = a.methods||[];
    const active = methods.includes('thiet_bi_het_gio') && !methods.includes('thiet_bi_bam_nut');
    if(active){
      // Giữ mức độ nguy hiểm nhất nếu có nhiều cảnh báo
      if(!alertMap[a.patientId] || a.severity==='nguy_hiem'){
        alertMap[a.patientId] = a.severity;
      }
    }
  });

  body.innerHTML = pts.map(function(p){
    const sev = alertMap[p.id]; // undefined = không có cảnh báo
    const triColor = sev==='nguy_hiem' ? 'var(--danger)' : sev==='canh_bao' ? 'var(--warn)' : 'transparent';

    return '<div class="alert-item" onclick="gotoPatient(\''+p.id+'\')">'
      // Tam giác — luôn có trong DOM, chỉ đổi màu fill
      +'<svg width="18" height="18" viewBox="0 0 24 24" style="flex-shrink:0;transition:fill .3s" fill="'+triColor+'">'
      +'<path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>'
      +(sev?'<line x1="12" y1="9" x2="12" y2="13" stroke="#fff" stroke-width="1.8"/><circle cx="12" cy="17" r="1" fill="#fff"/>':'')
      +'</svg>'
      // Tên + serial
      +'<div class="alert-item-info">'
      +'<div class="alert-item-name">'+esc(p.name)+'</div>'
      +'<div class="alert-item-serial">'+esc(p.serial||'—')+'</div>'
      +'</div>'
      +'</div>';
  }).join('');
}

function toggleAlertPopup(){
  const popup = document.getElementById('alert-popup');
  if(popup.classList.contains('open')){
    popup.classList.remove('open');
    return;
  }
  popup.classList.add('open');
  // Render ngay từ cache trước (không hiện "Đang tải...")
  renderAlertPopup();
  // Sau đó fetch mới để cập nhật
  loadActiveAlerts();
}

function gotoPatient(pid){
  document.getElementById('alert-popup').classList.remove('open');
  if(pts.find(p=>p.id===pid)) clickPt(pid);
}

document.addEventListener('click',function(e){
  const wrap=document.querySelector('.bell-wrap');
  if(wrap&&!wrap.contains(e.target)) document.getElementById('alert-popup')?.classList.remove('open');
});

function setupRealtime(){
  // Channel vitals — filter theo bệnh nhân của bác sĩ này
  _sb.channel('vitals-live')
    .on('postgres_changes', {
      event:  'INSERT',
      schema: 'public',
      table:  'du_lieu_sinh_ton',
    }, onNewVital)
    .subscribe(function(status){
      console.log('[Realtime vitals]', status);
    });

  // Channel alerts
  _sb.channel('alerts-live')
    .on('postgres_changes', {
      event:  'INSERT',
      schema: 'public',
      table:  'canh_bao_suc_khoe',
    }, onNewAlert)
    .subscribe(function(status){
      console.log('[Realtime alerts]', status);
    });
}

// Khởi động Realtime sau khi load xong danh sách bệnh nhân
// (cần pts[] để biết bệnh nhân nào thuộc bác sĩ này)
function startRealtime(){
  setupRealtime();
  // Thêm subscription cho xác nhận cảnh báo
  _sb.channel('alert-confirm')
    .on('postgres_changes',{
      event:'INSERT', schema:'public', table:'xac_nhan_canh_bao'
    }, function(payload){
      const method = payload.new?.phuong_thuc_xac_nhan;
      if(method==='thiet_bi_het_gio'||method==='thiet_bi_bam_nut'){
        loadActiveAlerts(); // Realtime cập nhật bell
      }
    })
    .subscribe();
  // Load cảnh báo lần đầu
  loadActiveAlerts();
}

let pts=[], vcache={}, selPid=null, selDate=null, allDates=[], curCPid=null, ccache={};
const esc = s => String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

function doLogout(){ if(!confirm('Đăng xuất?')) return; localStorage.removeItem('hm_session'); location.replace('index.html'); }
// ── VIEW SWITCHING ──
const viewTitles = {overview:'Tổng quan bệnh nhân', devices:'Thiết bị theo dõi', links:'Liên kết người nhà', records:'Hồ sơ bệnh án', 'threshold-history':'Lịch sử ngưỡng cảnh báo'};

function switchView(name, btn){
  // Active button
  document.querySelectorAll('.sb-btn').forEach(b=>b.classList.remove('active'));
  if(btn) btn.classList.add('active');
  // Hide all views
  ['overview','devices','links','records','patient','threshold-history'].forEach(v=>{
    const el = document.getElementById('view-'+v);
    if(el) el.style.display = 'none';
  });
  // Show selected
  const target = document.getElementById('view-'+name);
  if(target) target.style.display = 'flex';
  document.getElementById('page-title').textContent = viewTitles[name] || name;
  // Live dot only on overview
  document.getElementById('live-dot').style.display = name==='overview' ? 'flex' : 'none';
  // Load content
  if(name==='devices')            renderDevicesPage();
  if(name==='links')              renderLinksPage();
  if(name==='records')            renderRecordsPage();
  if(name==='threshold-history')  initThresholdHistoryView();
}

function setNav(b){ switchView('overview', b); } // compat

// ── THIẾT BỊ PAGE ──
async function renderDevicesPage(){
  const body = document.getElementById('devices-body');
  body.innerHTML = '<div class="loading"><span class="spin"></span>Đang tải...</div>';
  try {
    const r = await fetch(`${API}/doctor/${DID}/patients`, { headers: authHeader() });
    const list = r.ok ? await r.json() : [];
    if(!list.length){ body.innerHTML='<div class="loading">Không có dữ liệu</div>'; return; }
    body.innerHTML = `<div class="page-grid" style="padding:18px">${list.map(p=>{
      const dev = p.device;
      const init = (p.patientName||'?').split(' ').map(w=>w[0]).slice(-2).join('').toUpperCase();
      return `<div class="page-card">
        <div class="page-card-head">
          <div class="sb-av" style="width:36px;height:36px;font-size:.72rem;flex-shrink:0">${init}</div>
          <div>
            <div class="page-card-name">${esc(p.patientName)}</div>
            <div class="page-card-sub">BN-${(p.patientId||'').slice(0,8).toUpperCase()}</div>
          </div>
        </div>
        <div class="page-card-body">
          ${dev ? `
            <div class="dev-row">
              <div class="dev-ic"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="5" y="2" width="14" height="20" rx="2"/><line x1="12" y1="18" x2="12.01" y2="18"/></svg></div>
              <div style="flex:1">
                <div class="dev-serial">${esc(dev.serial||'—')}</div>
                <div class="dev-sub">Gán từ: ${dev.assignedAt?new Date(dev.assignedAt).toLocaleDateString('vi-VN'):'—'}</div>
              </div>
              <div style="display:flex;flex-direction:column;gap:4px;align-items:flex-end">
                <span style="font-size:.65rem;font-weight:700;padding:2px 8px;border-radius:10px;background:${dev.online?'#e6f7e6':'#f0f0f0'};color:${dev.online?'#2d7a2d':'#888'}">
                  ${dev.online?'● Online':'○ Offline'}
                </span>
                ${dev.battery!=null?`<span style="font-size:.65rem;color:var(--muted)">🔋 ${dev.battery}%</span>`:''}
              </div>
            </div>` :
            `<div style="font-size:.78rem;color:var(--muted);font-style:italic;padding:6px 0">Chưa có thiết bị</div>`
          }
        </div>
      </div>`;
    }).join('')}</div>`;
  } catch(e){ body.innerHTML=`<div class="loading">⚠️ ${esc(e.message)}</div>`; }
}

// ── LIÊN KẾT PAGE — Chỉ xem ──
let linksData = {};

async function renderLinksPage(){
  const body = document.getElementById('links-body');
  body.innerHTML = '<div class="loading"><span class="spin"></span>Đang tải...</div>';
  try {
    const r = await fetch(API + '/doctor/' + DID + '/families', { headers: authHeader() });
    linksData = r.ok ? await r.json() : {};
    const entries = Object.values(linksData);
    if(!entries.length){ body.innerHTML='<div class="loading">Chưa có liên kết nào</div>'; return; }

    let html = '';
    entries.forEach(function(info){
      const fams = info.families || [];
      const init = (info.patientName||'?').split(' ').map(function(w){return w[0];}).slice(-2).join('').toUpperCase();
      const dob = pts.find(function(p){return p.id===info.patientId;});
      const dobStr = dob && dob.dob ? new Date(dob.dob).toLocaleDateString('vi-VN') : '—';
      const pid = info.patientId || '';

      let famRows = '';
      if(fams.length){
        fams.forEach(function(f){
          const fi = (f.name||'?').split(' ').map(function(w){return w[0];}).slice(-2).join('').toUpperCase();
          const relLabel = esc(f.relation || 'Chưa xác định');
          const priTag = '';
          const phoneRow = f.phone ? '<div class="fam-sub">📞 ' + esc(f.phone) + '</div>' : '';
          const emailRow = f.email ? '<div class="fam-sub">✉️ ' + esc(f.email) + '</div>' : '';
          famRows += '<div class="fam-row">'
            + '<div class="fam-av">' + fi + '</div>'
            + '<div style="flex:1;min-width:0">'
            + '<div style="display:flex;align-items:center;gap:4px;flex-wrap:wrap">'
            + '<span class="fam-name">' + esc(f.name||'—') + '</span>'
            + '<span style="font-size:.65rem;font-weight:700;background:var(--mint);color:var(--navy);padding:2px 8px;border-radius:9px">' + relLabel + '</span>'
            + priTag
            + '</div>'
            + phoneRow + emailRow
            + '</div></div>';
        });
      } else {
        famRows = '<div style="color:var(--muted);font-size:.78rem;font-style:italic;padding:4px 0">Chưa có người nhà</div>';
      }

      html += '<div class="acc-item open" id="lnk-' + pid + '">'
        + '<div class="acc-head" onclick="this.closest(\'.acc-item\').classList.toggle(\'open\')">'
        + '<div class="acc-av">' + init + '</div>'
        + '<div class="acc-info">'
        + '<div class="acc-name">' + esc(info.patientName||'—') + '</div>'
        + '<div class="acc-sub">BN-' + pid.slice(0,8).toUpperCase() + ' · ' + dobStr + '</div>'
        + '</div>'
        + '<div class="acc-meta"><span class="acc-tag">' + fams.length + ' người nhà</span></div>'
        + '<svg class="acc-chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"/></svg>'
        + '</div>'
        + '<div class="acc-body">' + famRows + '</div>'
        + '</div>';
    });

    body.innerHTML = html;
  } catch(e){ body.innerHTML = '<div class="loading">⚠️ ' + esc(e.message) + '</div>'; }
}

function filterLinks(q){
  const kw = q.toLowerCase().trim();
  document.querySelectorAll('[id^="lnk-"].acc-item').forEach(function(el){
    el.classList.toggle('hidden', kw!=='' && !(el.querySelector('.acc-name')?.textContent||'').toLowerCase().includes(kw));
  });
}

// ── HỒ SƠ BỆNH ÁN PAGE — Accordion ──
let recPts = [];

async function renderRecordsPage(){
  const body = document.getElementById('records-body');
  body.innerHTML = '<div class="loading"><span class="spin"></span>Đang tải...</div>';
  document.getElementById('rec-srch').value = '';
  try {
    const r = await fetch(`${API}/doctor/${DID}/patients`, { headers: authHeader() });
    const list = r.ok ? await r.json() : [];
    if(!list.length){ body.innerHTML='<div class="loading">Không có bệnh nhân</div>'; return; }
    recPts = list;
    body.innerHTML = list.map(p=>{
      const init = (p.patientName||'?').split(' ').map(w=>w[0]).slice(-2).join('').toUpperCase();
      const dob = p.dob ? new Date(p.dob).toLocaleDateString('vi-VN') : '—';
      return `<div class="acc-item" id="acc-${p.patientId}" data-name="${(p.patientName||'').toLowerCase()}">
        <div class="acc-head" onclick="toggleAcc('${p.patientId}')">
          <div class="acc-av">${init}</div>
          <div class="acc-info">
            <div class="acc-name">${esc(p.patientName)}</div>
            <div class="acc-sub">BN-${(p.patientId||'').slice(0,8).toUpperCase()} · ${dob}</div>
          </div>
          <div class="acc-meta">
            <span class="acc-tag" id="acc-tag-${p.patientId}">Đang tải...</span>
          </div>
          <svg class="acc-chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"/></svg>
        </div>
        <div class="acc-body" id="acc-body-${p.patientId}">
          <div class="loading"><span class="spin"></span>Đang tải hồ sơ...</div>
        </div>
      </div>`;
    }).join('');
    await Promise.all(list.map(p => loadAccRecord(p.patientId)));
  } catch(e){ body.innerHTML=`<div class="loading">⚠️ ${esc(e.message)}</div>`; }
}

async function loadAccRecord(pid){
  const body = document.getElementById('acc-body-'+pid);
  const tag  = document.getElementById('acc-tag-'+pid);
  if(!body) return;
  try {
    // Fetch hồ sơ và ngưỡng cảnh báo song song
    const [r, rt] = await Promise.all([
      fetch(`${API}/medical-record/${pid}`, { headers: authHeader() }),
      fetch(`${API}/threshold/${pid}`, { headers: authHeader() })
    ]);
    const rec = r.ok ? await r.json() : null;
    const p = { threshold: rt.ok ? await rt.json() : null };
    const v = k => rec?.[k] ?? '';
    if(tag){
      tag.textContent = rec ? 'Có hồ sơ' : 'Chưa có hồ sơ';
      tag.style.background = rec ? 'var(--mint)' : '#fff4e0';
      tag.style.color = rec ? 'var(--navy)' : '#8a5800';
    }
    const fi = (id,type,val,opts=[]) => {
      const sid = `rf-${pid}-${id}`;
      if(type==='select') return `<select id="${sid}" class="acc-fsel"><option value="">—</option>${opts.map(o=>`<option ${String(val)===o?'selected':''}>${o}</option>`).join('')}</select>`;
      return `<input id="${sid}" type="${type}" value="${esc(String(val))}" class="acc-finp"/>`;
    };
    const ncb = p.threshold || {};
    const hasThreshold = p.threshold !== null && p.threshold !== undefined;
    const fncb = (id, val) => {
      const sid = `rf-${pid}-ncb-${id}`;
      return `<input id="${sid}" type="number" value="${val !== null && val !== undefined ? val : ''}" class="acc-finp" placeholder="${hasThreshold ? '' : 'Chưa có'}"/>`;
    };
    body.innerHTML = `
      <div class="acc-grid">
        <div class="acc-field"><div class="acc-flbl">Nhóm máu</div>${fi('nhom_mau','select',v('nhom_mau'),['A+','A-','B+','B-','O+','O-','AB+','AB-'])}</div>
        <div class="acc-field"><div class="acc-flbl">Chiều cao (cm)</div>${fi('chieu_cao_cm','number',v('chieu_cao_cm'))}</div>
        <div class="acc-field"><div class="acc-flbl">Cân nặng (kg)</div>${fi('can_nang_kg','number',v('can_nang_kg'))}</div>
        <div class="acc-field"><div class="acc-flbl">Dị ứng</div>${fi('di_ung','text',v('di_ung'))}</div>
        <div class="acc-field acc-full"><div class="acc-flbl">Bệnh mãn tính</div>${fi('benh_man_tinh','text',v('benh_man_tinh'))}</div>
        <div class="acc-field acc-full"><div class="acc-flbl">Tiền sử y tế</div>${fi('tien_su_y_te','text',v('tien_su_y_te'))}</div>
        <div class="acc-field"><div class="acc-flbl">Người liên hệ khẩn</div>${fi('nguoi_lien_he_khan_ten','text',v('nguoi_lien_he_khan_ten'))}</div>
        <div class="acc-field"><div class="acc-flbl">SĐT liên hệ khẩn</div>${fi('nguoi_lien_he_khan_sdt','text',v('nguoi_lien_he_khan_sdt'))}</div>
      </div>
      <!-- Ngưỡng cảnh báo -->
      <div style="margin:14px 0 8px;padding-top:12px;border-top:1px solid var(--border)">
        <div style="font-size:.62rem;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:var(--muted);margin-bottom:10px">
          ⚠️ Ngưỡng cảnh báo ${hasThreshold ? '<span style="font-size:.6rem;background:var(--mint);color:var(--navy);padding:1px 7px;border-radius:5px;margin-left:6px">Đã thiết lập</span>' : '<span style="font-size:.6rem;background:#fef3c7;color:#92400e;padding:1px 7px;border-radius:5px;margin-left:6px">Chưa thiết lập</span>'}
        </div>
        <div class="acc-grid">
          <div class="acc-field"><div class="acc-flbl">Nhịp tim tối thiểu <span style="color:var(--muted)">(bpm)</span></div>${fncb('nhip_tim_toi_thieu', ncb.nhip_tim_toi_thieu)}</div>
          <div class="acc-field"><div class="acc-flbl">Nhịp tim tối đa <span style="color:var(--muted)">(bpm)</span></div>${fncb('nhip_tim_toi_da', ncb.nhip_tim_toi_da)}</div>
          <div class="acc-field"><div class="acc-flbl">SpO2 tối thiểu <span style="color:var(--muted)">(%)</span></div>${fncb('spo2_toi_thieu', ncb.spo2_toi_thieu)}</div>
          <div class="acc-field"><div class="acc-flbl">Nhịp tim cơ sở <span style="color:var(--muted)">(bpm)</span></div>${fncb('nhip_tim_co_so', ncb.nhip_tim_co_so)}</div>
          <div class="acc-field"><div class="acc-flbl">SpO2 cơ sở <span style="color:var(--muted)">(%)</span></div>${fncb('spo2_co_so', ncb.spo2_co_so)}</div>
        </div>
      </div>
      <div class="acc-footer">
        <button class="acc-save" onclick="saveAccRec('${pid}')">💾 Lưu hồ sơ</button>
        <div class="acc-rmsg" id="acc-rmsg-${pid}"></div>
      </div>
    `;
  } catch(e){ if(body) body.innerHTML=`<div style="color:var(--danger);font-size:.74rem;padding:10px 0">⚠️ ${esc(e.message)}</div>`; }
}

function toggleAcc(pid){
  const item = document.getElementById('acc-'+pid);
  if(item) item.classList.toggle('open');
}
function expandAllRecs(){ document.querySelectorAll('.acc-item:not(.hidden)').forEach(el=>el.classList.add('open')); }
function collapseAllRecs(){ document.querySelectorAll('.acc-item').forEach(el=>el.classList.remove('open')); }
function filterRecords(q){
  const kw = q.toLowerCase().trim();
  document.querySelectorAll('.acc-item').forEach(el=>{
    el.classList.toggle('hidden', kw!=='' && !(el.dataset.name||'').includes(kw));
  });
}
async function saveAccRec(pid){
  const msg = document.getElementById('acc-rmsg-'+pid);
  const g = f => { const e = document.getElementById(`rf-${pid}-${f}`); return e ? e.value.trim()||null : null; };
  const gn = f => { const e = document.getElementById(`rf-${pid}-${f}`); return e && e.value.trim() ? parseFloat(e.value.trim()) : null; };

  // Hồ sơ bệnh nhân
  const payload = {};
  ['nhom_mau','benh_man_tinh','di_ung','tien_su_y_te','nguoi_lien_he_khan_ten','nguoi_lien_he_khan_sdt'].forEach(f=>{ const v=g(f); if(v) payload[f]=v; });
  ['chieu_cao_cm','can_nang_kg'].forEach(f=>{ const v=gn(f); if(v) payload[f]=v; });

  // Ngưỡng cảnh báo
  const ncbPayload = {
    nhip_tim_toi_thieu: gn('ncb-nhip_tim_toi_thieu'),
    nhip_tim_toi_da:    gn('ncb-nhip_tim_toi_da'),
    spo2_toi_thieu:     gn('ncb-spo2_toi_thieu'),
    nhip_tim_co_so:     gn('ncb-nhip_tim_co_so'),
    spo2_co_so:         gn('ncb-spo2_co_so'),
  };
  const hasNcbData = Object.values(ncbPayload).some(v => v !== null);

  msg.style.color='var(--muted)'; msg.textContent='Đang lưu...';
  try {
    // Lưu hồ sơ bệnh nhân
    const r = await fetch(`${API}/medical-record/${pid}`,{method:'PATCH',headers:authHeader(),body:JSON.stringify(payload)});
    const d = await r.json();
    if(!r.ok) throw new Error(d.error||'Lỗi lưu hồ sơ');

    // Lưu ngưỡng cảnh báo nếu có dữ liệu
    if(hasNcbData){
      const rn = await fetch(`${API}/threshold/${pid}`,{
        method:'POST', headers:authHeader(),
        body: JSON.stringify({...ncbPayload, doctorId: DID})
      });
      const dn = await rn.json();
      if(!rn.ok) throw new Error(dn.error||'Lỗi lưu ngưỡng');
    }

    msg.style.color='var(--green)'; msg.textContent='✅ Lưu thành công!';
    const tag=document.getElementById('acc-tag-'+pid);
    if(tag){tag.textContent='Có hồ sơ';tag.style.background='var(--mint)';tag.style.color='var(--navy)';}
    // Reload lịch sử ngưỡng nếu đang xem tab đó
    const thrView = document.getElementById('view-threshold-history');
    if(thrView && thrView.style.display !== 'none') loadThresholdHistoryView();
    // Reload accordion sau 500ms để cập nhật badge ngưỡng, giữ trạng thái mở
    setTimeout(async ()=>{
      await loadAccRecord(pid);
      // Đảm bảo accordion vẫn mở
      const item = document.getElementById('acc-'+pid);
      if(item && !item.classList.contains('open')) item.classList.add('open');
    }, 500);
    setTimeout(()=>{ const m=document.getElementById('acc-rmsg-'+pid); if(m) m.textContent=''; }, 3000);
  } catch(e){ msg.style.color='var(--danger)'; msg.textContent='⚠️ '+esc(e.message); }
}

async function loadThresholdHistory(pid){
  const wrap = document.getElementById('threshold-history-'+pid);
  const body = document.getElementById('threshold-history-body-'+pid);
  if(!wrap || !body) return;
  // Toggle
  if(wrap.style.display !== 'none' && body.dataset.loaded){
    wrap.style.display='none'; body.dataset.loaded=''; return;
  }
  wrap.style.display='block';
  body.innerHTML='<div class="loading"><span class="spin"></span>Đang tải...</div>';
  try {
    const r = await fetch(`${API}/threshold/${pid}/history`, { headers: authHeader() });
    const list = r.ok ? await r.json() : [];
    if(!list.length){
      body.innerHTML='<div style="font-size:.74rem;color:var(--muted);font-style:italic;padding:8px 0">Chưa có lịch sử thay đổi</div>';
    } else {
      body.innerHTML='<div class="tbl-wrap"><table class="tbl"><thead><tr>'
        +'<th>Thời gian</th><th>Nhịp tim cơ sở</th><th>SpO2 cơ sở</th><th>Lý do</th>'
        +'</tr></thead><tbody>'
        +list.map(h=>`<tr>
          <td style="font-size:.7rem;white-space:nowrap">${new Date(h.ngay_tinh_lai).toLocaleString('vi-VN')}</td>
          <td style="font-size:.74rem">${h.nhip_tim_co_so_moi} bpm</td>
          <td style="font-size:.74rem">${h.spo2_co_so_moi}%</td>
          <td style="font-size:.7rem;color:var(--muted)">${h.ly_do_cap_nhat==='bac_si_chinh_sua'?'Bác sĩ chỉnh sửa':h.ly_do_cap_nhat}</td>
        </tr>`).join('')
        +'</tbody></table></div>';
      body.dataset.loaded='1';
    }
  } catch(e){ body.innerHTML='<div style="color:var(--danger);font-size:.74rem">⚠️ '+esc(e.message)+'</div>'; }
}
// ── LỊCH SỬ NGƯỠNG CẢNH BÁO ──
let _thrRealtimeChannel = null;
let _thrPage = 1;
const THR_PER_PAGE = 5;
let _thrList = [];

function resetThrFilter(){
  document.getElementById('thr-flt-patient').value='';
  const f=document.getElementById('thr-flt-from'); if(f) f.value='';
  const t=document.getElementById('thr-flt-to');   if(t) t.value='';
  _thrPage=1;
  loadThresholdHistoryView();
}

function renderThrTable(){
  const body=document.getElementById('thr-history-body');
  const stats=document.getElementById('thr-stats');
  const cnt=document.getElementById('thr-count');
  const pgWrap=document.getElementById('thr-pagination');
  const pgInfo=document.getElementById('thr-page-info');
  const pgBtns=document.getElementById('thr-page-btns');
  if(!body) return;

  const total=_thrList.length;
  const pages=Math.max(1,Math.ceil(total/THR_PER_PAGE));
  if(_thrPage>pages) _thrPage=pages;
  const slice=_thrList.slice((_thrPage-1)*THR_PER_PAGE, _thrPage*THR_PER_PAGE);

  if(!slice.length){
    body.innerHTML='<tr><td colspan="5" style="padding:32px;text-align:center;color:var(--muted);font-size:.76rem;font-style:italic">Chưa có lịch sử thay đổi nào</td></tr>';
    if(stats) stats.style.display='none';
    if(pgWrap) pgWrap.style.display='none';
    return;
  }

  const LY_DO={bac_si_chinh_sua:'✏️ Bác sĩ chỉnh sửa',tu_dong_7_ngay:'🤖 Tự động 7 ngày',reset_he_thong:'🔄 Reset hệ thống'};
  body.innerHTML=slice.map(h=>{
    const time=new Date(h.ngay_tinh_lai).toLocaleString('vi-VN',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'});
    const init=(h.patient_name||'?').split(' ').map(w=>w[0]).slice(-2).join('').toUpperCase();
    return `<tr style="border-bottom:1px solid var(--border)" onmouseover="this.style.background='rgba(26,58,92,.03)'" onmouseout="this.style.background=''">
      <td style="padding:12px 18px;font-size:.7rem;color:var(--muted);white-space:nowrap;font-family:'DM Mono',monospace">${time}</td>
      <td style="padding:12px 18px"><div style="display:flex;align-items:center;gap:8px">
        <div style="width:28px;height:28px;border-radius:50%;background:var(--navy);color:#fff;display:flex;align-items:center;justify-content:center;font-size:.6rem;font-weight:800;flex-shrink:0">${esc(init)}</div>
        <span style="font-size:.76rem;font-weight:600;color:var(--text)">${esc(h.patient_name||'—')}</span></div></td>
      <td style="padding:12px 18px"><span style="font-size:.82rem;font-weight:700;color:var(--navy)">${h.nhip_tim_co_so_moi}</span><span style="font-size:.66rem;color:var(--muted);margin-left:3px">bpm</span></td>
      <td style="padding:12px 18px"><span style="font-size:.82rem;font-weight:700;color:var(--navy)">${h.spo2_co_so_moi}</span><span style="font-size:.66rem;color:var(--muted);margin-left:3px">%</span></td>
      <td style="padding:12px 18px"><span style="font-size:.7rem;padding:3px 10px;border-radius:6px;background:var(--bg);border:1px solid var(--border);color:var(--muted)">${LY_DO[h.ly_do_cap_nhat]||h.ly_do_cap_nhat}</span></td>
    </tr>`;
  }).join('');

  if(stats&&cnt){stats.style.display='block';cnt.textContent=total;}

  // Pagination
  if(pgWrap&&pgInfo&&pgBtns){
    if(pages>1){
      pgWrap.style.display='flex';
      pgInfo.textContent='Trang '+_thrPage+'/'+pages+' — '+total+' bản ghi';
      const S="font-family:'DM Mono',monospace;font-size:.72rem;font-weight:600;cursor:pointer;border-radius:7px;padding:5px 9px;border:1.5px solid";
      let btns='<button onclick="thrGoPage('+(_thrPage-1)+')" '+(_thrPage<=1?'disabled':'')+' style="'+S+' var(--border);background:var(--card);color:var(--muted)">←</button>';
      for(var i=1;i<=pages;i++){
        var a=i===_thrPage;
        btns+='<button onclick="thrGoPage('+i+')" style="'+S+' '+(a?'var(--navy)':'var(--border)')+';background:'+(a?'var(--navy)':'var(--card)')+';color:'+(a?'#fff':'var(--muted)')+'">'+i+'</button>';
      }
      btns+='<button onclick="thrGoPage('+(_thrPage+1)+')" '+(_thrPage>=pages?'disabled':'')+' style="'+S+' var(--border);background:var(--card);color:var(--muted)">→</button>';
      pgBtns.innerHTML=btns;
    } else {
      pgWrap.style.display='none';
    }
  }
}

function thrGoPage(p){
  const pages=Math.max(1,Math.ceil(_thrList.length/THR_PER_PAGE));
  if(p<1||p>pages) return;
  _thrPage=p;
  renderThrTable();
}

async function loadThresholdHistoryView(){
  const body=document.getElementById('thr-history-body');
  if(!body) return;
  body.innerHTML='<tr><td colspan="5"><div class="loading"><span class="spin"></span>Đang tải...</div></td></tr>';
  try {
    const pid  = document.getElementById('thr-flt-patient')?.value||'';
    const from = document.getElementById('thr-flt-from')?.value||'';
    const to   = document.getElementById('thr-flt-to')?.value||'';
    let url = pid ? `${API}/threshold/${pid}/history` : `${API}/threshold/all/history?doctorId=${DID}`;
    if(from) url+=(url.includes('?')?'&':'?')+'from='+from;
    if(to)   url+=(url.includes('?')?'&':'?')+'to='+to;
    const r=await fetch(url, { headers: authHeader() });
    _thrList=r.ok?await r.json():[];
    _thrPage=1;
    renderThrTable();
  } catch(e){body.innerHTML=`<tr><td colspan="5" style="padding:24px;color:var(--danger);font-size:.74rem">⚠️ ${esc(e.message)}</td></tr>`;}
}

function initThresholdHistoryView(){
  const sel=document.getElementById('thr-flt-patient');
  if(sel&&sel.options.length<=1){
    // Thử lấy từ acc-items trước
    const items=document.querySelectorAll('.acc-item[id^="acc-"]');
    if(items.length){
      items.forEach(el=>{
        const pid=el.id.replace('acc-','');
        const name=el.querySelector('.acc-name')?.textContent||'';
        if(pid&&name){const opt=document.createElement('option');opt.value=pid;opt.textContent=name;sel.appendChild(opt);}
      });
    } else {
      fetch(`${API}/doctor/${DID}/patients`, { headers: authHeader() }).then(r=>r.json()).then(list=>{
        (list||[]).forEach(p=>{const opt=document.createElement('option');opt.value=p.patientId;opt.textContent=p.patientName||p.name||'—';sel.appendChild(opt);});
      }).catch(()=>{});
    }
  }
  loadThresholdHistoryView();
  setupThrRealtime();
}

function setupThrRealtime(){
  if(_thrRealtimeChannel) return;
  if(!_sb) return;
  _thrRealtimeChannel=_sb.channel('thr-history-live')
    .on('postgres_changes',{event:'INSERT',schema:'public',table:'lich_su_nguong_co_so'},function(){
      const view=document.getElementById('view-threshold-history');
      if(view&&view.style.display!=='none') loadThresholdHistoryView();
    })
    .subscribe(function(status){
      const badge=document.getElementById('thr-realtime-badge');
      if(badge) badge.style.display=status==='SUBSCRIBED'?'flex':'none';
    });
}


// ── HỒ SƠ BÁC SĨ ──
let _profileAvatarFile = null;

const _sb_doc = (function(){
  const url = 'https://czgberdpnfultxkljhko.supabase.co';
  const key  = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImN6Z2JlcmRwbmZ1bHR4a2xqaGtvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ3OTY3MTEsImV4cCI6MjA5MDM3MjcxMX0.H9pv62PGbIJqJNK72yGEGB1Y9yw7HPEvk82zdxlgVYg';
  return supabase ? supabase.createClient(url, key) : null;
})();

function updateSidebarAvatar(src){
  const av = document.getElementById('sb-av');
  if(!av) return;
  if(src){ av.innerHTML='<img src="'+src+'" style="width:100%;height:100%;object-fit:cover;border-radius:50%"/>'; }
  else {
    const sess = JSON.parse(localStorage.getItem('hm_session')||'{}');
    av.textContent = (sess.name||'BS').split(' ').map(w=>w[0]).slice(-2).join('').toUpperCase();
  }
}

function previewAvatar(input){
  const file = input.files[0];
  if(!file) return;
  if(file.size > 5*1024*1024){ alert('Ảnh tối đa 5MB'); return; }
  _profileAvatarFile = file;
  const reader = new FileReader();
  reader.onload = function(e){
    const img = document.getElementById('profile-av-img');
    img.src = e.target.result; img.style.display='block';
    document.getElementById('profile-av-initials').style.display='none';
  };
  reader.readAsDataURL(file);
}

async function uploadAvatarDoc(file, userId){
  const client = _sb;
  if(!client) throw new Error('Supabase chưa khởi tạo');
  const ext  = file.name.split('.').pop().toLowerCase()||'jpg';
  const path = userId+'.'+ext;
  // Xóa tất cả file cũ của user trước khi upload mới
  const allExts = ['jpg','jpeg','png','webp','gif'];
  await client.storage.from('avatars').remove(allExts.map(e => userId+'.'+e));
  const { error } = await client.storage.from('avatars').upload(path, file, {
    upsert: true, contentType: file.type,
  });
  if(error) throw new Error('Upload thất bại: '+error.message);
  const { data } = client.storage.from('avatars').getPublicUrl(path);
  return data.publicUrl + '?t=' + Date.now();
}

async function openProfile(){
  const sess = JSON.parse(localStorage.getItem('hm_session')||'{}');
  document.getElementById('pf-msg').textContent='';
  _profileAvatarFile = null;
  try {
    const r = await fetch(`${API}/doctor/${DID}/profile`, { headers: authHeader() });
    const d = r.ok ? await r.json() : {};
    document.getElementById('pf-name').value  = d.name||sess.name||'';
    document.getElementById('pf-phone').value = d.phone||sess.phone||'';
    document.getElementById('pf-email').value = d.email||sess.email||'';
    const av = d.avatar||sess.avatar;
    const initials = (d.name||sess.name||'BS').split(' ').map(w=>w[0]).slice(-2).join('').toUpperCase();
    document.getElementById('profile-av-initials').textContent = initials;
    const img = document.getElementById('profile-av-img');
    if(av){ img.src=av; img.style.display='block'; document.getElementById('profile-av-initials').style.display='none'; }
    else  { img.style.display='none'; document.getElementById('profile-av-initials').style.display=''; }
  } catch(_){}
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
      msg.textContent='Đang upload ảnh...';
      avatarUrl = await uploadAvatarDoc(_profileAvatarFile, DID);
    }
    const body = {
      name, phone: document.getElementById('pf-phone').value.trim()||null,
      email: document.getElementById('pf-email').value.trim()||null,
    };
    if(avatarUrl) body.avatar = avatarUrl;
    const r = await fetch(`${API}/doctor/${DID}/profile`, {
      method:'PATCH', headers:authHeader(),
      body: JSON.stringify(body)
    });
    const d = await r.json();
    if(!r.ok) throw new Error(d.error||'Lỗi');
    const sess = JSON.parse(localStorage.getItem('hm_session')||'{}');
    sess.name=name; if(avatarUrl) sess.avatar=avatarUrl;
    localStorage.setItem('hm_session', JSON.stringify(sess));
    document.getElementById('sb-name').textContent=name;
    updateSidebarAvatar(sess.avatar||null);
    msg.style.color='var(--green)'; msg.textContent='✅ Đã cập nhật hồ sơ';
    setTimeout(()=>document.getElementById('modal-profile').classList.remove('open'), 1500);
  } catch(e){ msg.style.color='var(--danger)'; msg.textContent='⚠️ '+e.message; }
  btn.disabled=false;
}
function toggleDark(){ const h=document.documentElement; const d=h.getAttribute('data-theme')==='dark'; h.setAttribute('data-theme',d?'light':'dark'); document.getElementById('dark-tgl').classList.toggle('on',!d); localStorage.setItem('hm_theme',d?'light':'dark'); }
function setFont(n,b){
  // Thay đổi font-size của html → tất cả rem tự scale theo
  const sizes = {12: '87.5%', 14: '100%', 16: '112.5%'};
  document.documentElement.style.fontSize = sizes[n] || '100%';
  localStorage.setItem('hm_font', n);
  document.querySelectorAll('.fb').forEach(x=>x.classList.remove('on'));
  if(b) b.classList.add('on');
}
async function changePw(){
  const o=document.getElementById('pw-old').value, n=document.getElementById('pw-new').value, c=document.getElementById('pw-cf').value, m=document.getElementById('pwmsg');
  m.style.color='var(--danger)';
  if(!o||!n||!c){m.textContent='Điền đủ thông tin';return;} if(n.length<6){m.textContent='Mật khẩu ≥ 6 ký tự';return;} if(n!==c){m.textContent='Không khớp';return;}
  m.style.color='var(--muted)'; m.textContent='Đang xử lý...';
  try { const r=await fetch(`${API}/auth/change-password`,{method:'POST',headers:authHeader(),body:JSON.stringify({userId:DID,newPassword:n})}); const d=await r.json(); if(r.ok){m.style.color='var(--green)';m.textContent='✅ Thành công!';['pw-old','pw-new','pw-cf'].forEach(id=>document.getElementById(id).value='');}else{m.textContent=d.error||'Lỗi';} } catch(e){m.textContent='Không thể kết nối';}
}
(()=>{
  const t=localStorage.getItem('hm_theme');
  if(t==='dark'){document.documentElement.setAttribute('data-theme','dark');document.getElementById('dark-tgl').classList.add('on');}
  const f=parseInt(localStorage.getItem('hm_font'));
  if(f){
    const sizes={12:'87.5%',14:'100%',16:'112.5%'};
    document.documentElement.style.fontSize=sizes[f]||'100%';
    // Highlight đúng nút
    const labels={12:'Nhỏ',14:'Vừa',16:'Lớn'};
    document.querySelectorAll('.fb').forEach(b=>{
      b.classList.toggle('on', b.textContent.trim()===labels[f]);
    });
  }
})();

// ── DATE PICKER CHO TRANG BỆNH NHÂN ──
let ptSelDate = null;
let ptCalM = new Date().getMonth();
let ptCalY = new Date().getFullYear();

function togglePtDD(e){
  if(e) e.stopPropagation();
  const dd = document.getElementById('pt-date-dd');
  const isOpen = dd.style.display !== 'none';
  if(isOpen){ dd.style.display='none'; return; }
  const trigger = document.getElementById('pt-date-trigger');
  const rect = trigger.getBoundingClientRect();
  dd.style.display = 'block';
  dd.style.top = (rect.bottom + 6) + 'px';
  dd.style.left = rect.left + 'px';
  renderPtCal();
}

document.addEventListener('mousedown', function(e){
  const dd = document.getElementById('pt-date-dd');
  if(!dd || dd.style.display==='none') return;
  if(e.target.closest('#pt-date-dd') || e.target.closest('#pt-date-trigger')) return;
  dd.style.display = 'none';
});

function renderPtCal(){
  const dd = document.getElementById('pt-date-dd');
  if(!dd) return;
  const ptDates = (selPid && vcache[selPid]) ? vcache[selPid].dates : [];

  const mNames = ['Tháng 1','Tháng 2','Tháng 3','Tháng 4','Tháng 5','Tháng 6','Tháng 7','Tháng 8','Tháng 9','Tháng 10','Tháng 11','Tháng 12'];
  const today    = new Date().toISOString().slice(0,10);
  const firstDay = new Date(ptCalY, ptCalM, 1).getDay();
  const daysInMonth = new Date(ptCalY, ptCalM+1, 0).getDate();

  // Month nav
  let html = '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">'
    + '<button onclick="ptCalMove(-1)" style="background:none;border:1px solid var(--border);border-radius:7px;width:28px;height:28px;cursor:pointer;display:flex;align-items:center;justify-content:center;color:var(--navy)"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="15 18 9 12 15 6"/></svg></button>'
    + '<div style="font-size:.8rem;font-weight:700;color:var(--navy)">' + mNames[ptCalM] + ' ' + ptCalY + '</div>'
    + '<button onclick="ptCalMove(1)" style="background:none;border:1px solid var(--border);border-radius:7px;width:28px;height:28px;cursor:pointer;display:flex;align-items:center;justify-content:center;color:var(--navy)"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 18 15 12 9 6"/></svg></button>'
    + '</div>';

  // Day headers
  html += '<div style="display:grid;grid-template-columns:repeat(7,1fr);margin-bottom:3px">'
    + ['CN','T2','T3','T4','T5','T6','T7'].map(d=>`<div style="font-size:.6rem;font-weight:700;text-align:center;color:var(--muted);padding:2px 0">${d}</div>`).join('')
    + '</div>';

  // Days grid
  html += '<div style="display:grid;grid-template-columns:repeat(7,1fr);gap:2px">';
  for(let i=0;i<firstDay;i++) html += '<div></div>';
  for(let d=1;d<=daysInMonth;d++){
    const key = `${ptCalY}-${String(ptCalM+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    const has = ptDates.includes(key);
    const isActive = key===ptSelDate;
    const isToday  = key===today;
    let style = 'font-size:.72rem;text-align:center;padding:5px 2px;border-radius:6px;cursor:'+(has?'pointer':'default')+';';
    if(isActive)     style += 'background:var(--navy);color:#fff;font-weight:700;';
    else if(has)     style += 'background:var(--mint);color:var(--navy);font-weight:700;';
    else             style += 'color:var(--border);';
    if(isToday && !isActive) style += 'outline:2px solid var(--green);outline-offset:-1px;';
    html += `<div style="${style}" ${has?`onclick="pickPtDate('${key}')"`:''}>${d}</div>`;
  }
  html += '</div>';

  // Buttons
  html += '<div style="display:flex;gap:6px;margin-top:8px">'
    + `<button onclick="pickPtToday()" style="flex:1;padding:6px;background:none;border:1px solid var(--border);border-radius:8px;font-family:'Sora',sans-serif;font-size:.72rem;font-weight:600;color:var(--muted);cursor:pointer">📅 Hôm nay</button>`
    + '</div>';

  // Legend
  html += '<div style="display:flex;align-items:center;gap:5px;font-size:.6rem;color:var(--muted);margin-top:8px;padding-top:7px;border-top:1px solid var(--border)">'
    + '<div style="width:9px;height:9px;border-radius:3px;background:var(--mint);flex-shrink:0"></div> Có dữ liệu'
    + '<div style="width:9px;height:9px;border-radius:3px;background:var(--navy);flex-shrink:0;margin-left:6px"></div> Đang chọn'
    + '</div>';

  dd.innerHTML = html;
}

function ptCalMove(dir){
  ptCalM += dir;
  if(ptCalM>11){ptCalM=0;ptCalY++;}
  if(ptCalM<0){ptCalM=11;ptCalY--;}
  renderPtCal();
}

async function pickPtDate(d){
  ptSelDate = d;
  document.getElementById('pt-date-lbl').textContent = d ? d.split('-').reverse().join('/') : 'Hôm nay';
  document.getElementById('pt-date-dd').style.display = 'none';
  renderPtCal();
  if(!selPid) return;
  if(!d){
    // Không chọn ngày → dùng ngày mới nhất
    const dates = vcache[selPid]?.dates || [];
    d = dates[0];
    if(!d) return;
  }
  // Fetch on-demand nếu chưa có cache ngày này
  const rows = await fetchPatientDay(selPid, d);
  renderVT(rows);
  updPatientSum(selPid);
}

// ── DATE PICKER TỔNG QUAN ──
let calY = new Date().getFullYear(), calM = new Date().getMonth(); // 0-based month

function toggleDD(e){
  if(e) e.stopPropagation();
  const dd = document.getElementById('date-dd');
  const isOpen = dd.style.display !== 'none';
  if(isOpen){
    dd.style.display = 'none';
    return;
  }
  // Định vị theo trigger
  const trigger = document.getElementById('date-trigger');
  const rect = trigger.getBoundingClientRect();
  dd.style.display = 'block';
  dd.style.top = (rect.bottom + 6) + 'px';
  dd.style.left = rect.left + 'px';
  calInitSelects();
  calRender();
}

document.addEventListener('mousedown', function(e){
  const dd = document.getElementById('date-dd');
  if(dd.style.display === 'none') return;
  if(e.target.closest('#date-dd') || e.target.closest('#date-trigger')) return;
  dd.style.display = 'none';
});

function calInitSelects(){
  const ms = document.getElementById('cal-m-sel');
  const ys = document.getElementById('cal-y-sel');
  const mNames = ['Tháng 1','Tháng 2','Tháng 3','Tháng 4','Tháng 5','Tháng 6','Tháng 7','Tháng 8','Tháng 9','Tháng 10','Tháng 11','Tháng 12'];
  ms.innerHTML = mNames.map((m,i)=>`<option value="${i}" ${i===calM?'selected':''}>${m}</option>`).join('');
  // Lấy năm từ allDates hoặc năm hiện tại
  const years = [...new Set(allDates.map(d=>parseInt(d.slice(0,4))))];
  if(!years.includes(new Date().getFullYear())) years.push(new Date().getFullYear());
  years.sort();
  ys.innerHTML = years.map(y=>`<option value="${y}" ${y===calY?'selected':''}>${y}</option>`).join('');
  ms.onchange = ()=>{ calM=+ms.value; calRender(); };
  ys.onchange = ()=>{ calY=+ys.value; calRender(); };
}

function calMove(dir){
  calM += dir;
  if(calM > 11){ calM=0; calY++; }
  if(calM < 0){ calM=11; calY--; }
  calInitSelects();
  calRender();
}

function calRender(){
  const ms = document.getElementById('cal-m-sel');
  const ys = document.getElementById('cal-y-sel');
  if(ms) calM = +ms.value;
  if(ys) calY = +ys.value;
  const lbl = document.getElementById('cal-lbl');
  const mNames = ['Tháng 1','Tháng 2','Tháng 3','Tháng 4','Tháng 5','Tháng 6','Tháng 7','Tháng 8','Tháng 9','Tháng 10','Tháng 11','Tháng 12'];
  if(lbl) lbl.textContent = mNames[calM] + ' ' + calY;
  const grid = document.getElementById('cal-grid');
  if(!grid) return;
  const today = new Date().toISOString().slice(0,10);
  const firstDay = new Date(calY, calM, 1).getDay(); // 0=Sun
  const daysInMonth = new Date(calY, calM+1, 0).getDate();
  let html = '';
  for(let i=0; i<firstDay; i++) html += '<div class="cal-day"></div>';
  for(let d=1; d<=daysInMonth; d++){
    const key = `${calY}-${String(calM+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    const has = allDates.includes(key);
    const isToday = key===today;
    const isActive = key===selDate;
    const cls = ['cal-day', has?'has':'', isToday?'today':'', isActive?'active':''].filter(Boolean).join(' ');
    html += `<div class="${cls}" ${has?`onclick="pickDate('${key}')"`:''} title="${has?key:''}">${d}</div>`;
  }
  grid.innerHTML = html;
}

function buildDD(){ calRender(); } // Compat - called after allDates loads

function goToday(){
  const today = new Date();
  calY = today.getFullYear(); calM = today.getMonth();
  calInitSelects(); calRender();
  const key = today.toISOString().slice(0,10);
  if(allDates.includes(key)) pickDate(key);
}

function pickDate(d){
  selDate = d;
  document.getElementById('date-lbl').textContent = d ? d.split('-').reverse().join('/') : 'Hôm nay';
  if(d) document.getElementById('date-dd').style.display = 'none';
  calRender();
  if(selPid) showV(selPid);
  updSum();
  // Re-render danh sách với data của ngày được chọn
  renderPts(pts, document.getElementById('srch').value);
}

// Chọn hôm nay — nếu không có data thì nhảy về ngày gần nhất
function pickToday(){
  const today = new Date().toISOString().slice(0,10);
  // Kiểm tra xem hôm nay có data không (từ bất kỳ bệnh nhân nào)
  const hasToday = allDates.includes(today)
    || Object.values(vcache).some(c => c.byDate[today]?.length > 0);
  if(hasToday){
    pickDate(today);
  } else if(allDates.length){
    // Nhảy về ngày gần nhất có data
    pickDate(allDates[0]);
    const d = allDates[0].split('-').reverse().join('/');
    document.getElementById('date-lbl').textContent = d + ' (gần nhất)';
  } else {
    pickDate(null);
  }
  document.getElementById('date-dd').style.display = 'none';
}

// Tương tự cho trang bệnh nhân
function pickPtToday(){
  const today = new Date().toISOString().slice(0,10);
  const cache = selPid ? vcache[selPid] : null;
  if(cache && cache.byDate[today]?.length > 0){
    pickPtDate(today);
  } else if(cache && cache.dates.length){
    pickPtDate(cache.dates[0]);
    document.getElementById('pt-date-lbl').textContent =
      cache.dates[0].split('-').reverse().join('/') + ' (gần nhất)';
  } else {
    pickPtDate(null);
  }
}

// Preload: chỉ fetch danh sách NGÀY của từng bệnh nhân (nhẹ)
// Data thực sự sẽ được fetch theo ngày khi cần
async function preloadAllVitals(){
  if(!pts.length) return;
  const chunks = [];
  for(let i=0;i<pts.length;i+=3) chunks.push(pts.slice(i,i+3));

  for(const chunk of chunks){
    await Promise.all(chunk.map(async function(p){
      if(vcache[p.id]) return;
      try {
        const r = await fetch(API+'/vitals/'+p.id+'/days', { headers: authHeader() });
        if(!r.ok) return;
        const dates = await r.json();
        vcache[p.id] = { byDate:{}, dates:dates };
      } catch(_){}
    }));
    if(selDate) updSum();
  }

  updSum();
  calRender();
  if(selDate) renderPts(pts, document.getElementById('srch')?.value||'');
  // Nếu đang xem trang bệnh nhân → re-render calendar để highlight đủ ngày
  if(selPid && vcache[selPid]) renderPtCal();
}

// Fetch data của 1 bệnh nhân trong 1 ngày cụ thể (on demand)
async function fetchPatientDay(pid, date){
  if(!vcache[pid]) vcache[pid] = {byDate:{}, dates:[]};
  if(vcache[pid].byDate[date]) return vcache[pid].byDate[date]; // đã có cache
  try {
    const r = await fetch(API+'/vitals/'+pid+'/by-date/'+date, { headers: authHeader() });
    if(!r.ok) return [];
    const rows = await r.json();
    vcache[pid].byDate[date] = rows;
    if(!vcache[pid].dates.includes(date)){
      vcache[pid].dates.push(date);
      vcache[pid].dates.sort((a,b)=>b.localeCompare(a));
    }
    return rows;
  } catch(_){ return []; }
}

// LOAD DATA
async function loadData(){
  document.getElementById('pt-list').innerHTML='<div class="loading"><span class="spin"></span>Đang tải...</div>';
  try {
    const r=await fetch(`${API}/doctor/${DID}/patients`, { headers: authHeader() });
    if(!r.ok) throw new Error('HTTP '+r.status);
    const raw=await r.json();
    pts=raw.map(p=>({
      id:p.patientId, name:p.patientName, dob:p.dob, gender:p.gender,
      serial:p.device?.serial||'—',
      hr:p.live?.heartRate??null, spo2:p.live?.spo2??null,
      last:p.live?.updatedAt,
      alertLevel:p.live?.alertLevel||'binh_thuong',
      deviceStatus:p.live?.deviceStatus||null,
      blood:p.profile?.nhom_mau, disease:p.profile?.benh_man_tinh, phone:p.phone
    }));
    renderPts(pts);
    updSum();
    document.getElementById('last-upd').textContent=new Date().toLocaleTimeString('vi-VN',{hour:'2-digit',minute:'2-digit',second:'2-digit'});
    loadSbDoc();
    try { const rd=await fetch(`${API}/vitals/days`, { headers: authHeader() }); if(rd.ok){allDates=(await rd.json()).sort((a,b)=>b.localeCompare(a));buildDD();} } catch(_){}
    // Khởi động Realtime sau khi có danh sách bệnh nhân
    startRealtime();
    preloadAllVitals();
    pickToday();
    // Load cảnh báo ngay khi vào
    loadActiveAlerts();
  } catch(e){ document.getElementById('pt-list').innerHTML=`<div class="loading">⚠️ ${esc(e.message)}</div>`; }
}

// RENDER PATIENTS
function renderPts(list,q=''){
  const el=document.getElementById('pt-list');
  const fl=q?list.filter(p=>(p.name||'').toLowerCase().includes(q.toLowerCase())):list;
  if(!fl.length){el.innerHTML='<div class="loading">Không có dữ liệu</div>';return;}
  el.innerHTML=fl.map(p=>{
    // Nếu đang chọn ngày → dùng bản ghi cuối cùng của ngày đó từ vcache
    let hr, spo2;
    if(selDate && vcache[p.id] && vcache[p.id].byDate[selDate] && vcache[p.id].byDate[selDate].length){
      // byDate đã sort desc → phần tử cuối cùng là bản ghi cuối ngày
      const rows = vcache[p.id].byDate[selDate];
      const last = rows[rows.length - 1];
      hr   = last.hr   != null ? Number(last.hr)   : null;
      spo2 = last.spo2 != null ? Number(last.spo2) : null;
    } else if(selDate && vcache[p.id] && !vcache[p.id].byDate[selDate]){
      // Ngày đó không có data → hiện —
      hr = null; spo2 = null;
    } else {
      // Không chọn ngày → dùng live data
      hr   = p.hr   != null ? Number(p.hr)   : null;
      spo2 = p.spo2 != null ? Number(p.spo2) : null;
    }
    const hc=hr!=null?(hr>100||hr<50?'var(--danger)':hr>90?'var(--warn)':'var(--green)'):'var(--muted)';
    const sc=spo2!=null?(spo2<90?'var(--danger)':spo2<94?'var(--warn)':'var(--navy)'):'var(--muted)';
    const dob=p.dob?new Date(p.dob).toLocaleDateString('vi-VN'):'—';
    const sid=(p.id||'').slice(0,8).toUpperCase();
    const bdg=sbadge(hr,spo2);
    return `<div class="pt-row${selPid===p.id?' sel':''}" onclick="clickPt('${p.id}')" data-tip-pid="${p.id}">
      <div class="mono">BN-${sid}</div>
      <div style="font-size:.82rem;font-weight:600">${esc(p.name)}</div>
      <div class="mono">${dob}</div>
      <div class="mono">${esc(p.serial)}</div>
      <div class="val" style="color:${hc}">${hr!=null?hr:'—'}</div>
      <div class="val" style="color:${sc}">${spo2!=null?spo2+'%':'—'}</div>
      <div>${bdg}</div>
    </div>`;
  }).join('');
}
function sbadge(hr,spo2){
  if(hr==null&&spo2==null) return '<span class="badge off">⚫ Offline</span>';
  if((spo2!=null&&spo2<90)||(hr!=null&&(hr>120||hr<45))) return '<span class="badge danger">🔴 Nguy hiểm</span>';
  if((spo2!=null&&spo2<94)||(hr!=null&&(hr>100||hr<50))) return '<span class="badge warn">🟡 Cảnh báo</span>';
  return '<span class="badge ok">🟢 Bình thường</span>';
}

// Tính summary cho 1 bệnh nhân cụ thể (hiện trên view-patient)
function updPatientSum(pid){
  const cache = vcache[pid];
  if(!cache) return;
  let ok=0, w=0, d=0;
  // Nếu đang chọn ngày thì chỉ đếm ngày đó, không thì đếm tất cả
  if(ptSelDate && cache.byDate[ptSelDate]){
    cache.byDate[ptSelDate].forEach(r=>{
      const hr=r.hr!=null?Number(r.hr):null, spo2=r.spo2!=null?Number(r.spo2):null;
      if(hr==null&&spo2==null) return;
      if((spo2!=null&&spo2<90)||(hr!=null&&(hr>120||hr<45))) d++;
      else if((spo2!=null&&spo2<94)||(hr!=null&&(hr>100||hr<50))) w++;
      else ok++;
    });
  } else {
    Object.values(cache.byDate).forEach(rows=>{
      rows.forEach(r=>{
        const hr=r.hr!=null?Number(r.hr):null, spo2=r.spo2!=null?Number(r.spo2):null;
        if(hr==null&&spo2==null) return;
        if((spo2!=null&&spo2<90)||(hr!=null&&(hr>120||hr<45))) d++;
        else if((spo2!=null&&spo2<94)||(hr!=null&&(hr>100||hr<50))) w++;
        else ok++;
      });
    });
  }
  const okEl=document.getElementById('pt-ok');
  const wEl=document.getElementById('pt-warn');
  const dEl=document.getElementById('pt-danger');
  if(okEl) okEl.textContent=ok;
  if(wEl) wEl.textContent=w;
  if(dEl) dEl.textContent=d;
}

// SUMMARY — tổng tất cả bệnh nhân (overview)
function updSum(){
  if(selDate){
    // Chọn ngày → fetch on-demand rồi đếm
    Promise.all(pts.map(p => fetchPatientDay(p.id, selDate)))
      .then(function(allRows){
        let ok=0, w=0, d=0;
        allRows.forEach(function(rows){
          rows.forEach(function(r){
            const hr   = r.hr   != null ? Number(r.hr)   : null;
            const spo2 = r.spo2 != null ? Number(r.spo2) : null;
            if(hr==null && spo2==null) return;
            if((spo2!=null&&spo2<90)||(hr!=null&&(hr>120||hr<45))) d++;
            else if((spo2!=null&&spo2<94)||(hr!=null&&(hr>100||hr<50))) w++;
            else ok++;
          });
        });
        document.getElementById('s-ok').textContent      = ok;
        document.getElementById('s-warn').textContent    = w;
        document.getElementById('s-danger').textContent  = d;
        document.getElementById('s-total').textContent   = pts.length;
        document.getElementById('sub-ok').textContent    = 'bản ghi';
        document.getElementById('sub-warn').textContent  = 'bản ghi';
        document.getElementById('sub-danger').textContent= 'bản ghi';
        renderPts(pts, document.getElementById('srch')?.value||'');
      });
    return; // async
  }

  // Không chọn ngày → dùng alertLevel live
  let ok=0, w=0, d=0;
  pts.forEach(p=>{
    const lv = p.alertLevel || 'binh_thuong';
    if(lv === 'nguy_hiem')     d++;
    else if(lv === 'canh_bao') w++;
    else                        ok++;
  });
  document.getElementById('s-ok').textContent      = ok;
  document.getElementById('s-warn').textContent    = w;
  document.getElementById('s-danger').textContent  = d;
  document.getElementById('s-total').textContent   = pts.length;
  document.getElementById('sub-ok').textContent    = 'bệnh nhân';
  document.getElementById('sub-warn').textContent  = 'bệnh nhân';
  document.getElementById('sub-danger').textContent= 'bệnh nhân';
}

// TOOLTIP
let _tip=null;
function showTip(e,pid){
  _tip=document.getElementById('tip');
  const p=pts.find(x=>x.id===pid);if(!p)return;
  const dob=p.dob?new Date(p.dob).toLocaleDateString('vi-VN'):'—';
  const age=p.dob?Math.floor((Date.now()-new Date(p.dob))/31557600000):null;
  _tip.innerHTML=`<div class="tn">${esc(p.name)}</div>
    <div class="tr"><span class="tl">Mã BN</span><span class="tv">BN-${(p.id||'').slice(0,8).toUpperCase()}</span></div>
    <div class="tr"><span class="tl">Ngày sinh</span><span class="tv">${dob}${age?' ('+age+' tuổi)':''}</span></div>
    <div class="tr"><span class="tl">Giới tính</span><span class="tv">${p.gender==='nam'?'Nam':p.gender==='nu'?'Nữ':'—'}</span></div>
    <div class="tr"><span class="tl">Thiết bị</span><span class="tv">${esc(p.serial)}</span></div>
    <div class="tr"><span class="tl">Nhịp tim</span><span class="tv">${p.hr!=null?p.hr+' bpm':'—'}</span></div>
    <div class="tr"><span class="tl">SpO₂</span><span class="tv">${p.spo2!=null?p.spo2+'%':'—'}</span></div>
    ${p.blood?`<div class="tr"><span class="tl">Nhóm máu</span><span class="tv">${esc(p.blood)}</span></div>`:''}
    ${p.disease?`<div class="tr"><span class="tl">Bệnh mãn</span><span class="tv" style="font-size:.66rem;max-width:130px;text-align:right">${esc(p.disease)}</span></div>`:''}`;
  const x=e.clientX+14,y=e.clientY-10;
  _tip.style.left=(x+250>innerWidth?x-264:x)+'px';
  _tip.style.top=(y+280>innerHeight?y-280+20:y)+'px';
  _tip.style.display='block';
  // Đánh dấu pid đang hover để mousemove global check
  _tip._pid = pid;
}

function hideTip(){
  if(_tip){ _tip.style.display='none'; _tip._pid=null; }
}

// Tooltip: dùng mouseover/mouseout trên document thay vì inline handler
// mouseout có relatedTarget — biết chính xác chuột đi đâu, không bị miss
document.addEventListener('mouseover', function(e){
  const row = e.target.closest('[data-tip-pid]');
  if(row){
    showTip(e, row.dataset.tipPid);
  }
});

document.addEventListener('mouseout', function(e){
  const row = e.target.closest('[data-tip-pid]');
  if(!row) return;
  // relatedTarget = element chuột đi vào tiếp theo
  // Nếu vẫn trong cùng row (di chuyển sang child element) thì không ẩn
  if(row.contains(e.relatedTarget)) return;
  hideTip();
});

// Backup: ẩn tooltip khi click bất kỳ đâu
document.addEventListener('click', function(){
  hideTip();
});

// Backup: ẩn khi scroll
document.addEventListener('scroll', function(){
  hideTip();
}, true);

// CLICK PATIENT → mở trang chi tiết riêng
function clickPt(pid){
  selPid = pid;
  const p = pts.find(x=>x.id===pid);

  // Ẩn tất cả views
  ['overview','devices','links','records','patient'].forEach(v=>{
    document.getElementById('view-'+v).style.display = 'none';
  });

  // Hiện view-patient
  document.getElementById('view-patient').style.display = 'flex';
  document.getElementById('live-dot').style.display = 'none';

  // Cập nhật header
  if(p){
    document.getElementById('pt-detail-name').textContent = p.name;
    const dob = p.dob ? new Date(p.dob).toLocaleDateString('vi-VN') : '—';
    const sid = (p.id||'').slice(0,8).toUpperCase();
    document.getElementById('pt-detail-sub').textContent = 'BN-' + sid + ' · ' + dob;
    document.getElementById('vtitle').textContent = '📈 Dữ liệu sinh tồn — ' + p.name;
  }

  // Reset date picker & summary
  // Nếu bên ngoài đang chọn ngày cụ thể → kế thừa ngày đó
  ptSelDate = selDate || null;
  vtPage = 1;
  vtCurrentRows = [];

  if(selDate){
    // Kế thừa ngày từ tổng quan
    const [y,m] = selDate.split('-').map(Number);
    ptCalY = y; ptCalM = m - 1;
    document.getElementById('pt-date-lbl').textContent = selDate.split('-').reverse().join('/');
  } else {
    // Không có ngày chọn → dùng hôm nay/ngày gần nhất
    const now = new Date();
    ptCalY = now.getFullYear();
    ptCalM = now.getMonth();
    document.getElementById('pt-date-lbl').textContent = 'Hôm nay';
  }

  document.getElementById('pt-ok').textContent = '—';
  document.getElementById('pt-warn').textContent = '—';
  document.getElementById('pt-danger').textContent = '—';

  // Đặt spinner trước
  document.getElementById('vbody').innerHTML = '<div class="loading"><span class="spin"></span>Đang tải dữ liệu...</div>';

  // Load vitals
  setTimeout(async ()=>{
    await showV(pid);
    // Nếu không có selDate thì mới pickPtToday
    if(!selDate) pickPtToday();
  }, 0);
}

function backToOverview(){
  selPid = null;
  ['overview','devices','links','records','patient'].forEach(v=>{
    document.getElementById('view-'+v).style.display = 'none';
  });
  document.getElementById('view-overview').style.display = 'flex';
  document.getElementById('live-dot').style.display = 'flex';
  // Bỏ highlight bệnh nhân
  renderPts(pts, document.getElementById('srch').value);
}

async function showV(pid){
  const body = document.getElementById('vbody');
  if(!body) return;
  body.innerHTML = '<div class="loading"><span class="spin"></span>Đang tải...</div>';
  try {
    // Luôn fetch lại dates để đảm bảo đủ (override cache cũ có thể thiếu)
    const r = await fetch(API+'/vitals/'+pid+'/days', { headers: authHeader() });
    if(!r.ok) throw new Error('HTTP '+r.status);
    const dates = await r.json();
    if(!vcache[pid]) vcache[pid] = {byDate:{}, dates:[]};
    vcache[pid].dates = dates; // cập nhật dates đầy đủ

    const cache = vcache[pid];
    if(!cache.dates.length){
      body.innerHTML = '<div class="loading">Không có dữ liệu</div>';
      return;
    }

    // Nhảy calendar về tháng của ngày được chọn
    const showDate = ptSelDate && cache.dates.includes(ptSelDate)
      ? ptSelDate
      : cache.dates[0]; // fallback ngày gần nhất

    const [ly, lm] = showDate.split('-').map(Number);
    ptCalY = ly; ptCalM = lm - 1;

    if(!ptSelDate) {
      ptSelDate = showDate;
      document.getElementById('pt-date-lbl').textContent = showDate.split('-').reverse().join('/');
    }

    // Fetch data của ngày được chọn nếu chưa có
    const rows = await fetchPatientDay(pid, showDate);
    renderVT(rows);
    updPatientSum(pid);
    renderPtCal();
  } catch(e){
    body.innerHTML = '<div class="loading">⚠️ '+esc(e.message)+'</div>';
  }
}


// ── BỘ LỌC VITALS ──
let vtPage = 1;
const VT_PER_PAGE = 20;
let vtCurrentRows = [];
let vtAllRows = [];

function toggleVtFilter(){
  const panel = document.getElementById('vt-filter-panel');
  const btn   = document.getElementById('vt-filter-btn');
  const isOpen = panel.style.display !== 'none';
  panel.style.display = isOpen ? 'none' : 'block';
  btn.style.borderColor = isOpen ? 'var(--border)' : 'var(--navy)';
  btn.style.color       = isOpen ? 'var(--muted)'  : 'var(--navy)';
}

function inRange(val, rangeStr){
  if(val == null) return false;
  const [lo, hi] = rangeStr.split('-').map(Number);
  return Number(val) >= lo && Number(val) <= hi;
}

function applyVtFilter(){
  // Lấy checked values theo từng nhóm dựa vào data-group
  const hrF   = [...document.querySelectorAll('#vt-hr-group input:checked')].map(x=>x.value);
  const spo2F = [...document.querySelectorAll('#vt-spo2-group input:checked')].map(x=>x.value);
  const modeF = [...document.querySelectorAll('#vt-mode-group input:checked')].map(x=>x.value);

  let filtered = vtAllRows;
  if(hrF.length)   filtered = filtered.filter(r => hrF.some(range   => inRange(r.hr,   range)));
  if(spo2F.length) filtered = filtered.filter(r => spo2F.some(range => inRange(r.spo2, range)));
  if(modeF.length) filtered = filtered.filter(r => modeF.includes(r.mode));

  const totalActive = hrF.length + spo2F.length + modeF.length;
  document.getElementById('vt-filter-count').style.display = totalActive ? 'inline' : 'none';
  document.getElementById('vt-filter-count').textContent   = totalActive;
  document.getElementById('vt-filter-reset').style.display = totalActive ? 'inline-block' : 'none';

  vtPage = 1;
  vtCurrentRows = filtered;
  renderVTPage();
}

function resetVtFilter(){
  document.querySelectorAll('#vt-filter-panel input[type=checkbox]').forEach(x=>x.checked=false);
  document.getElementById('vt-filter-count').style.display = 'none';
  document.getElementById('vt-filter-reset').style.display = 'none';
  vtPage = 1;
  vtCurrentRows = vtAllRows;
  renderVTPage();
}

function renderVT(rows){
  vtAllRows     = rows; // lưu gốc để filter
  vtCurrentRows = rows;
  vtPage = 1;
  // Reset filter checkboxes khi đổi ngày
  document.querySelectorAll('#vt-filter-panel input[type=checkbox]').forEach(x=>x.checked=false);
  document.getElementById('vt-filter-count').style.display = 'none';
  document.getElementById('vt-filter-reset').style.display = 'none';
  renderVTPage();
}

function renderVTPage(){
  const body = document.getElementById('vbody');
  if(!body) return;
  const rows = vtCurrentRows;
  if(!rows.length){body.innerHTML='<div class="loading">Không có dữ liệu trong ngày này</div>';return;}

  const totalPages = Math.ceil(rows.length / VT_PER_PAGE);
  const start = (vtPage-1)*VT_PER_PAGE;
  const slice = rows.slice(start, start+VT_PER_PAGE);

  const mL={nghi_ngoi:'Nghỉ ngơi',thay_doi:'Thay đổi',canh_bao:'Cảnh báo',hau_canh_bao:'Hậu cảnh báo'};
  const modeColor={nghi_ngoi:'background:#e8f2fc;color:var(--navy)',thay_doi:'background:var(--mint);color:var(--navy)',canh_bao:'background:#fff4e0;color:#8a5800',hau_canh_bao:'background:#fdeaea;color:#c0392b'};

  let html = `<div class="vcount">Trang ${vtPage}/${totalPages} — Hiển thị ${start+1}–${Math.min(start+VT_PER_PAGE,rows.length)} trong ${rows.length} bản ghi</div>`;
  html += '<div class="vtw"><table class="vt"><thead><tr><th>Thời gian</th><th>Nhịp tim</th><th>Δ HR</th><th>SpO₂</th><th>Δ SpO₂</th><th>Chế độ</th></tr></thead><tbody>';
  html += slice.map(r=>{
    const hr=r.hr, spo2=r.spo2;
    const hc=hr!=null&&(hr>100||hr<50)?'var(--danger)':hr!=null?'var(--green)':'var(--muted)';
    const sc=spo2!=null&&spo2<93?'var(--danger)':'var(--navy)';
    const ts=r.time?new Date(r.time).toLocaleTimeString('vi-VN',{hour:'2-digit',minute:'2-digit',second:'2-digit'}):'—';
    const dHR=r.dHR!=null?(r.dHR>0?'+':'')+r.dHR:'—';
    const dS=r.dS!=null?(r.dS>0?'+':'')+Number(r.dS).toFixed(1):'—';
    const mc=modeColor[r.mode]||'background:var(--mint);color:var(--navy)';
    return`<tr><td>${ts}</td><td style="color:${hc};font-weight:700">${hr!=null?hr+' bpm':'—'}</td><td style="color:${r.dHR>0?'var(--danger)':r.dHR<0?'var(--green)':'var(--muted)'}">${dHR}</td><td style="color:${sc};font-weight:700">${spo2!=null?spo2+'%':'—'}</td><td style="color:${r.dS>0?'var(--navy)':r.dS<0?'var(--warn)':'var(--muted)'}">${dS}</td><td><span style="${mc};padding:2px 7px;border-radius:10px;font-size:.61rem;font-weight:700">${mL[r.mode]||r.mode||'—'}</span></td></tr>`;
  }).join('');
  html += '</tbody></table></div>';

  // Phân trang
  if(totalPages > 1){
    html += '<div style="display:flex;align-items:center;justify-content:space-between;padding:10px 16px;border-top:1px solid var(--border)">'
      + `<span style="font-size:.7rem;color:var(--muted)">Tổng ${rows.length} bản ghi</span>`
      + '<div style="display:flex;gap:6px">'
      + `<button onclick="vtGoPage(${vtPage-1})" ${vtPage<=1?'disabled':''} style="padding:5px 12px;border:1.5px solid var(--border);border-radius:7px;background:var(--card);font-family:'Sora',sans-serif;font-size:.74rem;font-weight:600;color:var(--muted);cursor:pointer;${vtPage<=1?'opacity:.4':''}">← Trước</button>`
      + Array.from({length:Math.min(totalPages,7)},(_,i)=>{
          let p = i+1;
          if(totalPages>7){
            const range=[1,2,vtPage-1,vtPage,vtPage+1,totalPages-1,totalPages].filter(x=>x>=1&&x<=totalPages);
            p = [...new Set(range)].sort((a,b)=>a-b)[i];
            if(!p) return '';
          }
          return `<button onclick="vtGoPage(${p})" style="padding:5px 10px;border:1.5px solid ${p===vtPage?'var(--navy)':'var(--border)'};border-radius:7px;background:${p===vtPage?'var(--navy)':'var(--card)'};color:${p===vtPage?'#fff':'var(--muted)'};font-family:'Sora',sans-serif;font-size:.74rem;font-weight:600;cursor:pointer">${p}</button>`;
        }).join('')
      + `<button onclick="vtGoPage(${vtPage+1})" ${vtPage>=totalPages?'disabled':''} style="padding:5px 12px;border:1.5px solid var(--border);border-radius:7px;background:var(--card);font-family:'Sora',sans-serif;font-size:.74rem;font-weight:600;color:var(--muted);cursor:pointer;${vtPage>=totalPages?'opacity:.4':''}">Tiếp →</button>`
      + '</div></div>';
  }

  body.innerHTML = html;
}

function vtGoPage(p){
  const total = Math.ceil(vtCurrentRows.length / VT_PER_PAGE);
  if(p<1||p>total) return;
  vtPage = p;
  renderVTPage();
  document.getElementById('view-patient')?.scrollTo({top:0,behavior:'smooth'});
}

document.getElementById('srch').addEventListener('input',function(){renderPts(pts,this.value);});

// SIDEBAR DOCTOR
async function loadSbDoc(){
  try {
    const r = await fetch(`${API}/doctor/${DID}`, { headers: authHeader() });
    if(!r.ok) return;
    const d = await r.json();
    const i = (d.name||'BS').split(' ').map(w=>w[0]).slice(-2).join('').toUpperCase();
    document.getElementById('sb-name').textContent = d.name||'Bác sĩ';
    document.getElementById('sb-role').textContent = d.hospital?.name||'Bác sĩ';
    // Hiện avatar nếu có
    const sess = JSON.parse(localStorage.getItem('hm_session')||'{}');
    const av = d.avatar || sess.avatar;
    if(av){ updateSidebarAvatar(av); if(!sess.avatar){ sess.avatar=av; localStorage.setItem('hm_session',JSON.stringify(sess)); } }
    else { document.getElementById('sb-av').textContent = i; }
  } catch(_){}
}

// SLIDE PANELS
async function saveRec(pid){
  const m=document.getElementById('rmsg-'+pid);
  const g=f=>{const e=document.getElementById(`rf-${pid}-${f}`);return e?e.value.trim()||null:null;};
  const p={};
  ['nhom_mau','benh_man_tinh','di_ung','tien_su_y_te','nguoi_lien_he_khan_ten','nguoi_lien_he_khan_sdt'].forEach(f=>{const v=g(f);if(v)p[f]=v;});
  ['chieu_cao_cm','can_nang_kg'].forEach(f=>{const v=g(f);if(v)p[f]=parseFloat(v);});
  m.style.color='var(--muted)';m.textContent='Đang lưu...';
  try { const r=await fetch(`${API}/medical-record/${pid}`,{method:'PATCH',headers:authHeader(),body:JSON.stringify(p)}); const d=await r.json(); if(r.ok){m.style.color='var(--green)';m.textContent='✅ Lưu thành công!';setTimeout(()=>m.textContent='',3000);}else{m.style.color='var(--danger)';m.textContent='⚠️ '+(d.error||'Lỗi');} } catch(e){m.style.color='var(--danger)';m.textContent='⚠️ Không thể kết nối';}
}

// CHAT
function toggleChat(){const b=document.getElementById('cbox');b.classList.toggle('open');if(b.classList.contains('open'))renderCList();}
function renderCList(){
  document.getElementById('cv-list').style.display='flex';
  document.getElementById('cv-chat').style.display='none';
  const l=document.getElementById('clist'),em=document.getElementById('cempty');
  if(!pts.length){l.innerHTML='';em.style.display='flex';document.getElementById('csub').textContent='Không có bệnh nhân';return;}
  em.style.display='none';document.getElementById('csub').textContent=`${pts.length} bệnh nhân`;
  l.innerHTML=pts.map(p=>{const i=(p.name||'?').split(' ').map(w=>w[0]).slice(-2).join('').toUpperCase();const msgs=ccache[p.id]||[];const last=msgs[msgs.length-1];return`<div class="citem" onclick="openChat('${p.id}','${esc(p.name)}')"><div class="cav2">${i}</div><div style="flex:1;min-width:0"><div class="cn">${esc(p.name)}</div><div class="cp">${last?esc(last.content.slice(0,40)):'Chưa có ghi chú'}</div></div></div>`;}).join('');
}
async function openChat(pid,name){
  curCPid=pid;
  const i=(name||'?').split(' ').map(w=>w[0]).slice(-2).join('').toUpperCase();
  document.getElementById('cav').textContent=i;
  document.getElementById('cpname').textContent=name;
  document.getElementById('cv-list').style.display='none';
  document.getElementById('cv-chat').style.display='flex';
  const m=document.getElementById('cmsgs');
  m.innerHTML='<div style="text-align:center;padding:20px"><span class="spin"></span></div>';
  try{const r=await fetch(`${API}/chat/${pid}`, { headers: authHeader() });ccache[pid]=r.ok?await r.json():[];}catch(_){ccache[pid]=[];}
  renderCMsgs();
}
function renderCMsgs(){
  const m=document.getElementById('cmsgs'),h=ccache[curCPid]||[];
  const tl={don_thuoc:'💊',khuyen_nghi:'📋',theo_doi:'👁️',tai_kham:'📅'};
  if(!h.length){m.innerHTML='<div style="text-align:center;color:var(--muted);padding:20px;font-size:.76rem">Chưa có ghi chú</div>';return;}
  m.innerHTML=h.map(x=>{const ts=new Date(x.createdAt).toLocaleTimeString('vi-VN',{hour:'2-digit',minute:'2-digit'});return`<div class="cmsg"><div class="cbbl">${tl[x.type]||''} ${esc(x.content)}</div><div class="cts">${ts}</div></div>`;}).join('');
  m.scrollTop=m.scrollHeight;
}
function backChat(){document.getElementById('cv-list').style.display='flex';document.getElementById('cv-chat').style.display='none';renderCList();}
async function sendNote(){
  const inp=document.getElementById('cinp'),txt=inp.value.trim();
  if(!txt||!curCPid)return;
  const type=document.getElementById('ctype').value;
  inp.value='';inp.style.height='auto';
  try{const r=await fetch(`${API}/chat/${curCPid}`,{method:'POST',headers:authHeader(),body:JSON.stringify({doctorId:DID,content:txt,type})});if(r.ok){if(!ccache[curCPid])ccache[curCPid]=[];ccache[curCPid].push(await r.json());renderCMsgs();}}catch(_){}
}
document.getElementById('cinp').addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();sendNote();}});
document.getElementById('cinp').addEventListener('input',function(){this.style.height='auto';this.style.height=Math.min(this.scrollHeight,68)+'px';});

loadData();

// ── AUTO REFRESH (fallback 60s — Realtime WebSocket là nguồn chính) ──
const REFRESH_INTERVAL = 60000; // 60 giây fallback

async function silentRefresh(){
  // Luôn refresh danh sách + live data (không hiện spinner)
  try {
    const r = await fetch(`${API}/doctor/${DID}/patients`, { headers: authHeader() });
    if(!r.ok) return;
    const raw = await r.json();
    const newPts = raw.map(p=>({
      id:p.patientId, name:p.patientName, dob:p.dob, gender:p.gender,
      serial:p.device?.serial||'—',
      hr:p.live?.heartRate??null, spo2:p.live?.spo2??null,
      last:p.live?.updatedAt,
      blood:p.profile?.nhom_mau, disease:p.profile?.benh_man_tinh, phone:p.phone
    }));

    // Cập nhật pts và re-render danh sách (giữ nguyên search filter)
    pts = newPts;
    renderPts(pts, document.getElementById('srch').value);
    updSum();
    document.getElementById('last-upd').textContent =
      new Date().toLocaleTimeString('vi-VN',{hour:'2-digit',minute:'2-digit',second:'2-digit'})
      + ' ↻';
  } catch(_){}

  // Nếu đang xem trang chi tiết bệnh nhân → refresh vitals của ngày đang chọn
  if(selPid && document.getElementById('view-patient').style.display !== 'none'){
    try {
      // Chỉ fetch data mới nhất (limit nhỏ để nhanh), merge vào cache
      const r = await fetch(`${API}/vitals/${selPid}?limit=50`, { headers: authHeader() });
      if(!r.ok) return;
      const raw = await r.json();
      if(!raw.length) return;

      const cache = vcache[selPid];
      if(!cache) return;

      let updated = false;
      raw.forEach(function(v){
        const row = {
          hr:   v.heartRate   != null ? v.heartRate   : v.nhip_tim,
          spo2: v.spo2,
          dHR:  v.deltaHeartRate != null ? v.deltaHeartRate : v.delta_nhip_tim,
          dS:   v.deltaSpo2   != null ? v.deltaSpo2   : v.delta_spo2,
          mode: v.samplingMode || v.che_do_lay_mau,
          time: v.time        || v.thoi_gian_do,
        };
        if(!row.time) return;
        const d = new Date(new Date(row.time).getTime() + 7*3600000);
        const k = d.toISOString().slice(0,10);
        if(!cache.byDate[k]) { cache.byDate[k]=[]; cache.dates.unshift(k); cache.dates.sort((a,b)=>b.localeCompare(a)); }
        // Thêm nếu chưa có (tránh duplicate theo time)
        const exists = cache.byDate[k].some(x=>x.time===row.time);
        if(!exists){ cache.byDate[k].unshift(row); updated=true; }
      });

      // Re-render nếu có data mới và đang xem đúng ngày đó
      if(updated){
        const show = ptSelDate && cache.byDate[ptSelDate] ? ptSelDate : cache.dates[0];
        renderVT(cache.byDate[show]||[]);
        updPatientSum(selPid);
        renderPtCal();
      }
    } catch(_){}
  }
}

// Bắt đầu auto-refresh
let _refreshTimer = setInterval(silentRefresh, REFRESH_INTERVAL);

// Hiển thị đồng hồ đếm ngược refresh
let _countdown = REFRESH_INTERVAL / 1000;
setInterval(function(){
  _countdown--;
  if(_countdown <= 0) _countdown = REFRESH_INTERVAL / 1000;
  const el = document.getElementById('last-upd');
  if(el && !el.textContent.includes('↻')){
    // Chỉ hiện countdown nếu không đang refresh
    const base = el.textContent.replace(/\s*\(.*\)$/,'');
    el.title = 'Tự làm mới sau ' + _countdown + 's';
  }
}, 1000);

// Tạm dừng refresh khi tab bị ẩn, tiếp tục khi quay lại
document.addEventListener('visibilitychange', function(){
  if(document.hidden){
    clearInterval(_refreshTimer);
  } else {
    silentRefresh(); // Refresh ngay khi quay lại tab
    _countdown = REFRESH_INTERVAL / 1000;
    _refreshTimer = setInterval(silentRefresh, REFRESH_INTERVAL);
  }
});
