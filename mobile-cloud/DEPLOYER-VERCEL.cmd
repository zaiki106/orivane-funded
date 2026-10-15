@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Installe Node.js 24 avec npm depuis https://nodejs.org puis relance ce fichier.
  pause
  exit /b 1
)
where npx >nul 2>nul
if errorlevel 1 (
  echo npx est absent. Installe Node.js 24 avec npm puis relance ce fichier.
  pause
  exit /b 1
)
echo Publication du projet existant orivane-funded-mobile.
echo Equipe : zaikifrt-1551s-projects
echo Adresse finale : https://orivane-funded-mobile.vercel.app
echo Le compte Vercel utilise doit etre autorise a deployer dans cette equipe.
call npx --yes vercel@latest --prod --scope zaikifrt-1551s-projects --yes
if errorlevel 1 (
  echo Publication echouee. Verifie la connexion et les droits du compte Vercel.
  echo Si necessaire, execute : npx vercel login
  pause
  exit /b 1
)
echo Publication terminee. Ouvre le site sur le telephone puis actualise la page.
pause
