import { afterEach, expect, it, vi } from "vitest";
import { initSandboxRuntimeModular } from "./init";
import { createMockTimeline, resetRuntimeFixtureDom } from "./runtimeSeekFixture.test-helpers";

// A split of one audible video: both halves play their own sound from the same file.
it("hands a split audible video from one half to the next at the split, like audio", () => {
  resetRuntimeFixtureDom();
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  let now = 0;
  let id = 0;
  const callbacks = new Map<number, FrameRequestCallback>();
  vi.spyOn(performance, "now").mockImplementation(() => now);
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
    callbacks.set(++id, callback);
    return id;
  });
  vi.spyOn(window, "cancelAnimationFrame").mockImplementation((key) => {
    callbacks.delete(key);
  });
  document.body.innerHTML = `<div data-composition-id="main" data-root="true" data-duration="12">
    <video id="first" data-start="0" data-duration="6" data-media-start="0" data-has-audio="true" src="/take.mp4"></video>
    <video id="second" data-start="6" data-duration="6" data-media-start="6" data-has-audio="true" src="/take.mp4"></video>
  </div>`;
  const playhead = () => window.__player!.getTime();
  const events: string[] = [];
  const fakeElementClock = (el: HTMLVideoElement) => {
    let at = 0;
    let since: number | null = null;
    const read = () => (since === null ? at : at + (now - since) / 1000);
    Object.defineProperty(el, "duration", { value: 12, configurable: true });
    Object.defineProperty(el, "readyState", { value: 4, configurable: true });
    Object.defineProperty(el, "paused", { get: () => since === null, configurable: true });
    Object.defineProperty(el, "currentTime", {
      get: read,
      set: (value: number) => {
        at = value;
        if (since !== null) since = now;
      },
      configurable: true,
    });
    el.play = vi.fn(() => {
      events.push(`${el.id} play @${playhead().toFixed(3)}`);
      since ??= now;
      return Promise.resolve();
    });
    el.pause = vi.fn(() => {
      if (since !== null) events.push(`${el.id} pause at ${read().toFixed(3)}`);
      at = read();
      since = null;
    });
    el.load = vi.fn();
  };
  const [first, second] = [...document.querySelectorAll<HTMLVideoElement>("video")];
  fakeElementClock(first!);
  fakeElementClock(second!);
  window.__timelines = { main: createMockTimeline(12) };
  initSandboxRuntimeModular();
  window.__player!.seek(5);
  window.__player!.play();
  for (let frame = 0; frame < 90; frame++) {
    for (let ms = 0; ms < 16; ms++) {
      now += 1;
      vi.advanceTimersByTime(1);
    }
    const pending = [...callbacks.values()];
    callbacks.clear();
    for (const callback of pending) callback(now);
  }
  const outgoing = events.find((event) => event.startsWith("first pause"));
  const incoming = events.find((event) => event.startsWith("second play"));
  expect(outgoing, events.join("\n")).toBeDefined();
  expect(incoming, events.join("\n")).toBeDefined();
  // The first half sounds to within a few ms of the split, and the second starts a tick before it.
  expect(Number(outgoing!.split(" ").pop())).toBeGreaterThanOrEqual(5.99);
  expect(Number(outgoing!.split(" ").pop())).toBeLessThan(6);
  expect(Number(incoming!.split("@").pop())).toBeGreaterThanOrEqual(5.95);
});

afterEach(() => {
  window.__hfRuntimeTeardown?.();
  vi.useRealTimers();
  vi.restoreAllMocks();
  resetRuntimeFixtureDom();
});
