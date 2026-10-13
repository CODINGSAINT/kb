// Libraries: reading tracks you generate yourself with `kb add "<subject>"`.
// Each one lives in your data folder (never in the repo):
//
//   kb-data/library/<slug>/library.json      title, subject, outline (chapter ids, titles, scope)
//   kb-data/library/<slug>/01-<id>.md        one Markdown file per written chapter
//
// They're merged into the fundamentals list as extra groups (see userdata.overlay), so the site,
// `kb read`, read status and the tutor all work on them exactly like the built-in chapters.
const fs = require("fs");
const path = require("path");
const core = require("./core/shared");

const slugify = (s) => String(s).toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "topic";
const chapterFile = (dir, i, id) => path.join(dir, `${String(i + 1).padStart(2, "0")}-${id}.md`);

function readMeta(dir) {
  const f = path.join(dir, "library.json");
  if (!fs.existsSync(f)) return null;
  try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch (e) { return null; }
}

// Every library folder, oldest first: [{ slug, dir, meta }]
function all(libDir) {
  if (!fs.existsSync(libDir)) return [];
  return fs.readdirSync(libDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => ({ slug: d.name, dir: path.join(libDir, d.name), meta: readMeta(path.join(libDir, d.name)) }))
    .filter((l) => l.meta && Array.isArray(l.meta.chapters))
    .sort(core.libOrder);
}

// Written chapters of one library: [{ index, ch, file, markdown }]
function written(lib) {
  return lib.meta.chapters.map((ch, i) => {
    const file = chapterFile(lib.dir, i, ch.id);
    return fs.existsSync(file) ? { index: i, ch, file, markdown: fs.readFileSync(file, "utf8") } : null;
  }).filter(Boolean);
}

const { summaryOf } = core;

// Groups to append to fundamentals.json; numbers continue after `start`.
const groups = (libDir, start) => core.libraryGroups(all(libDir).map((lib) => ({ ...lib, chapters: written(lib) })), start);

module.exports = { slugify, chapterFile, readMeta, all, written, groups, summaryOf };
