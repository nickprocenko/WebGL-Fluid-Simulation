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

  draw (ctx, canvasHeight, keyboardHeight) {
    const base = canvasHeight - keyboardHeight;

    // Draw finished (released) trails
    for (const t of this._finished) this._drawTrail(ctx, t, base);
    // Draw active (held) trails on top
    for (const t of this._trails.values()) this._drawTrail(ctx, t, base);
  }

  _drawTrail (ctx, t, base) {
    const h = t.topY - (t.released ? t.bottomY : 0);
    if (h <= 0) return;
    const yBottom = t.released ? base - t.bottomY : base;
    const yTop    = base - t.topY;

    // Glow effect: wider, semi-transparent under layer
    ctx.globalAlpha = 0.25;
    ctx.fillStyle = t.color;
    ctx.fillRect(t.x - t.width * 0.3, yTop, t.width * 1.6, h);

    // Solid note body
    ctx.globalAlpha = 0.85;
    ctx.fillStyle = t.color;
    const r = Math.min(t.width / 2, 6);
    this._roundedRect(ctx, t.x, yTop, t.width, h, r);
    ctx.fill();

    // Bright top edge (the "head" — where fluid splat happens)
    ctx.globalAlpha = 1.0;
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
