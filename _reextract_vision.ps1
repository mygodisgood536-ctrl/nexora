$ErrorActionPreference = "Continue"
Add-Type -AssemblyName System.IO.Compression.FileSystem
$docx = 'C:\Users\Me And Myself\Downloads\Cornelius%20Nexora%20Finance%20SAAS%20Software%20%E2%80%94%20Final%20Vision%20v3.9%20FINAL%20CLEAN%20AUTHORITY%20%E2%80%94%20AI%20and%20Multi-Company%20Concurrency%20Update%20%E2%80%94%20FINAL%20RECHECKED.docx'
$out = 'C:\Users\ME And Myself\nexora\docs\verification\VISION-v3.9-AUTHORITY-REEXTRACTED.txt'
$zip = [System.IO.Compression.ZipFile]::OpenRead($docx)
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
Write-Output ("WROTE {0} chars" -f $t.Length)
Write-Output ("LINES {0}" -f ($t -split "`n").Count)