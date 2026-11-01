' Запускает помощника без окна. Лог пишется в helper.log в папке проекта.
' Используется автозапуском (autostart-on.cmd), можно запускать и вручную двойным кликом.
Set fso = CreateObject("Scripting.FileSystemObject")
projectDir = fso.GetParentFolderName(fso.GetParentFolderName(WScript.ScriptFullName))
Set sh = CreateObject("WScript.Shell")
sh.CurrentDirectory = projectDir
sh.Run "cmd /c npm start > helper.log 2>&1", 0, False
