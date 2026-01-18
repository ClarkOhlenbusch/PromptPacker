import "@testing-library/jest-dom";

// Mock chrome API
if (typeof global.chrome === "undefined") {
    (global as any).chrome = {
        storage: {
            local: {
                get: vi.fn((_keys, cb) => cb({})),
                set: vi.fn((_data, cb) => cb && cb()),
            },
        },
    };
}
