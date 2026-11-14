import {
  AfterViewInit,
  Component,
  ElementRef,
  HostListener,
  NgZone,
  OnDestroy,
  ViewChild,
} from "@angular/core";
import { Router } from "@angular/router";
import { AllowIn, ShortcutInput } from "ng-keyboard-shortcuts";
import {
  Subscription,
  debounceTime,
  distinctUntilChanged,
  filter,
  fromEvent,
  map,
  skip,
} from "rxjs";
import { MemoryService } from "../memory.service";
import { Channel } from "../models/channel";
import { ViewMode } from "../models/viewMode";
import { MediaType } from "../models/mediaType";
import { ToastrService } from "ngx-toastr";
import { FocusArea, FocusAreaPrefix } from "../models/focusArea";
import { invoke } from "@tauri-apps/api/core";
import { Source } from "../models/source";
import { Filters } from "../models/filters";
import { SourceType } from "../models/sourceType";
import { animate, state, style, transition, trigger } from "@angular/animations";
import { ErrorService } from "../error.service";
import { Settings } from "../models/settings";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { SortType } from "../models/sortType";
import { getVersion } from "@tauri-apps/api/app";
import { NgbModal } from "@ng-bootstrap/ng-bootstrap";
import { WhatsNewModalComponent } from "../whats-new-modal/whats-new-modal.component";
import { LegacyDataModalComponent } from "../legacy-data-modal/legacy-data-modal.component";
import { LegacyData } from "../models/legacyData";
import { LAST_SEEN_VERSION } from "../models/localStorage";
import { isInputFocused } from "../utils";
import { Node } from "../models/node";
import { NodeType } from "../models/nodeType";
import { Stack } from "../models/stack";
import { GroupPreview } from "../models/groupPreview";
import { SIDEBAR_VIEWS } from "../sidebar/sidebar.component";
import { pageScroller } from "../page-scroll";

import { BulkActionType } from '../models/bulkActionType';
import { Country, findCountry, splitCountryPrefix } from "../countries";
import { EPG } from "../models/epg";

/** A row of a favorite category's first items on the All view. */
interface Shelf {
  group: Channel;
  code?: string;
  title: string;
  items: Channel[];
}

const SHELF_LIMIT = 6;
const SHELF_SIZE = 14;
const COUNTRY_CATEGORY_LIMIT = 8;

@Component({
    selector: "app-home",
    templateUrl: "./home.component.html",
    styleUrl: "./home.component.css",
    animations: [
        trigger("fadeInOut", [
            transition(":enter", [
                style({ opacity: 0, height: 0, padding: "0", margin: "0" }),
                animate("250ms", style({ opacity: 1, height: "*", padding: "*", margin: "*" })),
            ]),
            transition(":leave", [
                style({ opacity: 1, height: "*", padding: "*", margin: "*" }),
                animate("250ms", style({ opacity: 0, height: 0, padding: "0", margin: "0" })),
            ]),
        ]),
        trigger("fade", [
            state("visible", style({
                opacity: 1,
            })),
            state("hidden", style({
                opacity: 0,
            })),
            transition("visible => hidden", [animate("250ms ease-out")]),
            transition("hidden => visible", [animate("250ms ease-in")]),
        ]),
    ],
    standalone: false
})
export class HomeComponent implements AfterViewInit, OnDestroy {
  channels: Channel[] = [];
  readonly viewModeEnum = ViewMode;
  bulkActionType = BulkActionType;
  readonly mediaTypeEnum = MediaType;
  @ViewChild("search") search!: ElementRef;
  shortcuts: ShortcutInput[] = [];
  focus: number = 0;
  focusArea = FocusArea.Tiles;
  viewType = ViewMode.All;
  subscriptions: Subscription[] = [];
  filters?: Filters;
  chkLiveStream = true;
  chkMovie = true;
  chkSerie = true;
  reachedMax = false;
  readonly PAGE_SIZE = 36;
  channelsVisible = true;
  prevSearchValue: String = "";
  loading = false;
  nodeStack: Stack = new Stack();
  showScrollTop = false;
  hasXtream = false;
  /** Continue watching row: latest history items and when each was watched (Unix seconds). */
  recent: Channel[] = [];
  lastWatched: Record<number, number> = {};
  /** Item counts and logos for category tiles, by group id. */
  previews: Record<number, GroupPreview> = {};
  /** Favorite categories shown as rows on the All view. */
  shelves: Shelf[] = [];
  /** The country being searched ("US" typed in capitals), shown as a tag in the search box. */
  country?: Country;
  /** A country a lowercase search could mean, offered under the search box. */
  suggestedCountry?: Country;
  /** A code the viewer chose to search as text, so it isn't turned into a country again. */
  private textSearchCode?: string;
  /** Categories of the searched country, above its channels. */
  countryCategories: Channel[] = [];
  /** The item shown in the preview pane next to a category's channel list. */
  previewItem?: Channel;
  previewIndex = 0;
  previewEpg: EPG[] = [];
  private epgTimer?: ReturnType<typeof setTimeout>;
  private scrollFrame = 0;

