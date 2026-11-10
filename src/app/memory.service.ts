import { Injectable } from "@angular/core";
import { Source } from "./models/source";
import { BehaviorSubject, Subject } from "rxjs";
import { MatMenuTrigger } from "@angular/material/menu";
import { ToastrService } from "ngx-toastr";
import { ErrorService } from "./error.service";
import { NgbModalRef } from "@ng-bootstrap/ng-bootstrap";
import { invoke } from "@tauri-apps/api/core";
import { SortType } from "./models/sortType";
import { LAST_SEEN_VERSION } from "./models/localStorage";
import { SetNodeDTO } from "./models/setNodeDTO";
import { Channel } from "./models/channel";

@Injectable({
  providedIn: "root",
})
export class MemoryService {
  constructor(
    private toastr: ToastrService,
    private error: ErrorService,
  ) {
    invoke("is_container").then((val) => (this.IsContainer = val as boolean));
  }
  public SetNode: Subject<SetNodeDTO> = new Subject();
  public SetFocus: Subject<number> = new Subject();
  public Sort: BehaviorSubject<[number, boolean]> = new BehaviorSubject<[number, boolean]>([
    SortType.provider,
    false,
  ]);
  public Sources: Map<number, Source> = new Map();
  public currentContextMenu?: MatMenuTrigger;
  public Loading = false;
  public Refresh: Subject<boolean> = new Subject();
  public RefreshSources: Subject<boolean> = new Subject();
  public AddingAdditionalSource = false;
  public SeriesRefreshed: Map<number, boolean> = new Map();
  public HideChannels: Subject<boolean> = new Subject();
  public CustomSourceIds: Set<number> = new Set();
  public XtreamSourceIds: Set<number> = new Set();
  public ModalRef?: NgbModalRef;
  public Watched_epgs: Set<string> = new Set();
  private downloadingChannels: Map<number, [number, Subject<boolean>]> = new Map();
  public LoadingNotification: boolean = false;
  public AppVersion?: string;
  public trayEnabled?: boolean;
  public IsContainer?: boolean;
  public AlwaysAskSave?: boolean;
  /** A view chosen in the sidebar while on another page; Home opens it next. */
  public PendingView?: number;
  /** A favorite category chosen in the sidebar while on another page; Home opens it next. */
  public PendingCategory?: Channel;
  /** Favorite categories, listed in the sidebar. */
  public FavoriteGroups: BehaviorSubject<Channel[]> = new BehaviorSubject<Channel[]>([]);
  /** A favorite category chosen in the sidebar while Home is open. */
  public OpenCategory: Subject<Channel> = new Subject();

  async loadFavoriteGroups() {
    try {
      const groups: Channel[] = await invoke("get_favorite_groups", {
        sourceIds: Array.from(this.Sources.keys()),
      });
      this.FavoriteGroups.next(groups);
    } catch (e) {
      console.error(e);
    }
  }

  isFavoriteGroup(id?: number): boolean {
    return id != null && this.FavoriteGroups.value.some((group) => group.id == id);
  }

  /** Adds a category to the sidebar's favorites, or takes it out. */
  async toggleFavoriteGroup(group: Channel) {
    const favorite = !this.isFavoriteGroup(group.id);
    try {
      await invoke("favorite_group", { id: group.id, favorite });
      await this.loadFavoriteGroups();
      this.toastr.success(
        favorite ? `Added "${group.name}" to the sidebar` : `Removed "${group.name}" from the sidebar`,
      );
    } catch (e) {
      this.error.handleError(e, `Failed to update "${group.name}"`);
    }
  }

  async tryIPC<T>(
    successMessage: string,
    errorMessage: string,
    action: () => Promise<T>,
  ): Promise<boolean> {
    this.Loading = true;
    let error = false;
    try {
      await action();
      this.toastr.success(successMessage);
    } catch (e) {
      this.error.handleError(e, errorMessage);
      error = true;
    }
    this.Loading = false;
    return error;
  }

  async get_epg_ids() {
    let data = await invoke("get_epg_ids");
    let set = new Set(data as Array<string>);
    this.Watched_epgs = set;
  }

  addDownloadingChannel(id: number) {
    this.downloadingChannels.set(id, [0, new Subject()]);
  }

  notifyDownloadFinished(id: number) {
    this.downloadingChannels.get(id)?.[1].next(true);
  }

  removeDownloadingChannel(id: number) {
    this.downloadingChannels.delete(id);
  }

  downloadExists(id: number) {
    return this.downloadingChannels.has(id);
  }

  getDownload(id: number) {
    return this.downloadingChannels.get(id);
  }

  setLastDownloadProgress(id: number, progress: number) {
    this.downloadingChannels.get(id)![0] = progress;
  }

  updateVersion() {
    if (this.AppVersion) localStorage.setItem(LAST_SEEN_VERSION, this.AppVersion);
  }
}
