import { Component } from '@angular/core';
import { NgbActiveModal } from '@ng-bootstrap/ng-bootstrap';
import { writeText } from '@tauri-apps/plugin-clipboard-manager';
import { ToastrService } from 'ngx-toastr';

/** A channel that failed to play: a summary, what to try, and mpv's output. */
export interface PlaybackError {
  summary: string;
  hint: string;
  output: string;
}

const MPV_OUTPUT = "\n\nmpv output:\n";

@Component({
  selector: 'app-error-modal',
  templateUrl: './error-modal.component.html',
  styleUrl: './error-modal.component.css'
})
export class ErrorModalComponent {
  error?: string;
  constructor(public activeModal: NgbActiveModal, private toastr: ToastrService) {
  }

  /** Set when the error comes from playing a channel (see describe() in mpv.rs). */
  get playback(): PlaybackError | undefined {
    const at = this.error?.indexOf(MPV_OUTPUT) ?? -1;
    if (at < 0) return undefined;
    const [summary, ...hint] = this.error!.slice(0, at).split("\n");
    return { summary, hint: hint.join(" "), output: this.error!.slice(at + MPV_OUTPUT.length) };
  }

  async copy() {
    await writeText(this.error!);
    this.toastr.success("Copied error");
  }
}
