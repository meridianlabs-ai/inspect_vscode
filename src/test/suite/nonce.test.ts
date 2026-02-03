import * as assert from "assert";
import { getNonce } from "../../core/nonce";

suite("Nonce Utilities Test Suite", () => {
  suite("getNonce", () => {
    test("should return a string of exactly 64 characters", () => {
      const nonce = getNonce();
      assert.strictEqual(nonce.length, 64);
    });

    test("should only contain alphanumeric characters", () => {
      const nonce = getNonce();
      const validPattern = /^[A-Za-z0-9]+$/;
      assert.ok(validPattern.test(nonce), "Nonce should only contain alphanumeric characters");
    });

    test("should generate different nonces on successive calls", () => {
      const nonce1 = getNonce();
      const nonce2 = getNonce();
      assert.notStrictEqual(nonce1, nonce2, "Consecutive nonces should be different");
    });

    test("should generate many unique nonces", () => {
      const nonces = new Set<string>();
      const iterations = 100;

      for (let i = 0; i < iterations; i++) {
        nonces.add(getNonce());
      }

      assert.strictEqual(nonces.size, iterations, "All generated nonces should be unique");
    });

    test("should contain characters from the expected character set", () => {
      const expectedChars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
      const nonce = getNonce();

      for (const char of nonce) {
        assert.ok(
          expectedChars.includes(char),
          `Character '${char}' should be in the expected character set`
        );
      }
    });

    test("should have reasonable character distribution", () => {
      // Generate a longer sample to check distribution
      const sampleSize = 10;
      const allChars: string[] = [];

      for (let i = 0; i < sampleSize; i++) {
        allChars.push(...getNonce().split(""));
      }

      // Check that we have both upper and lower case letters and numbers
      const hasUpperCase = allChars.some(c => /[A-Z]/.test(c));
      const hasLowerCase = allChars.some(c => /[a-z]/.test(c));
      const hasNumbers = allChars.some(c => /[0-9]/.test(c));

      assert.ok(hasUpperCase, "Should contain uppercase letters");
      assert.ok(hasLowerCase, "Should contain lowercase letters");
      assert.ok(hasNumbers, "Should contain numbers");
    });
  });
});
