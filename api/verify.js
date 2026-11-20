// GET /api/verify?id=&key=&session_id=  -> {ok, link, emailed}
// Confirms the Stripe payment server-side, marks the book paid, emails the link (once).
const L = require("./_lib");
module.exports = async (req, res) => {
  if (!L.sbReady() || !L.stripeReady()) return res.status(503).json({ error: "not_configured" });
  const q = req.query || {};
  if (!L.UUID.test(q.id || "") || !/^cs_[\w]+$/.test(q.session_id || "")) return res.status(400).json({ error: "bad_params" });
  const book = await L.getBook(q.id);
  if (!book || !L.sameKey(book.key, q.key)) return res.status(403).json({ error: "forbidden" });
  const r = await fetch("https://api.stripe.com/v1/checkout/sessions/" + q.session_id, { headers: { Authorization: "Bearer " + L.env("STRIPE_SECRET_KEY") } });
  const s = await r.json();
  if (!r.ok) return res.status(502).json({ error: "stripe", status: r.status });
  if (s.payment_status !== "paid" || !s.metadata || s.metadata.book_id !== book.id) return res.status(402).json({ error: "not_paid" });
  if (!book.paid) await L.patchBook(book.id, { paid: true, stripe_session: s.id });
  const link = L.siteUrl(req) + "/b/" + book.id;
  let emailed = !!book.sent;
  if (!book.sent && L.env("RESEND_API_KEY") && L.env("FROM_EMAIL")) {
    const en = book.lang === "en", from = L.esc(book.from_name || (en ? "someone who loves you" : "شخص يحبك")), to = L.esc(book.to_name || "");
    const subject = en ? "A gift is waiting for you" : "وصلتك هدية خاصة";
    const html = en
      ? `<div style="font-family:Arial,sans-serif;max-width:520px;margin:auto;text-align:center;padding:24px"><h2>For ${to}</h2><p>${from} made you a colouring book of your own story. Colour every page and the last page opens with a surprise.</p><p><a href="${link}" style="background:#8E2C57;color:#fff;padding:12px 22px;border-radius:10px;text-decoration:none;display:inline-block">Open your book</a></p></div>`
      : `<div dir="rtl" style="font-family:Tahoma,Arial,sans-serif;max-width:520px;margin:auto;text-align:center;padding:24px"><h2>إلى ${to}</h2><p>${from} جهّز لك كتاب تلوين من قصتكم. لوّني كل الصفحات وتنفتح لك الصفحة الأخيرة بمفاجأة.</p><p><a href="${link}" style="background:#8E2C57;color:#fff;padding:12px 22px;border-radius:10px;text-decoration:none;display:inline-block">افتحي كتابك</a></p></div>`;
    const m = await fetch("https://api.resend.com/emails", { method: "POST", headers: { Authorization: "Bearer " + L.env("RESEND_API_KEY"), "Content-Type": "application/json" }, body: JSON.stringify({ from: L.env("FROM_EMAIL"), to: [book.email], subject, html }) });
    if (m.ok) { emailed = true; await L.patchBook(book.id, { sent: true }); }
    else console.error("[resend]", m.status, (await m.text()).slice(0, 300));
  }
  return res.status(200).json({ ok: true, link, emailed });
};
