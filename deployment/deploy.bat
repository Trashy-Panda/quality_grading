@echo off
cd /d "C:\Users\gunny\code"
echo Merging dev into master and deploying to beefgrading.study...
git checkout master || goto :fail
git pull origin master || goto :fail
git merge dev || goto :mergefail
git push origin master || goto :fail
git checkout dev
echo Done! Live site will update in about a minute.
pause
exit /b 0

:mergefail
echo MERGE FAILED - aborting merge, master left unchanged.
git merge --abort
git checkout dev
pause
exit /b 1

:fail
echo DEPLOY FAILED - check the output above. Returning to dev.
git checkout dev
pause
exit /b 1
