// Class kernel of the typed code-generation benchmark
// (docs/results/typed-codegen-baseline-v1.md). Typed classes do not lower
// natively yet ("module instance classes require scoped contract and
// construction lowering"), so this file is a separate image that is allowed
// to fall back to general semantics; it measures that gap, not typed code.
// Erasable syntax only; Node 26.13.1 runs the stripped text.

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
class Shape {
  readonly scale: number;
  constructor(scale: number) {
    this.scale = scale;
  }
  area(): number {
    return this.scale;
  }
}
class Rectangle extends Shape {
  readonly width: number;
  readonly height: number;
  constructor(scale: number, width: number, height: number) {
    super(scale);
    this.width = width;
    this.height = height;
  }
  override area(): number {
    return this.scale * this.width * this.height;
  }
}
class Triangle extends Shape {
  readonly base: number;
  constructor(scale: number, base: number) {
    super(scale);
    this.base = base;
  }
  override area(): number {
    return (this.scale * this.base * this.base) / 2;
  }
}

// --- Classes: fields, methods and a polymorphic method call. ---
export function classes(scale: number): number {
  const particles: Particle[] = [];
  for (let i = 0; i < 256; i++)
    particles.push(
      new Particle(i % 100, (i * 3) % 100, (i % 7) - 3, (i % 5) - 2),
    );
  const shapes: Shape[] = [];
  for (let i = 0; i < 256; i++)
    shapes.push(
      i % 3 === 0
        ? new Shape(i & 7)
        : i % 3 === 1
          ? new Rectangle(i & 7, i % 11, i % 13)
          : new Triangle(i & 7, i % 9),
    );
  let checksum = 0;
  for (let round = 0; round < scale; round++) {
    let energy = 0;
    for (let i = 0; i < particles.length; i++) {
      const particle = particles[i];
      if (particle === undefined) throw "particle";
      particle.step(0.5);
      energy += particle.energy();
    }
    let area = 0;
    for (let i = 0; i < shapes.length; i++) {
      const shape = shapes[i];
      if (shape === undefined) throw "shape";
      area += shape.area();
    }
    checksum = (checksum + Math.floor(energy) + Math.floor(area)) | 0;
  }
  return checksum;
}
