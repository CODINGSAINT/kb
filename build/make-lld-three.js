// Original, code-native illustrations for the three worked LLD answers.
// No browser-time dependencies or generated raster text. Java downloads mirror the tested sources.
const fs = require('node:fs');
const path = require('node:path');
const {instance} = require('@viz-js/viz');
const root = path.resolve(__dirname, '..');
const out = path.join(root, 'public/lld-figures');
const P = {ink:'#252044', muted:'#625d7b', violet:'#6550c5', pale:'#eeeafa', teal:'#12786c', green:'#e1f3ed', amber:'#9b5b0a', sand:'#fff1d9', line:'#d8d2e9', white:'#ffffff', bg:'#f8f7fc'};
const esc = s => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const text = (x,y,s,size=22,color=P.ink,anchor='start',weight=400) => `<text x="${x}" y="${y}" font-size="${size}" fill="${color}" text-anchor="${anchor}" font-weight="${weight}">${esc(s)}</text>`;
const lines = (x,y,a,size=22,color=P.ink,gap=32) => a.map((s,i)=>text(x,y+i*gap,s,size,color)).join('');
const rect = (x,y,w,h,fill=P.white,stroke=P.line,r=16) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="${fill}" stroke="${stroke}" stroke-width="2"/>`;
const line = (x1,y1,x2,y2,color=P.line,width=2,dash='') => `<path d="M${x1},${y1} L${x2},${y2}" fill="none" stroke="${color}" stroke-width="${width}"${dash?` stroke-dasharray="${dash}"`:''}/>`;
const arrow = (x1,y1,x2,y2,color=P.violet,dash='') => `<path d="M${x1},${y1} L${x2},${y2}" fill="none" stroke="${color}" stroke-width="3" marker-end="url(#${color===P.teal?'teal':color===P.amber?'amber':'violet'})"${dash?` stroke-dasharray="${dash}"`:''}/>`;
const route = (d,color=P.violet,dash='') => `<path d="${d}" fill="none" stroke="${color}" stroke-width="3" marker-end="url(#${color===P.teal?'teal':color===P.amber?'amber':'violet'})"${dash?` stroke-dasharray="${dash}"`:''}/>`;
const pill=(x,y,w,s,fill=P.pale,color=P.violet)=>rect(x,y,w,38,fill,fill,19)+text(x+w/2,y+26,s,19,color,'middle',700);
const dot=(x,y,n,color=P.violet)=>`<circle cx="${x}" cy="${y}" r="19" fill="${color}"/>`+text(x,y+7,n,21,P.white,'middle',700);
const card=(x,y,w,h,title,a,fill=P.white)=>rect(x,y,w,h,fill)+text(x+22,y+36,title,23,P.ink,'start',700)+lines(x+22,y+74,a,21,P.muted,31);
function write(name,title,desc,w,h,body,subtitle=''){
  const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-labelledby="fig-title fig-desc">
<title id="fig-title">${esc(title)}</title><desc id="fig-desc">${esc(desc)}</desc>
<defs>${[['violet',P.violet],['teal',P.teal],['amber',P.amber]].map(([id,c])=>`<marker id="${id}" markerWidth="9" markerHeight="9" refX="8" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 Z" fill="${c}"/></marker>`).join('')}</defs>
<g font-family="Arial, 'Segoe UI', sans-serif">${rect(1,1,w-2,h-2,P.bg,P.line,22)}${text(44,54,title,30,P.ink,'start',700)}${text(44,89,subtitle,20,P.muted)}${body}${line(44,h-48,w-44,h-48)}${text(44,h-20,'CODING SAINT / KB · Original worked reference · Java 21',16,P.muted)}</g></svg>\n`;
  fs.writeFileSync(path.join(out,name+'.svg'),svg);
}
const glyph={K:'♔',Q:'♕',R:'♖',B:'♗',N:'♘',P:'♙',k:'♚',q:'♛',r:'♜',b:'♝',n:'♞',p:'♟'};
function board(x,y,size,pieces,marks={},moves=[]){
  const cell=size/8;let s=rect(x-3,y-3,size+6,size+6,P.white,P.line,3);
  const pt=sq=>[x+(sq.charCodeAt(0)-97+.5)*cell,y+(8-Number(sq[1])+.5)*cell];
  for(let r=0;r<8;r++)for(let f=0;f<8;f++){
    const sq=String.fromCharCode(97+f)+(8-r),color=marks[sq]||((r+f)%2?'#b8acd8':'#f2edf9');
    s+=`<rect x="${x+f*cell}" y="${y+r*cell}" width="${cell}" height="${cell}" fill="${color}"/>`;
  }
  for(let n=0;n<8;n++)s+=text(x+(n+.5)*cell,y+size+27,String.fromCharCode(97+n),18,P.muted,'middle')+text(x-18,y+(n+.5)*cell+6,8-n,18,P.muted,'middle');
  for(const [sq,p]of Object.entries(pieces)){const [px,py]=pt(sq);s+=`<text x="${px}" y="${py+cell*.29}" text-anchor="middle" font-family="'Segoe UI Symbol', 'DejaVu Sans', serif" font-size="${cell*.78}" fill="${P.ink}">${glyph[p]}</text>`;}
  for(const [a,b,c=P.teal]of moves){const [ax,ay]=pt(a),[bx,by]=pt(b);s+=arrow(ax,ay,bx,by,c);}
  return s;
}
function chess(){
  const initial={};'rnbqkbnr'.split('').forEach((p,f)=>{const file=String.fromCharCode(97+f);initial[file+'8']=p;initial[file+'7']='p';initial[file+'2']='P';initial[file+'1']=p.toUpperCase();});delete initial.e2;initial.e4='P';
  write('chess-position','A position is more than its 64 squares','Position after e2-e4. Black to move, all castling rights retained, e3 en-passant target, halfmove zero and fullmove one.',1200,760,
    board(84,155,464,initial,{e2:'#c7e9dd',e3:'#fff0b7',e4:'#a9dbc9'},[['e2','e4']])+pill(660,151,360,'SNAPSHOT AFTER e2 → e4')+
    card(660,214,460,180,'Board + side to move',['32 pieces on the board','Black moves next','Move command does not own the board'])+
    card(660,416,460,230,'Rule state that must travel with it',['Castling: K Q k q','En-passant target: e3 (one reply only)','Halfmove clock: 0 · fullmove: 1','Immutable copy → safe trial and exact undo'])+text(84,680,'e3 is a target square, not a piece.',21,P.muted),
    'Same piece placement can have different legal moves when rule state differs.');
  const pin={e1:'K',e2:'R',e8:'r',a8:'k'},after={e1:'K',f2:'R',e8:'r',a8:'k'};
  write('chess-pin','Geometry can be valid while the move is illegal','A white rook shields its king on the e-file. Moving e2-f2 is geometrically valid but exposes the king to the black rook on e8.',1200,760,
    pill(84,126,400,'CURRENT POSITION',P.green,P.teal)+pill(708,126,400,'TRIAL: Re2 → f2',P.sand,P.amber)+
    board(92,186,384,pin,{e1:'#fce6b9',e2:'#c7e9dd'},[['e8','e2',P.amber]])+
    board(716,186,384,after,{e1:'#fce6b9',e2:'#fff1cf',f2:'#fce6b9'},[['e8','e1',P.amber]])+
    arrow(520,369,660,369)+text(590,344,'trial',22,P.violet,'middle',700)+
    card(80,628,1030,70,'Reject the trial; keep the original position unchanged.',[],P.white),
    'Legality = candidate movement + complete transition + own-king safety.');
  write('chess-castling','Castling must also survive the transit square','Black rook f8 attacks f1. White king e1 and destination g1 are not attacked, but castling crosses f1 and is illegal.',1200,760,
    board(84,168,448,{e1:'K',h1:'R',a8:'k',f8:'r'},{e1:'#c7e9dd',f1:'#fce6b9',g1:'#c7e9dd'},[['f8','f1',P.amber],['e1','g1']])+
    card(628,164,490,186,'Checking only e1 and g1 misses this',['1 · Start e1: safe','2 · Cross f1: attacked → reject','3 · Destination g1: safe is insufficient'])+
    card(628,376,490,260,'Other castling conditions',['The right still exists; rook is present.','The path is empty.','Test transit with the king moved.','Move king and rook in the final trial.','Then check the final king position.']),
    'One legal command moves two pieces; king safety applies along the route.');
  const ep={a8:'k',h5:'K',g5:'P',f5:'p',a5:'r'},epTrial={a8:'k',h5:'K',f6:'P',a5:'r'};
  write('chess-en-passant','En passant can expose a horizontal attack','Before: a5 rook is blocked by pawns f5 and g5. Trial g5xf6 en passant removes both blockers and exposes king h5; reject.',1200,800,
    pill(84,126,400,'BEFORE: target f6',P.green,P.teal)+pill(708,126,400,'TRIAL: g5 × f6 e.p.',P.sand,P.amber)+
    board(92,186,384,ep,{f5:'#fce6b9',g5:'#c7e9dd',f6:'#fff1cf'},[['g5','f6']])+
    board(716,186,384,epTrial,{f5:'#fce6b9',g5:'#fce6b9',h5:'#fce6b9',f6:'#c7e9dd'},[['a5','h5',P.amber]])+
    arrow(520,369,660,369)+text(590,344,'apply',22,P.violet,'middle',700)+
    card(80,630,1030,112,'The captured pawn is on f5, not the destination f6.',['Removing the correct captured square before checking attacks is essential.']),
    'A correct trial applies every side effect before asking whether the king is attacked.');
}
function carIcon(x,y,color=P.violet){return rect(x,y+10,76,33,color,color,9)+rect(x+17,y,42,21,color,color,8)+`<circle cx="${x+17}" cy="${y+46}" r="8" fill="${P.ink}"/><circle cx="${x+59}" cy="${y+46}" r="8" fill="${P.ink}"/>`;}
function parking(){
  let layout=rect(236,142,900,252,P.white)+text(260,178,'FLOOR 0 · one compact spot was available',23,P.ink,'start',700)+
    rect(236,430,900,224,P.white)+text(260,466,'FLOOR 1 · allocation considers compatibility first',23,P.ink,'start',700);
  const slots=[['C17',278,200,'COMPACT','S17 owns it',true],['C18',488,200,'COMPACT','occupied',true],['L01',698,200,'LARGE','available',false],['M01',908,200,'MOTORCYCLE','available',false],['C21',278,486,'COMPACT','disabled',false],['C22',488,486,'COMPACT','occupied',true],['L11',698,486,'LARGE','available',false],['M11',908,486,'MOTORCYCLE','available',false]];
  for(const [id,x,y,kind,state,busy]of slots){layout+=rect(x,y,180,130,busy?P.pale:state==='disabled'?'#ecebf0':P.green)+text(x+13,y+26,id,23,P.ink,'start',700)+text(x+13,y+52,kind,15,P.muted)+text(x+13,y+112,state,19,busy?P.violet:P.muted);if(busy)layout+=carIcon(x+88,y+25,id==='C17'?P.teal:P.violet);}
  layout+=line(260,356,1110,356,'#b3aec8',4,'18 12')+arrow(280,356,1060,356,P.teal)+
    card(38,177,160,90,'Gate A',[],P.green)+text(62,243,'claim wins',19,P.teal)+card(38,300,160,90,'Gate B',[],P.sand)+text(62,366,'rechecks',19,P.amber)+
    arrow(198,222,272,247,P.teal)+route('M198,345 L218,345 L218,282 L272,282',P.amber)+
    pill(252,682,870,'The live claim C17 → S17 is authoritative; a display count is only a view.');
  write('parking-layout','A parking lot is physical space plus ownership','Two gates contend for compact spot C17. A serialized claim gives it to visit S17; the second gate rechecks availability. Other bays illustrate occupied, disabled and compatible spaces.',1200,790,layout,
    'Two gates may see the same old “1 spot free” display; only one claim can succeed.');
  write('parking-race','Two gates, one last compatible spot','Gate A checks and records spot C17 ownership in one critical section. Gate B waits and rechecks after A commits; it cannot claim the same spot.',1200,810,
    pill(84,137,310,'GATE A',P.green,P.teal)+pill(810,137,310,'GATE B',P.sand,P.amber)+
    line(239,190,239,622,P.teal,3)+line(965,190,965,622,P.amber,3)+
    card(390,200,414,113,'One short lot monitor',['A selects C17 → installs visit S17'],P.green)+
    arrow(239,247,386,247,P.teal)+arrow(965,247,810,247,P.amber)+text(889,225,'wait',21,P.amber,'middle')+
    card(390,353,414,113,'Ownership is now C17 → S17',['Session, active plate and entry key agree'])+
    arrow(596,316,596,346,P.teal)+arrow(390,416,239,416,P.teal)+text(78,448,'A returns the same visit on retry',20,P.teal)+
    card(390,511,414,102,'B enters and rechecks',['No compatible free spot → reject'],P.sand)+
    arrow(965,557,810,557,P.amber)+arrow(804,591,965,591,P.amber)+
    card(84,653,1036,82,'Selection and claim are one transaction, not two separately locked getters.',[],P.white),
    'The same boundary owns all indexes needed to create a visit. No display or payment call runs here.');
  let sequence=pill(60,139,300,'LOT STATE OWNER')+pill(450,139,300,'PAYMENT PROVIDER',P.sand,P.amber)+pill(840,139,300,'ANOTHER GATE',P.green,P.teal);
  for(const x of[210,600,990])sequence+=line(x,195,x,565,P.line,3,'8 8');
  sequence+=rect(190,210,40,80,P.pale)+text(64,204,'1 · reserve attempt',20,P.violet)+arrow(230,258,590,258)+text(410,240,'charge(stable key, approved amount)',18,P.violet,'middle')+
    rect(580,258,40,220,P.sand)+text(632,320,'Slow I/O',21,P.amber)+text(632,348,'no lot lock held',19,P.amber)+
    arrow(990,375,230,375,P.teal)+text(825,400,'entry still progresses',20,P.teal,'middle')+rect(190,358,40,62,P.green)+arrow(230,420,990,420,P.teal)+
    arrow(580,495,230,495,P.amber)+text(410,477,'confirmed / declined / unknown',18,P.amber,'middle')+rect(190,495,40,60,P.pale)+text(64,590,'3 · apply once',20,P.violet)+
    text(62,653,'A timeout is not a decline.',26,P.ink,'start',700)+
    pill(60,691,180,'PARKED')+pill(310,691,190,'PENDING')+pill(590,691,190,'UNKNOWN',P.sand,P.amber)+pill(930,691,190,'PAID',P.green,P.teal)+
    arrow(244,710,306,710)+arrow(504,710,586,710,P.amber)+arrow(784,710,926,710,P.teal)+text(855,691,'lookup key',17,P.teal,'middle')+
    text(60,784,'Unknown outcome: keep the spot occupied, block a new payment key, reconcile the original key.',21,P.muted);
  write('parking-payment','Release the lock, not the parking spot','Payment reserves an attempt under a short lock, calls the provider without that lock, and applies a terminal result once. Another entry progresses during provider I/O. Unknown charges are reconciled by the original key.',1200,870,sequence,
    'The payment adapter must preserve idempotency and distinguish uncertainty from a known decline.');
  write('parking-fees','Grace time and paid credit are separate rules','A visit enters at 09:00, pays 40 rupees at 09:59 and has grace until 10:09. At 10:01 no extra fee is due. At 10:10 total tariff is 60, previous credit is 40 and additional due is 20 rupees.',1200,780,
    card(60,142,320,170,'09:00 · enter',['Tariff frozen: first hour ₹40','Each extra started hour ₹20','Money stored as integer paise'])+
    card(440,142,320,170,'09:59 · confirmed payment',['Total ₹40 · credit ₹40','exitBy = 10:09','Spot remains occupied'],P.green)+
    card(820,142,320,170,'10:10 · grace has expired',['Tariff total = ₹60','Already paid = ₹40','New payment due = ₹20'],P.sand)+
    arrow(384,226,434,226,P.teal)+arrow(764,226,814,226,P.amber)+
    line(100,401,1100,401,P.violet,5)+rect(450,373,450,56,P.green,P.green,10)+text(675,409,'paid exit grace',22,P.teal,'middle',700)+
    [ [100,'09:00'],[450,'09:59'],[610,'10:01'],[900,'10:09'],[1100,'10:10'] ].map(([x,t])=>`<circle cx="${x}" cy="401" r="7" fill="${P.violet}"/>`+text(x,459,t,20,P.muted,'middle')).join('')+
    card(60,510,510,163,'Exit at 10:01 → covered',['Do not charge just because hour two began.','Inside the valid grace: due = 0.','Only physical exit closes the visit.'],P.green)+
    card(620,510,520,163,'Pay at 10:10 → top up the difference',['due = max(0, total − paid) = ₹20','Never bill the whole ₹60 a second time.','Retrying the old key does not renew grace.'],P.sand)+
    text(60,711,'Event spacing is illustrative; the implementation compares exact Instants and Durations.',19,P.muted),
    'First hour includes its exact endpoint. Any positive time beyond it starts an extra hour.');
}
function elevators(){
  let building=rect(110,135,630,564,P.white);
  for(let f=0;f<10;f++){const y=645-f*52;building+=line(136,y+22,714,y+22,P.line)+text(150,y+8,String(f),22,P.muted);}
  building+=rect(232,153,140,518,'#eeebf5',P.line,0)+rect(476,153,140,518,'#eeebf5',P.line,0)+
    rect(244,623,116,44,P.violet,P.violet,6)+text(302,654,'A · 0',25,P.white,'middle',700)+
    rect(488,467,116,44,P.amber,P.amber,6)+text(546,498,'B · 3',25,P.white,'middle',700)+
    arrow(398,645,398,541,P.teal)+arrow(645,489,645,593,P.amber)+
    [3,6].map(f=>pill(235,645-f*52-17,134,'cabin '+f)).join('')+pill(480,645-52-17,132,'cabin 1',P.sand,P.amber)+
    arrow(760,555,760,518,P.teal)+text(760,595,'2 ↑',26,P.teal,'middle',700)+
    card(836,154,320,190,'A · farther, serving Up',['0 → 1 → 2','OPENING → OPEN','Pickup: 4 model ticks'],P.green)+
    card(836,375,320,250,'B · closer, serving Down',['3 → 2 → 1','Open, dwell and close','1 → 2, then open','Pickup: 9 model ticks'],P.sand)+
    text(110,739,'A tick is one floor/door event in this model. These numbers are not seconds.',21,P.muted);
  write('elevator-building','Nearest car does not mean earliest pickup','Car A starts at zero with cabin stops three and six. Car B starts at three heading toward cabin stop one. A hall Up request at two is served in four modeled events by A or nine by B.',1240,805,building,
    'Known-plan replay uses the same directional sweep and door rules as execution.');
  let sweep=rect(330,140,420,560,P.white);
  for(let f=0;f<10;f++){const y=650-f*52;sweep+=line(350,y,730,y,P.line)+text(365,y-9,f,19,P.muted);}
  sweep+=arrow(480,650,480,286,P.teal)+arrow(620,286,620,390,P.amber)+
    [[2,'1','2 ↑ · hall',P.teal],[3,'2','3 · cabin',P.teal],[7,'3','7 · cabin',P.teal],[5,'4','5 ↓ · hall',P.amber]].map(([f,n,label,c])=>{const y=650-f*52;return dot(f===5?620:480,y,n,c)+text(f===5?654:106,y+7,label,22,c);}).join('')+
    pill(400,610,180,'A starts at 0')+card(814,154,350,222,'Upward sweep',['Serve 2 ↑, then cabin 3.','Pass 5 ↓ without serving it.','Continue to cabin 7.','No further Up demand: reverse.'],P.green)+
    card(814,407,350,184,'Return sweep',['Open at 5, boarding Down.','A matching pickup clears 5 ↓.','No pending demand → idle.'],P.sand)+
    text(80,743,'Observed opening order: 2:UP → 3:UP → 7:UP → 5:DOWN',24,P.ink,'start',700);
  write('elevator-sweep','Direction is part of the stop contract','Car A starts at zero with cabin destinations three and seven, hall Up at two and hall Down at five. It opens at two Up, three Up, seven Up, then five Down.',1240,810,sweep,
    'LOOK-style service reverses at remaining demand, rather than visiting the endpoint by default.');
  let doors='';const states=[['CLOSED',70,0],['OPENING',370,14],['OPEN',670,43],['CLOSING',970,14]];
  for(const [label,x,gap]of states){doors+=rect(x,148,200,230,P.white)+text(x+100,185,label,24,P.ink,'middle',700)+rect(x+32,208,136,128,'#e5e0f2',P.line,0)+
    rect(x+33,209,67-gap,126,P.violet,P.violet,0)+rect(x+100+gap,209,67-gap,126,P.violet,P.violet,0);}
  doors+=arrow(276,270,364,270)+arrow(576,270,664,270)+arrow(876,270,964,270)+
    route('M1070,382 L1070,432 L170,432 L170,382')+text(620,465,'close completes → CLOSED',21,P.violet,'middle')+
    route('M1070,145 L1070,118 L470,118 L470,145',P.amber)+text(768,113,'obstructed while closing → reopen',19,P.amber,'middle')+
    card(60,510,550,198,'Travel requires every guard',['NORMAL · door CLOSED','no obstruction · interlock satisfied','load ≤ capacity','One false condition → no movement'],P.green)+
    card(650,510,550,198,'Full differs from overloaded',['load == capacity: cabin travel allowed','No new hall pickup while full.','load > capacity: cannot travel','An open door stays open while blocked.'],P.sand);
  write('elevator-doors','A stop plan cannot override the door state','Four door states form a cycle. Closing obstruction reopens the door. Movement requires normal mode, closed doors, clear obstruction, true interlock and non-overloaded load.',1260,780,doors,
    'Discrete floor-event simulator; independent certified hardware remains the real safety boundary.');
  let owner=pill(60,139,310,'CALL LEDGER')+pill(460,139,310,'CAR A')+pill(860,139,310,'CAR B');
  for(const x of[215,615,1015])owner+=line(x,191,x,714,P.line,3,'7 8');
  owner+=card(50,208,330,104,'Call 41 · createdTick 0',['ASSIGNED to A · epoch 1'])+arrow(382,257,615,257)+pill(630,237,245,'owns (41, 1)')+
    text(615,351,'A fails',24,P.amber,'middle',700)+arrow(610,369,382,369,P.amber)+
    card(50,358,330,104,'Same call · same age',['WAITING · epoch 2'],P.sand)+
    card(50,507,330,104,'Replacement assignment',['ASSIGNED to B · epoch 3'],P.green)+arrow(382,552,1015,552,P.teal)+pill(886,576,260,'owns (41, 3)',P.green,P.teal)+
    arrow(610,664,382,664,P.amber)+text(700,673,'late A ack (41, 1)',21,P.amber)+text(65,692,'Rejected: owner / epoch mismatch',20,P.amber)+
    card(50,748,1120,100,'A retains its onboard cabin destinations.',['Reassigning a waiting pickup cannot transfer people already inside a failed car.']),
    text(50,883,'B must still open at the requested floor, in the requested direction, with spare capacity.',20,P.muted);
  write('elevator-ownership','Reassignment changes the owner, not the call','Call forty-one retains its original age when A fails. Release increments its epoch from one to two. B receives epoch three. A late acknowledgement for epoch one is rejected. Cabin destinations remain in A.',1240,955,owner,
    'An epoch is a version of ownership; late events are checked against the current version.');
}
function htmlLabel(title,fields,methods){
  return `<TABLE BORDER="0" CELLBORDER="1" CELLSPACING="0" CELLPADDING="12" COLOR="${P.line}"><TR><TD BGCOLOR="${P.pale}"><B>${esc(title)}</B></TD></TR><TR><TD ALIGN="LEFT">${fields.map(esc).join('<BR ALIGN="LEFT"/>')}<BR ALIGN="LEFT"/></TD></TR><TR><TD ALIGN="LEFT">${methods.map(esc).join('<BR ALIGN="LEFT"/>')}<BR ALIGN="LEFT"/></TD></TR></TABLE>`;
}
async function domain(viz,name,title,desc,nodes,edges){
  // Limit each rank to two classes: wide fan-out makes article-sized UML illegible.
  const rows={
    'chess-domain':[['Game','RuleSet'],['Position','StandardRules'],['Frame','Move'],['Piece']],
    'parking-domain':[['Lot','Allocation'],['Session','Spot'],['Attempt','Tariff'],['Port']],
    'elevator-domain':[['System','Policy'],['Car','Request'],['Plan','Eta'],['Snapshot']]
  }[name];
  const layout=[];
  for(let r=0;r<rows.length-1;r++)for(let col=0;col<Math.min(rows[r].length,rows[r+1].length);col++)layout.push({tail:rows[r][col],head:rows[r+1][col],attributes:{style:'invis',weight:100}});
  const graph={name:'Domain',directed:true,graphAttributes:{rankdir:'TB',bgcolor:P.bg,pad:.35,nodesep:.6,ranksep:.72,fontname:'Arial',fontsize:25,fontcolor:P.ink,label:title,labelloc:'t',splines:'polyline'},nodeAttributes:{shape:'plain',fontname:'Arial',fontsize:20,fontcolor:P.ink},edgeAttributes:{fontname:'Arial',fontsize:17,color:P.violet,fontcolor:P.violet,arrowsize:.8},nodes:nodes.map(([id,heading,fields,methods])=>({name:id,attributes:{label:{html:htmlLabel(heading,fields,methods)}}})),subgraphs:rows.map((row,i)=>({name:'row'+i,graphAttributes:{rank:'same'},nodes:row.map(name=>({name}))})),edges:[...edges.map(([tail,head,label,extra={}])=>({tail,head,attributes:{label,constraint:false,...extra}})),...layout]};
  let svg=viz.renderString(graph,{format:'svg',engine:'dot'}).replace(/<\?xml[^>]*>\s*/,'').replace(/<!DOCTYPE[\s\S]*?>\s*/,'').replace(/ xmlns:xlink="[^"]*"/,'');
  svg=svg.replace(/<svg\b[^>]*>/,m=>m.slice(0,-1)+` role="img" aria-labelledby="fig-title fig-desc"><title id="fig-title">${esc(title)}</title><desc id="fig-desc">${esc(desc)}</desc>`);
  fs.writeFileSync(path.join(out,name+'.svg'),svg.trim()+'\n');
}
async function main(){
  fs.mkdirSync(out,{recursive:true});chess();parking();elevators();
  const viz=await instance();
  await domain(viz,'chess-domain','Chess · one owner, immutable positions, replaceable rules','Game owns current Position and undo Frames. Position contains sixty-four optional Pieces and rule state. Game calls RuleSet; StandardRules implements it. Move is an immutable command.',[
    ['Game','Game · aggregate owner',['position: Position','history: Deque<Frame>','version: long · result: Result'],['move(actor, expectedVersion, Move)','undo(expectedVersion) · view()']],
    ['Position','Position · immutable',['board: Piece[64] (private copy)','turn · castling · enPassant','halfmove · fullmove'],['at(Square) · fingerprint()']],
    ['Frame','Frame · immutable undo snapshot',['position: Position','result: Result'],['restored under a new game version']],
    ['Piece','Piece · immutable value',['side: WHITE | BLACK','kind: KING | ... | PAWN'],['no ownership of the board']],
    ['RuleSet','«interface» RuleSet',['operates on immutable positions'],['legalMoves(Position)','play(Position, Move) · inCheck(...)']],
    ['StandardRules','StandardRules',['movement + attack geometry','castling / en-passant / promotion'],['trial transition → own-king safety']],
    ['Move','Move · immutable command',['from: Square · to: Square','promotion: Kind (optional)'],['actor identity supplied separately']]
  ],[['Game','Position','1 current'],['Game','Frame','0..* history'],['Position','Piece','0..64 pieces'],['Frame','Position','1 snapshot'],['Game','RuleSet','uses'],['StandardRules','RuleSet','implements',{style:'dashed',arrowhead:'empty'}],['Move','RuleSet','input',{style:'dashed'}]]);
  await domain(viz,'parking-domain','Parking · visit ownership and payment evidence','Lot atomically owns spot claims and session indexes. Session retains entry tariff, paid credit and exit deadline. Allocation and tariff policies are pure. PaymentPort is called outside the lot lock; each attempt records its approved quote.',[
    ['Lot','Lot · aggregate owner',['spot → session claim','active plate · entry key indexes'],['enter(...) · quote(...)','pay(...) · confirmExit(...)']],
    ['Session','Session · one visit',['id · vehicle · spotId · enteredAt','frozen tariff · paidMinor · exitBy','state: PARKED | ... | CLOSED'],['snapshot only escapes Lot']],
    ['Spot','Spot · immutable bay',['id · floor · order · kind'],['claim held separately by Lot']],
    ['Allocation','«interface» AllocationPolicy',['SmallestFit implementation'],['choose(vehicle, availableSpots)']],
    ['Tariff','«interface» Tariff',['HourlyTariff · immutable version'],['totalMinor(Duration)']],
    ['Attempt','Attempt · one payment identity',['key · sessionId · approved Quote','PENDING | UNKNOWN | final'],['apply terminal result once']],
    ['Port','«interface» PaymentPort',['external I/O · stable key'],['charge(key, amountMinor)','lookup(key)']]
  ],[['Lot','Session','1 → 0..*'],['Lot','Spot','1 → 1..*'],['Lot','Allocation','selects through'],['Session','Tariff','entry snapshot'],['Lot','Attempt','owns attempts'],['Attempt','Session','for one visit'],['Lot','Port','calls outside monitor',{style:'dashed'}]]);
  await domain(viz,'elevator-domain','Elevators · fleet ownership and per-car plans','SystemController owns cars and a hall-call ledger. A car owns its SweepPlan and door/load state. DispatchPolicy chooses from immutable CarSnapshots; EtaPolicy implements known-plan replay. Requests carry an assignment epoch.',[
    ['System','SystemController · event owner',['active: HallKey → call ID','requests · cars · tick'],['hallCall(...) · cabinCall(...)','tick() · acknowledgePickup(...)']],
    ['Car','Car · private control state',['floor · heading · boarding','door · load · capacity','mode · obstruction · interlock'],['tick() · snapshot()']],
    ['Request','Request · hall-call ledger row',['id · key(floor, direction)','createdTick · state','carId · epoch'],['identity / age survive reassignment']],
    ['Plan','SweepPlan · private per car',['cabin: sorted unique floors','hall: call ID → HallTask'],['next(floor, heading) → Goal']],
    ['Policy','«interface» DispatchPolicy',['pure; no I/O or mutations'],['choose(HallTask, snapshots)']],
    ['Eta','EtaPolicy',['known-plan replay · stable ID tie'],['estimate(call, snapshot)']],
    ['Snapshot','CarSnapshot · immutable',['copies cabin / hall lists','all scheduling and guard state'],['cannot mutate a live car']]
  ],[['System','Car','1 → 1..*'],['System','Request','1 → 0..*'],['Car','Plan','1 owns 1'],['System','Policy','selects through'],['Eta','Policy','implements',{style:'dashed',arrowhead:'empty'}],['Car','Snapshot','creates'],['Policy','Snapshot','reads',{style:'dashed'}],['Plan','Request','task mirrors ID + epoch',{style:'dashed'}]]);
  const downloads=path.join(root,'public/reference-code/lld-three');fs.mkdirSync(downloads,{recursive:true});
  for(const f of ['Chess.java','Parking.java','Elevators.java','ThreeChecks.java','README.md'])fs.copyFileSync(path.join(root,'examples/lld-three',f),path.join(downloads,f));
  console.log(`Built 15 original LLD illustrations (3 UML + 12 board/layout/timeline/state drawings); mirrored 5 source/download files. Graphviz ${viz.graphvizVersion}.`);
}
main().catch(e=>{console.error(e);process.exitCode=1;});
