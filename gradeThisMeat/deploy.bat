@echo off
cd /d "C:\Users\gunny\code"
echo Merging dev into master and deploying to gradethismeat.xyz...
git checkout master
git merge dev
git push origin master
git checkout dev
echo Done! Live site will update in about a minute.
pause
