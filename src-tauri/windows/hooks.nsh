; LubaTV's additions to the NSIS installer (bundle.windows.nsis.installerHooks).

; The installers the updater downloads don't contain the player files (see
; src/player_files.rs), so the uninstaller they write doesn't list them. On a real uninstall,
; remove the installed player files and the ones LubaTV downloaded itself. Updates run
; in update mode and keep both.
!macro NSIS_HOOK_POSTUNINSTALL
  ${If} $UpdateMode <> 1
    RMDir /r "$INSTDIR\deps"
    RMDir "$INSTDIR"
    RMDir /r "$LOCALAPPDATA\luisbadalo\lubatv\data\player"
  ${EndIf}
!macroend
