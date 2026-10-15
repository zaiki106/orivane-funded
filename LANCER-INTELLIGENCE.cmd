@echo off
node "%~dp0src\intelligence-cli.mjs" %*
if "%~1"=="" pause
