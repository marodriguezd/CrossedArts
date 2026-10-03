# Infrastructure Memory

## Startup Scripts
- **Auto-Update**: `start.sh` and `start.ps1` perform an automatic `git fetch` and `git pull --ff-only` at the very beginning of their execution. This ensures the environment runs the latest stable main code.
- **PowerShell Syntax**: In `start.ps1`, PowerShell string escaping for regex inside single quotes requires four single quotes (`''''`) to represent two literal single quotes, unlike Bash escaping (`\'`).
