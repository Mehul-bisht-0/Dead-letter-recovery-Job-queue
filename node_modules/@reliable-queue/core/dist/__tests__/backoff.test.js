"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const backoff_1 = require("../backoff");
(0, vitest_1.describe)('Exponential Backoff', () => {
    (0, vitest_1.it)('computes exponential growth', () => {
        // attempt 0 = base * 2^0 = 1000
        (0, vitest_1.expect)((0, backoff_1.computeBackoffBase)(0, 1000, 60000)).toBe(1000);
        // attempt 1 = base * 2^1 = 2000
        (0, vitest_1.expect)((0, backoff_1.computeBackoffBase)(1, 1000, 60000)).toBe(2000);
        // attempt 2 = base * 2^2 = 4000
        (0, vitest_1.expect)((0, backoff_1.computeBackoffBase)(2, 1000, 60000)).toBe(4000);
    });
    (0, vitest_1.it)('respects the cap', () => {
        (0, vitest_1.expect)((0, backoff_1.computeBackoffBase)(10, 1000, 5000)).toBe(5000);
    });
});
//# sourceMappingURL=backoff.test.js.map