  scrollToTop() {
    pageScroller().scrollTo({ top: 0, behavior: "smooth" });
  }

  constructor(
    private router: Router,
    public memory: MemoryService,
    public toast: ToastrService,
    private error: ErrorService,
    private modal: NgbModal,
    private zone: NgZone,
  ) {
    this.getSources();
  }

  /** Keeps tiles (and their DOM, logos and state) when a reload returns the same items. */
  trackChannel(_: number, channel: Channel) {
    return `${channel.media_type}-${channel.id}`;
  }

  getSources() {
    let get_settings = invoke("get_settings");
    let get_sources = invoke("get_sources");
    Promise.all([get_settings, get_sources])
      .then((data) => {
        let settings = data[0] as Settings;
        let sources = data[1] as Source[];
        if (settings.zoom) getCurrentWebview().setZoom(Math.trunc(settings.zoom! * 100) / 10000);
        this.memory.trayEnabled = settings.enable_tray_icon ?? true;
        this.memory.AlwaysAskSave = settings.always_ask_save ?? false;
        this.memory.Sources = new Map(sources.filter((x) => x.enabled).map(s => [s.id!, s]));
        if (sources.length == 0) this.reset();
        else {
          getVersion().then((version) => {
            if (localStorage.getItem(LAST_SEEN_VERSION) != version) {
              this.memory.AppVersion = version;
              this.memory.ModalRef = this.modal.open(WhatsNewModalComponent, {
                backdrop: "static",
                size: "xl",
                keyboard: false,
              });
              this.memory.ModalRef.componentInstance.name = "WhatsNewModal";
              const afterWhatsNew = () => {
                this.memory.ModalRef = undefined;
                this.checkLegacyData();
              };
              this.memory.ModalRef.result.then(afterWhatsNew, afterWhatsNew);
            } else {
              this.checkLegacyData();
            }
          });
          sources
            .filter((x) => x.source_type == SourceType.Custom)
            .map((x) => x.id!)
            .forEach((x) => this.memory.CustomSourceIds?.add(x));
          sources
            .filter((x) => x.source_type == SourceType.Xtream)
            .map((x) => x.id!)
            .forEach((x) => this.memory.XtreamSourceIds.add(x));
          if (
            this.memory.XtreamSourceIds.size > 0 &&
            !sessionStorage.getItem("epgCheckedOnStart")
          ) {
            sessionStorage.setItem("epgCheckedOnStart", "true");
            invoke("on_start_check_epg");
          }
          this.filters = {
            source_ids: Array.from(this.memory.Sources.keys()),
            view_type: this.memory.PendingView ?? settings.default_view ?? ViewMode.All,
            media_types: [MediaType.livestream, MediaType.movie, MediaType.serie],
            page: 1,
            use_keywords: false,
            sort: SortType.provider,
          };
          if (settings.default_sort != undefined && settings.default_sort != SortType.provider) {
            this.memory.Sort.next([settings.default_sort, false]);
            this.filters.sort = settings.default_sort;
          }
          this.memory.PendingView = undefined;
          this.hasXtream = this.anyXtream();
          this.chkSerie = this.hasXtream;
          if (settings.refresh_on_start === true && !sessionStorage.getItem("refreshedOnStart")) {
            sessionStorage.setItem("refreshedOnStart", "true");
            this.refreshOnStart().then((_) => _);
          }
          this.memory.loadFavoriteGroups();
          const pending = this.memory.PendingCategory;
          this.memory.PendingCategory = undefined;
          if (pending) this.openFavoriteCategory(pending);
          else this.load().then((_) => _);
        }
      })
      .catch((e) => {
        this.error.handleError(e);
        this.reset();
      });
  }

  /** Once, after the data was copied from the app LubaTV was forked from: keep or delete it. */
  async checkLegacyData() {
    try {
      const legacy: LegacyData | null = await invoke("get_legacy_data");
      if (!legacy) return;
      const ref = this.modal.open(LegacyDataModalComponent, {
        backdrop: "static",
        size: "lg",
        keyboard: false,
      });
      ref.componentInstance.legacy = legacy;
      this.memory.ModalRef = ref;
      const clear = () => (this.memory.ModalRef = undefined);
      ref.result.then(clear, clear);
    } catch (e) {
      this.error.handleError(e);
    }
  }

  async refreshOnStart() {
    this.toast.info("Refreshing all sources... (refresh on start enabled)");
    await this.memory.tryIPC(
      "Successfully refreshed all sources (refresh on start enabled)",
      "Failed to refresh all sources (refresh on start enabled)",
      async () => {
        await invoke("refresh_all");
      },
    );
  }

  async reload() {
    await this.load();
  }

  reset() {
    this.router.navigateByUrl("setup");
  }

