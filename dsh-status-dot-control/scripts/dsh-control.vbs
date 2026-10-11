' dsh-control.vbs -- first hop of the control chain, shipped with the package.
'
' The panel asks the server half for POST /dsh-status-dot/action?action=<a>; the
' server half then starts
'     wscript.exe <this file> meowdsh://<a> [appPath] [processName] [delaySeconds]
' so the action runs in a process that SURVIVES the stop/restart it triggers.
' Measured on Windows (2026-09-12): spawning powershell with detached:true makes
' it exit silently with code 0 without running anything, and without detached the
' child dies with its parent -- so wscript is the reliable shape.
'
' Arguments: 0 = the action URL, then optional app exe path, process name and
' delay in seconds; each one that is present is forwarded to dsh-control.ps1 in
' this same folder. Nothing else is required: no protocol handler registration,
' no script of your own.
'
' ASCII only, and every literal double quote is built with Chr(34) instead of
' doubled quotes: a generated file that got that wrong made wscript refuse it
' with 800A0409 "unterminated string constant".

Option Explicit

Dim url, act, appPath, procName, delaySec, kept, i, ch
Dim fso, shell, q, here, ps1, cmd

q = Chr(34)
url = ""
appPath = ""
procName = ""
delaySec = ""
If WScript.Arguments.Count > 0 Then url = WScript.Arguments(0)
If WScript.Arguments.Count > 1 Then appPath = WScript.Arguments(1)
If WScript.Arguments.Count > 2 Then procName = WScript.Arguments(2)
If WScript.Arguments.Count > 3 Then delaySec = WScript.Arguments(3)

' keep the part after "://", then only letters (drops slashes and any query),
' lowercased. An empty action means "status", which changes nothing.
act = url
If InStr(act, "://") > 0 Then act = Mid(act, InStr(act, "://") + 3)
kept = ""
For i = 1 To Len(act)
  ch = Mid(act, i, 1)
  If (ch >= "a" And ch <= "z") Or (ch >= "A" And ch <= "Z") Then kept = kept & ch
Next
act = LCase(kept)
If act = "" Then act = "status"

Set fso = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")
here = fso.GetParentFolderName(WScript.ScriptFullName)
ps1 = fso.BuildPath(here, "dsh-control.ps1")

cmd = "powershell.exe -NoProfile -ExecutionPolicy Bypass -File " & q & ps1 & q & " -Action " & q & act & q
If appPath <> "" Then cmd = cmd & " -AppPath " & q & appPath & q
If procName <> "" Then cmd = cmd & " -ProcessName " & q & procName & q
If delaySec <> "" Then cmd = cmd & " -DelaySeconds " & delaySec

' 0 = hidden window, False = do not wait for it (this router is a one-shot hop).
shell.Run cmd, 0, False
