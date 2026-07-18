@echo off
setlocal
cd /d "C:\Users\gunny\code"
echo Deploying dev to master (beefgrading.study)...

REM Push dev first so the remote has everything
git push origin dev || goto :fail

REM Merge + push master in a temporary worktree so this working tree
REM never switches branches (uncommitted work stays untouched and the
REM running script can't delete itself mid-run).
set WT=%TEMP%\gtm-deploy-worktree
git worktree remove --force "%WT%" 2>nul
git worktree add "%WT%" master || goto :fail
git -C "%WT%" pull origin master || goto :cleanupfail
git -C "%WT%" merge dev -m "Deploy dev to master" || goto :mergefail
git -C "%WT%" push origin master || goto :cleanupfail
git worktree remove "%WT%"
echo Done! Live site will update in about a minute.
pause
exit /b 0

:mergefail
echo MERGE FAILED - aborting, master left unchanged.
git -C "%WT%" merge --abort
git worktree remove --force "%WT%"
pause
exit /b 1

:cleanupfail
git worktree remove --force "%WT%"
:fail
echo DEPLOY FAILED - check the output above.
pause
exit /b 1
