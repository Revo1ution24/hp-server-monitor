using System.Windows;
using System.Windows.Controls;

namespace HpServerMonitor.Installer;

public partial class WelcomePage : Page
{
    public WelcomePage()
    {
        InitializeComponent();

        if (!InstallerState.ExistingInstall)
            return;

        ExistingCard.Visibility = Visibility.Visible;
        ExistingText.Text = File.Exists(Path.Combine(InstallerState.DefaultInstallDir, "config.json"))
            ? $"默认目录 {InstallerState.DefaultInstallDir} 下已有配置。继续安装会复用旧配置，仅覆盖你本次填写的字段。"
            : $"检测到已注册的服务或计划任务（{InstallerState.DefaultInstallDir}）。继续安装会先停止旧实例再覆盖程序文件。";
    }

    private void Uninstall_Click(object sender, RoutedEventArgs e)
    {
        if (Window.GetWindow(this) is MainWindow host)
            host.ShowUninstall();
    }
}
