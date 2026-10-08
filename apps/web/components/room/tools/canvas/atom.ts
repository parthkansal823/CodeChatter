/**
 * A value with subscribers, read in React through useSyncExternalStore.
 * The canvas keeps fast-changing UI state (camera, selection, guides) here
 * instead of in React state, so a pointer move re-renders only the pieces
 * that read the value that changed.
 */
export class Atom<T> {
  private listeners = new Set<() => void>();
  private value: T;

  constructor(value: T) {
    this.value = value;
  }

  get = (): T => this.value;

  set(next: T) {
    if (Object.is(next, this.value)) return;
    this.value = next;
    for (const listener of [...this.listeners]) listener();
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
}
