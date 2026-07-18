@echo off
cd /d "C:\Users\gunny\code"
git add -A
git diff --cached --quiet && (
    echo No changes to sync.
) || (
    git commit -m "Auto-sync %date% %time%"
    git push origin master
    echo Synced to GitHub.
)
