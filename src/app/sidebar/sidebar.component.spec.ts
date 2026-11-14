import { TestBed } from "@angular/core/testing";
import { SidebarComponent } from "./sidebar.component";
import { MENU_PINNED_CLASS } from "./menu-pin";
import { MemoryService } from "../memory.service";
import { MENU_PINNED } from "../models/localStorage";
import { SourceType } from "../models/sourceType";
import { mockTauri, TEST_IMPORTS, TEST_PROVIDERS, TEST_SCHEMAS } from "../../testing/test-setup";

describe("SidebarComponent", () => {
  const root = document.documentElement;

  beforeEach(async () => {
    mockTauri();
    localStorage.removeItem(MENU_PINNED);
    root.classList.remove(MENU_PINNED_CLASS);
    await TestBed.configureTestingModule({
      declarations: [SidebarComponent],
      imports: TEST_IMPORTS,
      providers: TEST_PROVIDERS,
      schemas: TEST_SCHEMAS,
    }).compileComponents();
  });

  afterEach(() => {
    localStorage.removeItem(MENU_PINNED);
    root.classList.remove(MENU_PINNED_CLASS);
  });

  function render() {
    const fixture = TestBed.createComponent(SidebarComponent);
    fixture.detectChanges();
    return fixture;
  }

  it("starts as a column of icons that isn't kept open", () => {
    const page = render().nativeElement as HTMLElement;
    expect(page.querySelector(".side")?.classList).not.toContain("pinned");
    expect(root.classList).not.toContain(MENU_PINNED_CLASS);
    expect(page.querySelector(".pin-btn")?.getAttribute("aria-pressed")).toBe("false");
  });

  it("keeps the menu open after the pin is pressed, and remembers it", () => {
    const fixture = render();
    const page = fixture.nativeElement as HTMLElement;
    page.querySelector<HTMLButtonElement>(".pin-btn")!.click();
    fixture.detectChanges();

    expect(page.querySelector(".side")?.classList).toContain("pinned");
    expect(root.classList).toContain(MENU_PINNED_CLASS);
    expect(localStorage.getItem(MENU_PINNED)).toBe("true");
    expect(page.querySelector(".pin-btn")?.getAttribute("aria-pressed")).toBe("true");

    // The next page's menu starts open too.
    const next = render().nativeElement as HTMLElement;
    expect(next.querySelector(".side")?.classList).toContain("pinned");
  });

  it("lets the menu close again when the pin is pressed twice", () => {
    const fixture = render();
    const pin = (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>(".pin-btn")!;
    pin.click();
    pin.click();
    fixture.detectChanges();

    expect(root.classList).not.toContain(MENU_PINNED_CLASS);
    expect(localStorage.getItem(MENU_PINNED)).toBe("false");
  });

  it("lists each source with its type", () => {
    TestBed.inject(MemoryService).Sources.set(7, {
      id: 7,
      name: "Made-up playlist",
      source_type: SourceType.Xtream,
    } as never);
    const page = render().nativeElement as HTMLElement;
    const source = page.querySelector(".src:not(.fav-cat)");
    expect(source?.querySelector(".label")?.textContent).toBe("Made-up playlist");
    expect(source?.querySelector(".kind")?.textContent).toBe("Xtream");
  });
});
