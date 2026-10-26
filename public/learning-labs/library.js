'use strict';
(() => {
  const $ = id => document.getElementById(id); let cases = [], index = 0;
  let theme = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  try { const saved = localStorage.getItem('kb-theme'); if (saved === 'dark' || saved === 'light') theme = saved; } catch (_) {}
  function showTheme() { document.documentElement.dataset.theme = theme; $('theme').textContent = theme === 'dark' ? 'Use light theme' : 'Use dark theme'; $('theme').setAttribute('aria-pressed',String(theme === 'dark')); }
  showTheme(); $('theme').addEventListener('click', () => { theme = theme === 'dark' ? 'light' : 'dark'; try { localStorage.setItem('kb-theme',theme); } catch (_) {} showTheme(); });
  const selected = () => cases.find(item => item.id === $('scenario').value);
  const money = cents => '$' + (cents/100).toFixed(2);
  function ownership(frame) {
    const copy = frame.copy;
    if (copy.pickup) return {owner:`Reader ${copy.pickup.memberId}`,token:copy.pickup.token,deadline:copy.pickup.pickupBy + ' inclusive'};
    if (copy.loanId) { const loan = frame.loans.find(item => item.id === copy.loanId); return {owner:`Reader ${loan.memberId}`,token:loan.id,deadline:loan.due + ' inclusive'}; }
    return {owner:copy.state === 'REPAIR' ? 'Repair desk' : 'Shelf',token:'None',deadline:'None'};
  }
  function fillList(id,items) { const root = $(id); root.replaceChildren(); for (const text of items) { const li = document.createElement('li'); li.textContent = text; root.append(li); } }
  function render() {
    const scenario = selected(), frame = scenario.frames[index], owner = ownership(frame);
    $('intro').textContent = scenario.description; $('progress').textContent = `Step ${index+1} of ${scenario.frames.length}`;
    $('step-title').textContent = frame.title; $('explanation').textContent = frame.explanation;
    $('date').textContent = frame.date; $('copy-state').textContent = frame.copy.state; $('copy-state').classList.toggle('pickup',frame.copy.state === 'PICKUP');
    $('owner').textContent = owner.owner; $('token').textContent = owner.token; $('deadline').textContent = owner.deadline;
    const waiting = frame.holds.filter(hold => hold.state === 'WAITING'); fillList('queue',waiting.map(hold => `Reader ${hold.memberId} · ${hold.id}`));
    $('queue-empty').textContent = waiting.length ? 'Oldest eligible reader is offered the next healthy copy.' : 'No waiting readers.';
    fillList('hold-history',frame.holds.map(hold => `${hold.id} · reader ${hold.memberId} · ${hold.state}${hold.pickup ? ' · ' + hold.pickup.token : ''}`));
    if (!frame.holds.length) fillList('hold-history',['No hold has been placed.']);
    fillList('loans',frame.loans.map(loan => `${loan.id} · reader ${loan.memberId} · due ${loan.due} · ${loan.returned ? 'returned ' + loan.returned : 'active'} · renewals ${loan.renewals}`));
    if (!frame.loans.length) fillList('loans',['No borrowing visits yet.']);
    $('members').replaceChildren(); for (const member of frame.members) { const card = document.createElement('div'); card.className = 'member'; const title = document.createElement('strong'); title.textContent = 'Reader ' + member.id; const plan = document.createElement('p'); plan.textContent = member.plan + ' plan'; const count = document.createElement('p'); count.textContent = `${member.activeLoans} / ${member.limit} active loans`; card.append(title,plan,count); $('members').append(card); }
    $('returns').textContent = frame.returnCount; $('fine').textContent = money(frame.fineCents); $('notices').textContent = frame.noticeCount;
    $('prev').disabled = index === 0; $('next').disabled = index === scenario.frames.length-1; $('reset').disabled = false;
  }
  function transcript() {
    $('transcript').replaceChildren();
    for (const frame of selected().frames) { const item = document.createElement('li'), title = document.createElement('strong'), text = document.createElement('p'), facts = document.createElement('p'), owner = ownership(frame);
      title.textContent = `${frame.date}: ${frame.title}`; text.textContent = frame.explanation;
      facts.textContent = `C17 is ${frame.copy.state}; owner ${owner.owner}; token ${owner.token}; deadline ${owner.deadline}. Holds: ${frame.holds.map(h => h.id + ' ' + h.memberId + ' ' + h.state).join('; ') || 'none'}. Loans: ${frame.loans.map(l => l.id + ' ' + l.memberId + (l.returned ? ' returned ' + l.returned : ' active, due ' + l.due)).join('; ') || 'none'}. Return receipts ${frame.returnCount}; assessed fine ${money(frame.fineCents)}; pickup notice intents ${frame.noticeCount}.`;
      item.append(title,text,facts); $('transcript').append(item);
    }
  }
  $('scenario').addEventListener('change', () => { index = 0; transcript(); render(); });
  $('prev').addEventListener('click', () => { index = Math.max(0,index-1); render(); });
  $('next').addEventListener('click', () => { index = Math.min(selected().frames.length-1,index+1); render(); });
  $('reset').addEventListener('click', () => { index = 0; render(); });
  fetch('library-traces.json').then(response => { if (!response.ok) throw new Error('Trace unavailable'); return response.json(); }).then(data => { cases = data.scenarios; $('scenario').replaceChildren(); for (const item of cases) { const option = document.createElement('option'); option.value = item.id; option.textContent = item.title; $('scenario').append(option); } $('scenario').disabled = false; transcript(); render(); }).catch(() => { $('step-title').textContent = 'The recorded states could not be loaded'; $('error').hidden = false; $('error').textContent = 'The Library article contains the complete ownership and date walkthrough. No circulation records were changed by this viewer.'; });
})();
