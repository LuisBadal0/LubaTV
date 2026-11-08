import {
  AfterViewInit,
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  ElementRef,
  Input,
  OnChanges,
  OnDestroy,
  Renderer2,
  SimpleChanges,
  ViewChild,
} from "@angular/core";
import { MatMenuTrigger } from "@angular/material/menu";
import { Channel } from "../models/channel";
import { MemoryService } from "../memory.service";
import { MediaType } from "../models/mediaType";
import { invoke } from "@tauri-apps/api/core";
import { ToastrService } from "ngx-toastr";
import { ErrorService } from "../error.service";
import { NgbModal, NgbTooltip } from "@ng-bootstrap/ng-bootstrap";
import { EditChannelModalComponent } from "../edit-channel-modal/edit-channel-modal.component";
import { EditGroupModalComponent } from "../edit-group-modal/edit-group-modal.component";
import { DeleteGroupModalComponent } from "../delete-group-modal/delete-group-modal.component";
import { EpgModalComponent } from "../epg-modal/epg-modal.component";
import { EPG } from "../models/epg";
import { RestreamModalComponent } from "../restream-modal/restream-modal.component";
import { DownloadService } from "../download.service";
import { Download } from "../models/download";
import { Subscription, take } from "rxjs";
import { save } from "@tauri-apps/plugin-dialog";
import { CHANNEL_EXTENSION, GROUP_EXTENSION, RECORD_EXTENSION } from "../models/extensions";
import { getDateFormatted, getExtension, sanitizeFileName } from "../utils";
import { NodeType, fromMediaType } from "../models/nodeType";

import { ViewMode } from "../models/viewMode";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { GroupPreview } from "../models/groupPreview";
import { TimeAgoPipe } from "../pipes/time-ago.pipe";

/** Card tints, picked from the name so a channel always gets the same colour. */
const TINTS: [string, string][] = [
  ["#2563EB", "#60A5FA"], ["#DC2626", "#F87171"], ["#059669", "#34D399"], ["#D97706", "#FBBF24"],
  ["#7C3AED", "#C084FC"], ["#0891B2", "#22D3EE"], ["#DB2777", "#F472B6"], ["#4B5563", "#9CA3AF"],
];

/** "UK | Channel" or "|UK| Channel": a short country prefix shown as a corner tag. */
const COUNTRY_PREFIX = /^\s*\|?\s*([A-Z]{2,3})\s*\|\s*(\S.*)$/;

const timeAgo = new TimeAgoPipe();

function rgba(hex: string, alpha: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

function hash(text: string): number {
  let h = 0;
  for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) | 0;
  return Math.abs(h);
}

@Component({
    selector: "app-channel-tile",
    templateUrl: "./channel-tile.component.html",
    styleUrl: "./channel-tile.component.css",
    // Tiles only re-render when their inputs change, on their own events, or via markForCheck
    // after async work, instead of on every change detection pass of the whole grid.
    changeDetection: ChangeDetectionStrategy.OnPush,
    standalone: false
})
export class ChannelTileComponent implements OnChanges, OnDestroy, AfterViewInit {
  constructor(
    public memory: MemoryService,
    private toastr: ToastrService,
    private error: ErrorService,
    private modal: NgbModal,
    private el: ElementRef,
    private renderer: Renderer2,
    private download: DownloadService,
    private cdr: ChangeDetectorRef,
  ) { }
  @Input() channel?: Channel;
  @Input() id!: number;
  @Input() viewMode: number = 0;
  /** "card" in the grid, "wide" in the Continue watching row. */
  @Input() variant: "card" | "wide" = "card";
  /** Keyboard focus id prefix; home's focus areas look tiles up by it. */
  @Input() idPrefix = "tile-";
  /** Count and logos for a category tile. */
  @Input() preview?: GroupPreview;
  /** When this channel was last watched (Unix seconds), for the Continue watching row. */
  @Input() lastWatched?: number;
  @ViewChild(MatMenuTrigger, { static: true }) matMenuTrigger!: MatMenuTrigger;
  menuTopLeftPosition = { x: 0, y: 0 };
  showImage: boolean = true;
  starting: boolean = false;
  alreadyExistsInFav = false;
  alreadyHidden = false;
  downloading = false;
  mediaTypeEnum = MediaType;
  viewModeEnum = ViewMode;
  subscriptions: Subscription[] = [];
  fade = false;
  displayName = "";
  tag?: string;
  initials = "";
  tintStyle = "";
  tooltip = "";
  private brokenPreviews = new Set<string>();
  private tipTimer?: ReturnType<typeof setTimeout>;

