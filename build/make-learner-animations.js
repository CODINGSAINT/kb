// Optional: render step-by-step animated GIFs for learner figures that define `gif` and `steps`
// in build/learner-figures.json. Each frame is the same Graphviz figure with the active parts
// highlighted and a numbered caption, so a GIF never says more than its static SVG + text.
// Needs Playwright (Chromium) and ffmpeg; the generated GIFs are committed, so ordinary builds skip this.
//   node build/make-learner-animations.js            (all)
//   node build/make-learner-animations.js lld-4-race (one, by gif base name)
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const { execFileSync } = require('node:child_process');
const { dotFor, cleanSvg, loadSpec } = require('./make-learner-figures');
const root = path.resolve(__dirname, '..');
const out = path.join(root, 'public/learning-figures');

async function main() {
  const { instance } = require('@viz-js/viz');
  const { chromium } = require('playwright');
  const only = process.argv[2];
  const viz = await instance();
  const browser = await chromium.launch();
  let built = 0;
  for (const f of loadSpec().figures) {
    if (!f.gif || !f.steps) continue;
    if (only && f.gif.replace(/\.gif$/, '') !== only) continue;
    if (!/^[a-z0-9-]+\.gif$/.test(f.gif)) throw Error(`Bad gif name ${f.gif}`);
    const svgs = f.steps.map((s, i) => cleanSvg(viz.renderString(dotFor(f, s, i, f.steps.length), { format: 'svg', engine: f.engine || 'dot' }), f));
    const size = svgs.map((s) => s.match(/viewBox="[\d.]+ [\d.]+ ([\d.]+) ([\d.]+)"/).slice(1).map(Number));
    const W = Math.ceil(Math.max(...size.map((s) => s[0]))), H = Math.ceil(Math.max(...size.map((s) => s[1])));
    const scale = Math.min(1, 1100 / W);
    const vw = Math.round(W * scale) + 20, vh = Math.round(H * scale) + 20;
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kb-gif-'));
    const page = await browser.newPage({ viewport: { width: vw, height: vh }, deviceScaleFactor: 1 });
    const list = [];
    for (let i = 0; i < svgs.length; i++) {
      const svg = svgs[i].replace(/<svg\b([^>]*)\swidth="[^"]*"\s+height="[^"]*"/, `<svg$1 width="${(size[i][0] * scale).toFixed(0)}" height="${(size[i][1] * scale).toFixed(0)}"`);
      await page.setContent(`<html><body style="margin:0;background:#f7f7fc;display:flex;align-items:flex-start;justify-content:center;width:${vw}px;height:${vh}px;padding-top:10px;box-sizing:border-box">${svg}</body></html>`);
      const frame = path.join(dir, `f${String(i).padStart(3, '0')}.png`);
      await page.screenshot({ path: frame });
      const seconds = f.steps[i].seconds || (i === svgs.length - 1 ? 4 : 2.6);
      list.push(`file '${frame.replace(/\\/g, '/')}'`, `duration ${seconds}`);
    }
    list.push(list[list.length - 2]); // concat demuxer needs the last file repeated to honour its duration
    await page.close();
    const listFile = path.join(dir, 'frames.txt');
    fs.writeFileSync(listFile, list.join('\n') + '\n');
    const target = path.join(out, f.gif);
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', listFile,
      '-vf', 'split[a][b];[a]palettegen=max_colors=96:stats_mode=full[p];[b][p]paletteuse=dither=none', '-loop', '0', target]);
    fs.rmSync(dir, { recursive: true, force: true });
    console.log(`${f.gif}: ${svgs.length} frames, ${(fs.statSync(target).size / 1024).toFixed(0)} KiB`);
    built++;
  }
  await browser.close();
  console.log(`Built ${built} learner animations`);
}
main().catch((e) => { console.error(e); process.exitCode = 1; });
