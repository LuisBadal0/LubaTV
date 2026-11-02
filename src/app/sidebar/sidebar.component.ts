import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output } from "@angular/core";
import { Router } from "@angular/router";
import { MemoryService } from "../memory.service";
import { ViewMode } from "../models/viewMode";
import { Source } from "../models/source";
import { SourceType } from "../models/sourceType";

/** Sidebar order; the index is also the keyboard focus id (`viewMode-<index>`). */
export const SIDEBAR_VIEWS: { view: ViewMode; icon: string; label: string }[] = [
  { view: ViewMode.All, icon: "grid", label: "All" },
  { view: ViewMode.Categories, icon: "library", label: "Categories" },
  { view: ViewMode.Favorites, icon: "star", label: "Favorites" },
  { view: ViewMode.History, icon: "history", label: "History" },
  { view: ViewMode.Hidden, icon: "eyeOff", label: "Hidden" },
];

const SOURCE_COLORS = ["#34D399", "#60A5FA", "#F472B6", "#FBBF24", "#A78BFA", "#22D3EE", "#F87171"];

export function sourceColor(id?: number): string {
  return SOURCE_COLORS[(id ?? 0) % SOURCE_COLORS.length];
}

@Component({
  selector: "app-sidebar",
  templateUrl: "./sidebar.component.html",
  styleUrl: "./sidebar.component.css",
  changeDetection: ChangeDetectionStrategy.Default,
})
export class SidebarComponent {
  /** The highlighted entry: a view on the home screen, or "settings". */
  @Input() active?: ViewMode | "settings";
  @Output() selectView = new EventEmitter<ViewMode>();

  readonly views = SIDEBAR_VIEWS;
  readonly sourceColor = sourceColor;

  constructor(
    public memory: MemoryService,
    private router: Router,
  ) {}

  get sources(): Source[] {
    return Array.from(this.memory.Sources.values());
  }

  sourceKind(source: Source): string {
    switch (source.source_type) {
      case SourceType.M3U:
        return "M3U file";
      case SourceType.M3ULink:
        return "M3U link";
      case SourceType.Xtream:
        return "Xtream";
      default:
        return "Custom";
    }
  }

  choose(view: ViewMode) {
    if (this.active === "settings") {
      // Home picks this up when it loads.
      this.memory.PendingView = view;
      this.router.navigateByUrl("");
    } else {
      this.selectView.emit(view);
    }
  }

  openSettings(anchor?: string) {
    if (this.active === "settings") return;
    this.router.navigateByUrl(anchor ? `settings#${anchor}` : "settings");
  }
}
