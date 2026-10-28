// 2D physics in screen pixels (y down), driven at a fixed 60 Hz step so throws and
// auto-tosses behave the same on every monitor refresh rate.
const { Engine, Bodies, Body, Composite, Events, Sleeping } = window.Matter;

export const STEP = 1000 / 60;
export const GRAVITY = 2.2; // ≈ 2200 px/s²: snappy, readable arcs on a desktop-sized "room"
export const BIN = { topHalf: 64, botHalf: 50, height: 118, wall: 6, rimR: 4 };

export class Physics {
  constructor(sound) {
    this.sound = sound;
    this.engine = Engine.create({ enableSleeping: true, gravity: { x: 0, y: GRAVITY } });
    this.engine.positionIterations = 8;
    this.engine.velocityIterations = 6;
    this.world = this.engine.world;
    this.room = [];
    this.binParts = [];
    this.balls = new Map(); // body.id -> ball
    this.acc = 0;
    this.lastHit = new WeakMap();
    Events.on(this.engine, 'collisionStart', (e) => this.onCollisions(e.pairs));
  }

  layout(w, h) {
    this.w = w;
    this.h = h;
    Composite.remove(this.world, this.room);
    const opts = { isStatic: true, friction: 0.6, restitution: 0.3 };
    this.room = [
      Bodies.rectangle(w / 2, h + 100, w * 4, 200, { ...opts, label: 'floor' }),
      Bodies.rectangle(-100, h / 2 - 2000, 200, h + 4000, { ...opts, label: 'wall' }),
      Bodies.rectangle(w + 100, h / 2 - 2000, 200, h + 4000, { ...opts, label: 'wall' }),
    ];
    Composite.add(this.world, this.room);
    if (this.binX !== undefined) this.placeBin(this.binX);
  }

  /** Tapered side walls standing on the floor, with round rims so near misses roll off. */
  placeBin(x) {
    this.binX = x;
    Composite.remove(this.world, this.binParts);
    const { topHalf, botHalf, height, wall, rimR } = BIN;
    const floorY = this.h;
    const len = Math.hypot(topHalf - botHalf, height);
    const tilt = Math.asin((topHalf - botHalf) / len);
    const opts = { isStatic: true, friction: 0.25, restitution: 0.35, label: 'binwall' };
    const midY = floorY - height / 2;
    const midOff = (topHalf + botHalf) / 2;
    this.binParts = [
      Bodies.rectangle(x - midOff, midY, wall, len, { ...opts, angle: -tilt }),
      Bodies.rectangle(x + midOff, midY, wall, len, { ...opts, angle: tilt }),
      Bodies.circle(x - topHalf, floorY - height, rimR, { ...opts, label: 'rim', restitution: 0.5 }),
      Bodies.circle(x + topHalf, floorY - height, rimR, { ...opts, label: 'rim', restitution: 0.5 }),
    ];
    Composite.add(this.world, this.binParts);
  }

  /** Inner half-width of the bin at screen height y. */
  binHalfWidthAt(y) {
    const t = Math.min(1, Math.max(0, (this.h - y) / BIN.height));
    return BIN.botHalf + (BIN.topHalf - BIN.botHalf) * t - BIN.wall / 2;
  }

  isInsideBin(x, y, r) {
    const top = this.h - BIN.height;
    return y > top + r * 0.25 && Math.abs(x - this.binX) < this.binHalfWidthAt(y) - r * 0.2;
  }

  addBall(ball, x, y, r) {
    const body = Bodies.circle(x, y, r, {
      label: 'ball',
      restitution: 0.38,
      friction: 0.4,
      frictionStatic: 0.7,
      frictionAir: 0.006,
      density: 0.0012,
      sleepThreshold: 45,
    });
    this.balls.set(body.id, ball);
    Composite.add(this.world, body);
    return body;
  }

  removeBall(body) {
    this.balls.delete(body.id);
    Composite.remove(this.world, body);
  }

  wakeAll() {
    for (const ball of this.balls.values()) Sleeping.set(ball.body, false);
  }

  step(ms) {
    this.acc = Math.min(this.acc + ms, STEP * 6);
    while (this.acc >= STEP) {
      Engine.update(this.engine, STEP);
      for (const ball of this.balls.values()) ball.followHand?.();
      this.acc -= STEP;
    }
  }

  get active() {
    for (const ball of this.balls.values()) {
      if (ball.held || !ball.body.isSleeping) return true;
    }
    return false;
  }

  /**
   * Initial velocity (px per 60 Hz step) that lands a ball at (tx, ty) after `n` steps.
   * Matter integrates x[k+1] = x[k] + v + k·a with no air drag, so the sum is closed-form.
   */
  ballisticVelocity(from, tx, ty, n) {
    const a = GRAVITY * this.engine.gravity.scale * STEP * STEP;
    return { x: (tx - from.x) / n, y: (ty - from.y - (a * n * (n + 1)) / 2) / n };
  }

  onCollisions(pairs) {
    const now = performance.now();
    for (const { bodyA, bodyB } of pairs) {
      for (const [ball, other] of [[bodyA, bodyB], [bodyB, bodyA]]) {
        if (ball.label !== 'ball') continue;
        const owner = this.balls.get(ball.id);
        if (owner?.onCollide) owner.onCollide(other);
        const speed = Math.hypot(ball.velocity.x - other.velocity.x, ball.velocity.y - other.velocity.y);
        if (speed < 1.5 || now - (this.lastHit.get(ball) || 0) < 70) continue;
        this.lastHit.set(ball, now);
        if (other.label === 'rim') this.sound.tink(speed);
        else if (other.label === 'binwall') this.sound.tink(speed * 0.5);
        else if (other.label === 'ball') this.sound.tap(speed * 0.4);
        else this.sound.tap(speed);
      }
    }
  }
}

export { Body, Sleeping };
