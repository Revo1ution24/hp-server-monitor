using System.Windows;
using System.Windows.Controls;

namespace HpServerMonitor.Installer;

public partial class MainWindow : Window
{
    private readonly Page[] _pages;
    private int _index;

    public MainWindow()
    {
        InitializeComponent();
        InstallerState.Detect();

        _pages = new Page[]
        {
            new WelcomePage(),
            new ConfigPage(),
            new RuntimePage(),
            new ProgressPage()
        };

        ShowStep(0);
    }

    public void GoNext()
    {
        switch (ContentFrame.Content)
        {
            case WelcomePage:
                ShowStep(1);
                break;

            case ConfigPage configPage:
                if (configPage.Validate())
                    ShowStep(2);
                break;

            case RuntimePage runtimePage:
                if (runtimePage.Validate())
                    ShowStep(3);
                break;
        }
    }

    public void ShowStep(int index)
    {
        _index = index;
        var page = _pages[index];

        ContentFrame.Content = null;
        ContentFrame.Navigate(page);

        Footer.Visibility = Visibility.Visible;
        CancelButton.Visibility = page is ProgressPage ? Visibility.Collapsed : Visibility.Visible;
        BackButton.Visibility = index == 0 || page is ProgressPage ? Visibility.Collapsed : Visibility.Visible;
        NextButton.Visibility = page is ProgressPage ? Visibility.Collapsed : Visibility.Visible;
        NextButton.Content = page is RuntimePage ? "开始安装" : "下一步";

        StepLabel.Text = page switch
        {
            WelcomePage => "准备",
            ConfigPage => "第 1 步 / 共 3 步 · 基础配置",
            RuntimePage => "第 2 步 / 共 3 步 · 运行方式",
            _ => "第 3 步 / 共 3 步 · 安装"
        };

        FooterHint.Text = page switch
        {
            WelcomePage => "安装需要管理员权限；程序默认以 LocalSystem 运行，可读取硬件传感器。",
            ConfigPage => "如果目标目录已有 config.json，其余设置会保留，只更新本次填写的字段。",
            RuntimePage => "服务方式会开机自启并在崩溃后自动重启；也可只复制文件后手动运行。",
            _ => string.Empty
        };
    }

    public void ShowUninstall()
    {
        ContentFrame.Content = null;
        ContentFrame.Navigate(new UninstallPage());

        Footer.Visibility = Visibility.Collapsed;
        StepLabel.Text = "卸载";
    }

    private void Next_Click(object sender, RoutedEventArgs e) => GoNext();

    private void Back_Click(object sender, RoutedEventArgs e)
    {
        if (_index > 0)
            ShowStep(_index - 1);
    }

    private void Cancel_Click(object sender, RoutedEventArgs e)
    {
        if (MessageBox.Show("确定退出安装向导？", "HP Server Monitor 安装向导",
                MessageBoxButton.YesNo, MessageBoxImage.Question) == MessageBoxResult.Yes)
        {
            Close();
        }
    }

    protected override void OnClosing(System.ComponentModel.CancelEventArgs e)
    {
        if (ContentFrame.Content is ProgressPage { IsRunning: true })
        {
            var answer = MessageBox.Show(
                "安装正在进行，现在关闭可能留下未完成的服务注册。确定要退出？",
                "HP Server Monitor 安装向导",
                MessageBoxButton.YesNo,
                MessageBoxImage.Warning);

            if (answer != MessageBoxResult.Yes)
                e.Cancel = true;
        }

        base.OnClosing(e);
    }
}
