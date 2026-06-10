/**
 * Shared utilities — dùng chung cho cả 3 server
 * server.js | server-admin.js | server-subadmin.js
 */

require("dotenv").config();
const bcrypt  = require("bcrypt");
const jwt     = require("jsonwebtoken");

const SALT_ROUNDS  = 10;
const JWT_SECRET   = process.env.JWT_SECRET || "fallback-secret-change-in-production";
const JWT_EXPIRES  = process.env.JWT_EXPIRES_IN || "8h";
const FRONTEND_URL = process.env.FRONTEND_URL || "https://accountdoan.github.io/Health-monitor-system";

// ============================================================
// PASSWORD — bcrypt
// ============================================================

/**
 * Hash mật khẩu mới trước khi lưu vào DB
 */
async function hashPassword(plain) {
  return bcrypt.hash(plain, SALT_ROUNDS);
}

/**
 * So sánh mật khẩu khi đăng nhập.
 * Hỗ trợ chuyển đổi dần: nếu DB còn plain-text thì vẫn đăng nhập được
 * và tự động re-hash lần sau.
 *
 * @returns {{ ok: boolean, needsRehash: boolean }}
 */
async function verifyPassword(plain, stored) {
  const isHashed = stored && stored.startsWith("$2b$");
  if (isHashed) {
    const ok = await bcrypt.compare(plain, stored);
    return { ok, needsRehash: false };
  }
  // Plain-text legacy — so sánh thẳng, đánh dấu cần re-hash
  return { ok: plain === stored, needsRehash: true };
}

// ============================================================
// JWT
// ============================================================

/**
 * Tạo JWT token sau khi đăng nhập thành công
 */
function signToken(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES });
}

/**
 * Middleware xác thực JWT.
 * Yêu cầu header: Authorization: Bearer <token>
 *
 * Sau khi verify, req.user = { userId, roles, hospitalId, ... }
 */
function requireAuth(req, res, next) {
  const authHeader = req.headers["authorization"];
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Chưa đăng nhập hoặc token không hợp lệ" });
  }
  const token = authHeader.slice(7);
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch (err) {
    const msg = err.name === "TokenExpiredError"
      ? "Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại."
      : "Token không hợp lệ";
    return res.status(401).json({ error: msg });
  }
}

/**
 * Middleware kiểm tra role cụ thể.
 * Sử dụng sau requireAuth.
 * @param {...string} allowedRoles
 */
function requireRole(...allowedRoles) {
  return (req, res, next) => {
    const userRoles = req.user?.roles || [];
    if (!allowedRoles.some(r => userRoles.includes(r))) {
      return res.status(403).json({ error: "Không có quyền truy cập" });
    }
    next();
  };
}

// ============================================================
// EMAIL — Brevo API
// ============================================================

async function sendEmail({ to, subject, html }) {
  const apiKey = process.env.BREVO_API_KEY;
  if (!apiKey) throw new Error("Thiếu BREVO_API_KEY trong biến môi trường");

  const fromEmail = process.env.EMAIL_FROM || "no-reply@healthmonitor.vn";

  const response = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: {
      "api-key":      apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      sender:      { name: "Health Monitor", email: fromEmail },
      to:          [{ email: to }],
      subject,
      htmlContent: html,
    }),
  });

  const data = await response.json();
  if (!response.ok) throw new Error(data.message || `Brevo error ${response.status}`);
  return data;
}

