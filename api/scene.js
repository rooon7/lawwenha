// POST /api/scene {idx, answer, lang} -> {image:"data:image/png;base64,..."} ; GET -> {ready}
// Env: GEMINI_API_KEY, GEMINI_IMAGE_MODEL (default gemini-2.5-flash-image), MAX_SCENES_PER_HOUR (default 40)
const hits = new Map();
const COMMON =
  "Coloring book page for adults and children: PROFESSIONAL clean vector-style line illustration, very EASY and FUN to colour. " +
  "PURE BLACK INK on a plain white background, no grey, no colour fill, no shading, no gradients, no textures, no hatching. " +
  "Bold clean lines of even weight (approx. 5px at 2048px), all outlines fully closed. " +
  "FEW LARGE shapes: about 15 to 30 large regions in total; no tiny details, no small dots, no fine patterns, no dense ornament. " +
  "One clear focal subject, balanced centred composition, white margin of 10% around it, at least 12px of white space between elements. " +
  "No faces with features, no eyes, no text, no letters, no numbers, no watermark, no logo, no border frame. People only as simple silhouettes seen from behind.";
const STYLES = {
  love: "Style: elegant romantic fine-art. Big roses and peonies, large leaves, flowing vines, hearts and graceful flourishes.",
  friends: "Style: fun, playful, energetic modern doodle illustration of friends hanging out in cafés, restaurants, shopping malls or parties. NOT romantic: no hearts, no roses, no couples. Use big simple venue details, balloons, party garlands, cakes, cups, plates, shopping bags, stars, zigzags and confetti shapes.",
  family: "Style: warm, heartfelt Arabian Gulf heritage. Palm trees, a dallah coffee pot and small cups, majlis cushions, lanterns, a cozy house, simple geometric arabesque motifs, a tree of life. NOT romantic: no hearts, no couples, no roses as the main subject."
};
const HINTS = {
  love: [
    "the place where two people first met: {a}. A charming romantic illustrated scene of that place, simplified, framed by a few big roses and leaves.",
    "a joyful playful moment between two people: {a}. The main objects of that moment, simple and whimsical, with a few big hearts and flowers.",
    "a beloved place: {a}. A simple romantic view of that place with two elegant silhouettes seen from behind, big flowers in the foreground.",
    "a tribute to what makes the loved one special: {a}. A symbolic composition around a large heart with a bouquet of a few big roses and leaves.",
    "a loving nickname: {a}. A large symbolic emblem built from the meaning of that nickname (moon, rose, pearl, star...) with a few simple flourishes and flowers.",
    "a shared dream for the future: {a}. A dreamy simple scene of that dream, a big doorway of roses or a garden, two silhouettes seen from behind."
  ],
  friends: [
    "friends meeting: {a}. Set the scene inside whichever fits the answer best: a cozy café, a restaurant, a shopping mall or a party (default: a café). Show big simple venue details: tables, cups, plates, windows, plants, with two friendly silhouettes seen from behind.",
    "a funny moment between friends: {a}. Set the scene inside whichever fits the answer best: a restaurant, a café, a shopping mall or a party (default: a restaurant). Big comical objects of that moment (food, drinks, shopping bags, balloons), confetti and stars.",
    "a favourite hangout: {a}. Set the scene inside whichever fits the answer best: a shopping mall, a café, a restaurant or a party (default: a shopping mall). Shop fronts, escalator, benches, tables, with a few friendly silhouettes seen from behind.",
    "what makes a friend special: {a}. Set the scene at a party or a café (default: a party): a big friendship emblem (two high-fiving hands, a star) with balloons, a cake, garlands and cups around it.",
    "an inside joke or secret word between friends: {a}. Set the scene inside a café or a restaurant (default: a café): a large playful emblem built from the meaning of it sitting on a table with cups, plates, stars and zigzags.",
    "a plan or adventure friends dream of: {a}. Set the scene at a party, a restaurant, a café or a shopping mall, whichever fits the answer best (default: a party), with big bold simple shapes, balloons and confetti."
  ],
  family: [
    "a happy childhood memory with family: {a}. A warm simplified scene of that memory with palm trees and a big sun.",
    "a family tradition or shared meal: {a}. A large simple still life of that (dallah coffee pot, cups, dishes, dates, majlis cushions).",
    "a place that reminds of family: {a}. A warm simple view of that place (house, courtyard, palm trees) with big shapes and lanterns.",
    "gratitude for something a family member taught: {a}. A big tree of life with large leaves and two open hands beneath it.",
    "a phrase a loved family member always says: {a}. A large tender emblem built from its meaning (open hands, dove, olive branch, lantern) with simple geometric motifs.",
    "a heartfelt wish for a loved family member: {a}. A hopeful simple scene of that wish (sunrise, tree, bird, home) with big shapes."
  ]
};
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
  const kind = HINTS[b && b.kind] ? b.kind : "love";
  const prompt = COMMON + " " + STYLES[kind] + " Subject: " + HINTS[kind][idx].replace("{a}", "\"" + answer + "\"") +
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
