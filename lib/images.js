// Images in answers (diagrams, whiteboard photos, screenshots).
// Stored as files in <data folder>/images/<hash>.<ext> and referenced from Markdown as
// ![alt](/images/<file>), so the JSON stays small. Before a prompt is sent, they're
// pulled out of the text and attached as real image inputs the model can see.
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { CONTENT, userdata } = require("./store");

const IMG_DIR = userdata.IMAGES;                       // your data folder
const LEGACY_DIR = path.join(CONTENT, "images");       // older installs kept them in the repo
const TYPES = { "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp" };
const EXT_TYPES = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp" };
const MAX_UPLOAD = 10 * 1024 * 1024;
const MAX_SEND = 5 * 1024 * 1024; // per image; Claude's limit, and plenty for a diagram
const MAX_IMAGES = 6;
const IMG_RE = /!\[([^\]]*)\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g;

const mb = (n) => (n / 1048576).toFixed(1) + " MB";

/** Save image bytes; returns the URL to put in Markdown. Same bytes → same file. */
function saveImage(buf, mediaType) {
  const ext = TYPES[mediaType];
  if (!ext) throw Object.assign(new Error(`Unsupported image type ${mediaType || "(unknown)"}. Use PNG, JPEG, GIF or WebP.`), { status: 415 });
  if (!buf || !buf.length) throw Object.assign(new Error("Empty image."), { status: 400 });
  if (buf.length > MAX_UPLOAD) throw Object.assign(new Error(`Image is ${mb(buf.length)}; the limit is ${mb(MAX_UPLOAD)}.`), { status: 413 });
  userdata.ensureImages();
  const name = crypto.createHash("sha1").update(buf).digest("hex").slice(0, 16) + "." + ext;
  const file = path.join(IMG_DIR, name);
  if (!fs.existsSync(file)) fs.writeFileSync(file, buf);
  return "/images/" + name;
}

// Read a referenced image. Returns { mediaType, buf } or { error }.
function load(src, baseDir) {
  const data = /^data:(image\/[a-z+.-]+);base64,(.+)$/i.exec(src);
  if (data) return { mediaType: data[1].toLowerCase().replace("image/jpg", "image/jpeg"), buf: Buffer.from(data[2], "base64") };
  if (/^https?:\/\//i.test(src)) return { error: "web link, not attached" };
  let file;
  const m = /^\/?images\/([\w.-]+)$/.exec(src);
  if (m) { file = path.join(IMG_DIR, m[1]); if (!fs.existsSync(file) && fs.existsSync(path.join(LEGACY_DIR, m[1]))) file = path.join(LEGACY_DIR, m[1]); }
  else if (baseDir) file = path.resolve(baseDir, decodeURIComponent(src));
  else return { error: "not found" };
  if (!fs.existsSync(file)) return { error: "file missing" };
  const mediaType = EXT_TYPES[path.extname(file).slice(1).toLowerCase()];
  if (!mediaType) return { error: "unsupported type" };
  return { mediaType, buf: fs.readFileSync(file) };
}

/**
 * Split Markdown into prompt text plus image parts.
 * Each image becomes "[Image N: alt]" in the text; the bytes come back as
 * { type: "image", mediaType, data (base64) } parts, in the same order.
 */
function extract(markdown) {
  const images = [];
  const text = String(markdown || "").replace(IMG_RE, (all, alt, src) => {
    const label = alt && !/^image$|\.(png|jpe?g|gif|webp)$/i.test(alt) ? `: ${alt}` : "";
    const n = images.length + 1;
    if (n > MAX_IMAGES) return `[Image${label} — not attached, more than ${MAX_IMAGES} images]`;
    const r = load(src);
    if (r.error) return `[Image${label} — ${r.error}]`;
    if (r.buf.length > MAX_SEND) return `[Image${label} — too large to send (${mb(r.buf.length)}; keep diagrams under ${mb(MAX_SEND)})]`;
    images.push({ type: "image", mediaType: r.mediaType, data: r.buf.toString("base64") });
    return `[Image ${n}${label} — attached]`;
  });
  return { text, images };
}

/** Turn inline data: URIs into saved files, so answers don't carry megabytes of base64. */
function externalize(markdown) {
  return String(markdown || "").replace(IMG_RE, (all, alt, src) => {
    if (!/^data:image\//i.test(src)) return all;
    try {
      const r = load(src);
      return `![${alt}](${saveImage(r.buf, r.mediaType)})`;
    } catch (e) { return all; }
  });
}

/** For `kb answer file.md`: copy images referenced by relative path into the data folder's images/. */
function importLocal(markdown, baseDir) {
  return String(markdown || "").replace(IMG_RE, (all, alt, src) => {
    if (/^(https?:|data:|\/images\/)/i.test(src)) return all;
    const r = load(src, baseDir);
    if (r.error) return all;
    try { return `![${alt}](${saveImage(r.buf, r.mediaType)})`; } catch (e) { return all; }
  });
}

module.exports = { IMG_DIR, LEGACY_DIR, TYPES, MAX_UPLOAD, saveImage, extract, externalize, importLocal };