  /** Full-name tooltip: after a short hover, or straight away on keyboard focus. */
  hoverTip(tip: NgbTooltip) {
    if (!this.tooltip) return;
    clearTimeout(this.tipTimer);
    this.tipTimer = setTimeout(() => tip.open(), 400);
  }

  focusTip(event: FocusEvent, tip: NgbTooltip) {
    // Focus that follows a mouse click is not :focus-visible; only keyboard focus shows it.
    if (this.tooltip && (event.target as HTMLElement).matches(":focus-visible")) tip.open();
  }

  hideTip(tip: NgbTooltip) {
    clearTimeout(this.tipTimer);
    tip.close();
  }

  ngOnChanges(changes: SimpleChanges): void {
    // Tiles are reused across reloads (trackBy), so reset per-item display state when
    // fresh data arrives, as a newly created tile would have it.
    const channel = changes["channel"];
    if (channel && !channel.firstChange) {
      this.fade = false;
      this.showImage = true;
      this.brokenPreviews.clear();
    }
    if (channel) this.updateDisplay();
  }

  private updateDisplay() {
    const name = this.channel?.name ?? "";
    const prefix = COUNTRY_PREFIX.exec(name);
    this.tag = prefix?.[1];
    this.displayName = prefix ? prefix[2] : name;
    const words = this.displayName.match(/[\p{L}\p{N}]+/gu) ?? [];
    const first = words[0] ?? "?";
    const second = words[1];
    this.initials = (second ? first.charAt(0) + second.charAt(0) : first.slice(0, 2)).toUpperCase();
    const [c, c2] = TINTS[hash(name) % TINTS.length];
    this.tintStyle = `--c:${c};--c2:${c2};--tint:${rgba(c, 0.3)};--tint-strong:${rgba(c, 0.55)}`;
    // Show the full name on hover only when the card may not fit it.
    this.tooltip = this.tag || this.displayName.length > 30 ? name : "";
  }

  isGroup(): boolean {
    return this.channel?.media_type == MediaType.group;
  }

  badgeText(): string {
    switch (this.channel?.media_type) {
      case MediaType.livestream:
        return "LIVE";
      case MediaType.movie:
        return this.channel?.episode_num != null ? "EPISODE" : "MOVIE";
      case MediaType.serie:
        return "SERIES";
      case MediaType.season:
        return "SEASON";
      default:
        return "";
    }
  }

  countText(): string {
    if (!this.preview) return "Category";
    const count = this.preview.count;
    return `${count.toLocaleString()} ${count == 1 ? "item" : "items"}`;
  }

  previewImages(): string[] {
    return (this.preview?.images ?? []).filter((image) => !this.brokenPreviews.has(image));
  }

  hidePreview(image: string) {
    this.brokenPreviews.add(image);
  }

  wideSubtitle(): string {
    const type = this.badgeText().toLowerCase();
    const label = type == "live" ? "Live" : type.charAt(0).toUpperCase() + type.slice(1);
    const when = this.lastWatched ? timeAgo.transform(this.lastWatched * 1000) : this.getSourceName();
    return when ? `${label} · ${when}` : label;
  }

  ngAfterViewInit(): void {
    this.getExistingDownload();
  }

  setDownloadGradient(progress: number) {
    let element = this.el.nativeElement.querySelector(`#${this.idPrefix}${this.id}`);
    let background = `linear-gradient(to right, rgba(34, 197, 94, 0.32) ${progress}%, var(--lt-surface) ${progress}%)`;
    this.renderer.setStyle(element, "background", background);
  }

