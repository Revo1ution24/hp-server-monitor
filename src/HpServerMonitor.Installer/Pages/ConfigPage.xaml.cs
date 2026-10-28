using System.IO;
using System.Windows;
using System.Windows.Controls;
using Microsoft.Win32;

namespace HpServerMonitor.Installer;

public partial class ConfigPage : Page
{
    public ConfigPage()
    {
        InitializeComponent();

        DirBox.Text = InstallerState.InstallDir;
        UserBox.Text = InstallerState.Username;
        PortBox.Text = InstallerState.HttpPort.ToString();
        LoopbackRadio.IsChecked = InstallerState.BindAddress != "0.0.0.0";
        AnyRadio.IsChecked = InstallerState.BindAddress == "0.0.0.0";

        UpdatePasswordHint();
        DirBox.TextChanged += (_, _) => UpdatePasswordHint();
    }

    private void UpdatePasswordHint()
    {
        var existingHash = InstallerState.ReadPasswordHash(DirBox.Text.Trim());
        PasswordHint.Text = existingHash.Length > 0
            ? "该目录已有配置：密码留空则沿用旧密码，填写则覆盖。"
            : "首次安装必须设置密码，至少 8 位；程序只保存 PBKDF2 哈希。";
    }

    private void Browse_Click(object sender, RoutedEventArgs e)
    {
        var current = DirBox.Text.Trim();
        var dialog = new OpenFolderDialog
        {
            Title = "选择安装目录",
            InitialDirectory = Directory.Exists(current) ? current : "C:\\"
        };

        if (dialog.ShowDialog(Window.GetWindow(this)) == true)
        {
            DirBox.Text = dialog.FolderName;
            GeneratedPanel.Visibility = Visibility.Collapsed;
        }
    }

    private void Generate_Click(object sender, RoutedEventArgs e)
    {
        var password = PasswordHashing.GeneratePassword(16);
        PwdBox.Password = password;
        ConfirmBox.Password = password;
        GeneratedBox.Text = password;
        GeneratedPanel.Visibility = Visibility.Visible;
    }

    private void Copy_Click(object sender, RoutedEventArgs e)
    {
        try
        {
            Clipboard.SetText(GeneratedBox.Text);
        }
        catch
        {
            // 剪贴板偶发被占用，忽略即可
        }
    }

    public bool Validate()
    {
        ErrorText.Visibility = Visibility.Collapsed;

        var dirText = DirBox.Text.Trim();
        if (dirText.Length == 0)
            return Fail("请选择安装目录。");

        if (!Path.IsPathRooted(dirText))
            return Fail(@"安装目录必须是绝对路径，例如 C:\HpServerMonitor。");

        try
        {
            Directory.CreateDirectory(Path.GetFullPath(dirText));
        }
        catch (Exception ex)
        {
            return Fail("无法创建安装目录：" + ex.Message);
        }

        if (!int.TryParse(PortBox.Text.Trim(), out var port) || port is < 1 or > 65535)
            return Fail("HTTP 端口必须是 1-65535 之间的整数。");

        var user = UserBox.Text.Trim();
        if (user.Length == 0)
            return Fail("用户名不能为空。");

        var password = PwdBox.Password;
        var confirm = ConfirmBox.Password;
        var existingHash = InstallerState.ReadPasswordHash(dirText);

        if (password.Length == 0 && existingHash.Length == 0)
            return Fail("首次安装必须设置登录密码（至少 8 位）。");

        if (password.Length > 0)
        {
            if (password.Length < 8)
                return Fail("密码至少 8 位。");

            if (password != confirm)
                return Fail("两次输入的密码不一致。");
        }

        InstallerState.InstallDir = Path.GetFullPath(dirText);
        InstallerState.BindAddress = AnyRadio.IsChecked == true ? "0.0.0.0" : "127.0.0.1";
        InstallerState.HttpPort = port;
        InstallerState.Username = user;
        InstallerState.Password = password;
        return true;
    }

    private bool Fail(string message)
    {
        ErrorText.Text = message;
        ErrorText.Visibility = Visibility.Visible;
        return false;
    }
}
