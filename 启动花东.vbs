Set fso = CreateObject("Scripting.FileSystemObject")
base = fso.GetParentFolderName(WScript.ScriptFullName)
Set sh = CreateObject("WScript.Shell")
sh.CurrentDirectory = base
exe = base & "\node_modules\electron\dist\electron.exe"
If fso.FileExists(exe) Then
  sh.Run """" & exe & """ """ & base & """", 0, False
Else
  MsgBox "Electron not found. Run npm install in the pet folder first.", 48, "Hua Dong"
End If
