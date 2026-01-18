import "@testing-library/jest-dom";
import { vi } from "vitest";

// Mock chrome API
if (typeof globalThis.chrome === "undefined") {
    (globalThis as { chrome?: unknown }).chrome = {
        storage: {
            local: {
                get: vi.fn((_keys, cb) => cb({})),
                set: vi.fn((_data, cb) => cb && cb()),
            },
        },
    };
}
