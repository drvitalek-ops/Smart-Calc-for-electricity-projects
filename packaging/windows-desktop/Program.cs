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
    private const string ApplicationVersion = "1.0.37";
    private static readonly string InstallDirectory = Path.GetDirectoryName(Environment.ProcessPath)
        ?? AppContext.BaseDirectory;
    private readonly int backendPort = FindAvailablePort();
    private readonly string instanceToken = Guid.NewGuid().ToString("N");
    private string ApplicationUrl => $"http://127.0.0.1:{backendPort}";
    private readonly WebView2 webView = new() { Dock = DockStyle.Fill, AllowExternalDrop = true };
    private readonly Label status = new()
    {
        Dock = DockStyle.Fill,
        Text = "Запуск Smart Home Calc…",
        TextAlign = ContentAlignment.MiddleCenter,
        ForeColor = Color.White,
        Font = new Font("Segoe UI", 14),
    };
    private Process? backendProcess;
    private string? lastHealthFailure;

    private static void LogStartup(string message)
    {
        try
        {
            var directory = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "SmartHomeCalc", "data");
            Directory.CreateDirectory(directory);
            File.AppendAllText(Path.Combine(directory, "desktop.log"), $"{DateTimeOffset.Now:O} {ApplicationVersion} {message}{Environment.NewLine}");
        }
        catch (IOException) { }
        catch (UnauthorizedAccessException) { }
    }

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
            LogStartup("Starting desktop; local connections bypass system proxy.");
            await StartBackendAsync();
            status.Text = "Открытие окна Smart Home Calc…";
            var localAppData = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
            var userDataFolder = Path.Combine(localAppData, "SmartHomeCalc", "WebView2");
            var options = new CoreWebView2EnvironmentOptions(LocalServerConnection.BrowserArguments);
            var environment = await CoreWebView2Environment.CreateAsync(userDataFolder: userDataFolder, options: options)
                .WaitAsync(TimeSpan.FromSeconds(45));
            await webView.EnsureCoreWebView2Async(environment).WaitAsync(TimeSpan.FromSeconds(45));
            LogStartup("WebView2 ready; opening local interface.");

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
                LogStartup($"Navigation completed: success={eventArgs.IsSuccess}, status={eventArgs.WebErrorStatus}.");
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
            LogStartup("WebView2 Runtime not found.");
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
            LogStartup(exception.ToString());
            MessageBox.Show(
                this,
                "Не удалось открыть окно Smart Home Calc.\n\n" + exception.Message + "\n\nПодробности: %LOCALAPPDATA%\\SmartHomeCalc\\data\\desktop.log",
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
        using var client = LocalServerConnection.CreateHealthClient();
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
        LogStartup($"Backend started: pid={backendProcess.Id}, address={ApplicationUrl}.");

        var startup = Stopwatch.StartNew();
        while (startup.Elapsed < TimeSpan.FromSeconds(90))
        {
            if (backendProcess.HasExited)
            {
                throw new InvalidOperationException("Локальный сервер завершился при запуске. Подробности находятся в server.log.");
            }
            if (await IsBackendReady(client))
            {
                LogStartup("Backend health confirmed.");
                return;
            }
            await Task.Delay(1000);
        }
        throw new TimeoutException("Не удалось подключиться к локальному серверу за 90 секунд. Если VPN блокирует локальные соединения, разрешите доступ к 127.0.0.1 в настройках VPN.");
    }

    private async Task<bool> IsBackendReady(HttpClient client)
    {
        try
        {
            var health = await client.GetFromJsonAsync<HealthResponse>(ApplicationUrl + "/api/health");
            var ready = health?.Status == "ok"
                && health.Version == ApplicationVersion
                && health.Instance == instanceToken;
            if (!ready) RecordHealthFailure("Server health response did not match the launched backend.");
            return ready;
        }
        catch (Exception exception)
        {
            RecordHealthFailure($"Health check failed: {exception.GetType().Name}: {exception.Message}");
            return false;
        }
    }

    private void RecordHealthFailure(string message)
    {
        if (lastHealthFailure == message) return;
        lastHealthFailure = message;
        LogStartup(message);
    }

    private static int FindAvailablePort()
    {
        using var listener = new TcpListener(IPAddress.Loopback, 0);
        listener.Start();
        return ((IPEndPoint)listener.LocalEndpoint).Port;
    }

    private sealed record HealthResponse(string Status, string Version, string Instance);
}
