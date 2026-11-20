// Shared helpers (files starting with _ are not exposed as routes by Vercel)
const crypto = require("crypto");
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const hits = new Map();
function env(n, d) { return (process.env[n] || d || "").trim(); }
function svcKey() { return env("SUPABASE_SERVICE_ROLE_KEY") || env("SUPABASE_SERVICE_KEY"); }
function sbReady() { return !!(env("SUPABASE_URL") && svcKey()); }
function stripeReady() { return !!env("STRIPE_SECRET_KEY"); }
function sbHeaders(extra) {
  const k = svcKey();
  return Object.assign({ apikey: k, Authorization: "Bearer " + k }, extra || {});
}
async function sb(path, opts) {
  const r = await fetch(env("SUPABASE_URL").replace(/\/$/, "") + path, opts);
  let j = null; const t = await r.text(); try { j = t ? JSON.parse(t) : null; } catch (e) { j = t; }
  if (!r.ok) { console.error("[sb]", r.status, path.slice(0, 80), JSON.stringify(j).slice(0, 300)); }
  return { ok: r.ok, status: r.status, data: j };
}
function rate(req, key, max) {
  const ip = String(req.headers["x-forwarded-for"] || "").split(",")[0] || "x";
  const k = key + ":" + ip, now = Date.now();
  const arr = (hits.get(k) || []).filter(t => now - t < 3600e3);
  if (arr.length >= max) return false;
  arr.push(now); hits.set(k, arr); return true;
}
function body(req) {
  let b = req.body; if (typeof b === "string") { try { b = JSON.parse(b); } catch (e) { b = {}; } }
  return b || {};
}
function newKey() { return crypto.randomBytes(24).toString("hex"); }
function sameKey(a, b) {
  a = Buffer.from(String(a || "")); b = Buffer.from(String(b || ""));
  return a.length === b.length && a.length > 0 && crypto.timingSafeEqual(a, b);
}
function clip(s, n) { return String(s == null ? "" : s).replace(/[\u0000-\u001f]/g, " ").slice(0, n); }
function siteUrl(req) {
  const s = env("NEXT_PUBLIC_SITE_URL") || env("SITE_URL"); if (s) return s.replace(/\/$/, "");
  const proto = String(req.headers["x-forwarded-proto"] || "https").split(",")[0];
  return proto + "://" + (req.headers["x-forwarded-host"] || req.headers.host);
}
function esc(s) { return String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }
async function getBook(id) {
  const r = await sb("/rest/v1/books?id=eq." + id + "&select=*", { headers: sbHeaders() });
  return r.ok && Array.isArray(r.data) && r.data[0] ? r.data[0] : null;
}
async function patchBook(id, patch) {
  return sb("/rest/v1/books?id=eq." + id, { method: "PATCH", headers: sbHeaders({ "Content-Type": "application/json", Prefer: "return=minimal" }), body: JSON.stringify(patch) });
}
function publicUrl(path) { return env("SUPABASE_URL").replace(/\/$/, "") + "/storage/v1/object/public/" + env("SUPABASE_BUCKET", "lawwenha") + "/" + path; }
async function upload(path, buf, mime) {
  return sb("/storage/v1/object/" + env("SUPABASE_BUCKET", "lawwenha") + "/" + path, { method: "POST", headers: sbHeaders({ "Content-Type": mime, "x-upsert": "true" }), body: buf });
}
module.exports = { UUID, env, sbReady, stripeReady, sb, sbHeaders, rate, body, newKey, sameKey, clip, siteUrl, esc, getBook, patchBook, publicUrl, upload };
