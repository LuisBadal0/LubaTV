import { SimpleChange } from "@angular/core";
import { FormControl } from "@angular/forms";
import { NotEmptyValidatorDirective } from "./not-empty-validator.directive";

describe("NotEmptyValidatorDirective", () => {
  const validate = (value: unknown, disabled = false) => {
    const directive = new NotEmptyValidatorDirective();
    directive.disabled = disabled;
    return directive.validate(new FormControl(value));
  };

  it("rejects empty and whitespace-only values", () => {
    expect(validate("")).toEqual({ empty: true });
    expect(validate("   ")).toEqual({ empty: true });
    expect(validate(null)).toEqual({ empty: true });
  });

  it("accepts text", () => {
    expect(validate(" My source ")).toBeNull();
  });

  it("accepts anything while disabled", () => {
    expect(validate("", true)).toBeNull();
  });

  it("asks the form to validate again when it's turned on or off", () => {
    const directive = new NotEmptyValidatorDirective();
    const revalidate = jasmine.createSpy("revalidate");
    directive.registerOnValidatorChange(revalidate);
    directive.ngOnChanges({ disabled: new SimpleChange(false, true, false) });
    expect(revalidate).toHaveBeenCalledTimes(1);
  });
});
