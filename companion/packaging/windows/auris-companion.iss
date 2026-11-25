; Inno Setup script for the Windows companion: a per-user install (no admin
; prompt) into the same folder `auris-companion install` uses, registered
; with Firefox by that command. Built by .github/workflows/build.yml:
;   iscc /DAppVersion=0.3.0 /DExe=path\to\auris-companion.exe auris-companion.iss

#ifndef AppVersion
  #error Pass /DAppVersion=x.y.z
#endif
#ifndef Exe
  #define Exe "..\..\target\release\auris-companion.exe"
#endif

[Setup]
AppId={{6F1D5C2A-3B7E-4F4A-9C1D-2E8B7A5F0C31}
AppName=Auris Companion
AppVersion={#AppVersion}
AppPublisher=Auris
AppComments=Records Firefox's audio for the Auris extension, so DRM-protected videos get captions.
DefaultDirName={localappdata}\Programs\Auris Companion
DisableDirPage=yes
DisableProgramGroupPage=yes
DisableReadyPage=yes
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
; No version in the name: the extension links to releases/latest/download/<this>.
OutputBaseFilename=auris-companion-windows-x64-setup
OutputDir=Output
Compression=lzma2
SolidCompression=yes
UninstallDisplayName=Auris Companion
UninstallDisplayIcon={app}\auris-companion.exe
; A running companion (captions on) holds the exe; ask the user to stop captions.
CloseApplications=yes

[Files]
Source: "{#Exe}"; DestDir: "{app}"; Flags: ignoreversion
; Shipped with the binary as the GPL asks; not shown as a page, since using it needs no acceptance.
Source: "..\..\..\LICENSE"; DestDir: "{app}"; Flags: ignoreversion

[Run]
Filename: "{app}\auris-companion.exe"; Parameters: "install"; Flags: runhidden waituntilterminated; StatusMsg: "Registering with Firefox..."

[UninstallRun]
Filename: "{app}\auris-companion.exe"; Parameters: "uninstall"; Flags: runhidden waituntilterminated; RunOnceId: "Unregister"

[UninstallDelete]
Type: files; Name: "{app}\auris_companion.json"

[Messages]
FinishedLabelNoIcons=Auris Companion is installed. Restart captions in Firefox if they were running.
