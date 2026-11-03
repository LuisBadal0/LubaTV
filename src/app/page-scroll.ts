/**
 * The pages scroll inside `#page-scroll` (see app.component.html) instead of the window, so
 * the scrollbar can start below the window buttons in the top-right corner.
 */
export function pageScroller(): HTMLElement {
  return document.getElementById("page-scroll") ?? document.documentElement;
}
