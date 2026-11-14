import { MENU_PINNED } from "../models/localStorage";

/** On the root element while the menu is kept open, so pages make room for it (styles.css). */
export const MENU_PINNED_CLASS = "lt-menu-pinned";

/** Whether the user chose to keep the menu open. */
export function isMenuPinned(): boolean {
  return localStorage.getItem(MENU_PINNED) === "true";
}

/** Makes the pages leave room for an open menu, or take it back. */
export function applyMenuPinned(pinned: boolean) {
  document.documentElement.classList.toggle(MENU_PINNED_CLASS, pinned);
}

export function setMenuPinned(pinned: boolean) {
  localStorage.setItem(MENU_PINNED, String(pinned));
  applyMenuPinned(pinned);
}