  async addEvents() {
    this.subscriptions.push(
      this.memory.HideChannels.subscribe((val) => {
        this.channelsVisible = val;
      }),
    );
    this.subscriptions.push(
      this.memory.SetFocus.subscribe((focus) => {
        this.focusArea = FocusArea.Tiles;
        this.focus = focus;
      }),
    );
    this.subscriptions.push(
      this.memory.SetNode.subscribe(async (dto) => {
        this.nodeStack.add(
          new Node(
            dto.id,
            dto.name,
            dto.type,
            this.filters?.query,
            this.filters?.view_type,
            this.country,
          ),
        );
        if (dto.type == NodeType.Category) this.filters!.group_id = dto.id;
        else if (dto.type == NodeType.Series) {
          this.filters!.series_id = dto.id;
          this.filters!.source_ids = [dto.sourceId!];
        } else if (dto.type == NodeType.Season) this.filters!.season = dto.id;

        if (this.filters!.view_type == ViewMode.Hidden) {
          this.filters!.view_type = ViewMode.Categories;
        }

        this.clearSearch();
        await this.load();
        if (this.focusArea == FocusArea.Tiles) this.selectFirstChannelDelayed(100);
      }),
    );
    this.subscriptions.push(
      this.memory.Refresh.subscribe((scroll) => {
        this.load();
        if(scroll)
          pageScroller().scrollTo({ top: 0, behavior: "instant" });
      }),
    );
    this.subscriptions.push(
      this.memory.OpenCategory.subscribe((group) => this.openFavoriteCategory(group)),
    );
    this.subscriptions.push(
      this.memory.FavoriteGroups.pipe(skip(1)).subscribe(() => {
        if (this.wantsShelves()) this.loadShelves();
      }),
    );
    this.subscriptions.push(
      this.memory.Sort.pipe(skip(1)).subscribe(async ([sort, load]) => {
        if (!this.filters || !load) return;
        this.filters!.sort = sort;
        await this.load();
      }),
    );
  }

  clearSearch() {
    this.search.nativeElement.value = "";
    this.prevSearchValue = "";
    this.filters!.query = "";
    this.suggestedCountry = undefined;
    this.textSearchCode = undefined;
    this.clearCountry();
  }

  /** Searches a country: its tag goes in the search box, and the box narrows within it. */
  private setCountry(country: Country) {
    this.country = country;
    this.filters!.country = country.prefixes;
    this.suggestedCountry = undefined;
    this.search.nativeElement.value = "";
    this.prevSearchValue = "";
    this.filters!.query = "";
  }

  private clearCountry() {
    this.country = undefined;
    if (this.filters) this.filters.country = undefined;
    this.countryCategories = [];
  }

  async chooseCountry(country: Country) {
    this.setCountry(country);
    await this.load();
    this.search.nativeElement.focus({ preventScroll: true });
  }

  async removeCountry() {
    this.clearCountry();
    await this.load();
    this.search.nativeElement.focus({ preventScroll: true });
  }

  /** The viewer meant the letters, not the country: search names containing them. */
  async searchCodeAsText() {
    const code = this.country?.code;
    if (!code) return;
    this.clearCountry();
    this.textSearchCode = code;
    this.search.nativeElement.value = code;
    this.prevSearchValue = code;
    this.filters!.query = code;
    await this.load();
  }

  /** All categories of the searched country. */
  async showAllCountryCategories() {
    this.filters!.view_type = ViewMode.Categories;
    this.filters!.group_id = undefined;
    this.filters!.series_id = undefined;
    this.filters!.season = undefined;
    this.nodeStack.clear();
    await this.load();
  }

  /** Opens a favorite category from the sidebar or a shelf, with Back going to Categories. */
  openFavoriteCategory(group: Channel) {
    if (!this.filters) return;
    this.filters.view_type = ViewMode.Categories;
    this.filters.group_id = undefined;
    this.filters.series_id = undefined;
    this.filters.season = undefined;
    this.filters.source_ids = Array.from(this.memory.Sources.keys());
    this.clearSearch();
    this.nodeStack.clear();
    this.memory.SetNode.next({
      id: group.id!,
      name: group.name!,
      type: NodeType.Category,
      sourceId: group.source_id,
    });
  }

  loadMore() {
    return this.load(true);
  }

  async load(more = false) {
    this.loading = true;
    if (more) {
      this.filters!.page++;
    } else {
      this.filters!.page = 1;
    }
    try {
      let channels: Channel[] = await invoke("search", { filters: this.filters });
      if (!more) {
        this.channels = channels;
        this.channelsVisible = true;
        // prevent flicker of hiding opacity
        this.viewType = this.filters!.view_type;
      } else {
        this.channels = this.channels.concat(channels);
      }
      this.reachedMax = channels.length < this.PAGE_SIZE;
      if (!more) {
        this.previews = {};
        if (this.wantsRecent()) this.loadRecent();
        if (this.wantsShelves()) this.loadShelves();
        else this.shelves = [];
        if (this.wantsCountryCategories()) this.loadCountryCategories();
        else this.countryCategories = [];
        this.setPreview(this.isChannelList() ? this.channels[0] : undefined, 0);
      }
      this.loadPreviews(channels);
    } catch (e) {
      this.error.handleError(e);
    }
    this.loading = false;
  }

  /** The Continue watching row belongs on the unfiltered All view. */
  private wantsRecent(): boolean {
    const f = this.filters;
    return !!f && f.view_type == ViewMode.All && !f.query && !f.group_id && !f.series_id;
  }

