// Render final answer topologies with pinned Graphviz WASM. Build time only.
const fs=require('node:fs'),path=require('node:path');
const {instance}=require('@viz-js/viz');
const root=path.resolve(__dirname,'..'),out=path.join(root,'public/designs');
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
async function main(){
  fs.mkdirSync(out,{recursive:true});
  const viz=await instance();let count=0;
  for(let day=1;day<=20;day++)for(const t of JSON.parse(fs.readFileSync(path.join(root,`content/day-${String(day).padStart(2,'0')}.json`),'utf8')).topics){
    if(!t.markdown.includes('](designs/'))throw Error('Missing model-answer manuscript');
    const desc=t.diagram.edges.map(e=>`${t.diagram.nodes.find(n=>n.id===e.from).label} ${e.label} ${t.diagram.nodes.find(n=>n.id===e.to).label}`).join('; ');
    const graph={name:'SelectedDesign',directed:true,
      graphAttributes:{rankdir:'TB',bgcolor:'#f7f7fc',pad:0.3,nodesep:0.5,ranksep:0.55,splines:'spline',label:t.title,labelloc:'t',fontname:'Arial',fontsize:19,fontcolor:'#25213e'},
      nodeAttributes:{shape:'box',style:'rounded,filled',fillcolor:'#ffffff',color:'#b6b0d0',fontname:'Arial',fontsize:15,fontcolor:'#25213e',margin:'0.18,0.12'},
      edgeAttributes:{color:'#514b89',fontcolor:'#514b89',fontname:'Arial',fontsize:12,arrowsize:0.7},
      nodes:t.diagram.nodes.map(n=>({name:n.id,attributes:{label:n.label}})),
      edges:t.diagram.edges.map(e=>({tail:e.from,head:e.to,attributes:{label:e.label||''}}))};
    let svg=viz.renderString(graph,{format:'svg',engine:'dot'});
    svg=svg.replace(/<\?xml[^>]*>\s*/,'').replace(/<!DOCTYPE[\s\S]*?>\s*/,'');
    svg=svg.replace(/<svg\b[^>]*>/,m=>m.slice(0,-1)+' role="img" aria-labelledby="answer-title answer-desc">'+`<title id="answer-title">${esc(t.title)}: selected design</title><desc id="answer-desc">${esc(desc)}</desc>`);
    if(/<script|foreignObject|onload=/.test(svg))throw Error('Unexpected active SVG content');
    fs.writeFileSync(path.join(out,`${t.category.toLowerCase()}-${t.number}.svg`),svg.trim()+'\n');count++;
  }
  console.log(`Built ${count} selected-design SVGs with Graphviz ${viz.graphvizVersion}`);
}
main().catch(e=>{console.error(e);process.exitCode=1;});
