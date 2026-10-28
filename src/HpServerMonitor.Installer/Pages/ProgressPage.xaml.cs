using System.Diagnostics;
using System.Windows;
using System.Windows.Controls;

namespace HpServerMonitor.Installer;

public partial class ProgressPage : Page
{
    private bool _started;

    public bool IsRunning { get; private set; }

    public ProgressPage()
    {
        InitializeComponent();
        Loaded += OnLoaded;
    }

    private async void OnLoaded(object sender, RoutedEventArgs e)
    {
        if (_started)
            return;

        _started = true;
        IsRunning = true;

        var progress = new Progress<string>(AppendLog);
        try
        {
            var result = await InstallEngine.InstallAsync(progress, CancellationToken.None);
            IsRunning = false;
            ShowSuccess(result);
        }
        catch (Exception ex)
        {
            IsRunning = false;
            ShowFailure(ex);
        }
    }

    private void AppendLog(string line)
    {
        LogBox.AppendText($"[{DateTime.Now:HH:mm:ss}] {line}{Environment.NewLine}");
        LogBox.ScrollToEnd();
    }

    private void ShowSuccess(InstallResult result)
    {
        Bar.IsIndeterminate = false;
        Bar.Value = 100;
        TitleText.Text = "安装完成";
        SubtitleText.Text = result.Started
            ? "服务已注册并启动。建议先登录确认各页面读数正常。"
            : "程序文件已复制，可在安装目录手动运行 HpServerMonitor.exe。";

        UrlBox.Text = result.PublicUrl;
        UserNameBox.Text = result.Username;

        if (result.GeneratedPassword.Length > 0)
        {
            GeneratedBox.Text = result.GeneratedPassword;
            PasswordRow.Visibility = Visibility.Visible;
        }

        HealthText.Text = result.HealthOk
            ? "健康检查：通过"
            : result.Started
                ? "健康检查：未通过，服务可能仍在启动；请稍后刷新页面或查看 logs\\hpmonitor.log。"
                : "健康检查：未启动服务，可手动运行程序后访问。";
        HealthText.Foreground = result.HealthOk
            ? System.Windows.Media.Brushes.SeaGreen
            : System.Windows.Media.Brushes.DarkOrange;

        foreach (var warning in result.Warnings)
            AppendLog("注意：" + warning);

        if (InstallerState.UseCaddy)
        {
            CaddyText.Visibility = Visibility.Visible;
            if (result.CaddyConfigured)
            {
                CaddyText.Text = "Caddy：" + result.CaddyMessage;
                CaddyText.Foreground = System.Windows.Media.Brushes.SeaGreen;
            }
            else
            {
                CaddyText.Text = "Caddy：配置未完成，详见上方日志。";
                CaddyText.Foreground = System.Windows.Media.Brushes.DarkOrange;
            }
        }

        SummaryCard.Visibility = Visibility.Visible;
        ButtonRow.Visibility = Visibility.Visible;
        OpenSiteButton.Visibility = result.Started ? Visibility.Visible : Visibility.Collapsed;

        if (result.Started && InstallerState.OpenBrowserAfter)
            OpenUrl(result.AccessUrl);
    }

    private void ShowFailure(Exception ex)
    {
        Bar.IsIndeterminate = false;
        TitleText.Text = "安装失败";
        SubtitleText.Text = "安装已中止，可修正问题后重新运行向导。";

        FailureCard.Visibility = Visibility.Visible;
        FailureText.Text = ex.Message;

        ButtonRow.Visibility = Visibility.Visible;
        OpenSiteButton.Visibility = Visibility.Collapsed;
        CloseButton.Content = "关闭";
    }

    private void Copy_Click(object sender, RoutedEventArgs e)
    {
        try
        {
            Clipboard.SetText(GeneratedBox.Text);
        }
        catch
        {
            // 剪贴板被占用时忽略
        }
    }

    private void OpenSite_Click(object sender, RoutedEventArgs e)
        => OpenUrl(UrlBox.Text);

    private void OpenFolder_Click(object sender, RoutedEventArgs e)
    {
        try
        {
            Process.Start(new ProcessStartInfo("explorer.exe", $"\"{InstallerState.InstallDir}\"")
            {
                UseShellExecute = true
            });
        }
        catch (Exception ex)
        {
            AppendLog("打开目录失败：" + ex.Message);
        }
    }

    private void Close_Click(object sender, RoutedEventArgs e)
        => Window.GetWindow(this)?.Close();

    private static void OpenUrl(string url)
    {
        try
        {
            Process.Start(new ProcessStartInfo(url) { UseShellExecute = true });
        }
        catch
        {
            // 没有默认浏览器时忽略
        }
    }
}