  /** Favorite category rows belong on the unfiltered All view too. */
  private wantsShelves(): boolean {
    return this.wantsRecent() && !this.country;
  }

  private wantsCountryCategories(): boolean {
    const f = this.filters;
    return !!this.country && !!f && f.view_type == ViewMode.All && !f.group_id && !f.series_id;
  }

  showShelves(): boolean {
    return this.viewType == ViewMode.All && this.wantsShelves() && this.shelves.length > 0;
  }

  showCountryCategories(): boolean {
    return (
      this.viewType == ViewMode.All && this.wantsCountryCategories() && this.countryCategories.length > 0
    );
  }

  /** Inside a category: its items as a list, with a preview pane. */
  isChannelList(): boolean {
    return !!this.filters?.group_id && !this.filters?.series_id;
  }

  /** The open category, when the page shows one. */
  openCategory(): Node | undefined {
    const node = this.nodeStack.get();
    return node?.type == NodeType.Category ? node : undefined;
  }

  isOpenCategoryFavorite(): boolean {
    return this.memory.isFavoriteGroup(this.openCategory()?.id);
  }

  toggleOpenCategoryFavorite() {
    const node = this.openCategory();
    if (node) this.memory.toggleFavoriteGroup({ id: node.id, name: node.name });
  }

  private async loadShelves() {
    const groups = this.memory.FavoriteGroups.value.slice(0, SHELF_LIMIT);
    if (!groups.length || !this.filters) {
      this.shelves = [];
      return;
    }
    const base = this.filters;
    try {
      const rows = await Promise.all(
        groups.map((group) =>
          invoke<Channel[]>("search", {
            filters: {
              ...base,
              view_type: ViewMode.All,
              page: 1,
              query: "",
              use_keywords: false,
              group_id: group.id,
              series_id: undefined,
              season: undefined,
              country: undefined,
            },
          }),
        ),
      );
      if (!this.wantsShelves()) return;
      this.shelves = groups
        .map((group, i) => {
          const { code, rest } = splitCountryPrefix(group.name ?? "");
          return { group, code, title: rest, items: rows[i].slice(0, SHELF_SIZE) };
        })
        .filter((shelf) => shelf.items.length > 0);
    } catch (e) {
      console.error(e);
      this.shelves = [];
    }
  }

  /** Where each shelf's items start in the shelves' shared keyboard numbering. */
  shelfOffset(index: number): number {
    let offset = 0;
    for (let i = 0; i < index; i++) offset += this.shelves[i].items.length;
    return offset;
  }

  private async loadCountryCategories() {
    try {
      const categories: Channel[] = await invoke("search", {
        filters: {
          ...this.filters,
          view_type: ViewMode.Categories,
          page: 1,
          group_id: undefined,
          series_id: undefined,
          season: undefined,
        },
      });
      if (!this.wantsCountryCategories()) return;
      this.countryCategories = categories.slice(0, COUNTRY_CATEGORY_LIMIT);
      this.loadPreviews(this.countryCategories);
    } catch (e) {
      console.error(e);
      this.countryCategories = [];
    }
  }

  /** Shows an item in the preview pane; its TV guide loads once the pointer settles. */
  setPreview(item: Channel | undefined, index: number) {
    if (item === this.previewItem) return;
    this.previewItem = item;
    this.previewIndex = index;
    this.previewEpg = [];
    clearTimeout(this.epgTimer);
    if (!item || !this.hasGuide(item)) return;
    this.epgTimer = setTimeout(async () => {
      try {
        const epg: EPG[] = await invoke("get_epg", { channel: item });
        if (this.previewItem === item) this.previewEpg = epg.slice(0, 6);
      } catch (e) {
        console.error(e);
      }
    }, 350);
  }

  hasGuide(item: Channel): boolean {
    return (
      item.media_type == MediaType.livestream &&
      !this.memory.CustomSourceIds.has(item.source_id!) &&
      this.memory.XtreamSourceIds.has(item.source_id!)
    );
  }

  /** Starts the preview pane's item through its row, so playing works the same everywhere. */
  playPreview() {
    document.getElementById(`tile-${this.previewIndex}`)?.click();
  }

  /** Starts the banner's item through its tile in Continue watching, for the same reason. */
  playSpotlight() {
    document.getElementById("recent-0")?.click();
  }

  previewAction(): string {
    switch (this.previewItem?.media_type) {
      case MediaType.serie:
        return "Open series";
      case MediaType.movie:
        return "Play";
      default:
        return "Watch";
    }
  }

  async togglePreviewFavorite() {
    const item = this.previewItem;
    if (!item) return;
    try {
      await invoke(item.favorite ? "unfavorite_channel" : "favorite_channel", { channelId: item.id });
      item.favorite = !item.favorite;
      // The row shows the star too; a new item reference re-renders it.
      const copy = { ...item };
      this.channels = this.channels.map((c) => (c === item ? copy : c));
      this.previewItem = copy;
    } catch (e) {
      this.error.handleError(e, `Failed to update "${item.name}"`);
    }
  }

