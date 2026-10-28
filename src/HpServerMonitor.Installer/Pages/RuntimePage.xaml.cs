using System.Windows;
using System.Windows.Controls;

namespace HpServerMonitor.Installer;

public partial class RuntimePage : Page
{
    public RuntimePage()
    {
        InitializeComponent();

        ServiceRadio.IsChecked = InstallerState.Mode == RunMode.Service;
        TaskRadio.IsChecked = InstallerState.Mode == RunMode.ScheduledTask;
        FilesOnlyRadio.IsChecked = InstallerState.Mode == RunMode.FilesOnly;
        FirewallCheck.IsChecked = InstallerState.OpenFirewall;
        OpenBrowserCheck.IsChecked = InstallerState.OpenBrowserAfter;

        CaddyCheck.IsChecked = InstallerState.UseCaddy;
        DomainBox.Text = InstallerState.CaddyDomain;
        CaddyDirBox.Text = InstallerState.CaddyDir;
        HttpsPortBox.Text = InstallerState.CaddyHttpsPort.ToString();
        CertAutoRadio.IsChecked = InstallerState.CaddyCertMode == CaddyCertificateMode.Automatic;
        CertDnsRadio.IsChecked = InstallerState.CaddyCertMode == CaddyCertificateMode.Dns01;
        CertInternalRadio.IsChecked = InstallerState.CaddyCertMode == CaddyCertificateMode.Internal;
        TokenBox.Password = InstallerState.Dynv6Token;

        CaddyOptions.IsEnabled = InstallerState.UseCaddy;
        UpdateDnsPanel();
    }

    private void CaddyCheck_Click(object sender, RoutedEventArgs e)
        => CaddyOptions.IsEnabled = CaddyCheck.IsChecked == true;

    private void CertMode_Click(object sender, RoutedEventArgs e) => UpdateDnsPanel();

    private void UpdateDnsPanel()
        => DnsPanel.IsEnabled = CertDnsRadio.IsChecked == true;

    private CaddyCertificateMode SelectedCertMode
        => CertDnsRadio.IsChecked == true
            ? CaddyCertificateMode.Dns01
            : CertInternalRadio.IsChecked == true
                ? CaddyCertificateMode.Internal
                : CaddyCertificateMode.Automatic;

    public bool Validate()
    {
        ErrorText.Visibility = Visibility.Collapsed;

        var mode = ServiceRadio.IsChecked == true
            ? RunMode.Service
            : TaskRadio.IsChecked == true
                ? RunMode.ScheduledTask
                : RunMode.FilesOnly;

        var caddy = CaddyCheck.IsChecked == true;
        var domain = DomainBox.Text.Trim();
        var caddyDir = CaddyDirBox.Text.Trim();
        var certMode = SelectedCertMode;
        var token = TokenBox.Password.Trim();
        var httpsPort = 443;

        if (caddy)
        {
            if (domain.Length == 0)
                return Fail("启用 Caddy 时必须填写对外域名。");

            if (domain.Contains(' ') || domain.Contains('/') || domain.Contains(':'))
                return Fail("域名格式不正确，只填写主机名，例如 hpserver.example.com。");

            if (caddyDir.Length == 0 || !Path.IsPathRooted(caddyDir))
                return Fail(@"Caddy 安装目录必须是绝对路径，例如 D:\Program Files\Caddy。");

            if (!int.TryParse(HttpsPortBox.Text.Trim(), out httpsPort) || httpsPort is < 1 or > 65535)
                return Fail("HTTPS 端口必须是 1-65535 之间的整数。");

            if (certMode == CaddyCertificateMode.Automatic && httpsPort != 443)
                return Fail("自动验证（HTTP-01 / TLS-ALPN-01）只能使用 443 端口；" +
                            "如果 80/443 被运营商封了，请选择 DNS-01。");

            if (certMode == CaddyCertificateMode.Dns01)
            {
                if (token.Length == 0)
                    return Fail("选择 DNS-01 时必须填写 dynv6 API Token。");

                if (!CaddyManager.Dynv6CaddyAvailable(caddyDir))
                    return Fail("缺少带 dynv6 插件的 Caddy（caddy-dynv6.exe）。" +
                                "请把它放到安装器同目录，或改用“自签名 tls internal”。");
            }
        }

        InstallerState.Mode = mode;
        InstallerState.OpenFirewall = FirewallCheck.IsChecked == true;
        InstallerState.OpenBrowserAfter = OpenBrowserCheck.IsChecked == true;
        InstallerState.UseCaddy = caddy;
        InstallerState.CaddyDomain = domain;
        InstallerState.CaddyDir = caddyDir;
        InstallerState.CaddyHttpsPort = httpsPort;
        InstallerState.CaddyCertMode = certMode;
        InstallerState.Dynv6Token = token;
        return true;
    }

    private bool Fail(string message)
    {
        ErrorText.Text = message;
        ErrorText.Visibility = Visibility.Visible;
        return false;
    }
}
