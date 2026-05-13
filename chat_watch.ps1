# chat_watch.ps1
# Watches chat_queue.json for new messages and prints them to stdout.
# Used by Claude Code Monitor to detect incoming chat requests.

$QUEUE_FILE = Join-Path $PSScriptRoot "chat_queue.json"
$TRIGGER_FILE = Join-Path $PSScriptRoot "chat_queue.json.trigger"
$RESP_FILE = Join-Path $PSScriptRoot "chat_response.json"

Write-Output "CHAT_WATCHER: Started. Watching $QUEUE_FILE"

$lastId = $null
while ($true) {
    if (Test-Path $TRIGGER_FILE) {
        try {
            $triggerId = Get-Content $TRIGGER_FILE -Raw
            $triggerId = $triggerId.Trim()
            if ($triggerId -ne $lastId -and $triggerId -ne '') {
                $lastId = $triggerId
                if (Test-Path $QUEUE_FILE) {
                    $msg = Get-Content $QUEUE_FILE -Raw -Encoding UTF8
                    Write-Output "CHAT_REQUEST|$msg"
                }
            }
        } catch {}
    }
    Start-Sleep -Milliseconds 500
}