  showRecent(): boolean {
    return this.viewType == ViewMode.All && this.wantsRecent() && this.recent.length > 0;
  }

  private async loadRecent() {
    try {
      const items: Channel[] = await invoke("search", {
        filters: {
          ...this.filters,
          view_type: ViewMode.History,
          page: 1,
          query: "",
          use_keywords: false,
          group_id: undefined,
          series_id: undefined,
          season: undefined,
          media_types: [MediaType.livestream, MediaType.movie, MediaType.serie],
        },
      });
      this.recent = items.slice(0, 8);
      const ids = this.recent.map((c) => c.id!).filter((id) => id != null);
      this.lastWatched = ids.length ? await invoke("last_watched_times", { ids }) : {};
    } catch (e) {
      console.error(e);
      this.recent = [];
    }
  }

  private async loadPreviews(items: Channel[]) {
    const ids = items
      .filter((c) => c.media_type == MediaType.group && c.id != null && !(c.id in this.previews))
      .map((c) => c.id!);
    if (!ids.length) return;
    try {
      const previews: Record<number, GroupPreview> = await invoke("group_previews", { ids });
      this.previews = { ...this.previews, ...previews };
    } catch (e) {
      console.error(e);
    }
  }

  isCategoryGrid(): boolean {
    return this.viewType == ViewMode.Categories && !this.filters?.group_id && !this.filters?.series_id;
  }

  /** Title of the current view, ignoring any category or series opened inside it. */
  viewTitle(): string {
    switch (this.filters?.view_type) {
      case ViewMode.Categories:
        return "Categories";
      case ViewMode.Favorites:
        return "Favorites";
      case ViewMode.History:
        return "History";
      case ViewMode.Hidden:
        return "Hidden";
      default:
        return "All channels";
    }
  }

  pageTitle(): string {
    return this.nodeStack.get()?.name ?? this.viewTitle();
  }

  pageSubtitle(): string {
    const count = this.memory.Sources.size;
    const sources = this.country
      ? this.country.name
      : `${count} ${count == 1 ? "source" : "sources"}`;
    if (this.filters?.view_type == ViewMode.History) return `${sources} · most recent first`;
    switch (this.filters?.sort) {
      case SortType.alphabeticalAscending:
        return `${sources} · A–Z`;
      case SortType.alphabeticalDescending:
        return `${sources} · Z–A`;
      default:
        return `${sources} · provider order`;
    }
  }

  /**
   * Scroll events fire many times per frame. They are handled outside Angular's zone and
   * coalesced to one check per animation frame; change detection only runs when the
   * back-to-top button toggles or the next page needs loading.
   */
  private onScroll = () => {
    if (this.scrollFrame) return;
    this.scrollFrame = requestAnimationFrame(() => {
      this.scrollFrame = 0;
      const scroller = pageScroller();
      const scrollTop = scroller.scrollTop;
      const showScrollTop = scrollTop > 300;
      const nearEnd =
        !this.reachedMax &&
        !this.loading &&
        scrollTop + scroller.clientHeight >= scroller.scrollHeight * 0.75;
      if (showScrollTop === this.showScrollTop && !nearEnd) return;
      this.zone.run(() => {
        this.showScrollTop = showScrollTop;
        if (nearEnd) this.loadMore();
      });
    });
  };

