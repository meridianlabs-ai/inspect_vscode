import * as assert from "assert";
import { randomInt, cryptoRandom } from "../../core/random";

suite("Random Utilities Test Suite", () => {
  suite("cryptoRandom", () => {
    test("should return a number between 0 and 1", () => {
      for (let i = 0; i < 100; i++) {
        const value = cryptoRandom();
        assert.ok(value >= 0, `Value ${value} should be >= 0`);
        assert.ok(value < 1, `Value ${value} should be < 1`);
      }
    });

    test("should return different values on successive calls", () => {
      const values = new Set<number>();
      const iterations = 100;

      for (let i = 0; i < iterations; i++) {
        values.add(cryptoRandom());
      }

      // Allow for very unlikely collision (should be essentially 100)
      assert.ok(
        values.size > iterations * 0.95,
        "Most random values should be unique"
      );
    });

    test("should have reasonable distribution", () => {
      const sampleSize = 1000;
      const buckets = [0, 0, 0, 0, 0]; // 5 buckets: 0-0.2, 0.2-0.4, 0.4-0.6, 0.6-0.8, 0.8-1.0

      for (let i = 0; i < sampleSize; i++) {
        const value = cryptoRandom();
        const bucketIndex = Math.min(Math.floor(value * 5), 4);
        buckets[bucketIndex]++;
      }

      // Each bucket should have roughly 20% of values (allow 10-30%)
      for (let i = 0; i < buckets.length; i++) {
        const percentage = buckets[i] / sampleSize;
        assert.ok(
          percentage > 0.1 && percentage < 0.3,
          `Bucket ${i} has ${percentage * 100}% of values, expected roughly 20%`
        );
      }
    });
  });

  suite("randomInt", () => {
    test("should return integer within specified range", () => {
      for (let i = 0; i < 100; i++) {
        const value = randomInt(0, 10);
        assert.ok(
          Number.isInteger(value),
          `Value ${value} should be an integer`
        );
        assert.ok(value >= 0, `Value ${value} should be >= 0`);
        assert.ok(value < 10, `Value ${value} should be < 10`);
      }
    });

    test("should handle negative ranges", () => {
      for (let i = 0; i < 100; i++) {
        const value = randomInt(-10, 0);
        assert.ok(value >= -10, `Value ${value} should be >= -10`);
        assert.ok(value < 0, `Value ${value} should be < 0`);
      }
    });

    test("should handle ranges spanning positive and negative", () => {
      for (let i = 0; i < 100; i++) {
        const value = randomInt(-5, 5);
        assert.ok(value >= -5, `Value ${value} should be >= -5`);
        assert.ok(value < 5, `Value ${value} should be < 5`);
      }
    });

    test("should handle floating point min and max by rounding", () => {
      // min is ceil'd, max is floor'd
      // randomInt(0.5, 10.9) should behave like randomInt(1, 10)
      for (let i = 0; i < 100; i++) {
        const value = randomInt(0.5, 10.9);
        assert.ok(
          Number.isInteger(value),
          `Value ${value} should be an integer`
        );
        assert.ok(value >= 1, `Value ${value} should be >= 1 (ceil of 0.5)`);
        assert.ok(value < 10, `Value ${value} should be < 10 (floor of 10.9)`);
      }
    });

    test("should return min when range is 1", () => {
      for (let i = 0; i < 10; i++) {
        const value = randomInt(5, 6);
        assert.strictEqual(
          value,
          5,
          "Should always return 5 when range is [5,6)"
        );
      }
    });

    test("should cover the entire range over many iterations", () => {
      const min = 0;
      const max = 5;
      const seen = new Set<number>();

      for (let i = 0; i < 1000; i++) {
        seen.add(randomInt(min, max));
      }

      // Should have seen all values 0, 1, 2, 3, 4
      for (let expected = min; expected < max; expected++) {
        assert.ok(
          seen.has(expected),
          `Should have generated ${expected} at least once`
        );
      }

      // Should not have seen max value
      assert.ok(!seen.has(max), `Should not generate max value ${max}`);
    });

    test("should have roughly uniform distribution", () => {
      const min = 0;
      const max = 5;
      const counts = new Map<number, number>();
      const iterations = 5000;

      for (let i = 0; i < iterations; i++) {
        const value = randomInt(min, max);
        counts.set(value, (counts.get(value) || 0) + 1);
      }

      const expectedCount = iterations / (max - min);
      const tolerance = 0.2; // Allow 20% deviation

      for (let value = min; value < max; value++) {
        const count = counts.get(value) || 0;
        const deviation = Math.abs(count - expectedCount) / expectedCount;
        assert.ok(
          deviation < tolerance,
          `Value ${value} appeared ${count} times, expected ~${expectedCount} (deviation: ${(deviation * 100).toFixed(1)}%)`
        );
      }
    });

    test("should handle large ranges", () => {
      const min = 1000;
      const max = 5000;

      for (let i = 0; i < 100; i++) {
        const value = randomInt(min, max);
        assert.ok(value >= min, `Value ${value} should be >= ${min}`);
        assert.ok(value < max, `Value ${value} should be < ${max}`);
      }
    });
  });
});
