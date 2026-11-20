// POST /api/scene {idx, answer, lang} -> {image:"data:image/png;base64,..."} ; GET -> {ready}
// Env: GEMINI_API_KEY, GEMINI_IMAGE_MODEL (default gemini-2.5-flash-image), MAX_SCENES_PER_HOUR (default 40)
const hits = new Map();
const HINT = [
  "the place where two people first met: {a}. A charming romantic illustrated scene of that place with its architectural and interior details, framed by roses and climbing vines.",
  "a joyful playful moment between two people: {a}. The objects and atmosphere of that moment, whimsical and romantic, with floating hearts, petals and flowers.",
  "a beloved place: {a}. A sweeping romantic view of that place with two elegant silhouettes seen from behind, flowers in the foreground.",
  "a tribute to what makes her special: {a}. A symbolic composition around an elegant woman's profile silhouette whose flowing hair turns into roses, leaves and ornament. No detailed face.",
  "a loving nickname: {a}. A symbolic ornate emblem built from the meaning of that nickname (moon, rose, pearl, star...) surrounded by flourishes and flowers.",
  "a shared dream for the future: {a}. A dreamy romantic scene of that dream, a doorway of roses, a garden, two elegant silhouettes seen from behind.",
];
const STYLE =
  "Adult coloring book page, elegant and romantic. " +
  "PURE BLACK INK LINE ART on a plain white background, no grey, no colour, no shading, no gradients, no textures, no hatching. " +
  "Consistent medium-weight lines (approx. 3px at 2048px) with smooth closed shapes suitable for brush or marker colouring. " +
  "Art-nouveau and Persian floral influence: delicate roses, peonies, leaves, vines, ornamental flourishes. " +
  "Clear white space between elements (minimum 6px), generous white margin of 8% around the composition, " +
  "balanced centred composition, medium detail density, intricate but not cluttered, with large and medium areas that are easy to colour. " +
  "No faces with detailed features, no eyes, no text, no letters, no numbers, no watermark, no logo, no border frame. " +
  "If people appear, draw them from behind or as simplified elegant silhouettes.";
module.exports = async (req, res) => {
  const key = process.env.GEMINI_API_KEY;
  if (req.method === "GET") return res.status(200).json({ ready: !!key });
  if (req.method !== "POST") return res.status(405).json({ error: "method" });
  if (!key) return res.status(503).json({ error: "not_configured" });
  const ip = String(req.headers["x-forwarded-for"] || "").split(",")[0] || "x";
  const now = Date.now(), max = +process.env.MAX_SCENES_PER_HOUR || 40;
  const arr = (hits.get(ip) || []).filter(t => now - t < 3600e3);
  if (arr.length >= max) return res.status(429).json({ error: "rate" });
  arr.push(now); hits.set(ip, arr);
  let b = req.body; if (typeof b === "string") { try { b = JSON.parse(b); } catch { b = {}; } }
  const idx = Math.max(0, Math.min(5, parseInt(b && b.idx, 10) || 0));
  const answer = String((b && b.answer) || "").replace(/[\r\n"]/g, " ").slice(0, 120);
  const prompt = STYLE + " Subject: " + HINT[idx].replace("{a}", "\"" + answer + "\"") +
    " Use the meaning of the quoted text only to decide what to draw; never write it in the image." +
    " Square 1:1 composition, high resolution, print-ready line art.";
  const model = (process.env.GEMINI_IMAGE_MODEL || "gemini-2.5-flash-image").trim();
  const url = "https://generativelanguage.googleapis.com/v1beta/models/" + model + ":generateContent";
  async function call(cfg) {
    const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: cfg }) });
    let j = {}; try { j = await r.json(); } catch (e) {}
    const cand = j.candidates && j.candidates[0];
    const parts = (cand && cand.content && cand.content.parts) || [];
    const img = parts.filter(p => p.inlineData && p.inlineData.data).pop();
    if (!img) {
      const detail = (j.error && j.error.message) || (j.promptFeedback && j.promptFeedback.blockReason) || (cand && cand.finishReason) ||
        (parts.find(p => p.text) || {}).text || "no image in response";
      console.error("[scene] google", r.status, model, JSON.stringify(j).slice(0, 500));
      return { err: { status: r.status, detail: String(detail).slice(0, 200) } };
    }
    return { img };
  }
  try {
    let out = await call({ responseModalities: ["IMAGE"], imageConfig: { aspectRatio: "1:1" } });
    if (!out.img) out = await call({ responseModalities: ["IMAGE"] });
    if (!out.img) return res.status(502).json({ error: "no_image", status: out.err.status, model, detail: out.err.detail });
    const img = out.img;
    return res.status(200).json({ image: "data:" + (img.inlineData.mimeType || "image/png") + ";base64," + img.inlineData.data });
  } catch (e) {
    console.error("[scene] fetch failed", String(e && e.message || e));
    return res.status(502).json({ error: "upstream", detail: String(e && e.message || e).slice(0, 200) });
  }
};
