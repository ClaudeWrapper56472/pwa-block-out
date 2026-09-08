/**
 * PCG32 (XSH-RR).
 *
 * One seeded generator drives a whole generation run: the board shape, the
 * walls, every reverse move. The same seed therefore always produces the
 * identical level, which is what lets a failing board be reproduced from the
 * seed alone. Nothing in the generator may reach for Math.random().
 *
 * 64-bit state in BigInt. The generator runs a few thousand times per level, so
 * BigInt's cost is invisible next to the search that checks the result.
 */

const MULTIPLIER = 6364136223846793005n;
const MASK64 = 0xffffffffffffffffn;
const DEFAULT_INC = 1442695040888963407n;

export class Rng {
	constructor(seed = 0) {
		this.setSeed(seed);
	}

	setSeed(seed) {
		this._inc = DEFAULT_INC;
		this._state = 0n;
		this.nextUint32();
		this._state = (this._state + (BigInt(seed) & MASK64)) & MASK64;
		this.nextUint32();
	}

	/** Draws a fresh seed from the platform, for when no seed was asked for. */
	static randomSeed() {
		const words = new Uint32Array(2);
		crypto.getRandomValues(words);
		// Kept inside 2^53 so it survives a round trip through JSON.
		return words[0] * 0x200000 + (words[1] >>> 11);
	}

	nextUint32() {
		const previous = this._state;
		this._state = (previous * MULTIPLIER + this._inc) & MASK64;
		const xorshifted = Number(((previous >> 18n) ^ previous) >> 27n & 0xffffffffn);
		const rotation = Number(previous >> 59n);
		return ((xorshifted >>> rotation) | (xorshifted << (-rotation & 31))) >>> 0;
	}

	/** Inclusive at both ends. */
	randiRange(from, to) {
		const span = to - from + 1;
		return span <= 0 ? from : from + (this.nextUint32() % span);
	}

	chance(percent) {
		return this.randiRange(1, 100) <= percent;
	}

	/** One item, or undefined from an empty list. */
	pick(items) {
		return items.length === 0 ? undefined : items[this.randiRange(0, items.length - 1)];
	}

	/**
	 * Fisher-Yates in place. Array.prototype.sort with a random comparator would
	 * neither be uniform nor reproducible.
	 */
	shuffle(items) {
		for (let i = items.length - 1; i > 0; i -= 1) {
			const j = this.randiRange(0, i);
			const swap = items[i];
			items[i] = items[j];
			items[j] = swap;
		}
		return items;
	}
}
