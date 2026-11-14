import { Component, EventEmitter, Input, OnChanges, OnDestroy, Output, SimpleChanges } from "@angular/core";
import { invoke } from "@tauri-apps/api/core";
import { splitCountryPrefix } from "../countries";
import { MemoryService } from "../memory.service";
import { Channel } from "../models/channel";
import { Filters } from "../models/filters";
import { ViewMode } from "../models/viewMode";

/** How many categories the backend returns per page. */
const PAGE_SIZE = 36;

/**
 * The list of categories beside an open category, to move between them without going back:
 * favorite categories first, then the rest, with a box to filter them by name.
 */
@Component({
  selector: "app-category-pane",
  templateUrl: "./category-pane.component.html",
  styleUrl: "./category-pane.component.css",
  standalone: false,
})
export class CategoryPaneComponent implements OnChanges, OnDestroy {
  /** Home's filters: the list uses their sources, media types and sort. */
  @Input() filters?: Filters;
  /** Changes when the sources or media types do, so the list loads again. */
  @Input() reloadKey = "";
  /** The open category. */
  @Input() activeId?: number;
  @Output() open = new EventEmitter<Channel>();

  categories: Channel[] = [];
  query = "";
  reachedEnd = true;
  loading = false;
  private page = 1;
  private request = 0;
  private timer?: ReturnType<typeof setTimeout>;

  constructor(public memory: MemoryService) {}

  ngOnChanges(changes: SimpleChanges) {
    if (changes["reloadKey"] || changes["filters"]) this.load();
  }

  ngOnDestroy() {
    clearTimeout(this.timer);
  }

  label(group: Channel) {
    return splitCountryPrefix(group.name ?? "");
  }

  /** Favorites have their own section, except while filtering. */
  listed(): Channel[] {
    if (this.query) return this.categories;
    return this.categories.filter((group) => !this.memory.isFavoriteGroup(group.id));
  }

  onQuery(value: string) {
    this.query = value.trim();
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.load(), 250);
  }

  clearQuery(input: HTMLInputElement) {
    input.value = "";
    this.onQuery("");
  }

  async load(more = false) {
    if (!this.filters) return;
    const request = ++this.request;
    this.page = more ? this.page + 1 : 1;
    this.loading = true;
    try {
      const items: Channel[] = await invoke("search", {
        filters: {
          ...this.filters,
          view_type: ViewMode.Categories,
          page: this.page,
          query: this.query,
          use_keywords: false,
          group_id: undefined,
          series_id: undefined,
          season: undefined,
          country: undefined,
        },
      });
      // A newer request (more typing) answers instead.
      if (request != this.request) return;
      this.categories = more ? this.categories.concat(items) : items;
      this.reachedEnd = items.length < PAGE_SIZE;
    } catch (e) {
      console.error(e);
    }
    if (request == this.request) this.loading = false;
  }
}
