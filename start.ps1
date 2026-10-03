# =============================================================================
# DomestiK - Script de inicio (Windows)
# Uso:  powershell -ExecutionPolicy Bypass -File start.ps1 [-Dev] [-Quiet]
# =============================================================================
param(
    [switch]$Dev,
    [switch]$Quiet
)

$ErrorActionPreference = "Stop"

# == Colores ==================================================================
function Write-Info  { param($Msg) Write-Host "[DomestiK] " -ForegroundColor Cyan -NoNewline; Write-Host $Msg }
function Write-Ok    { param($Msg) Write-Host "  OK " -ForegroundColor Green -NoNewline; Write-Host $Msg }
function Write-Warn  { param($Msg) Write-Host "  !! " -ForegroundColor Yellow -NoNewline; Write-Host $Msg }
function Write-Fail  { param($Msg) Write-Host "  XX " -ForegroundColor Red -NoNewline; Write-Host $Msg; exit 1 }

# == Variables globales ======================================================
$ScriptDir   = Split-Path -Parent $MyInvocation.MyCommand.Path
$Port        = if ($env:DOMESTIK_PORT) { $env:DOMESTIK_PORT } else { "8088" }
$VenvDir     = ".venv"
$DataDir     = Join-Path $env:USERPROFILE ".domestik"
$EnvFile     = Join-Path $DataDir ".env"
$ExampleEnv  = Join-Path $ScriptDir ".env.example"
$PythonMin   = [version]"3.11.0"
$PipQuiet    = if ($Quiet) { "--quiet" } else { "" }

Set-Location $ScriptDir

# == Actualizacion de Git =====================================================
Write-Info "Comprobando actualizaciones del proyecto..."
if ((Get-Command git -ErrorAction SilentlyContinue) -and (Test-Path ".git")) {
    $prevErrorAction = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    try {
        $gitFetch = Start-Process -FilePath "git" -ArgumentList "fetch", "--quiet" -Wait -NoNewWindow -PassThru
        if ($gitFetch.ExitCode -eq 0) {
            $gitPull = Start-Process -FilePath "git" -ArgumentList "pull", "--ff-only", "--quiet" -Wait -NoNewWindow -PassThru
            if ($gitPull.ExitCode -eq 0) {
                Write-Ok "Proyecto actualizado correctamente (o ya estaba al dia)."
            } else {
                Write-Warn "Hay cambios locales o ramas divergentes. Se omitio la actualizacion automatica."
            }
        } else {
            Write-Warn "No se pudo conectar al repositorio remoto para actualizar."
        }
    } catch {
        Write-Warn "Error al intentar actualizar con Git."
    } finally {
        $ErrorActionPreference = $prevErrorAction
    }
} else {
    Write-Warn "Git no encontrado o no es un repositorio Git. Saltando actualizacion."
}

# == Funciones auxiliares =====================================================
function Find-Python311 {
    # Intenta el launcher de Python (py -3.11)
    try {
        $output = & py -3.11 --version 2>&1
        $ver = ($output | Select-String -Pattern '\d+\.\d+(\.\d+)?').Matches[0].Value
        if ([version]$ver -ge $PythonMin) {
            return @{ Cmd = "py"; Args = @("-3.11") }
        }
    } catch {}

    # Intenta python directamente
    try {
        $output = & python --version 2>&1
        $ver = ($output | Select-String -Pattern '\d+\.\d+(\.\d+)?').Matches[0].Value
        if ([version]$ver -ge $PythonMin) {
            return @{ Cmd = "python"; Args = @() }
        }
    } catch {}

    # Intenta python3
    try {
        $output = & python3 --version 2>&1
        $ver = ($output | Select-String -Pattern '\d+\.\d+(\.\d+)?').Matches[0].Value
        if ([version]$ver -ge $PythonMin) {
            return @{ Cmd = "python3"; Args = @() }
        }
    } catch {}

    return $null
}

