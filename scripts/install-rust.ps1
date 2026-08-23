# Installs the Rust toolchain for WorkPulse's Windows agent.
#
# This machine has no MSVC linker and no Windows SDK, so the default
# x86_64-pc-windows-msvc host would drag in ~3GB of Visual Studio Build Tools.
# We install the self-contained GNU host instead: no admin, no VS.
#
# Safe to re-run; exits early if a working toolchain is already present.

$ErrorActionPreference = 'Stop'

$cargoBin = Join-Path $env:USERPROFILE '.cargo\bin'
if (-not ($env:Path -split ';' | Where-Object { $_ -eq $cargoBin })) {
    $env:Path = "$cargoBin;$env:Path"
}

if (Get-Command rustc -ErrorAction SilentlyContinue) {
    Write-Output 'rustc already installed:'
    rustc -Vv
    cargo -V
    exit 0
}

$installer = Join-Path $env:TEMP 'rustup-init.exe'

Write-Output 'Downloading rustup-init...'
Invoke-WebRequest -Uri 'https://win.rustup.rs/x86_64' -OutFile $installer -UseBasicParsing

Write-Output 'Installing stable-x86_64-pc-windows-gnu...'
& $installer -y --no-modify-path --default-host x86_64-pc-windows-gnu --default-toolchain stable --profile default
if ($LASTEXITCODE -ne 0) { throw "rustup-init failed with exit code $LASTEXITCODE" }

Remove-Item $installer -Force -ErrorAction SilentlyContinue

Write-Output 'Installed:'
rustc -Vv
cargo -V
