/** Keyboard focus areas on the home screen. Content areas are listed top to bottom. */
export enum FocusArea {
  ViewMode,
  Filters,
  Recent,
  Tiles,
}

export const FocusAreaPrefix = {
  [FocusArea.ViewMode]: "viewMode-",
  [FocusArea.Filters]: "filter-",
  [FocusArea.Recent]: "recent-",
  [FocusArea.Tiles]: "tile-",
};
