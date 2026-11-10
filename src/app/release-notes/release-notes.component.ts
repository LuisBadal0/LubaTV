import { ChangeDetectionStrategy, Component, Input, OnChanges } from "@angular/core";
import { NoteBlock, parseNotes } from "../release-notes";

/** Shows release notes (a CHANGELOG.md section) as headings, lists and text. */
@Component({
  selector: "app-release-notes",
  templateUrl: "./release-notes.component.html",
  styleUrl: "./release-notes.component.css",
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: false,
})
export class ReleaseNotesComponent implements OnChanges {
  @Input() notes?: string;
  /** Smaller text, for the update prompt and Settings. */
  @Input() compact = false;
  blocks: NoteBlock[] = [];

  ngOnChanges(): void {
    this.blocks = this.notes ? parseNotes(this.notes) : [];
  }
}
