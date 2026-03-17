Set-Location "C:\Users\gunny\code"

while ($true) {
    $status = git status --porcelain
    if ($status) {
        git add -A
        git commit -m "Auto-sync $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"
        git push origin master
    }
    Start-Sleep 30
}