function Invoke-Python {
    param(
        [hashtable]$PythonInfo,
        [string[]]$Arguments
    )
    $allArgs = $PythonInfo.Args + $Arguments
    & $PythonInfo.Cmd @allArgs
}

function Test-PortAvailable {
    param([int]$PortNum)
    try {
        $conn = New-Object System.Net.Sockets.TcpClient
        $conn.Connect("127.0.0.1", $PortNum)
        $conn.Close()
        return $false
    } catch {
        return $true
    }
}

# == 1. Detectar / instalar Python 3.11 ======================================
Write-Info "Verificando Python >= $PythonMin..."
$pythonInfo = Find-Python311

if ($pythonInfo) {
    $ver = & $pythonInfo.Cmd @($pythonInfo.Args + @("--version")) 2>&1
    Write-Ok "Python encontrado: $ver"
} else {
    Write-Warn "Python >= $PythonMin no encontrado. Intentando instalar..."

    if (Get-Command winget -ErrorAction SilentlyContinue) {
        Write-Info "Instalando Python 3.11 via winget..."
        & winget install Python.Python.3.11 --silent --accept-package-agreements --accept-source-agreements

        # Refrescar PATH
        $env:Path = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path", "User")

        $pythonInfo = Find-Python311
        if ($pythonInfo) {
            Write-Ok "Python instalado correctamente."
        } else {
            Write-Fail "No se pudo instalar Python 3.11. Instalalo manualmente: https://www.python.org/downloads/"
        }
    } else {
        Write-Fail "winget no esta disponible. Instala Python 3.11 manualmente:`n       https://www.python.org/downloads/`n       Marca 'Add Python to PATH' durante la instalacion."
    }
}

# == 2. Crear entorno virtual ================================================
if (-not (Test-Path $VenvDir)) {
    Write-Info "Creando entorno virtual en .venv..."
    Invoke-Python -PythonInfo $pythonInfo -Arguments @("-m", "venv", $VenvDir)
    Write-Ok "Entorno virtual creado."
} else {
    Write-Ok "Entorno virtual existente."
}

# == 3. Activar entorno virtual ==============================================
$activateScript = Join-Path $VenvDir "Scripts\Activate.ps1"
. $activateScript
Write-Ok "Entorno virtual activado."

# == 4. Instalar dependencias ===============================================
Write-Info "Instalando dependencias..."
$pipArgs = @("--quiet")
& python -m pip install --upgrade pip @pipArgs 2>$null
& pip install -r backend\requirements.txt @pipArgs 2>$null
Write-Ok "Dependencias instaladas."

# == 5. Directorio de datos y .env ===========================================
if (-not (Test-Path $DataDir)) {
    New-Item -ItemType Directory -Path $DataDir -Force | Out-Null
}
Write-Ok "Directorio de datos: $DataDir"

if (-not (Test-Path $EnvFile)) {
    if (Test-Path $ExampleEnv) {
        Copy-Item $ExampleEnv $EnvFile
        Write-Ok "Archivo .env creado desde .env.example"
    } else {
        New-Item -ItemType File -Path $EnvFile -Force | Out-Null
        Write-Ok "Archivo .env creado (vacio)."
    }
}

# Configurar puerto en .env
$envContent = Get-Content $EnvFile -Raw -ErrorAction SilentlyContinue
if ($envContent -match '^\s*#\s*PORT=') {
    $envContent = $envContent -replace '^\s*#\s*PORT=.*', "PORT=$Port"
    Set-Content -Path $EnvFile -Value $envContent
    Write-Ok "Puerto configurado: $Port"
} elseif ($envContent -notmatch '^\s*PORT=') {
    Add-Content -Path $EnvFile -Value "`n# Configurado por start.ps1`nPORT=$Port"
    Write-Ok "Puerto configurado: $Port"
} else {
    Write-Ok "Puerto ya configurado en .env"
}

