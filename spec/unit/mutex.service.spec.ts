import { beforeEach, describe, expect, test } from "bun:test";
import { MutexTimeoutError } from "../../src/errors";
import { MutexService } from "../../src/services/mutex.service";

describe("MutexService", () => {
  let mutexService: MutexService;

  beforeEach(() => {
    mutexService = new MutexService();
  });

  test("should acquire mutex successfully", async () => {
    const result = await mutexService.acquireWithTimeout(1000);

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      const release = result.value;
      expect(typeof release).toBe("function");
      release();
    }
  });

  test("should release mutex after use", async () => {
    const result1 = await mutexService.acquireWithTimeout(1000);
    expect(result1.isOk()).toBe(true);

    if (result1.isOk()) {
      const release1 = result1.value;
      release1();
    }

    // Should be able to acquire again immediately after release
    const result2 = await mutexService.acquireWithTimeout(1000);
    expect(result2.isOk()).toBe(true);

    if (result2.isOk()) {
      result2.value();
    }
  });

  test("should only allow one operation to hold mutex at a time", async () => {
    const result1 = await mutexService.acquireWithTimeout(1000);
    expect(result1.isOk()).toBe(true);

    let secondAcquired = false;
    const acquirePromise = mutexService
      .acquireWithTimeout(100)
      .then((result) => {
        if (result.isOk()) {
          secondAcquired = true;
          result.value();
        }
      });

    // Wait a bit to ensure second acquire is waiting
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Second mutex should not be acquired yet
    expect(secondAcquired).toBe(false);

    // Release first mutex
    if (result1.isOk()) {
      result1.value();
    }

    // Wait for second acquire to complete
    await acquirePromise;
    expect(secondAcquired).toBe(true);
  });

  test("should timeout when mutex is held longer than timeout", async () => {
    const result1 = await mutexService.acquireWithTimeout(1000);
    expect(result1.isOk()).toBe(true);

    // Try to acquire with short timeout while first is held
    const startTime = Date.now();
    const result2 = await mutexService.acquireWithTimeout(100);
    const elapsed = Date.now() - startTime;

    expect(result2.isErr()).toBe(true);
    if (result2.isErr()) {
      expect(result2.error).toBeInstanceOf(MutexTimeoutError);
    }

    // Should have timed out around 100ms
    expect(elapsed).toBeGreaterThanOrEqual(90);
    expect(elapsed).toBeLessThan(200);

    // Release first mutex
    if (result1.isOk()) {
      result1.value();
    }
  });

  test("should handle multiple concurrent requests waiting for mutex", async () => {
    const result1 = await mutexService.acquireWithTimeout(1000);
    expect(result1.isOk()).toBe(true);

    // Start multiple concurrent acquire attempts
    const acquirePromises = Array.from({ length: 5 }, () =>
      mutexService.acquireWithTimeout(500)
    );

    // Wait a bit to ensure all are waiting
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Release first mutex
    if (result1.isOk()) {
      result1.value();
    }

    // All should eventually acquire (one at a time)
    const results = await Promise.all(acquirePromises);

    // First one should succeed immediately
    expect(results[0].isOk()).toBe(true);

    // Others might succeed or timeout depending on timing
    // At least one should succeed
    const successCount = results.filter((r) => r.isOk()).length;
    expect(successCount).toBeGreaterThan(0);

    // Release all acquired mutexes
    results.forEach((result) => {
      if (result.isOk()) {
        result.value();
      }
    });
  });

  test("should handle zero timeout", async () => {
    const result1 = await mutexService.acquireWithTimeout(1000);
    expect(result1.isOk()).toBe(true);

    // Try to acquire with zero timeout
    const result2 = await mutexService.acquireWithTimeout(0);

    expect(result2.isErr()).toBe(true);
    if (result2.isErr()) {
      expect(result2.error).toBeInstanceOf(MutexTimeoutError);
    }

    // Release first mutex
    if (result1.isOk()) {
      result1.value();
    }
  });

  test("should handle very long timeout", async () => {
    const result1 = await mutexService.acquireWithTimeout(1000);
    expect(result1.isOk()).toBe(true);

    // Try to acquire with very long timeout
    const acquirePromise = mutexService.acquireWithTimeout(5000);

    // Wait a bit
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Release first mutex
    if (result1.isOk()) {
      result1.value();
    }

    // Second should succeed
    const result2 = await acquirePromise;
    expect(result2.isOk()).toBe(true);

    if (result2.isOk()) {
      result2.value();
    }
  });
});