  clearDownloadGradient() {
    let element = this.el.nativeElement.querySelector(`#${this.idPrefix}${this.id}`);
    this.renderer.removeStyle(element, "background");
  }

  async click(record = false) {
    if (this.starting === true) {
      try {
        await invoke("cancel_play", { sourceId: this.channel?.source_id, channelId: this.channel?.id });
      } catch (e) {
        this.error.handleError(e);
      }
      return;
    }
    if (
      this.channel?.media_type == MediaType.serie ||
      this.channel?.media_type == MediaType.group ||
      this.channel?.media_type == MediaType.season
    ) {
      if (
        this.channel.media_type == MediaType.serie &&
        !this.memory.SeriesRefreshed.has(this.channel.id!)
      ) {
        this.memory.HideChannels.next(false);
        try {
          await invoke("get_episodes", { channel: this.channel });
          this.memory.SeriesRefreshed.set(this.channel.id!, true);
        } catch (e) {
          this.error.handleError(e, "Failed to fetch series");
        }
      }
      this.memory.SetNode.next({
        id:
          this.channel?.media_type == MediaType.serie
            ? parseInt(this.channel.url!)
            : this.channel.id!,
        name: this.channel.name!,
        type: fromMediaType(this.channel.media_type),
        sourceId: this.channel.source_id,
      });
      return;
    }
    let file = undefined;
    if (record && (this.memory.IsContainer || this.memory.AlwaysAskSave)) {
      file = await save({
        canCreateDirectories: true,
        title: "Select where to save recording",
        defaultPath: `${sanitizeFileName(this.channel?.name!)}_${getDateFormatted()}${RECORD_EXTENSION}`,
      });
      if (!file) return;
    }
    this.starting = true;
    this.cdr.markForCheck();
    if (this.idPrefix == "tile-") this.memory.SetFocus.next(this.id);
    try {
      await invoke("play", { channel: this.channel, record: record, recordPath: file });
    } catch (e) {
      this.error.handlePlayError(e);
    }
    invoke("add_last_watched", { id: this.channel?.id }).catch((e) => {
      console.error(e);
      this.error.handleError(e);
    });
    this.starting = false;
    this.cdr.markForCheck();
  }

  onRightClick(event: MouseEvent) {
    if (this.channel?.media_type == MediaType.season) return;
    this.alreadyExistsInFav = this.channel!.favorite!;
    this.alreadyHidden = this.channel!.hidden!;
    this.downloading = this.isDownloading();
    event.preventDefault();
    this.menuTopLeftPosition.x = event.clientX;
    this.menuTopLeftPosition.y = event.clientY;
    if (this.memory.currentContextMenu?.menuOpen) this.memory.currentContextMenu.closeMenu();
    this.memory.currentContextMenu = this.matMenuTrigger;
    this.matMenuTrigger.openMenu();
  }

  onError(event: Event) {
    this.showImage = false;
  }

  async favorite() {
    let call = "favorite_channel";
    const wasFavorite = this.channel!.favorite;
    let msg = `Added "${this.channel?.name}" to favorites`;
    if (wasFavorite) {
      call = "unfavorite_channel";
      msg = `Removed "${this.channel?.name}" from favorites`;
    }
    try {
      await invoke(call, { channelId: this.channel!.id });
      this.channel!.favorite = !wasFavorite;
      if (wasFavorite) {
        if (this.viewMode == ViewMode.Favorites)
          this.fade = true;
        this.toastr.success(`${msg} (updates on reload)`);
      } else {
        if (this.viewMode == ViewMode.Favorites)
          this.fade = false;
        this.toastr.success(msg);
      }
      this.cdr.markForCheck();
    } catch (e) {
      this.error.handleError(e, `Failed to add/remove "${this.channel?.name}" to/from favorites`);
    }
  }

  async removeFromHistory() {
    try {
      await invoke("remove_from_history", { id: this.channel!.id });
      this.memory.Refresh.next(false);
      this.toastr.success(`Removed "${this.channel?.name}" from history`);
    } catch (e) {
      this.error.handleError(e, `Failed to remove "${this.channel?.name}" from history`);
    }
  }

