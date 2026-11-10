import { Component } from "@angular/core";
import { UpdateService } from "../update.service";
import { PlayerFilesService } from "../player-files.service";

/**
 * Bottom-right card that offers a newer version found by the start-up check, and shows
 * progress while the player files update (which comes first).
 */
@Component({
    selector: "app-update-prompt",
    templateUrl: "./update-prompt.component.html",
    styleUrl: "./update-prompt.component.css",
    standalone: false
})
export class UpdatePromptComponent {
  /** The notes of the offered version, opened from "What's new". */
  showNotes = false;
  constructor(
    public updates: UpdateService,
    public player: PlayerFilesService,
  ) {}

  get playerVisible(): boolean {
    return this.player.state != "idle";
  }

  mb(bytes: number): string {
    return (bytes / 1048576).toFixed(bytes < 10 * 1048576 ? 1 : 0);
  }

  get visible(): boolean {
    const s = this.updates.state;
    if (!this.updates.prompt || this.updates.dismissed) return false;
    return s == "available" || s == "downloading" || s == "installing";
  }
}
