'use strict';
(() => {
  const $ = id => document.getElementById(id);
  let cases = [], index = 0;
  let theme = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  try { const saved = localStorage.getItem('kb-theme'); if (saved === 'dark' || saved === 'light') theme = saved; } catch (_) {}
  function showTheme() { document.documentElement.dataset.theme = theme; $('theme').textContent = theme === 'dark' ? 'Use light theme' : 'Use dark theme'; $('theme').setAttribute('aria-pressed',String(theme === 'dark')); }
  showTheme(); $('theme').addEventListener('click', () => { theme = theme === 'dark' ? 'light' : 'dark'; try { localStorage.setItem('kb-theme',theme); } catch (_) {} showTheme(); });
  const selected = () => cases.find(item => item.id === $('scenario').value);
  const money = cents => '$' + (cents / 100).toLocaleString('en-US');
  const notes = count => `${count.twenties} × $20; ${count.fifties} × $50`;
  const sessionName = value => ({IDLE:'Idle',CARD_INSERTED:'Card inserted',AUTHENTICATED:'Authenticated',CARD_ERROR:'Card error'})[value] || value;
  function drawNotes(id,count) {
    const root = $(id); root.replaceChildren();
    const label = document.createElement('p'); label.className = 'counts'; label.textContent = notes(count); root.append(label);
    const bills = document.createElement('div'); bills.className = 'bills'; bills.setAttribute('aria-hidden','true');
    for (const [denomination,total] of [[20,count.twenties],[50,count.fifties]]) for (let n = 0; n < Math.min(total,12); n++) { const bill = document.createElement('span'); bill.className = 'bill'; bill.textContent = '$' + denomination; bills.append(bill); }
    root.append(bills);
  }
  function drawPhases(frame) {
    const stage = frame.operation?.stage;
    const current = !stage ? -1 : stage === 'NO_NOTES' ? 0 : stage === 'FUNDS_UNKNOWN' || stage === 'DECLINED' ? 1 : stage === 'DISPENSING' || stage === 'CASH_UNKNOWN' ? 2 : 3;
    const terminal = ['COMPLETED','PARTIAL','NO_CASH'].includes(stage);
    const labels = ['Plan notes','Confirm bank hold','Resolve cash delivery','Confirm settlement'];
    [...$('phases').children].forEach((item,n) => {
      const done = terminal || n < current; const active = !terminal && n === current;
      item.classList.toggle('done',done); item.classList.toggle('current',active); item.replaceChildren(document.createTextNode(labels[n]));
      const status = document.createElement('small'); status.textContent = done ? 'Confirmed' : active ? (stage === 'DECLINED' || stage === 'NO_NOTES' ? 'Rejected' : 'Awaiting confirmation') : 'Not started'; item.append(status);
      if (active) item.setAttribute('aria-current','step'); else item.removeAttribute('aria-current');
    });
  }
  function render() {
    const item = selected(), frame = item.frames[index], op = frame.operation;
    $('intro').textContent = item.description; $('progress').textContent = `Step ${index+1} of ${item.frames.length}`;
    $('step-title').textContent = frame.title; $('explanation').textContent = frame.explanation;
    $('ledger').textContent = money(frame.bank.ledgerCents); $('held').textContent = money(frame.bank.heldCents); $('available').textContent = money(frame.bank.availableCents);
    $('state').textContent = op ? `${op.id} · ${op.stage}` : 'No withdrawal';
    $('delivered').textContent = !op ? 'No command yet' : op.deliveredCents === null ? 'Unknown — not zero' : money(op.deliveredCents);
    $('commands').textContent = frame.commands; $('session').textContent = sessionName(frame.session); $('blocked').textContent = frame.cashBlocked ? 'Blocked' : 'Available';
    drawNotes('cash-available',frame.cash.available); drawNotes('cash-reserved',frame.cash.reserved); drawNotes('cash-quarantined',frame.cash.quarantined); drawPhases(frame);
    $('prev').disabled = index === 0; $('next').disabled = index === item.frames.length-1; $('reset').disabled = false;
  }
  function transcript() {
    $('transcript').replaceChildren();
    for (const frame of selected().frames) {
      const li = document.createElement('li'), title = document.createElement('strong'), text = document.createElement('p'), facts = document.createElement('p');
      title.textContent = frame.title; text.textContent = frame.explanation;
      const op = frame.operation;
      facts.textContent = `Session ${sessionName(frame.session)}. ${op ? op.id + ': ' + op.stage + '; delivered ' + (op.deliveredCents === null ? 'unknown' : money(op.deliveredCents)) : 'No withdrawal'}. Bank: ledger ${money(frame.bank.ledgerCents)}, held ${money(frame.bank.heldCents)}, available ${money(frame.bank.availableCents)}. Cash: available ${notes(frame.cash.available)}; reserved ${notes(frame.cash.reserved)}; quarantined ${notes(frame.cash.quarantined)}. Physical commands ${frame.commands}; cash service ${frame.cashBlocked ? 'blocked' : 'available'}.`;
      li.append(title,text,facts); $('transcript').append(li);
    }
  }
  $('scenario').addEventListener('change', () => { index = 0; transcript(); render(); });
  $('prev').addEventListener('click', () => { index = Math.max(0,index-1); render(); });
  $('next').addEventListener('click', () => { index = Math.min(selected().frames.length-1,index+1); render(); });
  $('reset').addEventListener('click', () => { index = 0; render(); });
  fetch('atm-traces.json').then(response => { if (!response.ok) throw new Error('Trace unavailable'); return response.json(); }).then(data => {
    cases = data.scenarios; $('scenario').replaceChildren();
    for (const item of cases) { const option = document.createElement('option'); option.value = item.id; option.textContent = item.title; $('scenario').append(option); }
    $('scenario').value = 'cash-unknown'; $('scenario').disabled = false; transcript(); render();
  }).catch(() => { $('step-title').textContent = 'The guided data could not be loaded'; $('error').hidden = false; $('error').textContent = 'Open the ATM article for the complete worked withdrawal and recovery rules. No action was sent to a bank or cash dispenser.'; });
})();
