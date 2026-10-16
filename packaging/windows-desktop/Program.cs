using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;
using System.Diagnostics;
using System.Net;
using System.Net.Http.Json;
using System.Net.Sockets;

namespace SmartHomeCalc.Desktop;

internal static class Program
{
    [STAThread]
    private static void Main()
    {
        ApplicationConfiguration.Initialize();
        using var mutex = new Mutex(true, @"Local\SmartHomeCalc.Desktop", out var firstInstance);
        if (!firstInstance)
        {
            MessageBox.Show("Smart Home Calc уже открыт.", "Smart Home Calc", MessageBoxButtons.OK, MessageBoxIcon.Information);
            return;
        }
        Application.Run(new MainWindow());
    }
}

internal sealed class MainWindow : Form
{
    private const string ApplicationVersion = "1.0.28";
    private static readonly string InstallDirectory = Path.GetDirectoryName(Environment.ProcessPath)
        ?? AppContext.BaseDirectory;
    private readonly int backendPort = FindAvailablePort();
    private readonly string instanceToken = Guid.NewGuid().ToString("N");
    private string ApplicationUrl => $"http://127.0.0.1:{backendPort}";
    private readonly WebView2 webView = new() { Dock = DockStyle.Fill };
    private readonly Label status = new()
    {
        Dock = DockStyle.Fill,
        Text = "Запуск Smart Home Calc…",
        TextAlign = ContentAlignment.MiddleCenter,
        ForeColor = Color.White,
        Font = new Font("Segoe UI", 14),
    };
    private Process? backendProcess;

    public MainWindow()
    {
        Text = "Smart Home Calc";
        StartPosition = FormStartPosition.CenterScreen;
        Width = 1440;
        Height = 900;
        MinimumSize = new Size(1024, 700);
        WindowState = FormWindowState.Maximized;
        BackColor = Color.FromArgb(15, 23, 42);
        Controls.Add(status);
    }

    protected override async void OnShown(EventArgs e)
    {
        base.OnShown(e);
        try
        {
            await StartBackendAsync();
            var localAppData = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
            var userDataFolder = Path.Combine(localAppData, "SmartHomeCalc", "WebView2");
            var environment = await CoreWebView2Environment.CreateAsync(userDataFolder: userDataFolder);
            await webView.EnsureCoreWebView2Async(environment);

            webView.CoreWebView2.Settings.AreDevToolsEnabled = false;
            webView.CoreWebView2.Settings.AreBrowserAcceleratorKeysEnabled = false;
            webView.CoreWebView2.Settings.IsStatusBarEnabled = false;
            webView.CoreWebView2.Settings.IsZoomControlEnabled = false;
            webView.CoreWebView2.NewWindowRequested += (_, eventArgs) =>
            {
                eventArgs.Handled = true;
                webView.CoreWebView2.Navigate(eventArgs.Uri);
            };
            webView.CoreWebView2.NavigationCompleted += (_, eventArgs) =>
            {
                if (!eventArgs.IsSuccess)
                {
                    MessageBox.Show(
                        this,
                        "Не удалось загрузить локальный интерфейс Smart Home Calc. Закройте и снова откройте приложение.",
                        "Smart Home Calc",
                        MessageBoxButtons.OK,
                        MessageBoxIcon.Error);
                }
            };
            Controls.Remove(status);
            Controls.Add(webView);
            webView.CoreWebView2.Navigate(ApplicationUrl + "/?desktopVersion=" + ApplicationVersion);
        }
        catch (WebView2RuntimeNotFoundException)
        {
            MessageBox.Show(
                this,
                "Для окна Smart Home Calc нужен системный компонент Microsoft WebView2 Runtime. Установите его и повторите запуск.",
                "Smart Home Calc",
                MessageBoxButtons.OK,
                MessageBoxIcon.Error);
            Close();
        }
        catch (Exception exception)
        {
            MessageBox.Show(
                this,
                "Не удалось открыть окно Smart Home Calc.\n\n" + exception.Message,
                "Smart Home Calc",
                MessageBoxButtons.OK,
                MessageBoxIcon.Error);
            Close();
        }
    }

    protected override void OnFormClosed(FormClosedEventArgs e)
    {
        if (backendProcess is { HasExited: false })
        {
            backendProcess.Kill(entireProcessTree: true);
            backendProcess.Dispose();
        }
        base.OnFormClosed(e);
    }

    private async Task StartBackendAsync()
    {
        using var client = new HttpClient { Timeout = TimeSpan.FromSeconds(2) };
        var backendPath = Path.Combine(InstallDirectory, "SmartHomeCalc.Backend.exe");
        if (!File.Exists(backendPath))
        {
            throw new FileNotFoundException("Не найден локальный сервер приложения.", backendPath);
        }
        var startInfo = new ProcessStartInfo(backendPath)
        {
            WorkingDirectory = InstallDirectory,
            UseShellExecute = false,
            CreateNoWindow = true,
        };
        startInfo.Environment["SMART_HOME_CALC_PORT"] = backendPort.ToString();
        startInfo.Environment["SMART_HOME_CALC_INSTANCE_TOKEN"] = instanceToken;
        backendProcess = Process.Start(startInfo)
            ?? throw new InvalidOperationException("Не удалось запустить локальный сервер.");

        for (var attempt = 0; attempt < 90; attempt++)
        {
            if (backendProcess.HasExited)
            {
                throw new InvalidOperationException("Локальный сервер завершился при запуске. Подробности находятся в server.log.");
            }
            if (await IsBackendReady(client))
            {
                return;
            }
            await Task.Delay(1000);
        }
        throw new TimeoutException("Локальный сервер не ответил вовремя.");
    }

    private async Task<bool> IsBackendReady(HttpClient client)
    {
        try
        {
            var health = await client.GetFromJsonAsync<HealthResponse>(ApplicationUrl + "/api/health");
            return health?.Status == "ok"
                && health.Version == ApplicationVersion
                && health.Instance == instanceToken;
        }
        catch
        {
            return false;
        }
    }

    private static int FindAvailablePort()
    {
        using var listener = new TcpListener(IPAddress.Loopback, 0);
        listener.Start();
        return ((IPEndPoint)listener.LocalEndpoint).Port;
    }

    private sealed record HealthResponse(string Status, string Version, string Instance);
}
