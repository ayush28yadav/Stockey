/*
    Bot Service — Strategy Shared Utilities

    Purpose:
    Small, pure helper functions shared by all bot strategies. Keeping these
    in one place avoids duplication and makes the strategies easier to read
    and test.

    Design rationale:
    - All helpers are pure (no side effects) so they can be unit-tested in
      isolation and reasoned about deterministically.
    - Randomness is injected via a `random` function (defaulting to
      `Math.random`) so tests can supply a seeded PRNG for reproducible
      behaviour.
*/

/**
 * Return a random integer in the inclusive range [min, max].
 *
 * @param {number} min - Lower bound (inclusive).
 * @param {number} max - Upper bound (inclusive).
 * @param {() => number} [random] - Random source in [0, 1). Defaults to Math.random.
 * @returns {number} A random integer between min and max inclusive.
 */
export function randomInt(min, max, random = Math.random) {
    const lo = Math.ceil(min);
    const hi = Math.floor(max);
    return Math.floor(random() * (hi - lo + 1)) + lo;
}

/**
 * Pick a random element from an array.
 *
 * @template T
 * @param {T[]} array - The array to pick from.
 * @param {() => number} [random] - Random source in [0, 1). Defaults to Math.random.
 * @returns {T} A randomly selected element.
 */
export function pickRandom(array, random = Math.random) {
    return array[Math.floor(random() * array.length)];
}

/**
 * Compute the arithmetic mean of an array of numbers.
 *
 * @param {number[]} values - Numeric values.
 * @returns {number} The mean, or 0 for an empty array.
 */
export function average(values) {
    if (values.length === 0) return 0;
    return values.reduce((sum, value) => sum + value, 0) / values.length;
}

/**
 * Round a price to 2 decimal places (the precision used by the API).
 *
 * @param {number} price - Raw price.
 * @returns {number} Price rounded to 2 decimals.
 */
export function roundPrice(price) {
    return Math.round(price * 100) / 100;
}