function buildResetEmailHtml(name, resetLink) {
  return `
    <div style="font-family:'Segoe UI',sans-serif;max-width:520px;margin:0 auto;padding:32px 24px;background:#f0f7f4;border-radius:16px">
      <div style="text-align:center;margin-bottom:24px">
        <div style="background:#2b5f8e;display:inline-block;padding:12px 20px;border-radius:12px">
          <span style="color:#85c8ee;font-size:1.3rem;font-weight:800">Health<span style="color:#5ab52a">Monitor</span></span>
        </div>
      </div>
      <div style="background:#fff;border-radius:12px;padding:28px 24px;border:1px solid #d0e8da">
        <h2 style="color:#2b5f8e;margin:0 0 8px">Đặt lại mật khẩu</h2>
        <p style="color:#6b8f7a;margin:0 0 20px">Xin chào <strong style="color:#1a2e1e">${name}</strong>,</p>
        <p style="color:#1a2e1e;line-height:1.6;margin:0 0 24px">
          Chúng tôi nhận được yêu cầu đặt lại mật khẩu cho tài khoản của bạn.
          Link có hiệu lực trong <strong>1 giờ</strong>.
        </p>
        <div style="text-align:center;margin-bottom:24px">
          <a href="${resetLink}" style="display:inline-block;background:#2b5f8e;color:#fff;padding:13px 32px;border-radius:10px;text-decoration:none;font-weight:700;font-size:0.95rem">
            ✅ Đặt lại mật khẩu
          </a>
        </div>
        <p style="color:#6b8f7a;font-size:0.82rem;margin:0 0 8px">Nếu nút không hoạt động, copy link sau:</p>
        <p style="color:#2b5f8e;font-size:0.78rem;word-break:break-all;margin:0 0 20px">${resetLink}</p>
        <hr style="border:none;border-top:1px solid #d0e8da;margin:20px 0"/>
        <p style="color:#6b8f7a;font-size:0.78rem;margin:0">Nếu bạn không yêu cầu, hãy bỏ qua email này.</p>
      </div>
    </div>
  `;
}

// ============================================================
// NHẬT KÝ HỆ THỐNG
// ============================================================

function getIp(req) {
  return req.headers["x-forwarded-for"]?.split(",")[0]?.trim()
    || req.socket?.remoteAddress
    || null;
}

/**
 * Ghi nhật ký hoạt động vào bảng nhat_ky_he_thong.
 * Không throw — lỗi log không được làm gián đoạn nghiệp vụ.
 */
async function logAction(supabase, userId, action, targetType, targetId, detail, ip) {
  try {
    await supabase.from("nhat_ky_he_thong").insert({
      nguoi_dung_id:   userId || null,
      hanh_dong:       action,
      loai_doi_tuong:  targetType,
      doi_tuong_id:    targetId || null,
      du_lieu_bo_sung: detail || {},
      dia_chi_ip:      ip || null,
      ngay_tao:        new Date().toISOString(),
    });
  } catch (_) {}
}

// ============================================================
// SUPABASE CLIENT
// ============================================================

const { createClient } = require("@supabase/supabase-js");

function createSupabaseClient() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_ANON_KEY;
  if (!url || !key) {
    throw new Error("Thiếu SUPABASE_URL hoặc SUPABASE_ANON_KEY trong .env");
  }
  return createClient(url, key);
}

// ============================================================
// RATE LIMITERS
// ============================================================

const rateLimit = require("express-rate-limit");

const loginLimiter = rateLimit({
  windowMs:       15 * 60 * 1000,
  max:            10,
  message:        { error: "Quá nhiều lần đăng nhập thất bại. Vui lòng thử lại sau 15 phút." },
  standardHeaders: true,
  legacyHeaders:   false,
});

const apiLimiter = rateLimit({
  windowMs:       60 * 1000,
  max:            200,
  message:        { error: "Quá nhiều yêu cầu. Vui lòng thử lại sau." },
  standardHeaders: true,
  legacyHeaders:   false,
});

// ============================================================
// EXPORTS
// ============================================================

module.exports = {
  FRONTEND_URL,
  hashPassword,
  verifyPassword,
  signToken,
  requireAuth,
  requireRole,
  sendEmail,
  buildResetEmailHtml,
  getIp,
  logAction,
  createSupabaseClient,
  loginLimiter,
  apiLimiter,
};
