import { NO_ERRORS_SCHEMA, Provider, EnvironmentProviders } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { provideNoopAnimations } from "@angular/platform-browser/animations";
import { provideRouter } from "@angular/router";
import { NgbActiveModal } from "@ng-bootstrap/ng-bootstrap";
import { clearMocks, mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import { provideToastr } from "ngx-toastr";

/**
 * What the fake backend answers for commands components call while starting. Commands
 * missing here answer null. Tests can pass their own answers to mockTauri.
 */
const DEFAULT_ANSWERS: Record<string, unknown> = {
  get_settings: {},
  get_sources: [],
  get_enabled_sources: [],
  search: [],
  group_previews: [],
  last_watched_times: {},
  get_epg_ids: [],
  get_all_expiries: {},
  "plugin:app|version": "0.0.0-test",
};

/** Replaces the Tauri backend with a fake one, and fakes the "main" window. */
export function mockTauri(answers: Record<string, unknown> = {}) {
  clearMocks();
  mockWindows("main");
  mockIPC(
    (cmd) => {
      if (cmd in answers) return answers[cmd];
      return DEFAULT_ANSWERS[cmd] ?? null;
    },
    { shouldMockEvents: true },
  );
}

/** Services the app provides at the root and components expect to find. */
export const TEST_PROVIDERS: (Provider | EnvironmentProviders)[] = [
  provideNoopAnimations(),
  provideToastr(),
  provideRouter([]),
  NgbActiveModal,
];

export const TEST_IMPORTS = [FormsModule];

/**
 * Child components and directives aren't declared in the component tests, so their
 * elements and inputs are ignored rather than reported as unknown.
 */
export const TEST_SCHEMAS = [NO_ERRORS_SCHEMA];
