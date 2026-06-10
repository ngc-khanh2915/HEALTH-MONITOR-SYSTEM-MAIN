require("dotenv").config();
const express = require("express");
const cors    = require("cors");
const crypto  = require("crypto");

const {
  loginLimiter,
  apiLimiter,
  createSupabaseClient,
  verifyPassword,
  hashPassword,
  signToken,
  requireAuth,
  sendEmail,
  buildResetEmailHtml,
  getIp,
  logAction,
  FRONTEND_URL,
} = require("./utils/shared");

const supabase = createSupabaseClient();
const app      = express();

app.set("trust proxy", 1);

// ===== CORS =====
app.use(cors({
  origin: [
    "https://accountdoan.github.io",
    "http://localhost:3000",
    "http://localhost:5500",
    "http://127.0.0.1:5500",
  ],
  methods:        ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  credentials:    true,
}));

app.use(express.json());
app.use(apiLimiter);

// ===== Health check =====
app.get("/", (req, res) => {
  res.json({ status: "ok", version: "3.3" });
});

// ============================================================
// MODULE 1: DỮ LIỆU SINH TỒN
// ============================================================

// GET /vitals — bản ghi mới nhất của mỗi bệnh nhân
app.get("/vitals", requireAuth, async (req, res) => {
  try {
    const { data: vitals, error: vitalsError } = await supabase
      .from("du_lieu_sinh_ton")
      .select(`
        id, thiet_bi_id, nguoi_dung_tb_id,
        nhip_tim, spo2, che_do_lay_mau,
        delta_nhip_tim, delta_spo2, luu_tru_cuc_bo, thoi_gian_do
      `)
      .order("thoi_gian_do", { ascending: false })
      .limit(500);

    if (vitalsError) throw vitalsError;
    if (!vitals || vitals.length === 0) return res.json([]);

    const latestPerPatient = {};
    vitals.forEach((v) => {
      if (!latestPerPatient[v.nguoi_dung_tb_id]) {
        latestPerPatient[v.nguoi_dung_tb_id] = v;
      }
    });
    const uniqueVitals = Object.values(latestPerPatient);

    const uniquePatientIds = uniqueVitals.map((v) => v.nguoi_dung_tb_id).filter(Boolean);
    const userMap = {};
    if (uniquePatientIds.length > 0) {
      const { data: users } = await supabase
        .from("nguoi_dung")
        .select("id, ho_ten")
        .in("id", uniquePatientIds)
        .limit(uniquePatientIds.length);
      (users || []).forEach((u) => { userMap[u.id] = u.ho_ten; });
    }

    const vitalIds = uniqueVitals.map((v) => v.id).filter(Boolean);
    const alertMap = {};
    if (vitalIds.length > 0) {
      const { data: alerts } = await supabase
        .from("canh_bao_suc_khoe")
        .select("du_lieu_sinh_ton_id, loai_canh_bao, muc_do_nghiem_trong, trang_thai_xu_ly")
        .in("du_lieu_sinh_ton_id", vitalIds)
        .limit(vitalIds.length);
      (alerts || []).forEach((a) => {
        alertMap[a.du_lieu_sinh_ton_id] = {
          alertType: a.loai_canh_bao,
          severity:  a.muc_do_nghiem_trong,
          status:    a.trang_thai_xu_ly,
        };
      });
    }

    res.json(uniqueVitals.map((v) => ({
      id:             v.id,
      deviceId:       v.thiet_bi_id,
      patientId:      v.nguoi_dung_tb_id,
      patientName:    userMap[v.nguoi_dung_tb_id] || `ID:${v.nguoi_dung_tb_id?.slice(0, 8)}`,
      heartRate:      v.nhip_tim,
      spo2:           v.spo2,
      samplingMode:   v.che_do_lay_mau,
      deltaHeartRate: v.delta_nhip_tim,
      deltaSpo2:      v.delta_spo2,
      isCached:       v.luu_tru_cuc_bo,
      time:           v.thoi_gian_do,
      alertType:      alertMap[v.id]?.alertType || null,
      alertLevel:     alertMap[v.id]?.severity  || "binh_thuong",
      alertStatus:    alertMap[v.id]?.status    || null,
    })));
  } catch (err) {
    console.error("[GET /vitals]", err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /vitals/days — danh sách các ngày có dữ liệu (UTC+7)
app.get("/vitals/days", requireAuth, async (req, res) => {
  try {
    try {
      const { data: rpcData, error: rpcErr } = await supabase.rpc("get_distinct_dates");
      if (!rpcErr && Array.isArray(rpcData) && rpcData.length > 0) {
        const days = rpcData
          .map(r => (typeof r === "string" ? r : r.ngay || r.date || String(r)))
          .filter(Boolean)
          .sort((a, b) => b.localeCompare(a));
        return res.json(days);
      }
    } catch (_) {}

    const { data: raw, error: rawErr } = await supabase
      .from("du_lieu_sinh_ton")
      .select("thoi_gian_do")
      .order("thoi_gian_do", { ascending: false })
      .limit(100000);

    if (rawErr) throw rawErr;

    const dateSet = new Set();
    (raw || []).forEach((r) => {
      if (!r.thoi_gian_do) return;
      const local = new Date(new Date(r.thoi_gian_do).getTime() + 7 * 3600 * 1000);
      dateSet.add(local.toISOString().slice(0, 10));
    });

    res.json([...dateSet].sort((a, b) => b.localeCompare(a)));
  } catch (err) {
    console.error("[GET /vitals/days]", err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /vitals/by-date/:date — tất cả bản ghi của 1 ngày cụ thể (UTC+7)
app.get("/vitals/by-date/:date", requireAuth, async (req, res) => {
  try {
    const { date } = req.params;
    const startUTC = new Date(`${date}T00:00:00+07:00`).toISOString();
    const endUTC   = new Date(`${date}T23:59:59+07:00`).toISOString();

    const { data: vitals, error: vitalsError } = await supabase
      .from("du_lieu_sinh_ton")
      .select(`
        id, thiet_bi_id, nguoi_dung_tb_id,
        nhip_tim, spo2, delta_nhip_tim, delta_spo2,
        che_do_lay_mau, thoi_gian_do
      `)
      .gte("thoi_gian_do", startUTC)
      .lte("thoi_gian_do", endUTC)
      .order("thoi_gian_do", { ascending: false })
      .limit(2000);

    if (vitalsError) throw vitalsError;
    if (!vitals || vitals.length === 0) return res.json([]);

    const uniqueIds = [...new Set(vitals.map((v) => v.nguoi_dung_tb_id).filter(Boolean))];
    const userMap = {};
    if (uniqueIds.length > 0) {
      const { data: users } = await supabase
        .from("nguoi_dung").select("id, ho_ten").in("id", uniqueIds).limit(uniqueIds.length);
      (users || []).forEach((u) => { userMap[u.id] = u.ho_ten; });
    }

    res.json(vitals.map((v) => ({
      id:             v.id,
      deviceId:       v.thiet_bi_id,
      patientId:      v.nguoi_dung_tb_id,
      patientName:    userMap[v.nguoi_dung_tb_id] || `ID:${v.nguoi_dung_tb_id?.slice(0, 8)}`,
      heartRate:      v.nhip_tim,
      spo2:           v.spo2,
      deltaHeartRate: v.delta_nhip_tim,
      deltaSpo2:      v.delta_spo2,
      samplingMode:   v.che_do_lay_mau,
      time:           v.thoi_gian_do,
    })));
  } catch (err) {
    console.error("[GET /vitals/by-date/:date]", err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /vitals/:patientId/days — danh sách ngày có dữ liệu của 1 bệnh nhân
app.get("/vitals/:patientId/days", requireAuth, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("du_lieu_sinh_ton")
      .select("thoi_gian_do")
      .eq("nguoi_dung_tb_id", req.params.patientId)
      .order("thoi_gian_do", { ascending: false });

    if (error) throw error;

    const dateSet = new Set();
    (data || []).forEach(r => {
      if (!r.thoi_gian_do) return;
      const local = new Date(new Date(r.thoi_gian_do).getTime() + 7 * 3600 * 1000);
      dateSet.add(local.toISOString().slice(0, 10));
    });

    res.json([...dateSet].sort((a, b) => b.localeCompare(a)));
  } catch (err) {
    console.error("[GET /vitals/:patientId/days]", err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /vitals/:patientId/by-date/:date — dữ liệu 1 bệnh nhân trong 1 ngày
app.get("/vitals/:patientId/by-date/:date", requireAuth, async (req, res) => {
  try {
    const { patientId, date } = req.params;
    const startUTC = new Date(`${date}T00:00:00+07:00`).toISOString();
    const endUTC   = new Date(`${date}T23:59:59+07:00`).toISOString();

    const { data, error } = await supabase
      .from("du_lieu_sinh_ton")
      .select("id, nhip_tim, spo2, delta_nhip_tim, delta_spo2, che_do_lay_mau, thoi_gian_do")
      .eq("nguoi_dung_tb_id", patientId)
      .gte("thoi_gian_do", startUTC)
      .lte("thoi_gian_do", endUTC)
      .order("thoi_gian_do", { ascending: false });

    if (error) throw error;

    res.json((data || []).map(v => ({
      hr:   v.nhip_tim,
      spo2: v.spo2,
      dHR:  v.delta_nhip_tim,
      dS:   v.delta_spo2,
      mode: v.che_do_lay_mau,
      time: v.thoi_gian_do,
    })));
  } catch (err) {
    console.error("[GET /vitals/:patientId/by-date/:date]", err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /vitals/:patientId — sinh tồn theo bệnh nhân
app.get("/vitals/:patientId", requireAuth, async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 50;
    const { data, error } = await supabase
      .from("du_lieu_sinh_ton")
      .select(`
        id, thiet_bi_id, nguoi_dung_tb_id,
        nhip_tim, spo2, che_do_lay_mau,
        delta_nhip_tim, delta_spo2, thoi_gian_do
      `)
      .eq("nguoi_dung_tb_id", req.params.patientId)
      .order("thoi_gian_do", { ascending: false })
      .limit(limit);

    if (error) throw error;
    res.json(data);
  } catch (err) {
    console.error("[GET /vitals/:id]", err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /vitals/date/:date — tất cả dữ liệu sinh tồn của 1 ngày
app.get("/vitals/date/:date", requireAuth, async (req, res) => {
  try {
    const { date } = req.params;
    const startUTC = new Date(`${date}T00:00:00+07:00`).toISOString();
    const endUTC   = new Date(`${date}T23:59:59+07:00`).toISOString();

    const { data: vitals, error: vitalsError } = await supabase
      .from("du_lieu_sinh_ton")
      .select(`
        id, thiet_bi_id, nguoi_dung_tb_id,
        nhip_tim, spo2, che_do_lay_mau,
        delta_nhip_tim, delta_spo2, luu_tru_cuc_bo, thoi_gian_do
      `)
      .gte("thoi_gian_do", startUTC)
      .lte("thoi_gian_do", endUTC)
      .order("thoi_gian_do", { ascending: false })
      .limit(1000);

    if (vitalsError) throw vitalsError;
    if (!vitals || vitals.length === 0) return res.json([]);

    const uniquePatientIds = [...new Set(vitals.map((v) => v.nguoi_dung_tb_id).filter(Boolean))];
    const userMap = {};
    if (uniquePatientIds.length > 0) {
      const { data: users } = await supabase
        .from("nguoi_dung").select("id, ho_ten").in("id", uniquePatientIds).limit(uniquePatientIds.length);
      (users || []).forEach((u) => { userMap[u.id] = u.ho_ten; });
    }

    res.json(vitals.map((v) => ({
      id:             v.id,
      deviceId:       v.thiet_bi_id,
      patientId:      v.nguoi_dung_tb_id,
      patientName:    userMap[v.nguoi_dung_tb_id] || `ID:${v.nguoi_dung_tb_id?.slice(0, 8)}`,
      heartRate:      v.nhip_tim,
      spo2:           v.spo2,
      samplingMode:   v.che_do_lay_mau,
      deltaHeartRate: v.delta_nhip_tim,
      deltaSpo2:      v.delta_spo2,
      isCached:       v.luu_tru_cuc_bo,
      time:           v.thoi_gian_do,
    })));
  } catch (err) {
    console.error("[GET /vitals/date/:date]", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// MODULE 2: CẢNH BÁO
// ============================================================

app.get("/alerts", requireAuth, async (req, res) => {
  try {
    const { data: alerts, error } = await supabase
      .from("canh_bao_suc_khoe")
      .select(`
        id, du_lieu_sinh_ton_id, nguoi_dung_tb_id,
        loai_canh_bao, muc_do_nghiem_trong, trang_thai_xu_ly,
        thoi_gian_phat_hien, thoi_gian_bat_dau_dem_nguoc,
        thoi_gian_leo_thang, thoi_gian_xu_ly
      `)
      .order("thoi_gian_phat_hien", { ascending: false })
      .limit(50);

    if (error) throw error;
    if (!alerts || alerts.length === 0) return res.json([]);

    const uniquePatientIds = [...new Set(alerts.map((a) => a.nguoi_dung_tb_id).filter(Boolean))];
    const userMap = {};
    if (uniquePatientIds.length > 0) {
      const { data: users } = await supabase
        .from("nguoi_dung").select("id, ho_ten").in("id", uniquePatientIds).limit(uniquePatientIds.length);
      (users || []).forEach((u) => { userMap[u.id] = u.ho_ten; });
    }

    const vitalIds = [...new Set(alerts.map((a) => a.du_lieu_sinh_ton_id).filter(Boolean))];
    const vitalMap = {};
    if (vitalIds.length > 0) {
      const { data: vitals } = await supabase
        .from("du_lieu_sinh_ton").select("id, thiet_bi_id, nhip_tim, spo2").in("id", vitalIds).limit(vitalIds.length);
      (vitals || []).forEach((v) => { vitalMap[v.id] = v; });
    }

    res.json(alerts.map((a) => ({
      alertId:     a.id,
      patientId:   a.nguoi_dung_tb_id,
      patientName: userMap[a.nguoi_dung_tb_id] || `ID:${a.nguoi_dung_tb_id?.slice(0, 8)}`,
      deviceId:    vitalMap[a.du_lieu_sinh_ton_id]?.thiet_bi_id || null,
      heartRate:   vitalMap[a.du_lieu_sinh_ton_id]?.nhip_tim    || null,
      spo2:        vitalMap[a.du_lieu_sinh_ton_id]?.spo2        || null,
      alertType:   a.loai_canh_bao,
      severity:    a.muc_do_nghiem_trong,
      status:      a.trang_thai_xu_ly,
      detectedAt:  a.thoi_gian_phat_hien,
      countdownAt: a.thoi_gian_bat_dau_dem_nguoc,
      escalatedAt: a.thoi_gian_leo_thang,
      handledAt:   a.thoi_gian_xu_ly,
    })));
  } catch (err) {
    console.error("[GET /alerts]", err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get("/alerts/:patientId", requireAuth, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("canh_bao_suc_khoe")
      .select(`
        id, loai_canh_bao, muc_do_nghiem_trong,
        trang_thai_xu_ly, thoi_gian_phat_hien, thoi_gian_xu_ly,
        du_lieu_sinh_ton!du_lieu_sinh_ton_id ( nhip_tim, spo2 )
      `)
      .eq("nguoi_dung_tb_id", req.params.patientId)
      .order("thoi_gian_phat_hien", { ascending: false });

    if (error) throw error;
    res.json(data);
  } catch (err) {
    console.error("[GET /alerts/:id]", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// MODULE 3: BÁC SĨ
// ============================================================

app.get("/doctor/:doctorId", requireAuth, async (req, res) => {
  try {
    const { doctorId } = req.params;

    const { data: doctor, error: docErr } = await supabase
      .from("nguoi_dung")
      .select("id, ho_ten, email, so_dien_thoai, anh_dai_dien_url, co_so_y_te_id")
      .eq("id", doctorId)
      .maybeSingle();

    if (docErr) throw docErr;
    if (!doctor) return res.status(404).json({ error: `Không tìm thấy người dùng với ID: ${doctorId}` });

    const { data: pq } = await supabase
      .from("phan_quyen_nguoi_dung")
      .select("vai_tro_id, vai_tro(ten_vai_tro)")
      .eq("nguoi_dung_id", doctorId);
    const roles = (pq || []).map(p => p.vai_tro?.ten_vai_tro).filter(Boolean);

    let hospital = null;
    if (doctor.co_so_y_te_id) {
      const { data: csyt } = await supabase
        .from("co_so_y_te")
        .select("id, ten_co_so, dia_chi, so_dien_thoai, loai_hinh")
        .eq("id", doctor.co_so_y_te_id)
        .maybeSingle();
      hospital = csyt;
    }

    res.json({
      doctorId: doctor.id,
      name:     doctor.ho_ten,
      email:    doctor.email,
      phone:    doctor.so_dien_thoai,
      avatar:   doctor.anh_dai_dien_url,
      roles,
      hospital: hospital ? {
        id:      hospital.id,
        name:    hospital.ten_co_so,
        address: hospital.dia_chi,
        phone:   hospital.so_dien_thoai,
        type:    hospital.loai_hinh,
      } : null,
    });
  } catch (err) {
    console.error("[GET /doctor/:id]", err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get("/doctor/:doctorId/patients", requireAuth, async (req, res) => {
  try {
    const { doctorId } = req.params;

    const { data: links, error: linkErr } = await supabase
      .from("lien_ket_bac_si")
      .select("nguoi_dung_tb_id, tan_suat_theo_doi, ngay_phan_cong")
      .eq("nguoi_dung_bs_id", doctorId)
      .eq("trang_thai_hoat_dong", true);

    if (linkErr) throw linkErr;
    if (!links || links.length === 0) return res.json([]);

    const patientIds = links.map((l) => l.nguoi_dung_tb_id).filter(Boolean);

    const [
      { data: patients },
      { data: profiles },
      { data: assignments },
    ] = await Promise.all([
      supabase.from("nguoi_dung")
        .select("id, ho_ten, so_dien_thoai, email, ngay_sinh, gioi_tinh")
        .in("id", patientIds).limit(patientIds.length),
      supabase.from("ho_so_benh_nhan")
        .select("nguoi_dung_tb_id, nhom_mau, benh_man_tinh, di_ung, tien_su_y_te, chieu_cao_cm, can_nang_kg")
        .in("nguoi_dung_tb_id", patientIds).limit(patientIds.length),
      supabase.from("lich_su_gan_thiet_bi")
        .select("thiet_bi_id, nguoi_dung_tb_id, ngay_gan")
        .eq("trang_thai_hoat_dong", true)
        .in("nguoi_dung_tb_id", patientIds).limit(patientIds.length),
    ]);

    const patientMap = {};
    (patients || []).forEach((p) => { patientMap[p.id] = p; });
    const profileMap = {};
    (profiles || []).forEach((p) => { profileMap[p.nguoi_dung_tb_id] = p; });
    const assignMap = {};
    (assignments || []).forEach((a) => { assignMap[a.nguoi_dung_tb_id] = a; });

    const deviceIds = [...new Set(Object.values(assignMap).map((a) => a.thiet_bi_id).filter(Boolean))];
    const deviceMap = {};
    if (deviceIds.length > 0) {
      const { data: devices } = await supabase
        .from("thiet_bi_iot")
        .select("id, so_seri, phan_tram_pin, lan_online_cuoi, trang_thai_hoat_dong")
        .in("id", deviceIds).limit(deviceIds.length);
      (devices || []).forEach((d) => { deviceMap[d.id] = d; });
    }

    const { data: liveData } = await supabase
      .from("trang_thai_live")
      .select("nguoi_dung_tb_id, nhip_tim_live, spo2_live, muc_do_canh_bao, trang_thai_thiet_bi, thoi_gian_cap_nhat")
      .in("nguoi_dung_tb_id", patientIds).limit(patientIds.length);
    const liveMap = {};
    (liveData || []).forEach((l) => { liveMap[l.nguoi_dung_tb_id] = l; });

    res.json(links.map((l) => {
      const pid    = l.nguoi_dung_tb_id;
      const assign = assignMap[pid];
      const dev    = assign ? deviceMap[assign.thiet_bi_id] : null;
      const live   = liveMap[pid];
      const pat    = patientMap[pid] || {};
      return {
        patientId:       pid,
        patientName:     pat.ho_ten || `ID:${pid?.slice(0, 8)}`,
        phone:           pat.so_dien_thoai,
        email:           pat.email,
        dob:             pat.ngay_sinh,
        gender:          pat.gioi_tinh,
        profile:         profileMap[pid] || null,
        monitoringLevel: l.tan_suat_theo_doi,
        assignedAt:      l.ngay_phan_cong,
        device: dev ? {
          deviceId:   assign.thiet_bi_id,
          serial:     dev.so_seri,
          battery:    dev.phan_tram_pin,
          online:     dev.trang_thai_hoat_dong === true,
          lastOnline: dev.lan_online_cuoi,
          assignedAt: assign.ngay_gan,
        } : null,
        live: live ? {
          heartRate:    live.nhip_tim_live,
          spo2:         live.spo2_live,
          alertLevel:   live.muc_do_canh_bao,
          deviceStatus: live.trang_thai_thiet_bi,
          updatedAt:    live.thoi_gian_cap_nhat,
        } : null,
      };
    }));
  } catch (err) {
    console.error("[GET /doctor/:id/patients]", err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get("/doctor/:doctorId/families", requireAuth, async (req, res) => {
  try {
    const { doctorId } = req.params;

    const { data: links } = await supabase
      .from("lien_ket_bac_si").select("nguoi_dung_tb_id")
      .eq("nguoi_dung_bs_id", doctorId).eq("trang_thai_hoat_dong", true);

    const patientIds = (links || []).map((l) => l.nguoi_dung_tb_id).filter(Boolean);
    if (patientIds.length === 0) return res.json({});

    const [{ data: patientUsers }, { data: families, error }] = await Promise.all([
      supabase.from("nguoi_dung").select("id, ho_ten").in("id", patientIds),
      supabase.from("lien_ket_nguoi_nha")
        .select("nguoi_dung_tb_id, nguoi_dung_lq_id, moi_quan_he, la_nguoi_giam_sat_chinh, ngay_lien_ket")
        .in("nguoi_dung_tb_id", patientIds).eq("trang_thai_hoat_dong", true),
    ]);

    if (error) throw error;

    const patientNameMap = {};
    (patientUsers || []).forEach(p => { patientNameMap[p.id] = p.ho_ten; });

    const familyIds = [...new Set((families || []).map((f) => f.nguoi_dung_lq_id).filter(Boolean))];
    const familyMap = {};
    if (familyIds.length > 0) {
      const { data: users } = await supabase
        .from("nguoi_dung").select("id, ho_ten, so_dien_thoai, email").in("id", familyIds).limit(familyIds.length);
      (users || []).forEach((u) => { familyMap[u.id] = u; });
    }

    const result = {};
    (families || []).forEach((f) => {
      if (!result[f.nguoi_dung_tb_id]) {
        result[f.nguoi_dung_tb_id] = {
          patientId:   f.nguoi_dung_tb_id,
          patientName: patientNameMap[f.nguoi_dung_tb_id] || "—",
          families:    [],
        };
      }
      result[f.nguoi_dung_tb_id].families.push({
        familyId:  f.nguoi_dung_lq_id,
        name:      familyMap[f.nguoi_dung_lq_id]?.ho_ten,
        phone:     familyMap[f.nguoi_dung_lq_id]?.so_dien_thoai,
        email:     familyMap[f.nguoi_dung_lq_id]?.email,
        relation:  f.moi_quan_he,
        isPrimary: f.la_nguoi_giam_sat_chinh,
        linkedAt:  f.ngay_lien_ket,
      });
    });

    patientIds.forEach(pid => {
      if (!result[pid]) result[pid] = { patientId: pid, patientName: patientNameMap[pid] || "—", families: [] };
    });

    res.json(result);
  } catch (err) {
    console.error("[GET /doctor/:id/families]", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// MODULE 4: THIẾT BỊ
// ============================================================

app.get("/devices", requireAuth, async (req, res) => {
  try {
    const { csytId } = req.query;
    let query = supabase.from("thiet_bi_iot")
      .select(`
        id, so_seri, phien_ban_firmware, phien_ban_phan_cung,
        phan_tram_pin, trang_thai_hoat_dong, lan_online_cuoi, ngay_dang_ky,
        co_so_y_te_id, co_so_y_te!co_so_y_te_id ( ten_co_so )
      `)
      .order("lan_online_cuoi", { ascending: false });

    if (csytId) query = query.eq("co_so_y_te_id", csytId);
    const { data, error } = await query;
    if (error) throw error;

    res.json(data.map((d) => ({
      deviceId:     d.id,
      serial:       d.so_seri,
      firmware:     d.phien_ban_firmware,
      hardware:     d.phien_ban_phan_cung,
      battery:      d.phan_tram_pin,
      active:       d.trang_thai_hoat_dong,
      online:       d.trang_thai_hoat_dong === true,
      lastOnline:   d.lan_online_cuoi,
      registeredAt: d.ngay_dang_ky,
      hospitalId:   d.co_so_y_te_id,
      hospitalName: d.co_so_y_te?.ten_co_so,
    })));
  } catch (err) {
    console.error("[GET /devices]", err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get("/devices/active", requireAuth, async (req, res) => {
  try {
    const { data: assignments, error } = await supabase
      .from("lich_su_gan_thiet_bi").select("thiet_bi_id, nguoi_dung_tb_id, ngay_gan")
      .eq("trang_thai_hoat_dong", true);

    if (error) throw error;
    if (!assignments || assignments.length === 0) return res.json([]);

    const deviceIds  = [...new Set(assignments.map((a) => a.thiet_bi_id).filter(Boolean))];
    const patientIds = [...new Set(assignments.map((a) => a.nguoi_dung_tb_id).filter(Boolean))];

    const [{ data: devices }, { data: patients }] = await Promise.all([
      supabase.from("thiet_bi_iot")
        .select("id, so_seri, phan_tram_pin, lan_online_cuoi, trang_thai_hoat_dong, co_so_y_te_id")
        .in("id", deviceIds).limit(deviceIds.length),
      supabase.from("nguoi_dung")
        .select("id, ho_ten, so_dien_thoai").in("id", patientIds).limit(patientIds.length),
    ]);

    const deviceMap  = {};
    (devices  || []).forEach((d) => { deviceMap[d.id]  = d; });
    const patientMap = {};
    (patients || []).forEach((p) => { patientMap[p.id] = p; });

    res.json(assignments.map((a) => {
      const dev = deviceMap[a.thiet_bi_id];
      return {
        deviceId:     a.thiet_bi_id,
        serial:       dev?.so_seri,
        battery:      dev?.phan_tram_pin,
        online:       dev?.trang_thai_hoat_dong === true,
        lastOnline:   dev?.lan_online_cuoi,
        hospitalId:   dev?.co_so_y_te_id,
        patientId:    a.nguoi_dung_tb_id,
        patientName:  patientMap[a.nguoi_dung_tb_id]?.ho_ten,
        patientPhone: patientMap[a.nguoi_dung_tb_id]?.so_dien_thoai,
        assignedAt:   a.ngay_gan,
      };
    }));
  } catch (err) {
    console.error("[GET /devices/active]", err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get("/devices/:deviceId/status", requireAuth, async (req, res) => {
  try {
    const { data, error } = await supabase.from("thiet_bi_iot")
      .select(`
        id, so_seri, phien_ban_firmware, phan_tram_pin,
        trang_thai_hoat_dong, lan_online_cuoi,
        co_so_y_te!co_so_y_te_id ( ten_co_so )
      `)
      .eq("id", req.params.deviceId).maybeSingle();

    if (error) throw error;
    res.json({
      deviceId:   data.id,
      serial:     data.so_seri,
      firmware:   data.phien_ban_firmware,
      battery:    data.phan_tram_pin,
      active:     data.trang_thai_hoat_dong,
      online:     data.trang_thai_hoat_dong === true,
      lastOnline: data.lan_online_cuoi,
      hospital:   data.co_so_y_te?.ten_co_so,
    });
  } catch (err) {
    console.error("[GET /devices/:id/status]", err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post("/devices/assign", requireAuth, async (req, res) => {
  try {
    const { deviceId, patientId, assignedBy } = req.body;
    if (!deviceId || !patientId) return res.status(400).json({ error: "deviceId và patientId là bắt buộc" });

    await supabase.from("lich_su_gan_thiet_bi")
      .update({ trang_thai_hoat_dong: false, ngay_huy_gan: new Date() })
      .eq("thiet_bi_id", deviceId).eq("trang_thai_hoat_dong", true);

    const { data, error } = await supabase.from("lich_su_gan_thiet_bi")
      .insert({ thiet_bi_id: deviceId, nguoi_dung_tb_id: patientId, nguoi_gan: assignedBy || null })
      .select().maybeSingle();

    if (error) throw error;
    res.json({ message: "Gán thiết bị thành công", data });
  } catch (err) {
    console.error("[POST /devices/assign]", err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post("/devices/unassign", requireAuth, async (req, res) => {
  try {
    const { deviceId } = req.body;
    if (!deviceId) return res.status(400).json({ error: "deviceId là bắt buộc" });

    const { error } = await supabase.from("lich_su_gan_thiet_bi")
      .update({ trang_thai_hoat_dong: false, ngay_huy_gan: new Date() })
      .eq("thiet_bi_id", deviceId).eq("trang_thai_hoat_dong", true);

    if (error) throw error;
    res.json({ message: "Hủy gán thiết bị thành công" });
  } catch (err) {
    console.error("[POST /devices/unassign]", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// MODULE 5: CƠ SỞ Y TẾ
// ============================================================

app.get("/hospitals", async (req, res) => {
  try {
    const { data, error } = await supabase.from("co_so_y_te")
      .select("id, ten_co_so, dia_chi, so_dien_thoai, email_lien_he, loai_hinh, trang_thai_hoat_dong, ngay_tao")
      .order("ten_co_so");
    if (error) throw error;
    res.json(data);
  } catch (err) {
    console.error("[GET /hospitals]", err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get("/hospitals/:hospitalId/summary", requireAuth, async (req, res) => {
  try {
    const [csyt, devices, doctors, patients] = await Promise.all([
      supabase.from("co_so_y_te").select("*").eq("id", req.params.hospitalId).maybeSingle(),
      supabase.from("thiet_bi_iot").select("id, trang_thai_hoat_dong").eq("co_so_y_te_id", req.params.hospitalId),
      supabase.from("nguoi_dung").select("id").eq("co_so_y_te_id", req.params.hospitalId),
      supabase.from("lich_su_gan_thiet_bi").select("nguoi_dung_tb_id").eq("trang_thai_hoat_dong", true),
    ]);
    if (csyt.error) throw csyt.error;
    res.json({
      hospital:       csyt.data,
      totalDevices:   devices.data?.length || 0,
      activeDevices:  devices.data?.filter((d) => d.trang_thai_hoat_dong).length || 0,
      totalStaff:     doctors.data?.length || 0,
      activePatients: patients.data?.length || 0,
    });
  } catch (err) {
    console.error("[GET /hospitals/:id/summary]", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// MODULE 6: LIVE DATA
// ============================================================

app.get("/live/:patientId", requireAuth, async (req, res) => {
  try {
    const { data, error } = await supabase.from("trang_thai_live").select("*")
      .eq("nguoi_dung_tb_id", req.params.patientId).maybeSingle();
    if (error) throw error;
    res.json(data);
  } catch (err) {
    console.error("[GET /live/:id]", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// MODULE 7: NGƯỜI DÙNG
// ============================================================

app.get("/users", requireAuth, async (req, res) => {
  try {
    const { role, hospital_id } = req.query;

    if (role) {
      const { data: vaiTro, error: vtErr } = await supabase
        .from("vai_tro").select("id").eq("ten_vai_tro", role).maybeSingle();
      if (vtErr || !vaiTro) return res.status(400).json({ error: `Vai trò '${role}' không tồn tại` });

      const { data: pq, error: pqErr } = await supabase
        .from("phan_quyen_nguoi_dung").select("nguoi_dung_id").eq("vai_tro_id", vaiTro.id).limit(500);
      if (pqErr) throw pqErr;
      if (!pq || pq.length === 0) return res.json([]);

      let query = supabase.from("nguoi_dung")
        .select("id, ho_ten, email, so_dien_thoai, co_so_y_te_id, trang_thai_hoat_dong")
        .in("id", pq.map(p => p.nguoi_dung_id)).eq("trang_thai_hoat_dong", true);
      if (hospital_id) query = query.eq("co_so_y_te_id", hospital_id);

      const { data: users, error: uErr } = await query.order("ho_ten");
      if (uErr) throw uErr;
      return res.json((users || []).map(u => ({ ...u, vai_tro: role })));
    }

    let query = supabase.from("nguoi_dung")
      .select("id, ho_ten, email, so_dien_thoai, co_so_y_te_id, trang_thai_hoat_dong")
      .eq("trang_thai_hoat_dong", true);
    if (hospital_id) query = query.eq("co_so_y_te_id", hospital_id);

    const { data: users, error: uErr } = await query.order("ho_ten").limit(500);
    if (uErr) throw uErr;
    res.json(users || []);
  } catch (err) {
    console.error("[GET /users]", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// MODULE CHAT: GHI CHÚ Y TẾ
// ============================================================

app.get("/chat/:patientId", requireAuth, async (req, res) => {
  try {
    const { data, error } = await supabase.from("ghi_chu_y_te")
      .select(`
        id, nguoi_dung_bs_id, nguoi_dung_tb_id,
        loai_ghi_chu, noi_dung_ghi_chu, ngay_tao,
        bac_si:nguoi_dung_bs_id ( ho_ten, anh_dai_dien_url )
      `)
      .eq("nguoi_dung_tb_id", req.params.patientId)
      .order("ngay_tao", { ascending: true });

    if (error) throw error;

    res.json((data || []).map(r => ({
      id:           r.id,
      doctorId:     r.nguoi_dung_bs_id,
      doctorName:   r.bac_si?.ho_ten || "Bác sĩ",
      doctorAvatar: r.bac_si?.anh_dai_dien_url || null,
      patientId:    r.nguoi_dung_tb_id,
      type:         r.loai_ghi_chu,
      content:      r.noi_dung_ghi_chu,
      createdAt:    r.ngay_tao,
    })));
  } catch (err) {
    console.error("[GET /chat/:patientId]", err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post("/chat/:patientId", requireAuth, async (req, res) => {
  try {
    const { patientId } = req.params;
    const { doctorId, content, type } = req.body;

    if (!doctorId || !content?.trim()) return res.status(400).json({ error: "Thiếu thông tin" });

    const { data: pq } = await supabase.from("phan_quyen_nguoi_dung")
      .select("vai_tro(ten_vai_tro)").eq("nguoi_dung_id", doctorId).limit(5);
    const roles = (pq || []).map(p => p.vai_tro?.ten_vai_tro);
    if (!roles.includes("user_bs")) return res.status(403).json({ error: "Chỉ bác sĩ mới có thể gửi ghi chú" });

    const { data, error } = await supabase.from("ghi_chu_y_te")
      .insert({
        nguoi_dung_bs_id: doctorId,
        nguoi_dung_tb_id: patientId,
        loai_ghi_chu:     type || "theo_doi",
        noi_dung_ghi_chu: content.trim(),
        ngay_tao:         new Date().toISOString(),
      })
      .select(`
        id, nguoi_dung_bs_id, nguoi_dung_tb_id,
        loai_ghi_chu, noi_dung_ghi_chu, ngay_tao,
        bac_si:nguoi_dung_bs_id ( ho_ten, anh_dai_dien_url )
      `)
      .single();

    if (error) throw error;

    res.json({
      id:           data.id,
      doctorId:     data.nguoi_dung_bs_id,
      doctorName:   data.bac_si?.ho_ten || "Bác sĩ",
      doctorAvatar: data.bac_si?.anh_dai_dien_url || null,
      patientId:    data.nguoi_dung_tb_id,
      type:         data.loai_ghi_chu,
      content:      data.noi_dung_ghi_chu,
      createdAt:    data.ngay_tao,
    });
  } catch (err) {
    console.error("[POST /chat/:patientId]", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// AUTH — ĐĂNG NHẬP / MẬT KHẨU
// ============================================================

app.post("/auth/login", loginLimiter, async (req, res) => {
  try {
    const { login, password, hospitalId } = req.body;
    if (!login || !password) return res.status(400).json({ error: "Vui lòng nhập email/SĐT và mật khẩu" });

    const field = login.includes("@") ? "email" : "so_dien_thoai";
    const { data: users, error: findErr } = await supabase.from("nguoi_dung")
      .select("id, ho_ten, email, so_dien_thoai, mat_khau, co_so_y_te_id, trang_thai_hoat_dong")
      .eq(field, login).eq("trang_thai_hoat_dong", true).limit(1);

    if (findErr) throw findErr;
    if (!users || users.length === 0) return res.status(401).json({ error: "Tài khoản không tồn tại hoặc đã bị khoá" });

    const user = users[0];

    // Kiểm tra mật khẩu — hỗ trợ bcrypt lẫn plain-text (chuyển đổi dần)
    const { ok, needsRehash } = await verifyPassword(password, user.mat_khau);
    if (!ok) return res.status(401).json({ error: "Mật khẩu không đúng" });

    if (needsRehash) {
      const hashed = await hashPassword(password);
      await supabase.from("nguoi_dung").update({ mat_khau: hashed }).eq("id", user.id);
    }

    const { data: pq } = await supabase.from("phan_quyen_nguoi_dung")
      .select("vai_tro_id, vai_tro(ten_vai_tro)").eq("nguoi_dung_id", user.id);
    const roles = (pq || []).map(p => p.vai_tro?.ten_vai_tro).filter(Boolean);

    if (!roles.some(r => ["admin", "sub_admin", "user_bs"].includes(r))) {
      return res.status(403).json({ error: "Tài khoản không có quyền truy cập hệ thống này" });
    }

    const isAdmin = roles.includes("admin");
    if (isAdmin) {
      if (user.co_so_y_te_id) return res.status(403).json({ error: "Tài khoản Admin không được gắn với cơ sở y tế" });
    } else {
      if (!hospitalId) return res.status(400).json({ error: "Vui lòng chọn cơ sở y tế của bạn" });
      if (user.co_so_y_te_id !== hospitalId) return res.status(403).json({ error: "Cơ sở y tế không khớp với tài khoản" });
    }

    const { data: sessions } = await supabase.from("phien_dang_nhap")
      .select("id").eq("nguoi_dung_id", user.id).limit(1);
    const isFirstLogin = !sessions || sessions.length === 0;

    await supabase.from("nguoi_dung").update({ lan_dang_nhap_cuoi: new Date().toISOString() }).eq("id", user.id);

    const token = signToken({ userId: user.id, name: user.ho_ten, roles, hospitalId: user.co_so_y_te_id });

    res.json({
      userId:      user.id,
      name:        user.ho_ten,
      email:       user.email,
      phone:       user.so_dien_thoai,
      roles,
      isFirstLogin,
      hospitalId:  user.co_so_y_te_id,
      token,
    });
  } catch (err) {
    console.error("[POST /auth/login]", err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post("/auth/change-password", requireAuth, async (req, res) => {
  try {
    const { userId, newPassword } = req.body;
    if (!userId || !newPassword) return res.status(400).json({ error: "Thiếu thông tin" });
    if (newPassword.length < 6) return res.status(400).json({ error: "Mật khẩu phải có ít nhất 6 ký tự" });

    const hashed = await hashPassword(newPassword);
    const { error } = await supabase.from("nguoi_dung").update({ mat_khau: hashed }).eq("id", userId);
    if (error) throw error;

    const { data: existing } = await supabase.from("phien_dang_nhap")
      .select("id").eq("nguoi_dung_id", userId).limit(1);
    if (!existing || existing.length === 0) {
      await supabase.from("phien_dang_nhap").insert({
        nguoi_dung_id: userId, fcm_token: "web_first_login",
        ten_thiet_bi: "Web Browser", lan_hoat_dong_cuoi: new Date().toISOString(),
      });
    } else {
      await supabase.from("phien_dang_nhap")
        .update({ lan_hoat_dong_cuoi: new Date().toISOString() }).eq("nguoi_dung_id", userId);
    }
    res.json({ success: true });
  } catch (err) {
    console.error("[POST /auth/change-password]", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// AUTH — QUÊN MẬT KHẨU
// ============================================================

app.post("/auth/forgot-password", async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: "Vui lòng nhập email" });

    const { data: users } = await supabase.from("nguoi_dung")
      .select("id, ho_ten, email, trang_thai_hoat_dong")
      .eq("email", email.trim().toLowerCase()).eq("trang_thai_hoat_dong", true).limit(1);

    if (!users || users.length === 0) {
      return res.json({ message: "Nếu email tồn tại trong hệ thống, bạn sẽ nhận được hướng dẫn đặt lại mật khẩu." });
    }

    const user  = users[0];
    const token = crypto.randomBytes(32).toString("hex");
    const hetHan = new Date(Date.now() + 60 * 60 * 1000);

    await supabase.from("reset_password_token").delete().eq("nguoi_dung_id", user.id).eq("da_su_dung", false);
    await supabase.from("reset_password_token").insert({
      nguoi_dung_id: user.id, token, het_han: hetHan.toISOString(), da_su_dung: false,
    });

    if (!process.env.BREVO_API_KEY) {
      return res.status(500).json({ error: "Server chưa cấu hình email. Liên hệ quản trị viên." });
    }

    const resetLink = `${FRONTEND_URL}/reset-password.html?token=${token}`;
    await sendEmail({ to: user.email, subject: "Đặt lại mật khẩu — Health Monitor", html: buildResetEmailHtml(user.ho_ten, resetLink) });

    res.json({ message: "Nếu email tồn tại trong hệ thống, bạn sẽ nhận được hướng dẫn đặt lại mật khẩu." });
  } catch (err) {
    console.error("[POST /auth/forgot-password]", err.message);
    res.status(500).json({ error: "Lỗi server: " + err.message });
  }
});

app.get("/auth/verify-reset-token/:token", async (req, res) => {
  try {
    const { data: rows, error } = await supabase.from("reset_password_token")
      .select("id, nguoi_dung_id, het_han, da_su_dung, nguoi_dung(ho_ten, email)")
      .eq("token", req.params.token).eq("da_su_dung", false).limit(1);

    if (error) throw error;
    if (!rows || rows.length === 0) return res.status(400).json({ error: "Link không hợp lệ hoặc đã được sử dụng" });

    const row = rows[0];
    if (new Date(row.het_han) < new Date()) {
      return res.status(400).json({ error: "Link đã hết hạn. Vui lòng yêu cầu đặt lại mật khẩu mới." });
    }
    res.json({ valid: true, name: row.nguoi_dung?.ho_ten, email: row.nguoi_dung?.email });
  } catch (err) {
    console.error("[GET /auth/verify-reset-token]", err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post("/auth/reset-password", async (req, res) => {
  try {
    const { token, newPassword } = req.body;
    if (!token || !newPassword) return res.status(400).json({ error: "Thiếu thông tin" });
    if (newPassword.length < 6) return res.status(400).json({ error: "Mật khẩu phải có ít nhất 6 ký tự" });

    const { data: rows, error: tokenErr } = await supabase.from("reset_password_token")
      .select("id, nguoi_dung_id, het_han, da_su_dung")
      .eq("token", token).eq("da_su_dung", false).limit(1);

    if (tokenErr) throw tokenErr;
    if (!rows || rows.length === 0) return res.status(400).json({ error: "Link không hợp lệ hoặc đã được sử dụng" });

    const row = rows[0];
    if (new Date(row.het_han) < new Date()) {
      return res.status(400).json({ error: "Link đã hết hạn. Vui lòng yêu cầu đặt lại mật khẩu mới." });
    }

    const { data: userRows } = await supabase.from("nguoi_dung")
      .select("mat_khau").eq("id", row.nguoi_dung_id).limit(1);
    if (userRows?.length > 0) {
      const { ok } = await verifyPassword(newPassword, userRows[0].mat_khau);
      if (ok) return res.status(400).json({ error: "Mật khẩu mới phải khác mật khẩu hiện tại" });
    }

    const hashed = await hashPassword(newPassword);
    await supabase.from("nguoi_dung").update({ mat_khau: hashed }).eq("id", row.nguoi_dung_id);
    await supabase.from("reset_password_token").update({ da_su_dung: true }).eq("id", row.id);

    const { data: sessions } = await supabase.from("phien_dang_nhap")
      .select("id").eq("nguoi_dung_id", row.nguoi_dung_id).limit(1);
    if (!sessions || sessions.length === 0) {
      await supabase.from("phien_dang_nhap").insert({
        nguoi_dung_id: row.nguoi_dung_id, fcm_token: "web_reset_password",
        ten_thiet_bi: "Web Browser", lan_hoat_dong_cuoi: new Date().toISOString(),
      });
    }

    res.json({ success: true, message: "Đặt lại mật khẩu thành công!" });
  } catch (err) {
    console.error("[POST /auth/reset-password]", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// HỒ SƠ BỆNH ÁN
// ============================================================

app.get("/medical-record/:patientId", requireAuth, async (req, res) => {
  try {
    const { data, error } = await supabase.from("ho_so_benh_nhan").select("*")
      .eq("nguoi_dung_tb_id", req.params.patientId).maybeSingle();
    if (error) throw error;
    res.json(data || null);
  } catch (err) {
    console.error("[GET /medical-record]", err.message);
    res.status(500).json({ error: err.message });
  }
});

app.patch("/medical-record/:patientId", requireAuth, async (req, res) => {
  try {
    const { patientId } = req.params;
    const { data: existing } = await supabase.from("ho_so_benh_nhan")
      .select("nguoi_dung_tb_id").eq("nguoi_dung_tb_id", patientId).maybeSingle();

    let result;
    if (existing) {
      const { data, error } = await supabase.from("ho_so_benh_nhan")
        .update(req.body).eq("nguoi_dung_tb_id", patientId).select("*").maybeSingle();
      if (error) throw error;
      result = data;
    } else {
      const { data, error } = await supabase.from("ho_so_benh_nhan")
        .insert({ ...req.body, nguoi_dung_tb_id: patientId }).select("*").maybeSingle();
      if (error) throw error;
      result = data;
    }
    res.json(result);
  } catch (err) {
    console.error("[PATCH /medical-record]", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// MODULE CẢNH BÁO ACTIVE
// ============================================================

app.get("/doctor/:doctorId/active-alerts", requireAuth, async (req, res) => {
  try {
    const { doctorId } = req.params;

    const { data: links } = await supabase.from("lien_ket_bac_si").select("nguoi_dung_tb_id")
      .eq("nguoi_dung_bs_id", doctorId).eq("trang_thai_hoat_dong", true);

    const patientIds = (links || []).map(l => l.nguoi_dung_tb_id).filter(Boolean);
    if (!patientIds.length) return res.json([]);

    const { data: alerts, error } = await supabase.from("canh_bao_suc_khoe")
      .select("id, nguoi_dung_tb_id, du_lieu_sinh_ton_id, loai_canh_bao, muc_do_nghiem_trong, trang_thai_xu_ly, thoi_gian_phat_hien")
      .in("nguoi_dung_tb_id", patientIds)
      .order("thoi_gian_phat_hien", { ascending: false }).limit(500);

    if (error) throw error;
    if (!alerts.length) return res.json([]);

    const alertIds = alerts.map(a => a.id);
    const { data: confirmations } = await supabase.from("xac_nhan_canh_bao")
      .select("canh_bao_id, phuong_thuc_xac_nhan")
      .in("canh_bao_id", alertIds);

    const confMap = {};
    (confirmations || []).forEach(c => {
      if (!confMap[c.canh_bao_id]) confMap[c.canh_bao_id] = [];
      confMap[c.canh_bao_id].push(c.phuong_thuc_xac_nhan);
    });

    const activeAlerts = alerts.filter(a => {
      const methods = confMap[a.id] || [];
      return methods.includes("thiet_bi_het_gio") && !methods.includes("thiet_bi_bam_nut");
    });

    if (!activeAlerts.length) return res.json([]);

    const ptIds    = [...new Set(activeAlerts.map(a => a.nguoi_dung_tb_id))];
    const vitalIds = [...new Set(activeAlerts.map(a => a.du_lieu_sinh_ton_id).filter(Boolean))];

    const [{ data: pts }, { data: vitals }] = await Promise.all([
      supabase.from("nguoi_dung").select("id, ho_ten").in("id", ptIds),
      vitalIds.length
        ? supabase.from("du_lieu_sinh_ton").select("id, nhip_tim, spo2").in("id", vitalIds)
        : Promise.resolve({ data: [] }),
    ]);

    const ptMap = {};
    (pts || []).forEach(p => { ptMap[p.id] = p.ho_ten; });
    const vitalMap = {};
    (vitals || []).forEach(v => { vitalMap[v.id] = { hr: v.nhip_tim, spo2: v.spo2 }; });

    res.json(activeAlerts.map(a => ({
      alertId:     a.id,
      patientId:   a.nguoi_dung_tb_id,
      patientName: ptMap[a.nguoi_dung_tb_id] || "—",
      alertType:   a.loai_canh_bao,
      severity:    a.muc_do_nghiem_trong,
      detectedAt:  a.thoi_gian_phat_hien,
      methods:     confMap[a.id] || [],
      hr:          vitalMap[a.du_lieu_sinh_ton_id]?.hr  ?? null,
      spo2:        vitalMap[a.du_lieu_sinh_ton_id]?.spo2 ?? null,
    })));
  } catch (err) {
    console.error("[GET /doctor/:id/active-alerts]", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// MODULE NGƯỠNG CẢNH BÁO
// ============================================================

app.get("/threshold/all/history", requireAuth, async (req, res) => {
  try {
    const { doctorId } = req.query;
    const { data: links } = await supabase.from("lien_ket_bac_si")
      .select("nguoi_dung_tb_id").eq("nguoi_dung_bs_id", doctorId).eq("trang_thai_hoat_dong", true);
    const ptIds = (links || []).map(l => l.nguoi_dung_tb_id);
    if (!ptIds.length) return res.json([]);

    const { data: history } = await supabase.from("lich_su_nguong_co_so")
      .select("*, nguoi_dung!nguoi_dung_tb_id(ho_ten)")
      .in("nguoi_dung_tb_id", ptIds)
      .order("ngay_tinh_lai", { ascending: false }).limit(100);

    res.json((history || []).map(h => ({ ...h, patient_name: h.nguoi_dung?.ho_ten || "—" })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/threshold/:patientId", requireAuth, async (req, res) => {
  try {
    const { data } = await supabase.from("nguong_canh_bao").select("*")
      .eq("nguoi_dung_tb_id", req.params.patientId).eq("trang_thai_hoat_dong", true).maybeSingle();
    res.json(data || null);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/threshold/:patientId", requireAuth, async (req, res) => {
  try {
    const pid = req.params.patientId;
    const { nhip_tim_toi_thieu, nhip_tim_toi_da, spo2_toi_thieu, nhip_tim_co_so, spo2_co_so, doctorId } = req.body;

    const { data: existing } = await supabase.from("nguong_canh_bao")
      .select("id, nhip_tim_co_so, spo2_co_so")
      .eq("nguoi_dung_tb_id", pid).eq("trang_thai_hoat_dong", true).maybeSingle();

    const payload = { nguoi_dung_tb_id: pid, nguoi_thiet_lap_id: doctorId, trang_thai_hoat_dong: true, hieu_luc_tu: new Date().toISOString() };
    if (nhip_tim_toi_thieu !== null) payload.nhip_tim_toi_thieu = nhip_tim_toi_thieu;
    if (nhip_tim_toi_da    !== null) payload.nhip_tim_toi_da    = nhip_tim_toi_da;
    if (spo2_toi_thieu     !== null) payload.spo2_toi_thieu     = spo2_toi_thieu;
    if (nhip_tim_co_so     !== null) payload.nhip_tim_co_so     = nhip_tim_co_so;
    if (spo2_co_so         !== null) payload.spo2_co_so         = spo2_co_so;

    if (existing) {
      await supabase.from("nguong_canh_bao").update(payload).eq("id", existing.id);
    } else {
      await supabase.from("nguong_canh_bao").insert(payload);
    }

    await supabase.from("lich_su_nguong_co_so").insert({
      nguoi_dung_tb_id:   pid,
      nhip_tim_co_so_moi: Number(nhip_tim_co_so ?? existing?.nhip_tim_co_so ?? 70),
      spo2_co_so_moi:     Number(spo2_co_so     ?? existing?.spo2_co_so     ?? 97),
      ly_do_cap_nhat:    "bac_si_chinh_sua",
      nguoi_thay_doi_id:  doctorId || null,
      ngay_tinh_lai:      new Date().toISOString(),
    });

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/threshold/:patientId/history", requireAuth, async (req, res) => {
  try {
    const { data } = await supabase.from("lich_su_nguong_co_so")
      .select("*, nguoi_dung!nguoi_dung_tb_id(ho_ten)")
      .eq("nguoi_dung_tb_id", req.params.patientId)
      .order("ngay_tinh_lai", { ascending: false }).limit(50);
    res.json((data || []).map(h => ({ ...h, patient_name: h.nguoi_dung?.ho_ten || "—" })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// HỒ SƠ BÁC SĨ
// ============================================================

app.get("/doctor/:id/profile", requireAuth, async (req, res) => {
  try {
    const { data, error } = await supabase.from("nguoi_dung")
      .select("id, ho_ten, so_dien_thoai, email, anh_dai_dien_url")
      .eq("id", req.params.id).single();
    if (error) throw error;
    res.json({ name: data.ho_ten, phone: data.so_dien_thoai, email: data.email, avatar: data.anh_dai_dien_url });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.patch("/doctor/:id/profile", requireAuth, async (req, res) => {
  try {
    const { name, phone, email, avatar } = req.body;
    const updates = {};
    if (name?.trim())        updates.ho_ten           = name.trim();
    if (phone !== undefined) updates.so_dien_thoai    = phone || null;
    if (email?.trim())       updates.email            = email.trim();
    if (avatar)              updates.anh_dai_dien_url = avatar;
    const { error } = await supabase.from("nguoi_dung").update(updates).eq("id", req.params.id);
    if (error) throw error;
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// START
// ============================================================

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Health Monitor API v3.3 — port ${PORT}`);
});

process.on("unhandledRejection", (r) => console.error("[unhandledRejection]", r));
process.on("uncaughtException",  (e) => { console.error("[uncaughtException]", e); process.exit(1); });
