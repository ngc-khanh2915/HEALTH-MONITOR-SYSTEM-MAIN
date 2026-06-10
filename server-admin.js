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
  requireRole,
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
const corsOptions = {
  origin: function(origin, callback) {
    const allowed = [
      "https://accountdoan.github.io",
      "http://localhost:3000",
      "http://localhost:5500",
      "http://127.0.0.1:5500",
    ];
    if (!origin || allowed.includes(origin)) callback(null, true);
    else callback(new Error("Not allowed by CORS"));
  },
  methods:          ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders:   ["Content-Type", "Authorization"],
  credentials:      true,
  optionsSuccessStatus: 200,
};
app.use(cors(corsOptions));
app.options("*", cors(corsOptions));
app.use(express.json());
app.use(apiLimiter);

// ===== Health check =====
app.get("/", (req, res) => {
  res.json({ status: "ok", service: "HealthMonitor Admin API", version: "2.0" });
});

// ============================================================
// AUTH
// ============================================================

app.post("/auth/login", loginLimiter, async (req, res) => {
  try {
    const { login, password } = req.body;
    if (!login || !password) return res.status(400).json({ error: "Vui lòng nhập email và mật khẩu" });

    const field = login.includes("@") ? "email" : "so_dien_thoai";
    const { data: users, error } = await supabase.from("nguoi_dung")
      .select("id, ho_ten, email, so_dien_thoai, mat_khau, co_so_y_te_id, trang_thai_hoat_dong")
      .eq(field, login).eq("trang_thai_hoat_dong", true).limit(1);

    if (error) throw error;
    if (!users || !users.length) return res.status(401).json({ error: "Tài khoản không tồn tại hoặc đã bị khoá" });

    const user = users[0];

    const { ok, needsRehash } = await verifyPassword(password, user.mat_khau);
    if (!ok) return res.status(401).json({ error: "Mật khẩu không đúng" });

    if (needsRehash) {
      const hashed = await hashPassword(password);
      await supabase.from("nguoi_dung").update({ mat_khau: hashed }).eq("id", user.id);
    }

    const { data: pq } = await supabase.from("phan_quyen_nguoi_dung")
      .select("vai_tro(ten_vai_tro)").eq("nguoi_dung_id", user.id);
    const roles = (pq || []).map(p => p.vai_tro?.ten_vai_tro).filter(Boolean);

    if (!roles.includes("admin")) return res.status(403).json({ error: "Tài khoản không có quyền truy cập trang Admin" });
    if (user.co_so_y_te_id) return res.status(403).json({ error: "Tài khoản Admin không hợp lệ" });

    await logAction(supabase, user.id, "LOGIN", "admin", null, { email: user.email }, getIp(req));
    await supabase.from("nguoi_dung").update({ lan_dang_nhap_cuoi: new Date().toISOString() }).eq("id", user.id);

    const token = signToken({ userId: user.id, name: user.ho_ten, roles });

    res.json({ userId: user.id, name: user.ho_ten, email: user.email, role: "admin", roles: ["admin"], token });
  } catch (err) {
    console.error("[POST /auth/login]", err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post("/auth/logout", async (req, res) => {
  try {
    const { userId } = req.body;
    if (userId) await logAction(supabase, userId, "LOGOUT", "admin", userId, {}, getIp(req));
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/auth/change-password", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    const { userId, newPassword } = req.body;
    if (!userId || !newPassword) return res.status(400).json({ error: "Thiếu thông tin" });
    if (newPassword.length < 6) return res.status(400).json({ error: "Mật khẩu phải >= 6 ký tự" });
    const hashed = await hashPassword(newPassword);
    await supabase.from("nguoi_dung").update({ mat_khau: hashed }).eq("id", userId);
    await logAction(supabase, userId, "CHANGE_PASSWORD", "admin", null, {}, getIp(req));
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/auth/forgot-password", async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: "Vui lòng nhập email" });
    const { data: users } = await supabase.from("nguoi_dung")
      .select("id, ho_ten, email, trang_thai_hoat_dong")
      .eq("email", email.trim().toLowerCase()).eq("trang_thai_hoat_dong", true).limit(1);
    if (!users?.length) return res.json({ message: "Nếu email tồn tại, bạn sẽ nhận được hướng dẫn đặt lại mật khẩu." });

    const user  = users[0];
    const token = crypto.randomBytes(32).toString("hex");
    const hetHan = new Date(Date.now() + 60 * 60 * 1000);
    await supabase.from("reset_password_token").delete().eq("nguoi_dung_id", user.id).eq("da_su_dung", false);
    await supabase.from("reset_password_token").insert({ nguoi_dung_id: user.id, token, het_han: hetHan.toISOString(), da_su_dung: false });

    const resetLink = `${FRONTEND_URL}/reset-password.html?token=${token}`;
    await sendEmail({ to: user.email, subject: "Đặt lại mật khẩu — Health Monitor", html: buildResetEmailHtml(user.ho_ten, resetLink) });
    res.json({ message: "Nếu email tồn tại, bạn sẽ nhận được hướng dẫn đặt lại mật khẩu." });
  } catch (err) {
    console.error("[POST /auth/forgot-password]", err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get("/auth/verify-reset-token/:token", async (req, res) => {
  try {
    const { data } = await supabase.from("reset_password_token")
      .select("id, nguoi_dung_id, het_han, da_su_dung")
      .eq("token", req.params.token).maybeSingle();
    if (!data || data.da_su_dung || new Date(data.het_han) < new Date()) {
      return res.status(400).json({ valid: false, error: "Token không hợp lệ hoặc đã hết hạn" });
    }
    res.json({ valid: true, userId: data.nguoi_dung_id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/auth/reset-password", async (req, res) => {
  try {
    const { token, password } = req.body;
    if (!token || !password || password.length < 6) return res.status(400).json({ error: "Thông tin không hợp lệ" });

    const { data } = await supabase.from("reset_password_token")
      .select("id, nguoi_dung_id, het_han, da_su_dung")
      .eq("token", token).maybeSingle();
    if (!data || data.da_su_dung || new Date(data.het_han) < new Date()) {
      return res.status(400).json({ error: "Token không hợp lệ hoặc đã hết hạn" });
    }

    const hashed = await hashPassword(password);
    await supabase.from("nguoi_dung").update({ mat_khau: hashed }).eq("id", data.nguoi_dung_id);
    await supabase.from("reset_password_token").update({ da_su_dung: true }).eq("id", data.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// HỒ SƠ CÁ NHÂN
// ============================================================

app.get("/profile/:id", requireAuth, async (req, res) => {
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

app.patch("/profile", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    const { adminId, name, phone, email, avatar } = req.body;
    if (!adminId) return res.status(400).json({ error: "Thiếu adminId" });
    const updates = {};
    if (name?.trim())        updates.ho_ten           = name.trim();
    if (phone !== undefined) updates.so_dien_thoai    = phone || null;
    if (email?.trim())       updates.email            = email.trim();
    if (avatar)              updates.anh_dai_dien_url = avatar;
    const { error } = await supabase.from("nguoi_dung").update(updates).eq("id", adminId);
    if (error) throw error;
    res.json({ ok: true });
  } catch (err) {
    console.error("[PATCH /profile]", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// DASHBOARD TỔNG QUAN
// ============================================================

app.get("/dashboard", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    const [hsResult, devResult, saResult] = await Promise.all([
      supabase.from("co_so_y_te").select("id").eq("trang_thai_hoat_dong", true),
      supabase.from("thiet_bi_iot").select("id, trang_thai_hoat_dong"),
      supabase.from("vai_tro").select("id").eq("ten_vai_tro", "sub_admin").maybeSingle()
        .then(async ({ data: role }) => {
          if (!role) return { data: [] };
          return supabase.from("phan_quyen_nguoi_dung").select("nguoi_dung_id").eq("vai_tro_id", role.id);
        }),
    ]);

    const devices    = devResult.data || [];
    const onlineCount  = devices.filter(d => d.trang_thai_hoat_dong === true).length;
    const offlineCount = devices.length - onlineCount;

    res.json({
      hospitals: { total: (hsResult.data || []).length },
      devices:   { total: devices.length, online: onlineCount, offline: offlineCount },
      subadmins: { total: (saResult.data || []).length },
    });
  } catch (err) {
    console.error("[GET /dashboard]", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// CƠ SỞ Y TẾ
// ============================================================

app.get("/hospitals", async (req, res) => {
  try {
    const { data, error } = await supabase.from("co_so_y_te")
      .select("id, ten_co_so, dia_chi, so_dien_thoai, email_lien_he, loai_hinh, trang_thai_hoat_dong, ngay_tao")
      .order("ngay_tao", { ascending: false });
    if (error) throw error;

    const hsIds = (data || []).map(h => h.id);
    let devCount = {}, subCount = {};
    if (hsIds.length) {
      const [devRes, subRes] = await Promise.all([
        supabase.from("thiet_bi_iot").select("id, co_so_y_te_id").in("co_so_y_te_id", hsIds),
        supabase.from("nguoi_dung").select("id, co_so_y_te_id").in("co_so_y_te_id", hsIds).eq("trang_thai_hoat_dong", true),
      ]);
      (devRes.data || []).forEach(d => { devCount[d.co_so_y_te_id] = (devCount[d.co_so_y_te_id] || 0) + 1; });
      (subRes.data || []).forEach(u => { subCount[u.co_so_y_te_id] = (subCount[u.co_so_y_te_id] || 0) + 1; });
    }

    res.json((data || []).map(h => ({ ...h, deviceCount: devCount[h.id] || 0, staffCount: subCount[h.id] || 0 })));
  } catch (err) {
    console.error("[GET /hospitals]", err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post("/hospitals", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    const { adminId, name, address, phone, email, type } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: "Vui lòng nhập tên cơ sở y tế" });

    const { data, error } = await supabase.from("co_so_y_te").insert({
      ten_co_so:       name.trim(),
      dia_chi:         address || null,
      so_dien_thoai:   phone   || null,
      email_lien_he:   email   || null,
      loai_hinh:       type    || "benh_vien",
      trang_thai_hoat_dong: true,
      ngay_tao:        new Date().toISOString(),
    }).select("id, ten_co_so").single();
    if (error) throw error;

    await logAction(supabase, adminId, "CREATE_HOSPITAL", "co_so_y_te", data.id, { name: data.ten_co_so }, getIp(req));
    res.json({ hospitalId: data.id, name: data.ten_co_so });
  } catch (err) {
    console.error("[POST /hospitals]", err.message);
    res.status(500).json({ error: err.message });
  }
});

app.patch("/hospitals/:id", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    const { id } = req.params;
    const { adminId, name, address, phone, email, type, active } = req.body;

    if (active === false) {
      const errors = [];

      const [{ data: saRole }, { data: bsRole }, { data: tbRole }] = await Promise.all([
        supabase.from("vai_tro").select("id").eq("ten_vai_tro", "sub_admin").maybeSingle(),
        supabase.from("vai_tro").select("id").eq("ten_vai_tro", "user_bs").maybeSingle(),
        supabase.from("vai_tro").select("id").eq("ten_vai_tro", "user_tb").maybeSingle(),
      ]);

      const { data: usersInHs } = await supabase.from("nguoi_dung")
        .select("id").eq("co_so_y_te_id", id).eq("trang_thai_hoat_dong", true);
      const userIds = (usersInHs || []).map(u => u.id);

      for (const [role, label] of [[saRole, "sub-admin"], [bsRole, "bác sĩ"], [tbRole, "bệnh nhân"]]) {
        if (role && userIds.length) {
          const { data: pq } = await supabase.from("phan_quyen_nguoi_dung")
            .select("nguoi_dung_id").eq("vai_tro_id", role.id).in("nguoi_dung_id", userIds);
          if (pq?.length) errors.push(`Còn ${pq.length} ${label}`);
        }
      }

      const { data: devices } = await supabase.from("thiet_bi_iot").select("id").eq("co_so_y_te_id", id);
      const devIds = (devices || []).map(d => d.id);
      if (devIds.length) {
        const { data: assigns } = await supabase.from("lich_su_gan_thiet_bi")
          .select("id").in("thiet_bi_id", devIds).eq("trang_thai_hoat_dong", true);
        if (assigns?.length) errors.push(`Còn ${assigns.length} thiết bị đang gán bệnh nhân`);
      }

      if (userIds.length) {
        const [{ data: docLinks }, { data: famLinks }] = await Promise.all([
          supabase.from("lien_ket_bac_si").select("id").in("nguoi_dung_tb_id", userIds).eq("trang_thai_hoat_dong", true),
          supabase.from("lien_ket_nguoi_nha").select("id").in("nguoi_dung_tb_id", userIds).eq("trang_thai_hoat_dong", true),
        ]);
        if (docLinks?.length) errors.push(`Còn ${docLinks.length} liên kết bác sĩ - bệnh nhân`);
        if (famLinks?.length) errors.push(`Còn ${famLinks.length} liên kết người nhà - bệnh nhân`);
      }

      if (errors.length) {
        return res.status(409).json({
          error:   "Không thể dừng hoạt động cơ sở y tế",
          reason:  "Vẫn còn dữ liệu liên quan chưa được xóa:",
          details: errors,
        });
      }
    }

    const updates = {};
    if (name    !== undefined) updates.ten_co_so           = name;
    if (address !== undefined) updates.dia_chi             = address;
    if (phone   !== undefined) updates.so_dien_thoai       = phone;
    if (email   !== undefined) updates.email_lien_he       = email;
    if (type    !== undefined) updates.loai_hinh           = type;
    if (active  !== undefined) updates.trang_thai_hoat_dong = active;

    const { error } = await supabase.from("co_so_y_te").update(updates).eq("id", id);
    if (error) throw error;

    await logAction(supabase, adminId, "UPDATE_HOSPITAL", "co_so_y_te", id, updates, getIp(req));
    res.json({ ok: true });
  } catch (err) {
    console.error("[PATCH /hospitals/:id]", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// TÀI KHOẢN SUB ADMIN
// ============================================================

app.get("/subadmins", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    const { data: role } = await supabase.from("vai_tro").select("id").eq("ten_vai_tro", "sub_admin").maybeSingle();
    if (!role) return res.json([]);

    const { data: pq } = await supabase.from("phan_quyen_nguoi_dung").select("nguoi_dung_id").eq("vai_tro_id", role.id);
    const ids = (pq || []).map(p => p.nguoi_dung_id);
    if (!ids.length) return res.json([]);

    const { data: users, error } = await supabase.from("nguoi_dung")
      .select("id, ho_ten, email, so_dien_thoai, co_so_y_te_id, trang_thai_hoat_dong, lan_dang_nhap_cuoi")
      .in("id", ids).order("ho_ten");
    if (error) throw error;

    const hsIds = [...new Set((users || []).map(u => u.co_so_y_te_id).filter(Boolean))];
    const hsMap = {};
    if (hsIds.length) {
      const { data: hsList } = await supabase.from("co_so_y_te").select("id, ten_co_so").in("id", hsIds);
      (hsList || []).forEach(h => { hsMap[h.id] = h.ten_co_so; });
    }

    res.json((users || []).map(u => ({
      id:           u.id,
      name:         u.ho_ten,
      email:        u.email,
      phone:        u.so_dien_thoai,
      hospitalId:   u.co_so_y_te_id,
      hospitalName: hsMap[u.co_so_y_te_id] || "—",
      active:       u.trang_thai_hoat_dong,
      lastLogin:    u.lan_dang_nhap_cuoi,
    })));
  } catch (err) {
    console.error("[GET /subadmins]", err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post("/subadmins", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    const { adminId, name, email, phone, password, hospitalId } = req.body;
    if (!name?.trim() || !email?.trim() || !hospitalId) return res.status(400).json({ error: "Thiếu thông tin bắt buộc" });

    const { data: existing } = await supabase.from("nguoi_dung")
      .select("id").eq("email", email.trim().toLowerCase()).maybeSingle();
    if (existing) return res.status(409).json({ error: "Email đã tồn tại" });

    const hashed = await hashPassword(password || "123456");
    const { data: newUser, error: userErr } = await supabase.from("nguoi_dung").insert({
      ho_ten:              name.trim(),
      email:               email.trim().toLowerCase(),
      so_dien_thoai:       phone      || null,
      mat_khau:            hashed,
      co_so_y_te_id:       hospitalId,
      trang_thai_hoat_dong: true,
    }).select("id").single();
    if (userErr) throw userErr;

    const { data: role } = await supabase.from("vai_tro").select("id").eq("ten_vai_tro", "sub_admin").maybeSingle();
    if (role) await supabase.from("phan_quyen_nguoi_dung").insert({ nguoi_dung_id: newUser.id, vai_tro_id: role.id });

    await logAction(supabase, adminId, "CREATE_SUBADMIN", "nguoi_dung", newUser.id, { name, email, hospitalId }, getIp(req));
    res.json({ userId: newUser.id, name: name.trim() });
  } catch (err) {
    console.error("[POST /subadmins]", err.message);
    res.status(500).json({ error: err.message });
  }
});

// PATCH /subadmins/:id — cập nhật thông tin + trạng thái + mật khẩu
app.patch("/subadmins/:id", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    const { id } = req.params;
    const { adminId, active, password, name, email, phone, hospitalId } = req.body;

    const updates = {};
    if (active      !== undefined) updates.trang_thai_hoat_dong = active;
    if (name?.trim())              updates.ho_ten               = name.trim();
    if (email       !== undefined) updates.email                = email  || null;
    if (phone       !== undefined) updates.so_dien_thoai        = phone  || null;
    if (hospitalId  !== undefined) updates.co_so_y_te_id        = hospitalId || null;

    // Hash mật khẩu mới nếu được cung cấp
    if (password !== undefined) {
      if (password.length < 6) return res.status(400).json({ error: "Mật khẩu phải >= 6 ký tự" });
      updates.mat_khau = await hashPassword(password);
    }

    await supabase.from("nguoi_dung").update(updates).eq("id", id);
    await logAction(supabase, adminId, "UPDATE_SUBADMIN", "nguoi_dung", id, updates, getIp(req));
    res.json({ ok: true });
  } catch (err) {
    console.error("[PATCH /subadmins/:id]", err.message);
    res.status(500).json({ error: err.message });
  }
});

app.delete("/subadmins/:id", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    const { id }      = req.params;
    const { adminId } = req.body;

    const { data: saUser } = await supabase.from("nguoi_dung")
      .select("co_so_y_te_id, ho_ten").eq("id", id).maybeSingle();
    const hsId = saUser?.co_so_y_te_id;

    if (hsId) {
      const { data: roles } = await supabase.from("vai_tro").select("id, ten_vai_tro")
        .in("ten_vai_tro", ["user_tb", "user_bs", "user_lq"]);
      const roleIds = (roles || []).map(r => r.id);

      const { data: usersInHs } = await supabase.from("nguoi_dung")
        .select("id").eq("co_so_y_te_id", hsId).eq("trang_thai_hoat_dong", true).neq("id", id);
      const userIds = (usersInHs || []).map(u => u.id);

      let hasData = false;
      if (userIds.length && roleIds.length) {
        const { data: pq } = await supabase.from("phan_quyen_nguoi_dung")
          .select("nguoi_dung_id").in("nguoi_dung_id", userIds).in("vai_tro_id", roleIds);
        if (pq?.length) hasData = true;
      }

      if (!hasData) {
        const { data: devs } = await supabase.from("thiet_bi_iot").select("id").eq("co_so_y_te_id", hsId).limit(1);
        if (devs?.length) hasData = true;
      }

      if (hasData) {
        return res.status(400).json({
          error: `Không thể xóa Sub Admin "${saUser.ho_ten}" vì cơ sở y tế vẫn còn dữ liệu. Vui lòng xóa hết dữ liệu và cơ sở y tế trước.`,
        });
      }

      const { data: hs } = await supabase.from("co_so_y_te")
        .select("id, trang_thai_hoat_dong").eq("id", hsId).maybeSingle();
      if (hs?.trang_thai_hoat_dong) {
        return res.status(400).json({
          error: `Cơ sở y tế của Sub Admin "${saUser.ho_ten}" vẫn đang hoạt động. Vui lòng vô hiệu hóa cơ sở y tế trước.`,
        });
      }
    }

    await supabase.from("phan_quyen_nguoi_dung").delete().eq("nguoi_dung_id", id);
    await supabase.from("nguoi_dung").update({ trang_thai_hoat_dong: false }).eq("id", id);
    await logAction(supabase, adminId, "DELETE_SUBADMIN", "nguoi_dung", id, { name: saUser?.ho_ten }, getIp(req));
    res.json({ ok: true });
  } catch (err) {
    console.error("[DELETE /subadmins/:id]", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// THIẾT BỊ
// ============================================================

app.get("/devices", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    const { data, error } = await supabase.from("thiet_bi_iot")
      .select("id, so_seri, phan_tram_pin, lan_online_cuoi, trang_thai_hoat_dong, ngay_dang_ky, co_so_y_te_id")
      .order("ngay_dang_ky", { ascending: false });
    if (error) throw error;

    const hsIds = [...new Set((data || []).map(d => d.co_so_y_te_id).filter(Boolean))];
    const hsMap = {};
    if (hsIds.length) {
      const { data: hsList } = await supabase.from("co_so_y_te").select("id, ten_co_so").in("id", hsIds);
      (hsList || []).forEach(h => { hsMap[h.id] = h.ten_co_so; });
    }

    res.json((data || []).map(d => ({
      id:           d.id,
      serial:       d.so_seri,
      battery:      d.phan_tram_pin,
      online:       d.trang_thai_hoat_dong === true,
      lastOnline:   d.lan_online_cuoi,
      active:       d.trang_thai_hoat_dong,
      registeredAt: d.ngay_dang_ky,
      hospitalId:   d.co_so_y_te_id,
      hospitalName: hsMap[d.co_so_y_te_id] || "—",
    })));
  } catch (err) {
    console.error("[GET /devices]", err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post("/devices", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    const { adminId, serial, hospitalId, firmware } = req.body;
    if (!serial?.trim() || !hospitalId) return res.status(400).json({ error: "Thiếu serial hoặc cơ sở y tế" });

    const { data: existing } = await supabase.from("thiet_bi_iot")
      .select("id").eq("so_seri", serial.trim()).maybeSingle();
    if (existing) return res.status(409).json({ error: `Serial ${serial} đã tồn tại` });

    const { data, error } = await supabase.from("thiet_bi_iot").insert({
      so_seri:          serial.trim(),
      phien_ban_firmware: firmware || null,
      co_so_y_te_id:    hospitalId,
      trang_thai_hoat_dong: true,
      ngay_dang_ky:     new Date().toISOString(),
    }).select("id, so_seri").single();
    if (error) throw error;

    await logAction(supabase, adminId, "CREATE_DEVICE", "thiet_bi_iot", data.id, { serial, hospitalId }, getIp(req));
    res.json({ deviceId: data.id, serial: data.so_seri });
  } catch (err) {
    console.error("[POST /devices]", err.message);
    res.status(500).json({ error: err.message });
  }
});

app.patch("/devices/:id", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    const { id } = req.params;
    const { adminId, serial, hospitalId } = req.body;
    const updates = {};
    if (serial?.trim())           updates.so_seri       = serial.trim();
    if (hospitalId !== undefined) updates.co_so_y_te_id = hospitalId || null;
    const { error } = await supabase.from("thiet_bi_iot").update(updates).eq("id", id);
    if (error) throw error;
    await logAction(supabase, adminId, "UPDATE_DEVICE", "thiet_bi_iot", id, updates, getIp(req));
    res.json({ ok: true });
  } catch (err) {
    console.error("[PATCH /devices/:id]", err.message);
    res.status(500).json({ error: err.message });
  }
});

app.delete("/devices/:id", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    const { id }      = req.params;
    const { adminId } = req.body;

    const { data: activeAssigns } = await supabase.from("lich_su_gan_thiet_bi")
      .select("id").eq("thiet_bi_id", id).eq("trang_thai_hoat_dong", true).limit(1);
    if (activeAssigns?.length) {
      return res.status(409).json({ error: "Thiết bị đang được gán cho bệnh nhân. Vui lòng thu hồi trước khi xóa." });
    }

    const { data: historyAssigns } = await supabase.from("lich_su_gan_thiet_bi")
      .select("id").eq("thiet_bi_id", id).not("ngay_huy_gan", "is", null).limit(1);
    if (historyAssigns?.length) {
      return res.status(409).json({ error: "Thiết bị đã có lịch sử gán bệnh nhân. Không thể xóa." });
    }

    const { error } = await supabase.from("thiet_bi_iot").delete().eq("id", id);
    if (error) throw error;
    await logAction(supabase, adminId, "DELETE_DEVICE", "thiet_bi_iot", id, {}, getIp(req));
    res.json({ ok: true });
  } catch (err) {
    console.error("[DELETE /devices/:id]", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// NHẬT KÝ HỆ THỐNG
// ============================================================

app.get("/logs", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    const { page = 1, limit = 20, action, target, dateFrom, dateTo } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    const ALLOWED_ACTIONS = [
      "LOGIN", "LOGOUT", "CHANGE_PASSWORD",
      "CREATE_HOSPITAL", "UPDATE_HOSPITAL", "DELETE_HOSPITAL",
      "CREATE_SUBADMIN", "UPDATE_SUBADMIN", "DELETE_SUBADMIN",
      "CREATE_DEVICE",   "UPDATE_DEVICE",   "DELETE_DEVICE",
      "CREATE", "UPDATE", "DELETE",
    ];
    const ADMIN_TABLES    = ["co_so_y_te", "nguoi_dung", "thiet_bi_iot", "admin", "sub_admin"];
    const TRIGGER_ACTIONS = ["CREATE", "UPDATE", "DELETE"];

    const { data: saRole } = await supabase.from("vai_tro").select("id").eq("ten_vai_tro", "sub_admin").maybeSingle();
    let subAdminIds = [];
    if (saRole) {
      const { data: pq } = await supabase.from("phan_quyen_nguoi_dung").select("nguoi_dung_id").eq("vai_tro_id", saRole.id);
      subAdminIds = (pq || []).map(p => p.nguoi_dung_id);
    }

    let query = supabase.from("nhat_ky_he_thong")
      .select("id, nguoi_dung_id, hanh_dong, loai_doi_tuong, doi_tuong_id, dia_chi_ip, du_lieu_bo_sung, ngay_tao", { count: "exact" })
      .order("ngay_tao", { ascending: false })
      .range(offset, offset + parseInt(limit) - 1)
      .in("hanh_dong", action ? [action] : ALLOWED_ACTIONS);

    if (target) query = query.eq("loai_doi_tuong", target);
    else        query = query.in("loai_doi_tuong", ADMIN_TABLES);
    if (dateFrom) query = query.gte("ngay_tao", dateFrom);
    if (dateTo)   query = query.lte("ngay_tao", dateTo + "T23:59:59");

    const { data, error } = await query;
    if (error) throw error;

    const filterFn = l => {
      if (!TRIGGER_ACTIONS.includes(l.hanh_dong)) return true;
      if (!l.nguoi_dung_id) return true;
      return !subAdminIds.includes(l.nguoi_dung_id);
    };
    const filtered = (data || []).filter(filterFn);

    const uids = [...new Set(filtered.map(l => l.nguoi_dung_id).filter(Boolean))];
    const uMap = {};
    if (uids.length) {
      const { data: users } = await supabase.from("nguoi_dung").select("id, ho_ten, email").in("id", uids);
      (users || []).forEach(u => { uMap[u.id] = { name: u.ho_ten, email: u.email }; });
    }

    res.json({
      page:  parseInt(page),
      limit: parseInt(limit),
      data:  filtered.map(l => ({
        id:         l.id,
        userId:     l.nguoi_dung_id,
        userName:   uMap[l.nguoi_dung_id]?.name  || null,
        userEmail:  uMap[l.nguoi_dung_id]?.email || null,
        action:     l.hanh_dong,
        targetType: l.loai_doi_tuong,
        targetId:   l.doi_tuong_id,
        ip:         l.dia_chi_ip,
        detail:     l.du_lieu_bo_sung,
        time:       l.ngay_tao,
      })),
    });
  } catch (err) {
    console.error("[GET /logs]", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// START
// ============================================================

const PORT = process.env.PORT || 3002;
app.listen(PORT, () => {
  console.log(`HealthMonitor Admin API v2.0 — port ${PORT}`);
});

process.on("unhandledRejection", (r) => console.error("[unhandledRejection]", r));
process.on("uncaughtException",  (e) => { console.error("[uncaughtException]", e); process.exit(1); });
