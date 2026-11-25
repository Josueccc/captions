; Inno Setup script for the Windows companion: a per-user install (no admin
; prompt) into the same folder `captions-companion install` uses, registered
; with Firefox by that command. Built by .github/workflows/build.yml:
;   iscc /DAppVersion=0.3.0 /DExe=path\to\captions-companion.exe captions-companion.iss

#ifndef AppVersion
  #error Pass /DAppVersion=x.y.z
#endif
#ifndef Exe
  #define Exe "..\..\target\release\captions-companion.exe"
#endif

[Setup]
AppId={{6F1D5C2A-3B7E-4F4A-9C1D-2E8B7A5F0C31}
AppName=Captions Companion
AppVersion={#AppVersion}
AppPublisher=Captions
AppComments=Records Firefox's audio for the Captions extension, so DRM-protected videos get captions.
DefaultDirName={localappdata}\Programs\Captions Companion
DisableDirPage=yes
DisableProgramGroupPage=yes
DisableReadyPage=yes
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
; No version in the name: the extension links to releases/latest/download/<this>.
OutputBaseFilename=captions-companion-windows-x64-setup
OutputDir=Output
Compression=lzma2
SolidCompression=yes
UninstallDisplayName=Captions Companion
UninstallDisplayIcon={app}\captions-companion.exe
; A running companion (captions on) holds the exe; ask the user to stop captions.
CloseApplications=yes

[Files]
Source: "{#Exe}"; DestDir: "{app}"; Flags: ignoreversion

[Run]
Filename: "{app}\captions-companion.exe"; Parameters: "install"; Flags: runhidden waituntilterminated; StatusMsg: "Registering with Firefox..."

[UninstallRun]
Filename: "{app}\captions-companion.exe"; Parameters: "uninstall"; Flags: runhidden waituntilterminated; RunOnceId: "Unregister"

[UninstallDelete]
Type: files; Name: "{app}\captions_companion.json"

[Messages]
FinishedLabelNoIcons=Captions Companion is installed. Restart captions in Firefox if they were running.
