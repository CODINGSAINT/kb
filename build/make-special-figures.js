// Domain-specific pictures complement the causal walkthrough illustrations.
const fs=require('node:fs'), path=require('node:path');
const out=path.join(__dirname,'../public/lessons');
const write=(name,body)=>fs.writeFileSync(path.join(out,name),body+'\n');
const start=(w,h,title,desc)=>`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-labelledby="title desc"><title id="title">${title}</title><desc id="desc">${desc}</desc><rect width="100%" height="100%" rx="12" fill="#f7f7fc"/><g font-family="Arial,sans-serif" fill="#25213e">`;
let s=start(440,510,'A pinned rook on an actual board','White king e1 is protected by White rook e2 from Black rook e8. Moving the White rook to f2 opens the e-file and is illegal.');
s+='<text x="22" y="28" font-size="18" font-weight="bold">Why Re2-f2 exposes the king</text>';
for(let rank=8;rank>=1;rank--){
  const y=56+(8-rank)*44;
  s+=`<text x="14" y="${y+28}" font-size="14">${rank}</text>`;
  for(let file=0;file<8;file++) s+=`<rect x="${34+file*44}" y="${y}" width="44" height="44" fill="${(file+rank)%2?'#b6b0d0':'#e8e5f4'}"/>`;
}
for(let file=0;file<8;file++)s+=`<text x="${51+file*44}" y="430" font-size="14">${String.fromCharCode(97+file)}</text>`;
const piece=(file,rank,char)=>`<text x="${56+file*44}" y="${90+(8-rank)*44}" text-anchor="middle" font-family="Segoe UI Symbol,DejaVu Sans,sans-serif" font-size="38" fill="#17132e">${char}</text>`;
s+=piece(0,8,'♚')+piece(4,8,'♜')+piece(4,2,'♖')+piece(4,1,'♔');
s+='<path d="M232 105 V302" stroke="#9b2947" stroke-width="4" stroke-dasharray="7 5"/><path d="M232 302 L225 289 M232 302 L239 289" stroke="#9b2947" stroke-width="3"/><path d="M247 342 H288 L280 334 M288 342 L280 350" fill="none" stroke="#2a526d" stroke-width="3"/><text x="22" y="463" font-size="15">The rook blocks the attack while it stays on e2.</text><text x="22" y="488" font-size="15">After moving sideways, its own king is exposed.</text></g></svg>';
write('lld-1-board.svg',s);

s=start(760,510,'URL shortener: separate durable mappings from analytics','Client traffic enters URL services. Services use Redis as a cache and a partition router for durable mapping shards. Replicas copy each shard. Click events go asynchronously to analytics rather than blocking redirects.');
s+='<defs><marker id="a" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0 L10 5 L0 10Z" fill="#514b89"/></marker></defs><text x="22" y="30" font-size="20" font-weight="bold">URL shortener: two paths, different guarantees</text>';
const boxes=[['Clients',25,65],['Routing / LB',255,65],['URL services',485,65],['Redis cache',485,185],['Partition router',255,185],['Click stream',25,185],['Shard 1 primary',255,305],['Shard 2 primary',485,305],['Analytics store',25,305],['Shard 1 replica',255,425],['Shard 2 replica',485,425]];
const edge=(x1,y1,x2,y2,dashed=false)=>`<path d="M${x1} ${y1} L${x2} ${y2}" stroke="#514b89" stroke-width="2" fill="none" ${dashed?'stroke-dasharray="6 4"':''} marker-end="url(#a)"/>`;
s+=edge(205,90,255,90)+edge(435,90,485,90)+edge(575,115,575,185)+edge(500,115,345,185)+edge(490,115,115,185,true)+edge(345,235,345,305)+edge(370,235,575,305)+edge(115,235,115,305)+edge(345,355,345,425,true)+edge(575,355,575,425,true);
for(const [label,x,y] of boxes)s+=`<rect x="${x}" y="${y}" width="180" height="50" rx="9" fill="white" stroke="#b6b0d0"/><text x="${x+90}" y="${y+30}" text-anchor="middle" font-size="16">${label}</text>`;
s+='</g></svg>';write('hld-1-architecture.svg',s);

s=start(440,360,'A token bucket refills over elapsed time','Capacity is five permits and refill is two permits per second. After five immediate requests the bucket is empty. After 1.25 seconds it holds 2.5 permits; two requests leave 0.5, and one further permit is available after another 0.25 seconds.');
s+='<text x="20" y="29" font-size="18" font-weight="bold">Capacity 5; refill 2 permits/second</text>';
const rows=[['Initially: five permits',5],['After five accepted requests',0],['After 1.25 seconds: 2.5 permits',2.5],['After two requests: 0.5 permit',0.5]];
rows.forEach(([label,count],i)=>{
  const y=56+i*72;s+=`<text x="20" y="${y}" font-size="15">${label}</text>`;
  for(let j=0;j<5;j++){s+=`<rect x="${22+j*73}" y="${y+12}" width="60" height="25" rx="5" fill="white" stroke="#b6b0d0"/>`;const part=Math.min(1,Math.max(0,count-j));if(part)s+=`<rect x="${22+j*73}" y="${y+12}" width="${60*part}" height="25" rx="5" fill="#514b89"/>`;}
});s+='</g></svg>';write('lld-14-bucket.svg',s);
console.log('Built chess-board, URL architecture and token-bucket pictures');
