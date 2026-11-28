/**
 * Tells a returning visitor that a newer build has been installed.
 *
 * The service worker installs a new build in the background and takes over straight away, but the
 * page that is already open keeps running the old code until it is reloaded. Without a prompt the
 * visitor would keep seeing the old version for as long as they stayed on the page.
 */

export interface UpdateWatchTarget {
  controller: ServiceWorker | null;
  addEventListener(type: 'controllerchange', listener: () => void): void;
}

export interface UpdateCheck {
  update(): Promise<unknown>;
}

export interface VisibilitySource {
  visibilityState: DocumentVisibilityState;
  addEventListener(type: 'visibilitychange', listener: () => void): void;
}

/**
 * Calls `onUpdate` once when a new worker replaces the one that controlled this page at the start.
 * A first-ever visit has no earlier worker, so it never counts as an update. Also asks the browser
 * to look for a new worker whenever the tab becomes visible again, so a long-lived tab notices.
 */
export function watchForUpdate(
  container: UpdateWatchTarget,
  registration: UpdateCheck,
  onUpdate: () => void,
  doc: VisibilitySource = document,
): void {
  const hadController = container.controller !== null;
  let announced = false;
  container.addEventListener('controllerchange', () => {
    if (!hadController || announced) return;
    announced = true;
    onUpdate();
  });
  doc.addEventListener('visibilitychange', () => {
    if (doc.visibilityState === 'visible') registration.update().catch(() => undefined);
  });
}

/**
 * Shows a bar at the top of the page. The message is added a moment after the bar so that screen
 * readers, which only announce changes inside a live region that already exists, say it aloud.
 * Focus is never moved: the visitor may be in the middle of something.
 */
export function showUpdateBanner(doc: Document, reload: () => void = () => location.reload()): HTMLElement {
  const bar = doc.createElement('div');
  bar.className = 'sw-update';

  const message = doc.createElement('p');
  message.setAttribute('role', 'status');

  const reloadButton = doc.createElement('button');
  reloadButton.type = 'button';
  reloadButton.className = 'sw-update-reload';
  reloadButton.textContent = 'Reload';
  reloadButton.addEventListener('click', reload);

  const laterButton = doc.createElement('button');
  laterButton.type = 'button';
  laterButton.textContent = 'Not now';
  laterButton.addEventListener('click', () => bar.remove());

  bar.append(message, reloadButton, laterButton);
  doc.body.prepend(bar);
  setTimeout(() => {
    message.textContent = 'A new version is ready. Reload to use it.';
  }, 100);
  return bar;
}
