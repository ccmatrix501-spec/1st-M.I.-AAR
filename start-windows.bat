@echo off
if not exist node_modules (
  echo Installing dependencies...
  call npm install
)
echo Starting 1st M.I. Onboarding Bot...
node src\index.js
pause
