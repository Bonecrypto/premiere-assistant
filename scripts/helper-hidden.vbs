' Starts the Premiere Assistant helper without a window. Log: helper.log in the project folder.
' Used by autostart-on.cmd; can also be double-clicked manually.
Set fso = CreateObject("Scripting.FileSystemObject")
projectDir = fso.GetParentFolderName(fso.GetParentFolderName(WScript.ScriptFullName))
Set sh = CreateObject("WScript.Shell")
sh.CurrentDirectory = projectDir
sh.Run "cmd /c npm start > helper.log 2>&1", 0, False