  async hide() {
    const isGroup = this.channel?.media_type === MediaType.group;
    const hide = !this.channel!.hidden;

    const command = isGroup ? "hide_group" : "hide_channel";
    const args = { id: this.channel!.id, hidden: hide };

    const action = hide ? "Hidden" : "Unhidden";
    const type = isGroup ? "group " : "";
    const msg = `${action} ${type}"${this.channel?.name}"`;

    try {
      await invoke(command, args);
      this.channel!.hidden = hide;
      this.fade = this.viewMode == ViewMode.Hidden ? !hide : hide;
      this.cdr.markForCheck();
      this.toastr.success(`${msg} (updates on reload)`);
    } catch (e) {
      this.error.handleError(e, `Failed to hide/unhide "${this.channel?.name}"`);
    }
  }

  async record() {
    await this.click(true);
  }

  isMovie() {
    return this.channel?.media_type == MediaType.movie;
  }

  isLivestream() {
    return this.channel?.media_type == MediaType.livestream;
  }

  isCustom(): boolean {
    return this.memory.CustomSourceIds!.has(this.channel?.source_id!);
  }

  showEPG(): boolean {
    return (
      this.channel?.media_type == MediaType.livestream &&
      !this.isCustom() &&
      this.memory.XtreamSourceIds.has(this.channel.source_id!)
    );
  }

  getSourceName(): string {
    if (!this.channel?.source_id) return "";
    return this.memory.Sources.get(this.channel.source_id)?.name || "";
  }

  async showEPGModal() {
    try {
      let data: EPG[] = await invoke("get_epg", { channel: this.channel });
      if (data.length == 0) {
        this.toastr.info("No EPG data for this channel");
        return;
      }
      this.memory.ModalRef = this.modal.open(EpgModalComponent, {
        backdrop: "static",
        size: "xl",
        keyboard: false,
      });
      this.memory.ModalRef.result.then((_) => (this.memory.ModalRef = undefined));
      this.memory.ModalRef.componentInstance.epg = data;
      this.memory.ModalRef.componentInstance.name = this.channel?.name;
      this.memory.ModalRef.componentInstance.channelId = this.channel?.id;
      this.memory.ModalRef.componentInstance.sourceId = this.channel?.source_id;
    } catch (e) {
      this.error.handleError(
        e,
        "Missing stream id. Please refresh your sources (Settings -> Refresh All) to enable the EPG feature",
      );
    }
  }

  edit() {
    if (this.channel?.media_type == MediaType.group) this.edit_group();
    else {
      this.edit_channel();
    }
  }

  edit_group() {
    this.memory.ModalRef = this.modal.open(EditGroupModalComponent, {
      backdrop: "static",
      size: "xl",
      keyboard: false,
    });
    this.memory.ModalRef.result.then((_) => (this.memory.ModalRef = undefined));
    this.memory.ModalRef.componentInstance.name = "EditCustomGroupModal";
    this.memory.ModalRef.componentInstance.editing = true;
    this.memory.ModalRef.componentInstance.group = {
      id: this.channel!.id,
      name: this.channel!.name,
      image: this.channel!.image,
      source_id: this.channel!.source_id,
    };
    this.memory.ModalRef.componentInstance.originalName = this.channel!.name;
  }

  edit_channel() {
    this.memory.ModalRef = this.modal.open(EditChannelModalComponent, {
      backdrop: "static",
      size: "xl",
      keyboard: false,
    });
    this.memory.ModalRef.result.then((_) => (this.memory.ModalRef = undefined));
    this.memory.ModalRef.componentInstance.name = "EditCustomChannelModal";
    this.memory.ModalRef.componentInstance.editing = true;
    this.memory.ModalRef.componentInstance.channel.data = { ...this.channel };
  }

