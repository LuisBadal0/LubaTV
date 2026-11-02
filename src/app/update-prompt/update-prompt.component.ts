import { Component } from "@angular/core";
import { UpdateService } from "../update.service";

/** Bottom-right card that offers a newer version found by the start-up check. */
@Component({
  selector: "app-update-prompt",
  templateUrl: "./update-prompt.component.html",
  styleUrl: "./update-prompt.component.css",
})
export class UpdatePromptComponent {
  constructor(public updates: UpdateService) {}

  get visible(): boolean {
    const s = this.updates.state;
    if (!this.updates.prompt || this.updates.dismissed) return false;
    return s == "available" || s == "downloading" || s == "installing";
  }
}
