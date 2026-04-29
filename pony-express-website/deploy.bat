@echo off
echo [Pony Express] Building site...
call npm run build
if %errorlevel% neq 0 (
  echo BUILD FAILED. Aborting deploy.
  exit /b 1
)

echo [Pony Express] Deploying to GitHub Pages (gh-pages branch)...
call npx gh-pages -d dist
if %errorlevel% neq 0 (
  echo DEPLOY FAILED.
  exit /b 1
)

echo [Pony Express] Deploy complete!
