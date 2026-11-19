if ($env:GITHUB_ACTIONS -ne 'true' -or $env:RL_RUNNER_ENVIRONMENT -ne 'github-hosted') {
    throw 'This input probe runs only on the hosted test desktop'
}

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$form = [Windows.Forms.Form]::new()
$form.Text = 'Remote Light scroll test'
$form.Size = [Drawing.Size]::new(400, 300)
$form.StartPosition = 'CenterScreen'
$form.TopMost = $true
$form.add_Shown({
    $form.Activate()
    [Windows.Forms.Cursor]::Position = $form.PointToScreen([Drawing.Point]::new(150, 130))
    [Console]::WriteLine('probe ready')
})
$form.add_MouseWheel({
    param($sender, $eventArgs)
    [Console]::WriteLine("wheel:$($eventArgs.Delta)")
})
[Windows.Forms.Application]::Run($form)