  ngAfterViewInit(): void {
    this.zone.runOutsideAngular(() =>
      pageScroller().addEventListener("scroll", this.onScroll, { passive: true }),
    );
    this.addEvents().then((_) => _);
    this.subscriptions.push(
      fromEvent(this.search.nativeElement, "keyup")
        .pipe(
          filter((event: any) => event.key !== "Escape"),
          map((event: any) => {
            this.focus = 0;
            this.focusArea = FocusArea.Tiles;
            if (this.channelsVisible && event.target.value != this.prevSearchValue)
              this.channelsVisible = false;
            this.prevSearchValue = event.target.value;
            return event.target.value;
          }),
          debounceTime(300),
        )
        .subscribe(async (term: string) => {
          const country = this.country ? undefined : findCountry(term);
          const code = term.trim();
          if (country && code.toUpperCase() != this.textSearchCode) {
            // Capitals ("US", "PT") mean the country; lowercase is offered as a suggestion.
            if (code == code.toUpperCase()) {
              this.setCountry(country);
              await this.load();
              return;
            }
            this.suggestedCountry = country;
          } else {
            this.suggestedCountry = undefined;
          }
          this.filters!.query = term;
          await this.load();
        }),
    );
    this.subscriptions.push(
      fromEvent<KeyboardEvent>(this.search.nativeElement, "keydown")
        .pipe(
          filter(
            (event) => event.key == "Backspace" && !this.search.nativeElement.value && !!this.country,
          ),
        )
        .subscribe(() => this.removeCountry()),
    );

    this.shortcuts.push(
      {
        key: ["ctrl + f", "ctrl + space", "cmd + f"],
        label: "Search",
        description: "Go to search",
        preventDefault: true,
        allowIn: [AllowIn.Input],
        command: (_) => this.focusSearch(),
      },
      {
        key: ["ctrl + a", "cmd + a"],
        label: "Switching modes",
        description: "Selects the all channels view",
        preventDefault: true,
        command: async (_) => await this.switchMode(this.viewModeEnum.All),
      },
      {
        key: ["ctrl + s", "cmd + s"],
        label: "Switching modes",
        description: "Selects the categories view",
        command: async (_) => await this.switchMode(this.viewModeEnum.Categories),
      },
      {
        key: ["ctrl + d", "cmd + d"],
        label: "Switching modes",
        description: "Selects the history view",
        command: async (_) => await this.switchMode(this.viewModeEnum.History),
      },
      {
        key: ["ctrl + r", "cmd + r"],
        label: "Switching modes",
        description: "Selects the favorites view",
        command: async (_) => await this.switchMode(this.viewModeEnum.Favorites),
      },
      {
        key: "ctrl + q",
        label: "Media Type Filters",
        description: "Enable/Disable livestreams",
        preventDefault: true,
        allowIn: [AllowIn.Input],
        command: async (_) => {
          this.chkLiveStream = !this.chkLiveStream;
          this.updateMediaTypes(MediaType.livestream);
        },
      },
      {
        key: "ctrl + w",
        label: "Media Type Filters",
        description: "Enable/Disable movies",
        preventDefault: true,
        allowIn: [AllowIn.Input],
        command: async (_) => {
          this.chkMovie = !this.chkMovie;
          this.updateMediaTypes(MediaType.movie);
        },
      },
      {
        key: "ctrl + e",
        label: "Media Type Filters",
        description: "Enable/Disable series",
        preventDefault: true,
        allowIn: [AllowIn.Input],
        command: async (_) => {
          this.chkSerie = !this.chkSerie;
          this.updateMediaTypes(MediaType.serie);
        },
      },
      {
        key: "left",
        label: "Navigation",
        description: "Go left",
        allowIn: [AllowIn.Input],
        command: async (_) => await this.nav("ArrowLeft"),
      },
      {
        key: "right",
        label: "Navigation",
        description: "Go right",
        allowIn: [AllowIn.Input],
        command: async (_) => await this.nav("ArrowRight"),
      },
      {
        key: "up",
        label: "Navigation",
        description: "Go up",
        allowIn: [AllowIn.Input],
        preventDefault: true,
        command: async (_) => await this.nav("ArrowUp"),
      },
      {
        key: "down",
        label: "Navigation",
        description: "Go down",
        allowIn: [AllowIn.Input],
        preventDefault: true,
        command: async (_) => await this.nav("ArrowDown"),
      },
    );
  }

  toggleMediaType(mediaType: MediaType) {
    if (mediaType == MediaType.livestream) this.chkLiveStream = !this.chkLiveStream;
    else if (mediaType == MediaType.movie) this.chkMovie = !this.chkMovie;
    else if (mediaType == MediaType.serie) this.chkSerie = !this.chkSerie;
    this.updateMediaTypes(mediaType);
  }

  updateMediaTypes(mediaType: MediaType) {
    let index = this.filters!.media_types.indexOf(mediaType);
    if (index == -1) this.filters!.media_types.push(mediaType);
    else this.filters!.media_types.splice(index, 1);
    this.load();
  }

  filtersVisible() {
    return !this.filters?.series_id;
  }

  async switchMode(viewMode: ViewMode) {
    if (viewMode == this.filters?.view_type) return;
    this.filters!.series_id = undefined;
    this.filters!.group_id = undefined;
    this.filters!.view_type = viewMode;
    this.filters!.season = undefined;
    this.clearSearch();
    this.nodeStack.clear();
    await this.load();
  }

  searchFocused(): boolean {
    return document.activeElement?.id == "search";
  }

  focusSearch() {
    if (this.searchFocused()) {
      this.selectFirstChannel();
      return;
    } else {
      this.focus = 0;
      this.focusArea = FocusArea.Tiles;
    }
    pageScroller().scrollTo({ top: 0, behavior: "smooth" });
    this.search.nativeElement.focus({
      preventScroll: true,
    });
  }

  async goBackHotkey() {
    if (this.memory.ModalRef) {
      if (
        this.memory.ModalRef.componentInstance.name != "RestreamModalComponent" ||
        !this.memory.ModalRef.componentInstance.started
      )
        this.memory.ModalRef.close("close");
      return;
    } else if (this.memory.currentContextMenu?.menuOpen) {
      this.closeContextMenu();
    } else if (this.searchFocused()) {
      this.selectFirstChannel();
    } else if (this.filters?.query || this.country) {
      this.clearSearch();
      await this.load();
      this.selectFirstChannelDelayed(100);
    } else if (this.nodeStack.hasNodes()) {
      await this.goBack();
      this.selectFirstChannelDelayed(100);
    } else {
      this.selectFirstChannel();
    }
  }

  selectFirstChannelDelayed(milliseconds: number) {
    setTimeout(() => this.selectFirstChannel(), milliseconds);
  }

