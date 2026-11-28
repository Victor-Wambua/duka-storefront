import { afterEach, describe, expect, it, vi } from 'vitest';
import { showUpdateBanner, watchForUpdate } from '../src/lib/swUpdate';

function fakeContainer(controlled: boolean) {
  const listeners: Array<() => void> = [];
  return {
    controller: controlled ? ({} as ServiceWorker) : null,
    addEventListener: (_type: 'controllerchange', listener: () => void) => void listeners.push(listener),
    fire: () => listeners.forEach((l) => l()),
  };
}

function fakeDocument(state: DocumentVisibilityState) {
  const listeners: Array<() => void> = [];
  return {
    visibilityState: state,
    addEventListener: (_type: string, listener: () => void) => void listeners.push(listener),
    fire: () => listeners.forEach((l) => l()),
  };
}

describe('watchForUpdate', () => {
  it('ignores the first-ever visit, when the new worker simply takes control', () => {
    const container = fakeContainer(false);
    const onUpdate = vi.fn();
    watchForUpdate(container, { update: () => Promise.resolve() }, onUpdate, fakeDocument('visible'));
    container.fire();
    expect(onUpdate).not.toHaveBeenCalled();
  });

  it('announces a replaced worker once, however many times the event fires', () => {
    const container = fakeContainer(true);
    const onUpdate = vi.fn();
    watchForUpdate(container, { update: () => Promise.resolve() }, onUpdate, fakeDocument('visible'));
    container.fire();
    container.fire();
    expect(onUpdate).toHaveBeenCalledTimes(1);
  });

  it('asks the browser to look for a new worker when the tab becomes visible, not when it hides', () => {
    const doc = fakeDocument('hidden');
    const update = vi.fn(() => Promise.resolve());
    watchForUpdate(fakeContainer(true), { update }, vi.fn(), doc);
    doc.fire();
    expect(update).not.toHaveBeenCalled();
    doc.visibilityState = 'visible';
    doc.fire();
    expect(update).toHaveBeenCalledTimes(1);
  });

  it('does not throw when the update check fails (for example offline)', async () => {
    const doc = fakeDocument('visible');
    watchForUpdate(fakeContainer(true), { update: () => Promise.reject(new Error('offline')) }, vi.fn(), doc);
    expect(() => doc.fire()).not.toThrow();
    await Promise.resolve();
  });
});

describe('showUpdateBanner', () => {
  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = '';
  });

  it('adds the bar first on the page and says its message a moment later, inside a live region', () => {
    vi.useFakeTimers();
    showUpdateBanner(document, () => undefined);
    const bar = document.body.firstElementChild as HTMLElement;
    expect(bar.className).toBe('sw-update');
    const status = bar.querySelector('[role="status"]') as HTMLElement;
    expect(status.textContent).toBe('');
    vi.advanceTimersByTime(150);
    expect(status.textContent).toContain('new version');
  });

  it('reloads on request and goes away on "Not now" without reloading', () => {
    const reload = vi.fn();
    const bar = showUpdateBanner(document, reload);
    (bar.querySelector('.sw-update-reload') as HTMLButtonElement).click();
    expect(reload).toHaveBeenCalledTimes(1);

    const later = Array.from(bar.querySelectorAll('button')).find((b) => b.textContent === 'Not now')!;
    later.click();
    expect(document.body.contains(bar)).toBe(false);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('never moves keyboard focus', () => {
    const input = document.createElement('input');
    document.body.append(input);
    input.focus();
    showUpdateBanner(document, () => undefined);
    expect(document.activeElement).toBe(input);
  });
});
