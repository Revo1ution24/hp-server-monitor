using System.IO;
using System.Windows;
using System.Windows.Controls;
using Microsoft.Win32;

namespace HpServerMonitor.Installer;

public partial class UninstallPage : Page
{
    private bool _running;

    public UninstallPage()
    {
        InitializeComponent();
        DirBox.Text = InstallerState.DefaultInstallDir;
    }

    private void Browse_Click(object sender, RoutedEventArgs e)
    {
        var current = DirBox.Text.Trim();
        var dialog = new OpenFolderDialog
        {
            Title = "选择 HpServerMonitor 安装目录",
            InitialDirectory = Directory.Exists(current) ? current : "C:\\"
        };

        if (dialog.ShowDialog(Window.GetWindow(this)) == true)
            DirBox.Text = dialog.FolderName;
    }

    private void Back_Click(object sender, RoutedEventArgs e)
    {
        if (Window.GetWindow(this) is MainWindow host)
            host.ShowStep(0);
    }

    private async void Uninstall_Click(object sender, RoutedEventArgs e)
    {
        if (_running)
            return;

        var dir = DirBox.Text.Trim();
        if (dir.Length == 0)
        {
            StatusText.Text = "请先选择安装目录。";
            return;
        }

        if (MessageBox.Show(
                $"确定卸载 {dir} 下的 HpServerMonitor 吗？\n\n服务会被停止并删除。",
                "确认卸载",
                MessageBoxButton.YesNo,
                MessageBoxImage.Warning) != MessageBoxResult.Yes)
        {
            return;
        }

        _running = true;
        UninstallButton.IsEnabled = false;
        BackButton.IsEnabled = false;
        LogBox.Visibility = Visibility.Visible;
        LogBox.Clear();
        StatusText.Text = "正在卸载……";

        var progress = new Progress<string>(line =>
        {
            LogBox.AppendText($"[{DateTime.Now:HH:mm:ss}] {line}{Environment.NewLine}");
            LogBox.ScrollToEnd();
        });

        try
        {
            await InstallEngine.UninstallAsync(
                dir,
                KeepDataCheck.IsChecked == true,
                FirewallCheck.IsChecked == true,
                CaddyCheck.IsChecked == true,
                progress,
                CancellationToken.None);

            StatusText.Text = "卸载完成。";
        }
        catch (Exception ex)
        {
            StatusText.Text = "卸载未完成：" + ex.Message;
        }
        finally
        {
            _running = false;
            UninstallButton.IsEnabled = true;
            BackButton.IsEnabled = true;
        }
    }
}
