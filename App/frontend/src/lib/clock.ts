// "Now" for countdowns such as "Expires in 31 hours". The real backend runs on the real
// clock; the mock API runs on the date its dummy data was generated for, so main.tsx
// points this at that date while VITE_USE_MOCKS=true.

let source: () => number = () => Date.now();

export function setClock(now: () => number) {
  source = now;
}

export const nowMs = () => source();
