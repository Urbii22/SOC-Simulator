const UINT32_RANGE = 0x1_0000_0000;

function hashLabel(label: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < label.length; index++) {
    hash ^= label.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** Small, stable PRNG. All procedural choices must flow through this class. */
export class SeededRng {
  readonly seed: number;
  private state: number;

  constructor(seed: number) {
    this.seed = seed >>> 0;
    this.state = this.seed;
  }

  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let value = Math.imul(this.state ^ this.state >>> 15, 1 | this.state);
    value = (value + Math.imul(value ^ value >>> 7, 61 | value)) ^ value;
    return ((value ^ value >>> 14) >>> 0) / UINT32_RANGE;
  }

  int(min: number, max: number): number {
    if (!Number.isSafeInteger(min) || !Number.isSafeInteger(max) || max < min) throw new RangeError('Invalid deterministic integer range');
    return min + Math.floor(this.next() * (max - min + 1));
  }

  pick<T>(values: readonly T[]): T {
    if (!values.length) throw new RangeError('Cannot pick from an empty pool');
    return values[this.int(0, values.length - 1)];
  }

  shuffle<T>(values: readonly T[]): T[] {
    const result = [...values];
    for (let index = result.length - 1; index > 0; index--) {
      const swap = this.int(0, index);
      [result[index], result[swap]] = [result[swap], result[index]];
    }
    return result;
  }

  fork(label: string): SeededRng {
    return new SeededRng((this.seed ^ hashLabel(label)) >>> 0);
  }
}