  async goBack() {
    var node = this.nodeStack.pop();
    if (node.type == NodeType.Category) this.filters!.group_id = undefined;
    else if (node.type == NodeType.Series) {
      this.filters!.series_id = undefined;
      this.filters!.source_ids = Array.from(this.memory.Sources.keys());
    } else if (node.type == NodeType.Season) {
      this.filters!.season = undefined;
    }
    if (node.query) {
      this.search.nativeElement.value = node.query;
      this.prevSearchValue = node.query;
      this.filters!.query = node.query;
    }
    if (node.country) {
      this.country = node.country;
      this.filters!.country = node.country.prefixes;
    }
    if (node.fromViewType && this.filters!.view_type !== node.fromViewType) {
      this.filters!.view_type = node.fromViewType;
    }
    await this.load();
  }

  openSettings() {
    this.router.navigateByUrl("settings");
  }

  /**
   * Arrow keys, Tab and TV-remote navigation. The sidebar is a vertical list on the left;
   * the content areas (media type chips, Continue watching, the grid) are stacked top to
   * bottom, and the grid's column count follows the window width.
   */
  async nav(key: string) {
    if (this.searchFocused()) return;
    if (this.memory.currentContextMenu?.menuOpen || this.memory.ModalRef) return;
    const area = this.focusArea;
    const count = this.areaCount(area);

    if (area == FocusArea.ViewMode) {
      if (key == "ArrowUp" || key == "ShiftTab") this.focusItem(area, Math.max(0, this.focus - 1));
      else if ((key == "ArrowDown" || key == "Tab") && this.focus < count - 1) this.focusItem(area, this.focus + 1);
      else if (key == "ArrowRight" || key == "Tab") this.enterContent();
      return;
    }
    if (count == 0) return this.enterContent();

    if (area == FocusArea.Shelves && key.startsWith("Arrow")) return this.navShelves(key);

    const cols = this.areaColumns(area);
    const col = this.focus % cols;
    switch (key) {
      case "ArrowLeft":
        if (col == 0) return this.focusItem(FocusArea.ViewMode, this.viewModeIndex());
        return this.focusItem(area, this.focus - 1);
      case "ArrowRight":
        if (col < cols - 1 && this.focus + 1 < count) this.focusItem(area, this.focus + 1);
        return;
      case "ArrowUp":
        if (this.focus - cols >= 0) return this.focusItem(area, this.focus - cols);
        return this.moveToArea(area, -1, col);
      case "ArrowDown":
        if (this.focus + cols < count) return this.focusItem(area, this.focus + cols);
        if (area == FocusArea.Tiles) return this.focusAfterLoadingMore(this.focus + cols);
        return this.moveToArea(area, 1, col);
      case "Tab":
        if (this.focus + 1 < count) return this.focusItem(area, this.focus + 1);
        if (area == FocusArea.Tiles) return this.focusAfterLoadingMore(this.focus + 1);
        return this.moveToArea(area, 1, 0);
      case "ShiftTab": {
        if (this.focus > 0) return this.focusItem(area, this.focus - 1);
        const previous = this.adjacentArea(area, -1);
        if (previous == undefined) return this.focusItem(FocusArea.ViewMode, this.viewModeIndex());
        return this.focusItem(previous, this.areaCount(previous) - 1);
      }
    }
  }

  /** Shelves are rows of different lengths: left and right move in a row, up and down between rows. */
  private navShelves(key: string) {
    let shelf = 0;
    while (shelf < this.shelves.length - 1 && this.focus >= this.shelfOffset(shelf + 1)) shelf++;
    const start = this.shelfOffset(shelf);
    const length = this.shelves[shelf].items.length;
    const pos = this.focus - start;
    switch (key) {
      case "ArrowLeft":
        if (pos == 0) return this.focusItem(FocusArea.ViewMode, this.viewModeIndex());
        return this.focusItem(FocusArea.Shelves, this.focus - 1);
      case "ArrowRight":
        if (pos < length - 1) this.focusItem(FocusArea.Shelves, this.focus + 1);
        return;
      case "ArrowUp":
      case "ArrowDown": {
        const target = shelf + (key == "ArrowUp" ? -1 : 1);
        if (target < 0 || target >= this.shelves.length) {
          return this.moveToArea(FocusArea.Shelves, key == "ArrowUp" ? -1 : 1, pos);
        }
        const index = this.shelfOffset(target) + Math.min(pos, this.shelves[target].items.length - 1);
        return this.focusItem(FocusArea.Shelves, index);
      }
    }
  }

  private areaCount(area: FocusArea): number {
    switch (area) {
      case FocusArea.ViewMode:
        return SIDEBAR_VIEWS.length;
      case FocusArea.Filters:
        return this.filtersVisible() ? (this.hasXtream ? 3 : 2) : 0;
      case FocusArea.Recent:
        return this.showRecent() ? this.recent.length : 0;
      case FocusArea.Shelves:
        return this.showShelves() ? this.shelfOffset(this.shelves.length) : 0;
      case FocusArea.CountryCategories:
        return this.showCountryCategories() ? this.countryCategories.length : 0;
      default:
        return this.channels.length;
    }
  }

