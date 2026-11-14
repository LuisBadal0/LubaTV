import { TestBed } from "@angular/core/testing";
import { CategoryPaneComponent } from "./category-pane.component";
import { MemoryService } from "../memory.service";
import { Channel } from "../models/channel";
import { Filters } from "../models/filters";
import { MediaType } from "../models/mediaType";
import { ViewMode } from "../models/viewMode";
import { mockTauri, TEST_IMPORTS, TEST_PROVIDERS, TEST_SCHEMAS } from "../../testing/test-setup";

describe("CategoryPaneComponent", () => {
  const sports: Channel = { id: 1, name: "PT: Made-up Sports", media_type: MediaType.group };
  const news: Channel = { id: 2, name: "Made-up News", media_type: MediaType.group };
  const filters: Filters = {
    source_ids: [1],
    media_types: [MediaType.livestream],
    view_type: ViewMode.Categories,
    page: 1,
    use_keywords: false,
    group_id: 1,
  };

  async function render(favorites: Channel[] = []) {
    mockTauri({ search: [sports, news], get_favorite_groups: favorites });
    await TestBed.configureTestingModule({
      declarations: [CategoryPaneComponent],
      imports: TEST_IMPORTS,
      providers: TEST_PROVIDERS,
      schemas: TEST_SCHEMAS,
    }).compileComponents();
    TestBed.inject(MemoryService).FavoriteGroups.next(favorites);
    const fixture = TestBed.createComponent(CategoryPaneComponent);
    fixture.componentRef.setInput("filters", filters);
    fixture.componentRef.setInput("activeId", 1);
    fixture.detectChanges();
    // The fake backend answers after a turn of the event loop.
    await new Promise((resolve) => setTimeout(resolve, 20));
    fixture.detectChanges();
    return fixture;
  }

  function names(page: HTMLElement) {
    return Array.from(page.querySelectorAll(".label")).map((label) => label.textContent);
  }

  it("lists the categories, with the open one marked", async () => {
    const page = (await render()).nativeElement as HTMLElement;
    expect(names(page)).toEqual(["Made-up Sports", "Made-up News"]);
    expect(page.querySelector(".row.on .label")?.textContent).toBe("Made-up Sports");
    expect(page.querySelector(".row.on .cc")?.textContent).toBe("PT");
    expect(page.querySelector(".more")).toBeNull();
  });

  it("puts favorites in their own section, once", async () => {
    const page = (await render([news])).nativeElement as HTMLElement;
    expect(names(page)).toEqual(["Made-up News", "Made-up Sports"]);
    const sections = Array.from(page.querySelectorAll(".sect")).map((sect) => sect.textContent);
    expect(sections).toEqual(["Favorites", "All categories"]);
    expect(page.querySelector(".row .pin.on")).not.toBeNull();
  });

  it("asks home to open the chosen category", async () => {
    const fixture = await render();
    const opened = jasmine.createSpy("open");
    fixture.componentInstance.open.subscribe(opened);
    (fixture.nativeElement as HTMLElement).querySelectorAll<HTMLButtonElement>(".name")[1].click();
    expect(opened).toHaveBeenCalledWith(news);
  });

  it("shows every match while filtering, favorites included", async () => {
    const fixture = await render([news]);
    fixture.componentInstance.query = "made";
    fixture.detectChanges();
    const page = fixture.nativeElement as HTMLElement;
    expect(names(page)).toEqual(["Made-up Sports", "Made-up News"]);
    expect(page.querySelector(".sect")?.textContent).toBe("Matches");
  });
});
