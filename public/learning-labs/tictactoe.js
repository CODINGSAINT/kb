'use strict';
(() => {
  const $ = id => document.getElementById(id);
  const lines = [[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]];
  const fresh = () => ({cells:Array(9).fill('EMPTY'),nextPlayer:'X',status:'IN_PROGRESS',version:0});
  let scenarios = [], frameIndex = 0, state = fresh(), last = null;
  let theme = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  try { const saved = localStorage.getItem('kb-theme'); if (saved === 'light' || saved === 'dark') theme = saved; } catch (_) {}
  function showTheme() { document.documentElement.dataset.theme = theme; $('theme').textContent = theme === 'dark' ? 'Use light theme' : 'Use dark theme'; $('theme').setAttribute('aria-pressed', String(theme === 'dark')); }
  showTheme();
  $('theme').addEventListener('click', () => { theme = theme === 'dark' ? 'light' : 'dark'; try { localStorage.setItem('kb-theme', theme); } catch (_) {} showTheme(); });
  const buttons = Array.from({length:9}, (_,cell) => {
    const button = document.createElement('button'); button.type = 'button'; button.className = 'cell';
    const mark = document.createElement('span'); mark.className = 'mark';
    const coordinate = document.createElement('span'); coordinate.className = 'coordinate'; coordinate.textContent = `${Math.floor(cell/3)}, ${cell%3}`;
    button.append(mark,coordinate); button.addEventListener('click', () => freeMove(cell)); $('board').append(button); return button;
  });
  const freeMode = () => $('scenario').value === 'free';
  const selected = () => scenarios.find(s => s.id === $('scenario').value);
  const outcome = value => ({IN_PROGRESS:'In progress',X_WON:'X won',O_WON:'O won',DRAW:'Draw'})[value];
  function requestText(move) { return move ? `${move.player} at (${move.row},${move.col}), expected version ${move.expectedVersion}` : 'No request yet'; }
  function winningLine(position) { return lines.find(line => position.cells[line[0]] !== 'EMPTY' && line.every(cell => position.cells[cell] === position.cells[line[0]])) || []; }
  function draw(position,frame) {
    const win = winningLine(position);
    buttons.forEach((button,cell) => {
      const value = position.cells[cell]; button.firstElementChild.textContent = value === 'EMPTY' ? '·' : value;
      button.setAttribute('aria-label', `Row ${Math.floor(cell/3)}, column ${cell%3}: ${value === 'EMPTY' ? 'empty' : value}${win.includes(cell) ? ', winning line' : ''}`);
      button.disabled = !freeMode(); button.classList.toggle('winner',win.includes(cell));
      button.classList.toggle('latest',Boolean(frame.request && frame.request.row*3+frame.request.col === cell));
    });
    $('version').textContent = position.version; $('turn').textContent = position.nextPlayer === 'EMPTY' ? 'None — finished' : position.nextPlayer;
    $('result').textContent = outcome(position.status); $('request').textContent = requestText(frame.request);
    $('decision').textContent = frame.decision; $('explanation').textContent = frame.explanation;
    $('line').textContent = win.length ? `Winning line: ${win.map(cell => `(${Math.floor(cell/3)},${cell%3})`).join(' → ')}.` : 'A dashed border marks the requested square. A rejected request leaves the position unchanged.';
  }
  function guidedRender() {
    const scenario = selected(); if (!scenario) return;
    const frame = scenario.frames[frameIndex]; draw(frame.snapshot,frame);
    $('prev').disabled = frameIndex === 0; $('next').disabled = frameIndex === scenario.frames.length-1;
    $('progress').textContent = `Position ${frameIndex+1} of ${scenario.frames.length} · ${frameIndex} request${frameIndex === 1 ? '' : 's'} shown`;
  }
  function transcript() {
    const list = $('steps'); list.replaceChildren();
    for (const frame of selected().frames) {
      const item = document.createElement('li'), text = document.createElement('p'), board = document.createElement('pre');
      text.textContent = `${requestText(frame.request)} → ${frame.decision}. ${frame.explanation} Version ${frame.snapshot.version}; next ${frame.snapshot.nextPlayer === 'EMPTY' ? 'nobody' : frame.snapshot.nextPlayer}; ${outcome(frame.snapshot.status)}.`;
      board.textContent = [0,3,6].map(start => frame.snapshot.cells.slice(start,start+3).map(mark => mark === 'EMPTY' ? '.' : mark).join(' ')).join('\n');
      item.append(text,board); list.append(item);
    }
  }
  function changeCase() {
    frameIndex = 0; const free = freeMode(); $('guided').hidden = free; $('free').hidden = !free; $('transcript').hidden = free;
    if (free) { $('intro').textContent = 'Try a move, choose the wrong player, click an occupied cell or send an old version. Rejection must not consume a turn.'; newGame(); }
    else { $('intro').textContent = selected().description; transcript(); guidedRender(); }
  }
  function newGame() { state = fresh(); last = {request:null,decision:'START',explanation:'X moves first. Choose any square.'}; $('player').value = 'turn'; $('stale').checked = false; draw(state,last); }
  function freeMove(cell) {
    if (!freeMode()) return;
    const move = {player:$('player').value === 'turn' ? state.nextPlayer === 'EMPTY' ? 'X' : state.nextPlayer : $('player').value,row:Math.floor(cell/3),col:cell%3,expectedVersion:$('stale').checked ? state.version-1 : state.version};
    let decision = 'ACCEPTED', explanation;
    if (state.status !== 'IN_PROGRESS') decision = 'GAME_OVER';
    else if (move.player !== 'X' && move.player !== 'O') decision = 'INVALID_PLAYER';
    else if (move.expectedVersion !== state.version) decision = 'STALE_VERSION';
    else if (move.player !== state.nextPlayer) decision = 'WRONG_TURN';
    else if (move.row < 0 || move.row > 2 || move.col < 0 || move.col > 2) decision = 'OUT_OF_BOUNDS';
    else if (state.cells[cell] !== 'EMPTY') decision = 'OCCUPIED';
    if (decision === 'ACCEPTED') {
      state.cells[cell] = move.player; state.version++;
      if (winningLine(state).length) { state.status = move.player+'_WON'; state.nextPlayer = 'EMPTY'; }
      else if (state.version === 9) { state.status = 'DRAW'; state.nextPlayer = 'EMPTY'; }
      else state.nextPlayer = move.player === 'X' ? 'O' : 'X';
      explanation = state.status === 'IN_PROGRESS' ? `${move.player} placed one mark. It is now ${state.nextPlayer}'s turn.` : `${outcome(state.status)}. There is no next player; later moves will be rejected.`;
    } else explanation = ({GAME_OVER:'The game has finished. The final board is preserved.',INVALID_PLAYER:'Only X and O can play.',STALE_VERSION:'This request used a different position version. Nothing changed.',WRONG_TURN:`It is ${state.nextPlayer}'s turn. Nothing changed.`,OUT_OF_BOUNDS:'That coordinate is outside the board. Nothing changed.',OCCUPIED:'This square already has a mark. The same player keeps the turn.'})[decision];
    last = {request:move,decision,explanation}; draw(state,last);
  }
  $('scenario').addEventListener('change',changeCase);
  $('prev').addEventListener('click', () => { frameIndex = Math.max(0,frameIndex-1); guidedRender(); });
  $('next').addEventListener('click', () => { frameIndex = Math.min(selected().frames.length-1,frameIndex+1); guidedRender(); });
  $('reset').addEventListener('click', () => { frameIndex = 0; guidedRender(); });
  $('new-game').addEventListener('click',newGame);
  fetch('tictactoe-traces.json').then(response => { if (!response.ok) throw new Error('Trace unavailable'); return response.json(); }).then(data => {
    scenarios = data.scenarios; $('scenario').replaceChildren();
    for (const scenario of scenarios) { const option = document.createElement('option'); option.value = scenario.id; option.textContent = scenario.title; $('scenario').append(option); }
    const option = document.createElement('option'); option.value = 'free'; option.textContent = 'Play freely — try an invalid move'; $('scenario').append(option);
    $('scenario').disabled = false; changeCase();
  }).catch(() => { $('error').hidden = false; $('error').textContent = 'The guided data could not be loaded. The article contains the complete trace. You can still select free play below.'; $('scenario').replaceChildren(); const option = document.createElement('option'); option.value = 'free'; option.textContent = 'Play freely'; $('scenario').append(option); $('scenario').disabled = false; changeCase(); });
})();
