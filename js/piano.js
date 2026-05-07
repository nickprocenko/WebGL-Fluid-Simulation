// 88-key piano layout: MIDI 21 (A0) to 108 (C8)

const IS_BLACK = [false,true,false,true,false,false,true,false,true,false,true,false];
const FIRST_NOTE = 21;
const LAST_NOTE  = 108;
const WHITE_NOTES = [];

function isBlack (note) { return IS_BLACK[note % 12]; }

function countWhitesBefore (note) {
  let count = 0;
  for (let n = FIRST_NOTE; n < note; n++) {
    if (!isBlack(n)) count++;
  }
  return count;
}

const TOTAL_WHITES = (() => {
  let c = 0;
  for (let n = FIRST_NOTE; n <= LAST_NOTE; n++) {
    if (!isBlack(n)) {
      c++;
      WHITE_NOTES.push(n);
    }
  }
  return c;
})();

export function noteToX (note, canvasWidth) {
  if (isBlack(note)) {
    // Centre on parent white key's right edge
    const whites = countWhitesBefore(note);
    const ww = canvasWidth / TOTAL_WHITES;
    return whites * ww - (ww * 0.3);
  }
  return countWhitesBefore(note) * (canvasWidth / TOTAL_WHITES);
}

export function noteWidth (note, canvasWidth) {
  const ww = canvasWidth / TOTAL_WHITES;
  return isBlack(note) ? ww * 0.58 : ww;
}

export function noteCenterX (note, canvasWidth) {
  return noteToX(note, canvasWidth) + noteWidth(note, canvasWidth) / 2;
}

export function noteAtPoint (x, y, canvasWidth, keyboardHeight) {
  if (x < 0 || x > canvasWidth || y < 0 || y > keyboardHeight) return null;
  const ww = canvasWidth / TOTAL_WHITES;
  const bh = keyboardHeight * 0.62;

  // Black keys sit visually on top, so test them first in their vertical area.
  if (y <= bh) {
    for (let n = FIRST_NOTE; n <= LAST_NOTE; n++) {
      if (!isBlack(n)) continue;
      const bx = noteToX(n, canvasWidth);
      const bw = ww * 0.58;
      if (x >= bx && x <= bx + bw) return n;
    }
  }

  const whiteIndex = Math.min(TOTAL_WHITES - 1, Math.max(0, Math.floor(x / ww)));
  return WHITE_NOTES[whiteIndex] ?? null;
}

export function drawKeyboard (ctx, activeNotes, keyboardHeight, colorMap) {
  const W = ctx.canvas.width;
  const H = ctx.canvas.height;
  const top = H - keyboardHeight;
  const ww = W / TOTAL_WHITES;
  const bh = keyboardHeight * 0.62;

  // White keys
  let wi = 0;
  for (let n = FIRST_NOTE; n <= LAST_NOTE; n++) {
    if (isBlack(n)) continue;
    const x = wi * ww;
    const active = activeNotes.has(n);
    const col = (active && colorMap[n]) ? colorMap[n] : (active ? '#88aaff' : '#ffffff');
    ctx.fillStyle = col;
    ctx.fillRect(x + 1, top, ww - 2, keyboardHeight - 1);
    ctx.strokeStyle = '#333';
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 1, top, ww - 2, keyboardHeight - 1);
    wi++;
  }

  // Black keys (drawn on top)
  for (let n = FIRST_NOTE; n <= LAST_NOTE; n++) {
    if (!isBlack(n)) continue;
    const x = noteToX(n, W);
    const bw = ww * 0.58;
    const active = activeNotes.has(n);
    const col = (active && colorMap[n]) ? colorMap[n] : (active ? '#6688ff' : '#111');
    ctx.fillStyle = col;
    ctx.fillRect(x, top, bw, bh);
  }
}