  async share() {
    let entityName = this.channel?.media_type == MediaType.group ? "group" : "channel";
    let file = await save({
      canCreateDirectories: true,
      title: `Select where to export ${entityName}`,
      defaultPath:
        sanitizeFileName(this.channel?.name!) +
        (this.channel?.media_type == MediaType.group ? GROUP_EXTENSION : CHANNEL_EXTENSION),
    });
    if (!file) {
      return;
    }
    if (this.channel?.media_type == MediaType.group) {
      this.memory.tryIPC(
        `Successfully exported category to ${file}`,
        "Failed to export channel",
        () => invoke("share_custom_group", { group: this.channel, path: file }),
      );
    } else {
      this.memory.tryIPC(
        `Successfully exported channel to ${file}`,
        "Failed to export channel",
        () => invoke("share_custom_channel", { channel: this.channel, path: file }),
      );
    }
  }

  async delete() {
    if (this.channel?.media_type == MediaType.group) this.deleteGroup();
    else await this.deleteChannel();
  }

  async deleteGroup() {
    try {
      if (await invoke("group_not_empty", { id: this.channel?.id })) {
        this.openDeleteGroupModal();
      } else await this.deleteGroupNoReplace();
    } catch (e) {
      this.error.handleError(e);
    }
  }

  async deleteGroupNoReplace() {
    try {
      await invoke("delete_custom_group", {
        id: this.channel?.id,
        doChannelsUpdate: false,
      });
      this.memory.Refresh.next(true);
      this.error.success("Successfully deleted category");
    } catch (e) {
      this.error.handleError(e);
    }
  }

  openDeleteGroupModal() {
    this.memory.ModalRef = this.modal.open(DeleteGroupModalComponent, {
      backdrop: "static",
      size: "xl",
      keyboard: false,
    });
    this.memory.ModalRef.result.then((_) => (this.memory.ModalRef = undefined));
    this.memory.ModalRef.componentInstance.name = "DeleteGroupModal";
    this.memory.ModalRef.componentInstance.group = { ...this.channel };
  }

  openRestreamModal() {
    this.memory.ModalRef = this.modal.open(RestreamModalComponent, {
      backdrop: "static",
      size: "xl",
      keyboard: false,
    });
    this.memory.ModalRef.componentInstance.channel = this.channel;
    this.memory.ModalRef.componentInstance.name = "RestreamModalComponent";
    this.memory.ModalRef.result.then((_) => (this.memory.ModalRef = undefined));
  }

  async deleteChannel() {
    await this.memory.tryIPC("Successfully deleted channel", "Failed to delete channel", () =>
      invoke("delete_custom_channel", { id: this.channel?.id }),
    );
    this.memory.Refresh.next(true);
  }

  isDownloading() {
    return this.download.Downloads.has(this.channel!.id!.toString());
  }

  async downloadVod() {
    let file = undefined;
    if (this.memory.IsContainer || this.memory.AlwaysAskSave) {
      file = await save({
        canCreateDirectories: true,
        title: "Select where to download movie",
        defaultPath: `${sanitizeFileName(this.channel?.name!)}.${getExtension(this.channel?.url!)}`,
      });
      if (!file) {
        return;
      }
    }
    let download = await this.download.addDownload(
      this.channel!.id!.toString(),
      this.channel!,
    );
    this.downloadSubscribe(download);
    await this.download.download(download.id, file);
  }

  async cancelDownload() {
    await this.download.abortDownload(this.channel!.id!.toString());
  }

  getExistingDownload() {
    let download = this.download.Downloads.get(this.channel!.id!.toString());
    if (download) {
      this.setDownloadGradient(download.progress);
      this.downloadSubscribe(download);
    }
  }

  downloadSubscribe(download: Download) {
    let progressUpdate = download.progressUpdate.subscribe((progress) => {
      this.setDownloadGradient(progress);
      if (progress == 100) progressUpdate.unsubscribe();
    });
    this.subscriptions.push(progressUpdate);
    this.subscriptions.push(
      download.complete.pipe(take(1)).subscribe((_) => {
        progressUpdate.unsubscribe();
        this.clearDownloadGradient();
      }),
    );
  }

  async copyURL() {
    try {
      await writeText(this.channel?.url ?? "");
      this.error.success("Copied channel URL");
    }
    catch (e) {
      this.error.handleError(e);
    }
  }

  ngOnDestroy() {
    clearTimeout(this.tipTimer);
    this.subscriptions.forEach((x) => x.unsubscribe());
  }
}
