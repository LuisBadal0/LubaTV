import { Component, EventEmitter, Input, OnChanges, Output, SimpleChanges } from "@angular/core";
import { invoke } from "@tauri-apps/api/core";
import { NgbModal } from "@ng-bootstrap/ng-bootstrap";
import { ToastrService } from "ngx-toastr";
import { splitCountryPrefix } from "../countries";
import { EpgModalComponent } from "../epg-modal/epg-modal.component";
import { ErrorService } from "../error.service";
import { MemoryService } from "../memory.service";
import { Channel } from "../models/channel";
import { EPG } from "../models/epg";
import { MediaType } from "../models/mediaType";
import { TimeAgoPipe } from "../pipes/time-ago.pipe";

const timeAgo = new TimeAgoPipe();

function clock(timestamp: number): string {
  return new Date(timestamp * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

/** The banner at the top of the home screen: the last thing watched, ready to start again. */
@Component({
  selector: "app-spotlight",
  templateUrl: "./spotlight.component.html",
  styleUrl: "./spotlight.component.css",
  standalone: false,
})
export class SpotlightComponent implements OnChanges {
  @Input() channel!: Channel;
  /** When it was last watched (Unix seconds). */
  @Input() lastWatched?: number;
  /** Whether its source has a TV guide to ask for. */
  @Input() hasGuide = false;
  /** Home starts it, the same way as its tile in Continue watching. */
  @Output() play = new EventEmitter<void>();

  readonly mediaTypeEnum = MediaType;
  name = "";
  tag?: string;
  imageBroken = false;
  guide: EPG[] = [];
  now?: EPG;
  next?: EPG;

  constructor(
    private memory: MemoryService,
    private modal: NgbModal,
    private toastr: ToastrService,
    private error: ErrorService,
  ) {}

  ngOnChanges(changes: SimpleChanges) {
    if (!changes["channel"]) return;
    const { code, rest } = splitCountryPrefix(this.channel?.name ?? "");
    this.name = rest;
    this.tag = code;
    this.imageBroken = false;
    this.loadGuide();
  }

  isLive(): boolean {
    return this.channel?.media_type == MediaType.livestream;
  }

  /** "Live · 2 hours ago", "Movie · 1 day ago"… */
  kicker(): string {
    const kind = this.isLive()
      ? "Live"
      : this.channel?.media_type == MediaType.serie
        ? "Series"
        : this.channel?.episode_num != null
          ? "Episode"
          : "Movie";
    const when = this.lastWatched ? timeAgo.transform(this.lastWatched * 1000) : "";
    return when ? `${kind} · watched ${when.toLowerCase()}` : kind;
  }

  action(): string {
    switch (this.channel?.media_type) {
      case MediaType.serie:
        return "Open series";
      case MediaType.movie:
        return "Play";
      default:
        return "Watch";
    }
  }

  startTime(): string {
    return this.now ? clock(this.now.start_timestamp) : "";
  }

  endTime(): string {
    return this.next ? clock(this.next.start_timestamp) : "";
  }

  /** How far the current programme is, 0 to 100. Unknown without the next one's start. */
  progress(): number | undefined {
    if (!this.now || !this.next) return undefined;
    const length = this.next.start_timestamp - this.now.start_timestamp;
    if (length <= 0) return undefined;
    const done = (Date.now() / 1000 - this.now.start_timestamp) / length;
    return Math.round(Math.min(1, Math.max(0, done)) * 100);
  }

  private async loadGuide() {
    const channel = this.channel;
    this.guide = [];
    this.now = undefined;
    this.next = undefined;
    if (!channel || !this.hasGuide) return;
    try {
      const guide: EPG[] = await invoke("get_epg", { channel });
      if (this.channel !== channel || !Array.isArray(guide)) return;
      this.guide = guide;
      const index = guide.findIndex((epg) => epg.now_playing);
      if (index != -1) {
        this.now = guide[index];
        this.next = guide[index + 1];
      }
    } catch (e) {
      console.error(e);
    }
  }

  openGuide() {
    if (!this.guide.length) {
      this.toastr.info("No EPG data for this channel");
      return;
    }
    const ref = this.modal.open(EpgModalComponent, { backdrop: "static", size: "xl", keyboard: false });
    this.memory.ModalRef = ref;
    const clear = () => (this.memory.ModalRef = undefined);
    ref.result.then(clear, clear);
    ref.componentInstance.epg = this.guide;
    ref.componentInstance.name = this.channel.name;
    ref.componentInstance.channelId = this.channel.id;
    ref.componentInstance.sourceId = this.channel.source_id;
  }

  async toggleFavorite() {
    const channel = this.channel;
    try {
      await invoke(channel.favorite ? "unfavorite_channel" : "favorite_channel", { channelId: channel.id });
      channel.favorite = !channel.favorite;
    } catch (e) {
      this.error.handleError(e, `Failed to update "${channel.name}"`);
    }
  }
}
