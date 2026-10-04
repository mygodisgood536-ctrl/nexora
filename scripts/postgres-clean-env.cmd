@echo off
rem Starts PostgreSQL with a deliberately minimal, clean environment so that
rem backend processes cannot inherit anything hostile from an operator shell.
set "SystemRoot=C:\Windows"
set "SystemDrive=C:"
set "windir=C:\Windows"
set "ComSpec=C:\Windows\System32\cmd.exe"
set "PATH=C:\Users\adede\nexora\.pg\16\bin;C:\Windows\System32;C:\Windows"
set "TEMP=C:\Windows\Temp"
set "TMP=C:\Windows\Temp"
set "NUMBER_OF_PROCESSORS=8"
set "OS=Windows_NT"
set "USERPROFILE=C:\Users\adede"
set "HOMEDRIVE=C:"
set "HOMEPATH=\Users\adede"
set "APPDATA=C:\Users\adede\AppData\Roaming"
set "LOCALAPPDATA=C:\Users\adede\AppData\Local"
"C:\Users\adede\nexora\.pg\16\bin\postgres.exe" -D %1 -p %2