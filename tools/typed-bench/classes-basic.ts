// Class kernel without inheritance of the typed code-generation benchmark
// (docs/design-typed-classes.md, C1): fields, constructors and method calls
// on module classes, which lower natively. Erasable syntax only; Node
// 26.13.1 runs the stripped text.

class Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  constructor(x: number, y: number, vx: number, vy: number) {
    this.x = x;
    this.y = y;
    this.vx = vx;
    this.vy = vy;
  }
  step(dt: number): void {
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    if (this.x < 0 || this.x > 100) this.vx = -this.vx;
    if (this.y < 0 || this.y > 100) this.vy = -this.vy;
  }
  energy(): number {
    return this.vx * this.vx + this.vy * this.vy;
  }
}
class Vector {
  readonly x: number;
  readonly y: number;
  constructor(x: number, y: number) {
    this.x = x;
    this.y = y;
  }
  add(other: Vector): Vector {
    return new Vector(this.x + other.x, this.y + other.y);
  }
  dot(other: Vector): number {
    return this.x * other.x + this.y * other.y;
  }
}

// --- Classes: fields, monomorphic method calls and instance allocation. ---
export function basicClasses(scale: number): number {
  const particles: Particle[] = [];
  for (let i = 0; i < 256; i++)
    particles.push(
      new Particle(i % 100, (i * 3) % 100, (i % 7) - 3, (i % 5) - 2),
    );
  const step = new Vector(1, 0.5);
  let checksum = 0;
  for (let round = 0; round < scale; round++) {
    let energy = 0;
    for (let i = 0; i < particles.length; i++) {
      const particle = particles[i];
      if (particle === undefined) throw "particle";
      particle.step(0.5);
      energy += particle.energy();
    }
    let position = new Vector(round % 7, 0);
    for (let i = 0; i < 64; i++) position = position.add(step);
    checksum =
      (checksum + Math.floor(energy) + Math.floor(position.dot(step))) | 0;
  }
  return checksum;
}
