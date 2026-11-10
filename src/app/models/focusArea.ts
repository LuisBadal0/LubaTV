/** Keyboard focus areas on the home screen. Content areas are listed top to bottom. */
export enum FocusArea {
  ViewMode,
  Filters,
  Recent,
  /** Rows of favorite categories on the All view; each row scrolls sideways. */
  Shelves,
  /** Categories matching a country search. */
  CountryCategories,
  Tiles,
}

export const FocusAreaPrefix = {
  [FocusArea.ViewMode]: "viewMode-",
  [FocusArea.Filters]: "filter-",
  [FocusArea.Recent]: "recent-",
  [FocusArea.Shelves]: "shelf-",
  [FocusArea.CountryCategories]: "ccat-",
  [FocusArea.Tiles]: "tile-",
};
