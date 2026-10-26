// Integrity checks for authored references, generated JSON, prerequisite links and public content.
const fs = require('fs');
const path = require('path');
const assert = require('assert/strict');
const root = path.resolve(__dirname, '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');
const personal = new Set(['userAnswer','answerEvaluation','answerEvaluatedAt','notes','chat','readAt']);
function noPersonal(value, where) {
  if (!value || typeof value !== 'object') return;
  for (const [k,v] of Object.entries(value)) {
    assert(!personal.has(k), `${where}.${k}: personal field in shared material`);
    noPersonal(v, `${where}.${k}`);
  }
}
const authored = new Map();
for (const file of fs.readdirSync(path.join(root,'build/topics')).filter(f=>f.endsWith('.txt'))) {
  const parts=read(`build/topics/${file}`).split(/^=== (LLD|HLD|AI) (\d+) ===\s*$/m);
  for(let i=1;i<parts.length;i+=3){
    const key=`${parts[i]}-${Number(parts[i+1])}`;
    assert(!authored.has(key),`duplicate ${key}`);
    const separator=parts[i+2].indexOf('\n---\n');
    assert(separator>=0,`missing separator ${key}`);
    authored.set(key,parts[i+2].slice(separator+5).trim()+'\n');
  }
}
assert.equal(authored.size,60,'every topic, including day 1, needs authored source');
const topics = new Map(), metrics = {LLD:[],HLD:[],AI:[]};
for(let day=1;day<=20;day++){
  const file=`content/day-${String(day).padStart(2,'0')}.json`;
  const doc=JSON.parse(read(file));
  noPersonal(doc,file);
  assert.equal(doc.topics.length,3);
  for(const t of doc.topics){
    const key=`${t.category}-${t.number}`;
    assert.equal(t.number,day);
    assert(!topics.has(key),`duplicate generated topic ${key}`);
    topics.set(key,t);
    assert.equal(t.markdown,authored.get(key),`${key} differs from authored source`);
    const headings=[...t.markdown.matchAll(/^## (.+)$/gm)].map(m=>m[1]);
    assert(/^Problem/i.test(headings[0]),`${key}: missing initial Problem`);
    assert(/^Requirements/i.test(headings[1]),`${key}: missing initial Requirements`);
    const sections=t.markdown.split(/^(?=## )/m).filter(Boolean);
    const reference=sections.filter(s=>!/^## (problem|requirements)/i.test(s)).join('\n');
    const words=reference.split(/\s+/).filter(Boolean).length;
    // A padded manuscript passed the previous 1,500-word gate. Verify the authored
    // teaching contract and duplication instead; this still needs editorial review.
    assert(words>=600,`${key}: unexpectedly abbreviated reference (${words} words)`);
    assert(headings.some(h=>/^1\. /.test(h)),`${key}: missing chosen solution`);
    assert(headings.some(h=>/^2\. /.test(h)),`${key}: missing concrete contracts`);
    assert(headings.includes('6. Interviewer follow-ups'),`${key}: missing answered follow-ups`);
    assert(headings.includes('7. Closing answer'),`${key}: missing final position`);
    assert(!/Learn through a concrete example|Practise, then check your reasoning|\*\*Build:\*\*|\*\*Lab:\*\*/.test(reference),`${key}: tutorial assignment remains`);
    const design=`designs/${t.category.toLowerCase()}-${t.number}.svg`;
    assert(reference.includes(`](${design})`),`${key}: missing selected-design picture`);
    const designSvg=read(`public/${design}`);
    assert(designSvg.includes('<title')&&designSvg.includes('<desc'),`${key}: inaccessible selected-design SVG`);
    assert(!/<script|foreignObject|onload=/i.test(designSvg),`${key}: active SVG`);
    const pictures=[...reference.matchAll(/!\[([^\]]+)\]\(((?:lessons|lld-figures|learning-figures)\/[^)]+\.svg)\)/g)];
    assert(pictures.length>=2,`${key}: needs operation and failure pictures`);
    for(const [,alt,url] of pictures){
      assert(alt.length>=30,`${key}: inadequate diagram text alternative`);
      const svg=read(`public/${url}`);
      assert(svg.includes('<title') && svg.includes('<desc'),`${key}: inaccessible SVG ${url}`);
      assert(!/<script|foreignObject|onload=|https?:\/\//i.test(svg.replace('http://www.w3.org/2000/svg','')),`${key}: active or remote SVG content`);
    }
    assert(/```/.test(reference),`${key}: missing concrete code/data/flow example`);
    assert(/(failure|race|recovery|reject|illegal|unavailable)/i.test(reference),`${key}: no failure treatment`);
    assert(/(contract|transaction|algorithm|execution|\benter\b|\bpay\b|\bconfirmExit\b|\bplay\b|\btick\b)/i.test(reference),`${key}: no concrete operation`);
    // A lesson can link its own complete source; external course links are not a quality requirement.
    assert(/https:\/\/|reference-code\//.test(reference),`${key}: no source links`);
    assert.equal((t.markdown.match(/^```/gm)||[]).length%2,0,`${key}: unclosed code fence`);
    const nodes=t.diagram.nodes, ids=new Set(nodes.map(n=>n.id));
    assert(nodes.length>=4 && nodes.length<=7,`${key}: diagram size`);
    assert.equal(ids.size,nodes.length,`${key}: duplicate node ID`);
    for(const e of t.diagram.edges) assert(ids.has(e.from)&&ids.has(e.to),`${key}: invalid edge`);
    metrics[t.category].push(words);
  }
}
const paragraphs=new Map();
for(const [key,t] of topics) {
  for(const p of t.markdown.split(/\n\s*\n/).map(p=>p.trim())) {
    if(p.split(/\s+/).length<35 || /^(?:#|```|\||- )/.test(p)) continue;
    if(!paragraphs.has(p)) paragraphs.set(p,new Set());
    paragraphs.get(p).add(key);
  }
}
for(const [p,owners] of paragraphs)
  assert(owners.size<10,`Repeated teaching prose in ${owners.size} lessons: ${p.slice(0,100)}`);
const fund=JSON.parse(read('content/fundamentals.json'));
noPersonal(fund,'fundamentals');
const items=fund.groups.flatMap(g=>g.items), byId=new Map(items.map(i=>[i.id,i]));
assert.equal(byId.size,items.length,'duplicate fundamental');
assert.equal(items.length,45);
assert.equal(fund.groups.find(g=>g.track==='AI').items.length,10);
for(const [key,ids] of Object.entries(fund.prereqs)){
  assert(topics.has(key),`unknown prerequisite target ${key}`);
  for(const id of ids){
    assert(byId.has(id),`unknown fundamental ${id}`);
    assert(byId.get(id).usedBy.some(u=>u.key===key),`missing reverse link ${id}->${key}`);
  }
}
for(const item of items){
  for(const u of item.usedBy) assert(fund.prereqs[u.key].includes(item.id),`stale reverse link ${item.id}`);
  assert.equal((item.markdown.match(/^```/gm)||[]).length%2,0,`${item.id}: code fence`);
}
const dsa=JSON.parse(read('content/dsa.json'));
assert.equal(dsa.topics.reduce((s,t)=>s+t.problems.length,0),304);
for(const [track,words] of Object.entries(metrics))
  console.log(`${track}: ${words.length} references, ${Math.min(...words)}-${Math.max(...words)} reference words`);
console.log('PASS: 60 source/generated model answers, selected-design and operation figures, answered follow-ups, no widely repeated long prose, valid topic diagrams, 45 chapters, reciprocal prerequisites, 304 DSA problems, no personal fields');
