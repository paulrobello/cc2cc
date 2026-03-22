import "@testing-library/jest-dom";

// jsdom does not implement scrollIntoView
Element.prototype.scrollIntoView = jest.fn();

// jsdom does not implement crypto.randomUUID
if (!globalThis.crypto?.randomUUID) {
  Object.defineProperty(globalThis, "crypto", {
    value: {
      ...globalThis.crypto,
      randomUUID: () => "00000000-0000-0000-0000-000000000000",
    },
    writable: true,
  });
}
