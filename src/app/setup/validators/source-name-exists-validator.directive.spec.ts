import { FormControl } from "@angular/forms";
import { mockIPC } from "@tauri-apps/api/mocks";
import { firstValueFrom } from "rxjs";
import { mockTauri } from "../../../testing/test-setup";
import { SourceNameExistsValidator } from "./source-name-exists-validator.directive";

describe("SourceNameExistsValidator", () => {
  const validator = new SourceNameExistsValidator();
  const validate = (value: string) => firstValueFrom(validator.validate(new FormControl(value)));

  it("rejects a name another source already has", async () => {
    mockTauri({ source_name_exists: true });
    expect(await validate("My IPTV")).toEqual({ sourceNameExists: true });
  });

  it("accepts a new name", async () => {
    mockTauri({ source_name_exists: false });
    expect(await validate("My IPTV")).toBeNull();
  });

  it("checks the name without surrounding spaces, and skips empty names", async () => {
    const asked: unknown[] = [];
    mockTauri();
    mockIPC((cmd, args) => {
      asked.push({ cmd, args });
      return false;
    });
    expect(await validate("  ")).toBeNull();
    expect(await validate("  My IPTV ")).toBeNull();
    expect(asked).toEqual([{ cmd: "source_name_exists", args: { name: "My IPTV" } }]);
  });
});
