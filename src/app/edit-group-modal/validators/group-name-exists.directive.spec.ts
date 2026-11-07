import { FormControl } from "@angular/forms";
import { mockIPC } from "@tauri-apps/api/mocks";
import { firstValueFrom } from "rxjs";
import { mockTauri } from "../../../testing/test-setup";
import { GroupNameExistsValidator } from "./group-name-exists.directive";

describe("GroupNameExistsValidator", () => {
  let validator: GroupNameExistsValidator;
  let asked: unknown[];
  const validate = (value: string) => firstValueFrom(validator.validate(new FormControl(value)));

  beforeEach(() => {
    validator = new GroupNameExistsValidator();
    validator.sourceId = 3;
    asked = [];
    mockTauri();
  });

  function backendSays(exists: boolean) {
    mockIPC((cmd, args) => {
      asked.push({ cmd, args });
      return exists;
    });
  }

  it("rejects a name already used in the same source", async () => {
    backendSays(true);
    expect(await validate(" Sports ")).toEqual({ groupNameExists: true });
    expect(asked).toEqual([{ cmd: "group_exists", args: { name: "Sports", sourceId: 3 } }]);
  });

  it("accepts a new name", async () => {
    backendSays(false);
    expect(await validate("Sports")).toBeNull();
  });

  it("doesn't ask about empty names or the group's own name", async () => {
    backendSays(true);
    validator.originalName = "News";
    expect(await validate("")).toBeNull();
    expect(await validate("News")).toBeNull();
    expect(asked).toEqual([]);
  });
});
