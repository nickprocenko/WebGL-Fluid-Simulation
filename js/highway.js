// Note trail (highway) renderer

export class Highway {
  constructor () {
    this._trails = new Map(); // note -> trail object
    this._finished = [];      // released trails still animating out
  }

  noteOn (note, velocity, x, width, color) {
    this._trails.set(note, {
      note, x, width, color,
      topY: 0,       // grows each frame
      bottomY: 0,    // set when released
      released: false,
      velocity,
    });
  }

  noteOff (note) {
    const trail = this._trails.get(note);
    if (!trail) return;
    trail.released = true;
    // bottomY stays at 0 (keyboard) so the full bar scrolls off cleanly
    this._finished.push(trail);
    this._trails.delete(note);
  }

  update (dt, speed, canvasHeight, keyboardHeight) {
    const dy = speed * dt;
    const limit = canvasHeight - keyboardHeight;

    // Grow active trails upward from keyboard
    for (const t of this._trails.values()) {
      t.topY = Math.min(t.topY + dy, limit);
    }

    // Scroll finished trails upward and prune once the tail leaves the screen
    this._finished = this._finished.filter(t => {
      t.topY    += dy;
      t.bottomY += dy;
      return t.bottomY < limit;
    });
  }

  draw (ctx, canvasHeight, keyboardHeight, appearance = {}) {
    const base = canvasHeight - keyboardHeight;

    // Draw finished (released) trails
    for (const t of this._finished) this._drawTrail(ctx, t, base, appearance);
    // Draw active (held) trails on top
    for (const t of this._trails.values()) this._drawTrail(ctx, t, base, appearance);
  }

  recolor (getColor) {
    for (const t of this._trails.values()) t.color = getColor(t.note);
    for (const t of this._finished) t.color = getColor(t.note);
  }

  _drawTrail (ctx, t, base, appearance) {
    const h = t.topY - (t.released ? t.bottomY : 0);
    if (h <= 0) return;
    const yBottom = t.released ? base - t.bottomY : base;
    const yTop    = base - t.topY;
    const glow = Math.max(0, Math.min(1, appearance.glow ?? 0.35));
    const innerOpacity = Math.max(0, Math.min(1, appearance.innerOpacity ?? 0.85));
    const headOpacity = Math.max(0, Math.min(1, appearance.headOpacity ?? 0.9));
    const outerWidth = t.width * (1.2 + glow * 1.2);
    const midWidth = t.width * (1.0 + glow * 0.6);
    const outerX = t.x - (outerWidth - t.width) / 2;
    const midX = t.x - (midWidth - t.width) / 2;

    // Glow effect: two soft under-layers
    ctx.globalAlpha = 0.08 + glow * 0.28;
    ctx.fillStyle = t.color;
    ctx.fillRect(outerX, yTop, outerWidth, h);

    ctx.globalAlpha = 0.12 + glow * 0.3;
    ctx.fillStyle = t.color;
    ctx.fillRect(midX, yTop, midWidth, h);

    // Solid note body
    ctx.globalAlpha = innerOpacity;
    ctx.fillStyle = t.color;
    const r = Math.min(t.width / 2, 6);
    this._roundedRect(ctx, t.x, yTop, t.width, h, r);
    ctx.fill();

    // Bright top edge (the "head" — where fluid splat happens)
    ctx.globalAlpha = headOpacity;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(t.x, yTop, t.width, Math.min(3, h));

    ctx.globalAlpha = 1.0;
  }

  _roundedRect (ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h);
    ctx.lineTo(x, y + h);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

  // Yield active trail positions for fluid splat injection
  * activeTrails () {
    for (const t of this._trails.values()) yield t;
  }

  get activeCount () { return this._trails.size; }
}
