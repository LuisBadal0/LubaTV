import { TestBed } from "@angular/core/testing";
import { AppComponent } from "./app.component";
import { mockTauri, TEST_IMPORTS, TEST_PROVIDERS, TEST_SCHEMAS } from "../testing/test-setup";

describe("AppComponent", () => {
  beforeEach(async () => {
    mockTauri();
    await TestBed.configureTestingModule({
      declarations: [AppComponent],
      imports: TEST_IMPORTS,
      providers: TEST_PROVIDERS,
      schemas: TEST_SCHEMAS,
    }).compileComponents();
  });

  function render() {
    const fixture = TestBed.createComponent(AppComponent);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  function rightClick(target: HTMLElement) {
    const event = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
    target.dispatchEvent(event);
    return event;
  }

  it("puts the pages in the scroll container below the window buttons", () => {
    const page = render();
    expect(page.querySelector("#page-scroll router-outlet")).not.toBeNull();
    expect(page.querySelector("app-window-controls")).not.toBeNull();
  });

  it("hides the download manager while nothing downloads", () => {
    expect(render().querySelector("app-download-manager")).toBeNull();
  });

  it("blocks the browser's context menu", () => {
    const page = render();
    expect(rightClick(page).defaultPrevented).toBeTrue();
  });

  it("keeps right-click on elements that open a menu", () => {
    const page = render();
    const trigger = document.createElement("button");
    trigger.setAttribute("matMenuTriggerFor", "");
    const icon = document.createElement("span");
    trigger.appendChild(icon);
    page.appendChild(trigger);
    expect(rightClick(icon).defaultPrevented).toBeFalse();
  });
});
