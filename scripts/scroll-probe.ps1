if ($env:GITHUB_ACTIONS -ne 'true' -or $env:RL_RUNNER_ENVIRONMENT -ne 'github-hosted') {
    throw 'This input probe runs only on the hosted test desktop'
}

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class ScrollProbe {
    [DllImport("user32.dll")]
    public static extern void mouse_event(uint flags, uint dx, uint dy, int data, UIntPtr extraInfo);
}
'@

$form = [Windows.Forms.Form]::new()
$form.Text = 'Remote Light scroll test'
$form.Size = [Drawing.Size]::new(400, 300)
$form.StartPosition = 'CenterScreen'
$form.TopMost = $true
$timer = [Windows.Forms.Timer]::new()
$timer.Interval = 500
$timer.add_Tick({
    $timer.Stop()
    [ScrollProbe]::mouse_event(0x0800, 0, 0, 120, [UIntPtr]::Zero)
})
$form.add_Shown({
    $form.Activate()
    [Windows.Forms.Cursor]::Position = $form.PointToScreen([Drawing.Point]::new(150, 130))
    [Console]::WriteLine('probe ready')
    $timer.Start()
})
$form.add_MouseWheel({
    param($sender, $eventArgs)
    [Console]::WriteLine("wheel:$($eventArgs.Delta)")
})
[Windows.Forms.Application]::Run($form)