# Configurar embedding provider en .env
if ($envContent -match '^\s*(#\s*)?EMBEDDING_PROVIDER\s*=\s*(mock|""|''''|"\s*")') {
    $envContent = $envContent -replace '^\s*(#\s*)?EMBEDDING_PROVIDER\s*=.*', "EMBEDDING_PROVIDER=huggingface"
    Set-Content -Path $EnvFile -Value $envContent
    Write-Ok "Configurado proveedor de embeddings local: huggingface"
} elseif ($envContent -notmatch '^\s*EMBEDDING_PROVIDER=') {
    Add-Content -Path $EnvFile -Value "`n# Configurado automaticamente por start.ps1`nEMBEDDING_PROVIDER=huggingface"
    Write-Ok "Configurado proveedor de embeddings local: huggingface"
}


# == 6. Migraciones de base de datos ========================================
Write-Info "Aplicando migraciones de base de datos..."
$env:PYTHONPATH = "."
try {
    & alembic -c backend\alembic.ini upgrade head 2>$null
    Write-Ok "Base de datos lista."
} catch {
    Write-Warn "Alembic no aplico migraciones (puede ser normal si la DB ya esta al dia)."
}

# == 7. Crear directorios auxiliares =========================================
$contentDir = Join-Path $DataDir "content"
$coversDir  = Join-Path $DataDir "covers"
if (-not (Test-Path $contentDir)) { New-Item -ItemType Directory -Path $contentDir -Force | Out-Null }
if (-not (Test-Path $coversDir))  { New-Item -ItemType Directory -Path $coversDir  -Force | Out-Null }
Write-Ok "Directorios de contenido y portadas listos."

# == 8. Verificar puerto ====================================================
if (-not (Test-PortAvailable -PortNum ([int]$Port))) {
    Write-Warn "Puerto $Port en uso. Probando 8089..."
    $Port = "8089"
    $envContent = Get-Content $EnvFile -Raw
    $envContent = $envContent -replace 'PORT=\d+', "PORT=$Port"
    Set-Content -Path $EnvFile -Value $envContent
    Write-Ok "Puerto cambiado a: $Port"
}

# == 9. Iniciar servidor ====================================================
Write-Host ""
Write-Host ("=" * 59) -ForegroundColor Cyan
Write-Host "  DomestiK - Gestor de Aprendizaje" -ForegroundColor White
Write-Host ("=" * 59) -ForegroundColor Cyan
Write-Host "  URL:    " -ForegroundColor Gray -NoNewline
Write-Host "http://127.0.0.1:$Port" -ForegroundColor Green
Write-Host "  Datos:  " -ForegroundColor Gray -NoNewline
Write-Host $DataDir -ForegroundColor Cyan
Write-Host "  Modo:   " -ForegroundColor Gray -NoNewline
if ($Dev) { Write-Host "Desarrollo (auto-reload)" -ForegroundColor Yellow }
else      { Write-Host "Produccion" -ForegroundColor Green }
Write-Host ("=" * 59) -ForegroundColor Cyan
Write-Host ""

$env:PYTHONPATH = "."
$env:PORT = $Port

# == 10. Abrir el navegador automaticamente ==================================
Start-Job -ScriptBlock {
    param($p)
    for ($i=0; $i -lt 60; $i++) {
        try {
            $c = New-Object System.Net.Sockets.TcpClient
            $c.Connect('127.0.0.1', $p)
            $c.Close()
            break
        } catch {
            Start-Sleep -Milliseconds 500
        }
    }
    $url = 'http://127.0.0.1:' + $p

    # Buscar Opera en rutas conocidas de Windows
    $operaPaths = @(
        "$env:LOCALAPPDATA\Programs\Opera\opera.exe",
        "$env:PROGRAMFILES\Opera\opera.exe",
        "${env:PROGRAMFILES(X86)}\Opera\opera.exe"
    )
    $opera = $operaPaths | Where-Object { Test-Path $_ } | Select-Object -First 1

    if ($opera) {
        Start-Process $opera $url
    } else {
        Start-Process $url
    }
} -ArgumentList $Port | Out-Null

& python -m backend.app.main


