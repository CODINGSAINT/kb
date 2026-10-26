// Purpose-specific diagrams. Generated SVG is passive and has a complete text description.
const fs=require('node:fs'),path=require('node:path');
const {instance}=require('@viz-js/viz');
const root=path.resolve(__dirname,'..');
const figures=[
 {name:'chatclient-flow',title:'The prompt is prepared before the model is invoked',desc:'The application validates the question. ChatClient combines system and user messages into a new request. Its advisor chain reaches ChatModel. The offline fixture returns a ChatResponse without network access; a live ChatModel adapter would call its provider. The application consumes one response, reads text and metadata, and validates structured fields before returning them.',dot:`
  app [label="Application\\nvalidate question"];
  client [label="ChatClient\\nfresh system + user request"];
  advisors [label="Advisor chain\\nends at model invocation"];
  model [label="ChatModel\\noffline fixture in this demo"];
  response [label="ChatResponse\\ntext · metadata · usage"];
  result [label="Application result\\ncheck fields · render safely"];
  app -> client [label="build request"];
  client -> advisors [label="consume response spec"];
  advisors -> model [label="call / subscribe"];
  model -> response [label="one model response"];
  response -> result [label="read once, validate"];
 `},
 {name:'chatclient-stream',title:'A partial stream is not a completed answer',desc:'A prepared publisher has not invoked the model. Subscription starts the stream. Chunks can arrive before completion. Normal completion marks the answer complete; cancellation, error or timeout leaves it incomplete. Local cancellation does not establish that a remote provider stopped work or billing.',dot:`
  prepared [label="PREPARED\\nno subscription, no model stream"];
  active [label="STREAMING\\nchunks are provisional"];
  complete [label="COMPLETE\\nnormal completion",fillcolor="#c5f0df"];
  incomplete [label="INCOMPLETE\\nkeep partial text labelled",fillcolor="#fff1bd"];
  prepared -> active [label="subscribe"];
  active -> active [label="next chunk"];
  active -> complete [label="completion signal"];
  active -> incomplete [label="cancel / error / idle timeout"];
 `},
 {name:'ratelimit-flow',title:'A shared admission decision before the backend',desc:'A client reaches an authenticated gateway. The gateway uses a locally cached trusted policy and executes a small script on the Redis primary selected by subject and route. An allow decision forwards the request. Exhausted quota returns 429; unavailable authority follows the route failure policy and can return 503. Replicas support recovery but never serve quota decisions.',dot:`
  client [label="Client"];
  gateway [label="Gateway + limiter plugin\\nauthenticate · choose policy"];
  policy [label="Policy control plane\\nversion · capacity · refill"];
  redis [label="Sharded Redis primaries\\natomic refill + spend"];
  replica [label="Replicas\\nrecovery only, no quota reads"];
  backend [label="Application backend\\ncalled only after allow"];
  metrics [label="Metrics + traces\\nallow · 429 · 503 · latency"];
  client -> gateway [label="request"];
  policy -> gateway [label="cached trusted configuration",style=dashed];
  gateway -> redis [label="one subject-policy key"];
  redis -> gateway [label="allow / deny + retry delay"];
  gateway -> backend [label="allow only"];
  gateway -> client [label="429 exhausted / 503 unavailable"];
  redis -> replica [label="asynchronous replication",style=dashed];
  gateway -> metrics [label="bounded labels",style=dashed];
 `},
 {name:'ratelimit-expiry',title:'Delete the bucket only when forgetting it is safe',desc:'For capacity 1000 and refill one token per second, an empty bucket has zero tokens at time zero, 60 tokens after 60 seconds and 1000 tokens after 1000 seconds. Deleting at 60 seconds would recreate 1000 tokens instead of 60. The correct idle expiry waits until full, with an extra delay if the stored refill clock is ahead.',dot:`
  empty [label="0 seconds\\n0 / 1000 tokens"];
  minute [label="60 seconds\\n60 / 1000 tokens"];
  full [label="1000 seconds\\n1000 / 1000 tokens",fillcolor="#c5f0df"];
  unsafe [label="Delete at 60 seconds?\\nNew bucket incorrectly starts at 1000",fillcolor="#ffe0e0"];
  safe [label="Delete once full\\nNew full bucket means the same thing"];
  empty -> minute [label="refill 60 tokens"];
  minute -> full [label="refill remaining 940"];
  minute -> unsafe [label="fixed short TTL",style=dashed];
  full -> safe [label="idle expiry is safe"];
 `},
 {name:'booking-ownership',title:'One service owns each show-seat allocation',desc:'A customer asks BookingService for a cart hold. The same critical section owns reservations and the show-seat allocation map. Payment uses a stable attempt key outside the lock. A receipt returns to the service; a late capture creates a refund intent rather than reclaiming a seat.',dot:`
  customer [label="Customer\\nchoose A7 + A8"];
  service [label="BookingService\\none atomic decision"];
  holds [label="Internal Hold\\nowner · expiry · quote · state"];
  seats [label="Show-seat allocation\\n(show, seat) → reservation"];
  provider [label="Payment provider\\ncalled outside the lock"];
  refund [label="Refund intent\\ncharge · amount · reason"];
  customer -> service [label="hold / pay / cancel"];
  service -> holds [label="owns"];
  service -> seats [label="claims all seats or none"];
  service -> provider [label="stable attempt key",style=dashed];
  provider -> service [label="verified receipt",style=dashed];
  service -> refund [label="late capture / cancellation"];
 `},
 {name:'booking-states',title:'Reservation state and payment state answer different questions',desc:'A new reservation is HELD. A matching captured payment before expiry confirms it. Reaching the deadline expires a held reservation. Cancellation or definite decline cancels it. A late capture leaves an expired or cancelled reservation terminal and records one refund intent. CONFIRMED never expires.',dot:`
  held [label="HELD\\nseats temporarily owned",fillcolor="#fff1bd"];
  confirmed [label="CONFIRMED\\nticket entitlement",fillcolor="#c5f0df"];
  expired [label="EXPIRED\\nseats released"];
  cancelled [label="CANCELLED\\nseats released"];
  refund [label="One refund intent\\nif money was captured"];
  held -> confirmed [label="captured correct amount\\nbefore deadline"];
  held -> expired [label="now ≥ expiresAt"];
  held -> cancelled [label="cancel / decline / wrong amount"];
  confirmed -> cancelled [label="eligible cancellation"];
  expired -> refund [label="late capture"];
  cancelled -> refund [label="capture exists or arrives later"];
 `}
];
async function main(){const viz=await instance();fs.mkdirSync(path.join(root,'public/learning-figures'),{recursive:true});
 for(const f of figures){const dot=`digraph G { graph [rankdir=TB,bgcolor="#f7f7fc",pad=.3,nodesep=.5,ranksep=.65]; node [shape=box,style="rounded,filled",fillcolor=white,color="#aaa4c2",fontname=Arial,fontsize=15,fontcolor="#25213e",margin=".18,.12"]; edge [color="#514b89",fontname=Arial,fontsize=12,fontcolor="#514b89"]; ${f.dot} }`;
 let svg=viz.renderString(dot,{format:'svg',engine:'dot'}).replace(/<\?xml[^>]*>\s*/,'').replace(/<!DOCTYPE[\s\S]*?>\s*/,'').replace(/ xmlns:xlink="http:\/\/www.w3.org\/1999\/xlink"/,'');
 const esc=s=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 svg=svg.replace(/<svg\b[^>]*>/,m=>m.slice(0,-1)+` role="img" aria-labelledby="figure-title figure-desc"><title id="figure-title">${esc(f.title)}</title><desc id="figure-desc">${esc(f.desc)}</desc>`);
 fs.writeFileSync(path.join(root,'public/learning-figures',f.name+'.svg'),svg.trimEnd()+'\n');}
 console.log(`Built ${figures.length} learning figures`);
}
main().catch(e=>{console.error(e);process.exitCode=1;});
