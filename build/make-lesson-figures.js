// Deterministic, dependency-free SVG illustrations from authored cause/effect steps.
const fs = require('node:fs');
const path = require('node:path');
const figures = require('./lesson-figures.json');
const out = path.join(__dirname, '../public/lessons');
fs.mkdirSync(out, {recursive:true});
const esc = s => s.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function wrap(s, max) {
  const lines=[];
  for(const word of s.split(/\s+/)) {
    if(!lines.length || lines.at(-1).length+1+word.length>max) lines.push(word);
    else lines[lines.length-1]+=' '+word;
  }
  return lines;
}
const seen=new Set();
for(const f of figures) {
  if(!/^(lld|hld|ai)-\d+-(flow|failure)\.svg$/.test(f.file) || seen.has(f.file)) throw Error('Invalid/duplicate figure filename');
  seen.add(f.file);
  if(f.steps.length<3 || f.steps.length>6) throw Error('Figure needs 3–6 causal steps');
  const height=110+f.steps.length*108;
  const svg=[`<svg xmlns="http://www.w3.org/2000/svg" width="440" height="${height}" viewBox="0 0 440 ${height}" role="img" aria-labelledby="title desc">`,
    `<title id="title">${esc(f.title)}</title><desc id="desc">${esc(f.description)} Steps: ${esc(f.steps.join('; '))}</desc>`,
    '<defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0 L10 5 L0 10Z" fill="#514b89"/></marker></defs>',
    '<rect width="440" height="100%" rx="18" fill="#f7f7fc"/>'];
  const titleLines=wrap(f.title,38);
  if(titleLines.length>2) throw Error(`${f.file}: title too long`);
  titleLines.forEach((line,j)=>svg.push(`<text x="24" y="${32+j*23}" fill="#25213e" font-family="Arial,sans-serif" font-size="19" font-weight="700">${esc(line)}</text>`));
  f.steps.forEach((step,i)=>{
    const y=88+i*108, lines=wrap(step,43);
    if(lines.length>3) throw Error(`${f.file}: step too long`);
    if(i) svg.push(`<path d="M220 ${y-24} V${y-5}" stroke="#514b89" stroke-width="2" marker-end="url(#arrow)"/>`);
    svg.push(`<rect x="18" y="${y}" width="404" height="80" rx="12" fill="white" stroke="#cac7df"/>`,
      `<circle cx="44" cy="${y+40}" r="15" fill="#30285e"/>`,
      `<text x="44" y="${y+45}" text-anchor="middle" fill="white" font-family="Arial,sans-serif" font-size="15">${i+1}</text>`);
    lines.forEach((line,j)=>svg.push(`<text x="70" y="${y+24+j*20}" fill="#25213e" font-family="Arial,sans-serif" font-size="15">${esc(line)}</text>`));
  });
  svg.push('</svg>');
  fs.writeFileSync(path.join(out,f.file), svg.join('\n')+'\n');
}
if(seen.size!==120) throw Error('Expected two authored figures for each of 60 lessons');
console.log(`Built ${seen.size} accessible lesson figures`);
