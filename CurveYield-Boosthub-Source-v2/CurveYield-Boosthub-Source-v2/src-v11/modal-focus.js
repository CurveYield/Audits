const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

function visibleFocusable(container) {
  return [...container.querySelectorAll(FOCUSABLE_SELECTOR)].filter((element) => {
    if (element.hidden || element.getAttribute("aria-hidden") === "true") return false;
    const style = globalThis.getComputedStyle?.(element);
    return !style || (style.visibility !== "hidden" && style.display !== "none");
  });
}

export function createModalFocusManager({ container, onEscape = () => {} }) {
  let opener = null;

  function handleKeydown(event) {
    if (container.hidden) return;
    if (event.key === "Escape") {
      event.preventDefault();
      onEscape();
      return;
    }
    if (event.key !== "Tab") return;
    const focusable = visibleFocusable(container);
    if (!focusable.length) {
      event.preventDefault();
      container.querySelector('[role="dialog"]')?.focus?.();
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement;
    if (event.shiftKey && (active === first || !container.contains(active))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (active === last || !container.contains(active))) {
      event.preventDefault();
      first.focus();
    }
  }

  function open(trigger = document.activeElement) {
    opener = trigger && typeof trigger.focus === "function" ? trigger : null;
    container.addEventListener("keydown", handleKeydown);
    queueMicrotask(() => visibleFocusable(container)[0]?.focus?.());
  }

  function close() {
    container.removeEventListener("keydown", handleKeydown);
    const target = opener;
    opener = null;
    queueMicrotask(() => target?.focus?.());
  }

  return { open, close, handleKeydown };
}
