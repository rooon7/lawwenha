// POST /api/book {action:"create", ...}                         -> {id,key}
// POST /api/book?id=&key=&kind=scene&idx=0..5   {image:dataURL} -> {ok}
// POST /api/book?id=&key=&kind=audio            {audio:dataURL} -> {ok}
// GET  /api/book?id=   (only when paid)                         -> public book data
const L = require("./_lib");
const MIMES = { "audio/mpeg": "mp3", "audio/mp3": "mp3", "audio/mp4": "m4a", "audio/x-m4a": "m4a", "audio/aac": "aac", "audio/webm": "webm", "audio/ogg": "ogg", "audio/wav": "wav", "audio/x-wav": "wav" };
module.exports = async (req, res) => {
  if (!L.sbReady()) return res.status(503).json({ error: "not_configured" });
  const q = req.query || {};
  if (req.method === "GET") {
    if (!L.UUID.test(q.id || "")) return res.status(400).json({ error: "bad_id" });
    const b = await L.getBook(q.id);
    if (!b || !b.paid) return res.status(404).json({ error: "not_found" });
    const scenes = []; for (let i = 0; i < 6; i++) scenes.push(L.publicUrl(b.id + "/scene" + i + ".png"));
    return res.status(200).json({ id: b.id, lang: b.lang, to: b.to_name, from: b.from_name, secret: b.secret, sig: b.sig, answers: b.answers, style: b.style, scenes, audio: b.audio_path ? L.publicUrl(b.audio_path) : null });
  }
  if (req.method !== "POST") return res.status(405).json({ error: "method" });
  const b = L.body(req);
  if (b.action === "create") {
    if (!L.rate(req, "create", 10)) return res.status(429).json({ error: "rate" });
    const email = L.clip(b.email, 120);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return res.status(400).json({ error: "bad_email" });
    const a = b.answers && typeof b.answers === "object" ? b.answers : {};
    const answers = {}; ["q1", "q2", "q3", "q4", "q5", "q6"].forEach(k => { answers[k] = L.clip(a[k], 120); });
    answers.k = ["love", "friends", "family"].includes(a.k) ? a.k : "love";
    const key = L.newKey();
    const row = { key, lang: b.lang === "en" ? "en" : "ar", to_name: L.clip(b.to, 24), from_name: L.clip(b.from, 24), secret: L.clip(b.secret, 120), sig: L.clip(b.sig, 60), email, answers, style: L.clip(b.style, 10) };
    const r = await L.sb("/rest/v1/books", { method: "POST", headers: L.sbHeaders({ "Content-Type": "application/json", Prefer: "return=representation" }), body: JSON.stringify(row) });
    if (!r.ok || !r.data || !r.data[0]) return res.status(502).json({ error: "db", status: r.status });
    return res.status(200).json({ id: r.data[0].id, key });
  }
  if (!L.UUID.test(q.id || "")) return res.status(400).json({ error: "bad_id" });
  const book = await L.getBook(q.id);
  if (!book || !L.sameKey(book.key, q.key)) return res.status(403).json({ error: "forbidden" });
  if (book.paid) return res.status(409).json({ error: "already_paid" });
  const m = /^data:([\w\/+.-]+);base64,(.+)$/s.exec(String(b.image || b.audio || ""));
  if (!m) return res.status(400).json({ error: "bad_data" });
  const buf = Buffer.from(m[2], "base64");
  if (q.kind === "scene") {
    const idx = parseInt(q.idx, 10);
    if (!(idx >= 0 && idx <= 5)) return res.status(400).json({ error: "bad_idx" });
    if (!/^image\/(png|jpeg|webp)$/.test(m[1]) || buf.length > 3.2e6) return res.status(400).json({ error: "bad_image" });
    const r = await L.upload(book.id + "/scene" + idx + ".png", buf, m[1]);
    return r.ok ? res.status(200).json({ ok: true }) : res.status(502).json({ error: "storage", status: r.status });
  }
  if (q.kind === "audio") {
    const ext = MIMES[m[1].split(";")[0]];
    if (!ext || buf.length > 3.2e6) return res.status(400).json({ error: "bad_audio" });
    const path = book.id + "/audio." + ext;
    const r = await L.upload(path, buf, m[1].split(";")[0]);
    if (!r.ok) return res.status(502).json({ error: "storage", status: r.status });
    await L.patchBook(book.id, { audio_path: path });
    return res.status(200).json({ ok: true });
  }
  return res.status(400).json({ error: "bad_kind" });
};
