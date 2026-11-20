// GET  /api/checkout            -> {ready}   (payment + storage configured)
// POST /api/checkout {id,key}   -> {url}     (Stripe Checkout)
const L = require("./_lib");
module.exports = async (req, res) => {
  if (req.method === "GET") return res.status(200).json({ ready: L.sbReady() && L.stripeReady() });
  if (req.method !== "POST") return res.status(405).json({ error: "method" });
  if (!L.sbReady() || !L.stripeReady()) return res.status(503).json({ error: "not_configured" });
  if (!L.rate(req, "checkout", 20)) return res.status(429).json({ error: "rate" });
  const b = L.body(req);
  if (!L.UUID.test(b.id || "")) return res.status(400).json({ error: "bad_id" });
  const book = await L.getBook(b.id);
  if (!book || !L.sameKey(book.key, b.key)) return res.status(403).json({ error: "forbidden" });
  if (book.paid) return res.status(409).json({ error: "already_paid" });
  const base = L.siteUrl(req), en = book.lang === "en";
  const p = new URLSearchParams();
  p.set("mode", "payment");
  p.set("line_items[0][quantity]", "1");
  const sar = parseFloat(L.env("PRICE_SAR"));
  const cur = sar > 0 ? "sar" : L.env("CURRENCY", "sar").toLowerCase();
  const amt = sar > 0 ? Math.round(sar * 100) : (parseInt(L.env("PRICE_AMOUNT", "4900"), 10) || 4900);
  p.set("line_items[0][price_data][currency]", cur);
  p.set("line_items[0][price_data][unit_amount]", String(amt));
  p.set("line_items[0][price_data][product_data][name]", en ? "Lawwenha personal colouring book" : "كتاب لوّنها الشخصي للتلوين");
  p.set("success_url", base + "/?paid=1&id=" + book.id + "&session_id={CHECKOUT_SESSION_ID}");
  p.set("cancel_url", base + "/?cancel=1");
  p.set("metadata[book_id]", book.id);
  p.set("locale", en ? "en" : "auto");
  const r = await fetch("https://api.stripe.com/v1/checkout/sessions", { method: "POST", headers: { Authorization: "Bearer " + L.env("STRIPE_SECRET_KEY"), "Content-Type": "application/x-www-form-urlencoded" }, body: p });
  const j = await r.json();
  if (!r.ok || !j.url) { console.error("[stripe]", r.status, JSON.stringify(j).slice(0, 300)); return res.status(502).json({ error: "stripe", status: r.status, detail: j.error && j.error.message }); }
  return res.status(200).json({ url: j.url });
};
