# Re-extracts the authoritative Vision v3.9 text (it was removed by cleanup).
$ErrorActionPreference = "Continue"
Add-Type -AssemblyName System.IO.Compression.FileSystem
$out = "C:\Users\adede\.cline\data\workspaces\chat\nexora-restored\_probe_out\VISION-v3.9-AUTHORITY.txt"
$files = Get-ChildItem 'C:\Users\adede\Downloads' -Filter '*.docx' | Where-Object { $_.Name -like '*v3.9*AI*Multi-Company*' }
if (-not $files) { $files = Get-ChildItem 'C:\Users\adede\Downloads' -Filter '*v3.9*.docx' }
$target = $files | Select-Object -First 1
$zip = [System.IO.Compression.ZipFile]::OpenRead($target.FullName)
$entry = $zip.Entries | Where-Object { $_.FullName -eq 'word/document.xml' }
$sr = New-Object System.IO.StreamReader($entry.Open())
$xml = $sr.ReadToEnd(); $sr.Close(); $zip.Dispose()
$t = $xml
$t = $t -replace '<w:tab[^>]*/>', "`t"
$t = $t -replace '<w:br[^>]*/>', "`n"
$t = $t -replace '</w:p>', "`n"
$t = $t -replace '</w:tr>', "`n"
$t = $t -replace '<w:tc[^>]*>', "`t"
$t = $t -replace '<[^>]+>', ''
$t = $t -replace '&lt;','<' -replace '&gt;','>' -replace '&quot;','"' -replace '&apos;',"'" -replace '&amp;','&'
$t = $t -replace "[ \t]+`n", "`n" -replace "`n{3,}", "`n`n"
[System.IO.File]::WriteAllText($out, $t, [System.Text.Encoding]::UTF8)
Write-Output ("WROTE {0} chars from {1}" -f $t.Length, $target.Name)