  /** Items per row: the grid follows its CSS columns, the other content areas are one row. */
  private areaColumns(area: FocusArea): number {
    if (area == FocusArea.ViewMode) return 1;
    if (area == FocusArea.Tiles) {
      const grid = document.querySelector(".tile-grid.main");
      if (grid) return this.cssColumns(grid);
    }
    if (area == FocusArea.CountryCategories) {
      const grid = document.querySelector(".tile-grid.country-cats");
      if (grid) return this.cssColumns(grid);
    }
    return Math.max(1, this.areaCount(area));
  }

  private cssColumns(grid: Element): number {
    return getComputedStyle(grid).gridTemplateColumns.split(" ").filter((c) => c).length || 1;
  }

  /** The nearest non-empty content area above (-1) or below (1). */
  private adjacentArea(area: FocusArea, direction: number): FocusArea | undefined {
    const order = [
      FocusArea.Filters,
      FocusArea.Recent,
      FocusArea.Shelves,
      FocusArea.CountryCategories,
      FocusArea.Tiles,
    ];
    for (let i = order.indexOf(area) + direction; i >= 0 && i < order.length; i += direction) {
      if (this.areaCount(order[i]) > 0) return order[i];
    }
    return undefined;
  }

  private moveToArea(area: FocusArea, direction: number, col: number) {
    const next = this.adjacentArea(area, direction);
    if (next == undefined) return;
    if (next == FocusArea.Shelves) {
      const shelf = direction > 0 ? 0 : this.shelves.length - 1;
      const index = this.shelfOffset(shelf) + Math.min(col, this.shelves[shelf].items.length - 1);
      return this.focusItem(next, index);
    }
    const count = this.areaCount(next);
    const cols = this.areaColumns(next);
    const lastRowStart = Math.floor((count - 1) / cols) * cols;
    const index = direction > 0 ? Math.min(col, count - 1) : Math.min(count - 1, lastRowStart + col);
    this.focusItem(next, index);
  }

  private enterContent() {
    const first = [
      FocusArea.Tiles,
      FocusArea.CountryCategories,
      FocusArea.Shelves,
      FocusArea.Recent,
      FocusArea.Filters,
    ].find((a) => this.areaCount(a) > 0);
    if (first != undefined) this.focusItem(first, 0);
  }

  private async focusAfterLoadingMore(index: number) {
    if (this.reachedMax || this.loading) {
      if (index >= this.channels.length && this.focus < this.channels.length - 1)
        this.focusItem(FocusArea.Tiles, this.channels.length - 1);
      return;
    }
    await this.loadMore();
    this.focusItem(FocusArea.Tiles, Math.min(index, this.channels.length - 1));
  }

  private viewModeIndex(): number {
    return Math.max(0, SIDEBAR_VIEWS.findIndex((v) => v.view == this.filters?.view_type));
  }

  private focusItem(area: FocusArea, index: number) {
    this.focusArea = area;
    this.focus = index;
    setTimeout(() => {
      const element = document.getElementById(`${FocusAreaPrefix[area]}${index}`);
      element?.focus({ preventScroll: true });
      element?.scrollIntoView({ block: "nearest" });
    }, 0);
  }

  anyXtream() {
    return Array.from(this.memory.Sources.values()).findIndex((x) => x.source_type == SourceType.Xtream) != -1;
  }

  //Temporary solution because the ng-keyboard-shortcuts library doesn't seem to support ESC
  @HostListener("document:keydown", ["$event"])
  onKeyDown(event: KeyboardEvent) {
    if (
      event.key == "Escape" ||
      event.key == "BrowserBack" ||
      (event.key == "Backspace" && !isInputFocused())
    ) {
      this.goBackHotkey();
      event.preventDefault();
    }
    if (event.key == "Tab" && !this.memory.ModalRef) {
      event.preventDefault();
      this.nav(event.shiftKey ? "ShiftTab" : "Tab");
    }
  }

  selectFirstChannel() {
    this.focusArea = FocusArea.Tiles;
    this.focus = 0;
    (document.getElementById("first")?.firstChild as HTMLElement)?.focus();
  }

  closeContextMenu() {
    if (this.memory.currentContextMenu?.menuOpen) {
      this.memory.currentContextMenu?.closeMenu();
    }
  }

  ngOnDestroy() {
    pageScroller().removeEventListener("scroll", this.onScroll);
    cancelAnimationFrame(this.scrollFrame);
    clearTimeout(this.epgTimer);
    this.subscriptions.forEach((x) => x.unsubscribe());
  }

  async toggleKeywords() {
    this.filters!.use_keywords = !this.filters!.use_keywords;
    await this.load();
  }

  async bulkAction(action: BulkActionType) {
    if ((this.filters?.series_id && !this.filters?.season) || this.country) {
      return;
    }
    const actionName = BulkActionType[action].toLowerCase();
    try {
      await invoke("bulk_update", { filters: this.filters, action: action });
      await this.load();
      this.toast.success(`Successfully executed bulk update: ${actionName}`);
    } catch (e) {
      this.error.handleError(e);
    }
  }
}
