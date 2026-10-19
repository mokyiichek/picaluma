param([switch]$SkipDownload, [int]$Width = 1280, [int]$Height = 800)
# Real Picaluma screenshot for the website (site/preview.jpg) from an isolated demo: its own library
# and web-view profile, filled with free Unsplash photos served by Lorem Picsum. The installed
# Picaluma's library and settings are never opened. Run after installing a new version:
#   powershell -File scripts/demo-screenshot.ps1   (then convert demo\screenshot.png to site/preview.jpg)
$ErrorActionPreference = 'Stop'
$root = Join-Path $env:TEMP 'picaluma-demo'
$pics = Join-Path $root 'Pictures'
$lib = Join-Path $root 'library'
$exe = "$env:LOCALAPPDATA\Picaluma\picaluma.exe"

$folders = [ordered]@{
  'Summer Holiday' = @{ date = '2026-10-12'; ids = 1015, 1011, 1040, 1043, 1050, 1039, 1047, 1067, 129, 1016, 1036, 1044 }
  'Family Dinner'  = @{ date = '2026-10-03'; ids = 292, 312, 429, 431, 493, 488 }
  'Garden'         = @{ date = '2026-09-21'; ids = 152, 306, 360, 401, 106, 145 }
  'Weekend Hike'   = @{ date = '2026-09-14'; ids = 1018, 1019, 1022, 1043, 1052, 1056, 1057 }
  'Birthday'       = @{ date = '2026-09-02'; ids = 1074, 1080, 1084, 225, 201 }
  'City Walk'      = @{ date = '2026-08-20'; ids = 1031, 1048, 1054, 1062, 1076, 1078, 274 }
  'Beach Day'      = @{ date = '2026-08-09'; ids = 1000, 1001, 1005, 1013, 1024 }
}

if (-not $SkipDownload) {
  Remove-Item $pics -Recurse -Force -ErrorAction SilentlyContinue
  foreach ($name in $folders.Keys) {
    $dir = Join-Path $pics $name; New-Item -ItemType Directory -Force $dir | Out-Null
    $base = [datetime]$folders[$name].date
    $n = 0
    foreach ($id in $folders[$name].ids) {
      $file = Join-Path $dir ("IMG_{0:D4}.jpg" -f (4100 + $id % 900 + $n))
      try {
        Invoke-WebRequest "https://picsum.photos/id/$id/1600/1067" -OutFile $file -UseBasicParsing
        (Get-Item $file).LastWriteTime = $base.AddHours(9 + $n)
        $n++
      } catch { Remove-Item $file -ErrorAction SilentlyContinue }
    }
    (Get-Item $dir).LastWriteTime = $base.AddHours(20)
    "{0}: {1} photos" -f $name, $n
  }
}

# Fresh demo library pointed at the demo folder.
Remove-Item $lib -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force $lib | Out-Null
$env:PICALUMA_DATA_DIR = $lib
# Isolated sandbox: its own web-view profile too, so the user's window settings (thumbnail size,
# panels) are neither used nor changed.
$web = Join-Path $root 'webview'
Remove-Item $web -Recurse -Force -ErrorAction SilentlyContinue
$env:WEBVIEW2_USER_DATA_FOLDER = $web
$p = Start-Process $exe -PassThru
Start-Sleep 6
$p.CloseMainWindow() | Out-Null; Start-Sleep 2; if (-not $p.HasExited) { $p.Kill() }
python -c "import sqlite3,sys; c=sqlite3.connect(sys.argv[1]); c.execute('INSERT OR IGNORE INTO roots(path, excluded) VALUES (?, 0)', (sys.argv[2],)); c.commit()" "$lib\library.db" $pics
$p = Start-Process $exe -PassThru
Start-Sleep 20

Add-Type @'
using System; using System.Runtime.InteropServices;
public class Win {
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int w, int hgt, uint flags);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("dwmapi.dll")] public static extern int DwmGetWindowAttribute(IntPtr h, int attr, out RECT r, int size);
  public struct RECT { public int L, T, R, B; }
}
'@
Add-Type -AssemblyName System.Drawing
$p.Refresh(); $h = $p.MainWindowHandle
[Win]::ShowWindow($h, 9) | Out-Null                       # restore (not maximised)
[Win]::SetWindowPos($h, [IntPtr]::new(-1), 60, 40, $Width, $Height, 0x40) | Out-Null   # topmost while capturing
[Win]::SetForegroundWindow($h) | Out-Null
Start-Sleep 2
Add-Type -AssemblyName System.Windows.Forms
[System.Windows.Forms.SendKeys]::SendWait('%{ENTER}')    # Alt+Enter: hide the Properties panel
Start-Sleep 3
$r = New-Object Win+RECT
[Win]::DwmGetWindowAttribute($h, 9, [ref]$r, 16) | Out-Null   # visible frame, without the invisible resize border
$w = $r.R - $r.L; $hh = $r.B - $r.T
$bmp = New-Object Drawing.Bitmap $w, $hh
$g = [Drawing.Graphics]::FromImage($bmp); $g.CopyFromScreen($r.L, $r.T, 0, 0, $bmp.Size); $g.Dispose()
$out = Join-Path $root 'screenshot.png'; $bmp.Save($out); $bmp.Dispose()
[Win]::SetWindowPos($h, [IntPtr]::new(-2), 0, 0, 0, 0, 0x3) | Out-Null
"captured ${w}x$hh -> $out"
$p.CloseMainWindow() | Out-Null; Start-Sleep 2; if (-not $p.HasExited) { $p.Kill() }
