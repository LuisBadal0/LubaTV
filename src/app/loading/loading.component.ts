import { Component, Input, OnDestroy, OnInit } from "@angular/core";

@Component({
  selector: "app-loading",
  templateUrl: "./loading.component.html",
  styleUrl: "./loading.component.css",
})
export class LoadingComponent implements OnInit, OnDestroy {
  @Input()
  center: boolean = false;
  count = 0;
  texts: string[] = ["Loading your channels...", "Getting things ready..."];

  currentText: string = "";
  private timer?: ReturnType<typeof setInterval>;

  ngOnInit() {
    this.displayRandomText();
    this.timer = setInterval(() => this.displayRandomText(), 3500);
  }

  ngOnDestroy() {
    clearInterval(this.timer);
  }

  displayRandomText() {
    if (this.count == this.texts.length) this.count = 0;
    this.currentText = this.texts[this.count++];
  }
}
