// Render the learner-first figures (class diagrams, state machines and request flows) from
// build/learner-figures.json with pinned Graphviz WASM. Build time only; output is static SVG.
// build/make-learner-animations.js reuses dotFor() to render step-by-step GIFs from the same specs.
//
// Spec kinds:
//   class: { classes:[{name, stereo?, fields:[], methods:[]}], links:[{from,to,label?,kind?}] }
//          kind = has (filled diamond) | uses (dashed arrow) | is (hollow triangle) | assoc (plain arrow)
//   flow:  { nodes:[{id,label,shape?,tone?}], edges:[{from,to,label?,dashed?}], rankdir? }
//          tone = good | bad | note | store (colour only; meaning is always also in the label)
// Optional animation: gif: "name.gif", steps: [{caption, on:[node ids or class names], edges:[[from,to]]}]
const fs = require('node:fs'), path = require('node:path');
const root = path.resolve(__dirname, '..');
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const q = (s) => '"' + String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n') + '"';
const INK = '#25213e', LINE = '#514b89', BORDER = '#b6b0d0', HEAD = '#ece9f8', ACCENT = '#d9480f', DIM = '#c9c6d8';
const TONES = { good: '#e8f6ee', bad: '#fbe6e4', note: '#fff5df', store: '#edf5fa' };

function edgeTone(step, e) {
  if (!step) return {};
  const hot = (step.edges || []).some(([a, b]) => a === e.from && b === e.to);
  return hot ? { color: ACCENT, fontcolor: ACCENT, penwidth: '2.6' } : { color: DIM, fontcolor: DIM };
}

function classDot(f, step) {
  const lines = [];
  const on = new Set(step ? step.on || [] : []);
  for (const c of f.classes) {
    const hot = on.has(c.name), dim = step && !hot;
    const border = hot ? ACCENT : dim ? DIM : BORDER;
    const rows = [`<TR><TD BGCOLOR="${hot ? '#ffe8d9' : HEAD}"><B>${c.stereo ? '&lt;&lt;' + esc(c.stereo) + '&gt;&gt;<BR/>' : ''}${esc(c.name)}</B></TD></TR>`];
    if (c.fields && c.fields.length) rows.push(`<TR><TD ALIGN="LEFT" BALIGN="LEFT">${c.fields.map(esc).join('<BR/>')}</TD></TR>`);
    if (c.methods && c.methods.length) rows.push(`<TR><TD ALIGN="LEFT" BALIGN="LEFT">${c.methods.map(esc).join('<BR/>')}</TD></TR>`);
    lines.push(`${q(c.name)} [shape=plain label=<<TABLE BORDER="${hot ? 3 : 1}" CELLBORDER="1" CELLSPACING="0" CELLPADDING="6" COLOR="${border}" BGCOLOR="#ffffff">${rows.join('')}</TABLE>>];`);
  }
  for (const l of f.links || []) {
    const attrs = { label: l.label || '' };
    if (l.kind === 'has') Object.assign(attrs, { dir: 'back', arrowtail: 'diamond' });
    else if (l.kind === 'is') Object.assign(attrs, { arrowhead: 'onormal' });
    else if (l.kind === 'uses') Object.assign(attrs, { style: 'dashed', arrowhead: 'vee' });
    else Object.assign(attrs, { arrowhead: 'vee' });
    Object.assign(attrs, edgeTone(step, l));
    lines.push(`${q(l.from)} -> ${q(l.to)} [${Object.entries(attrs).map(([k, v]) => `${k}=${q(v)}`).join(' ')}];`);
  }
  return lines;
}

function flowDot(f, step) {
  const lines = [];
  const on = new Set(step ? step.on || [] : []);
  for (const n of f.nodes) {
    const hot = on.has(n.id), dim = step && !hot;
    const fill = TONES[n.tone] || '#ffffff';
    const extra = hot ? ` color="${ACCENT}" penwidth=3` : dim ? ` color="${DIM}" fontcolor="#8a86a3"` : '';
    lines.push(`${q(n.id)} [label=${q(n.label)} shape=${q(n.shape || 'box')} fillcolor=${q(fill)}${extra}];`);
  }
  for (const e of f.edges || []) {
    const attrs = Object.entries(edgeTone(step, e)).map(([k, v]) => ` ${k}=${q(v)}`).join('');
    lines.push(`${q(e.from)} -> ${q(e.to)} [label=${q(e.label || '')}${e.dashed ? ' style="dashed"' : ''}${attrs}];`);
  }
  return lines;
}

// step: optional {caption, on, edges}; index/total number the frame in the caption.
function dotFor(f, step, index, total) {
  const body = f.kind === 'class' ? classDot(f, step) : flowDot(f, step);
  const heading = f.heading || f.title;
  const label = step ? `${heading}\n\nStep ${index + 1} of ${total}: ${step.caption}` : heading;
  return `digraph G {
      graph [rankdir=${f.rankdir || (f.kind === 'class' ? 'TB' : 'LR')} bgcolor="#f7f7fc" pad=0.3 nodesep=0.45 ranksep=0.5 fontname="Arial" fontsize=18 fontcolor="${INK}" label=${q(label)} labelloc=t];
      node [fontname="Arial" fontsize=14 fontcolor="${INK}" color="${BORDER}" style="rounded,filled" margin="0.18,0.1"];
      edge [fontname="Arial" fontsize=12 color="${LINE}" fontcolor="${LINE}" arrowsize=0.7];
      ${body.join('\n      ')}
    }`;
}

function cleanSvg(svg, f) {
  svg = svg.replace(/<\?xml[^>]*>\s*/, '').replace(/<!DOCTYPE[\s\S]*?>\s*/, '').replace(/<!--[\s\S]*?-->\s*/g, '');
  svg = svg.replace(/\s+xmlns:xlink="[^"]*"/, '');
  if (/xlink:/.test(svg)) throw Error(`${f.file}: unexpected link content`);
  return svg;
}

function loadSpec() {
  return JSON.parse(fs.readFileSync(path.join(__dirname, 'learner-figures.json'), 'utf8'));
}

async function main() {
  const { instance } = require('@viz-js/viz');
  const out = path.join(root, 'public/learning-figures');
  const spec = loadSpec();
  fs.mkdirSync(out, { recursive: true });
  const viz = await instance();
  for (const f of spec.figures) {
    if (!/^[a-z0-9-]+\.svg$/.test(f.file)) throw Error(`Bad figure name ${f.file}`);
    if (!f.title || !f.desc || f.desc.length < 40) throw Error(`${f.file}: title and a full text description are required`);
    let svg = cleanSvg(viz.renderString(dotFor(f), { format: 'svg', engine: f.engine || 'dot' }), f);
    const id = f.file.replace(/\.svg$/, '');
    svg = svg.replace(/<svg\b[^>]*>/, (m) => m.slice(0, -1) + ` role="img" aria-labelledby="${id}-title ${id}-desc"><title id="${id}-title">${esc(f.title)}</title><desc id="${id}-desc">${esc(f.desc)}</desc>`);
    if (/<script|foreignObject|onload=/i.test(svg) || /https?:\/\//.test(svg.replace('http://www.w3.org/2000/svg', ''))) throw Error(`${f.file}: active or remote content`);
    fs.writeFileSync(path.join(out, f.file), svg.trim() + '\n');
  }
  console.log(`Built ${spec.figures.length} learner figures with Graphviz ${viz.graphvizVersion}`);
}

module.exports = { dotFor, cleanSvg, loadSpec };
if (require.main === module) main().catch((e) => { console.error(e); process.exitCode = 1; });
