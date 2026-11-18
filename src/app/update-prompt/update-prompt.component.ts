import { Component } from "@angular/core";
import { UpdateService } from "../update.service";
import { PlayerFilesService } from "../player-files.service";
import { megabytes } from "../utils";

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

  readonly mb = megabytes;

  get visible(): boolean {
    const s = this.updates.state;
    // While updating, the full-window update screen takes over.
    if (!this.updates.prompt || this.updates.dismissed || this.updates.updating) return false;
    return s == "available";
  }
}
