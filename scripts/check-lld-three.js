// Verify that the three answers publish the implementation actually exercised by Java checks.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),read=p=>fs.readFileSync(path.join(root,p),'utf8').replace(/\r\n/g,'\n');
const lessons=[['Chess',1,['values','legal','attacks','apply','game'],'chess'],['Parking',2,['values','tariff','enter','payment','exit'],'parking'],['Elevators',3,['contracts','look','tick','dispatch','ownership'],'elevator']];
let excerpts=0;
for(const [file,n,regions,prefix]of lessons){
  const topic=JSON.parse(read(`content/day-${String(n).padStart(2,'0')}.json`)).topics.find(t=>t.category==='LLD');
  const source=read(`examples/lld-three/${file}.java`);
  const snippets=[...topic.markdown.matchAll(/```java\n\/\/ source: (\w+\.java)#(\w+)\n([\s\S]*?)\n```/g)];
  assert.equal(snippets.length,regions.length,`${file}: all five mechanism excerpts required`);
  assert.deepEqual(snippets.map(m=>m[2]).sort(),[...regions].sort(),`${file}: expected regions`);
  for(const [,name,region,snippet]of snippets){
    assert.equal(name,file+'.java');
    const match=source.match(new RegExp('^\\s*// region:'+region+'\\s*\\n([\\s\\S]*?)^\\s*// endregion:'+region+'\\s*$','m'));
    assert(match,`${file}#${region} absent`);
    assert.equal(snippet,match[1].trimEnd(),`${file}#${region}: article differs from executable source`);excerpts++;
  }
  const figures=[...topic.markdown.matchAll(/!\[[^\]]+\]\((lld-figures\/[^)]+\.svg)\)/g)].map(m=>m[1]);
  assert.equal(new Set(figures).size,5,`${file}: domain and four worked illustrations`);
  assert(figures.every(f=>f.startsWith(`lld-figures/${prefix}-`)),`${file}: mismatched assets`);
  assert(!/\{\{java:/.test(topic.markdown),`${file}: unresolved manuscript token`);
  for(const f of figures)assert(fs.existsSync(path.join(root,'public',f)),`missing ${f}`);
  assert.equal(read(`public/reference-code/lld-three/${file}.java`),source,`${file}: download drift`);
}
for(const f of ['ThreeChecks.java','README.md'])assert.equal(read(`public/reference-code/lld-three/${f}`),read(`examples/lld-three/${f}`),`${f}: download drift`);
assert.equal(fs.readdirSync(path.join(root,'public/lld-figures')).filter(f=>f.endsWith('.svg')).length,15);
console.log(`PASS: ${excerpts} article excerpts equal executable Java source; 15 original figures and all public source downloads present and current.`);
