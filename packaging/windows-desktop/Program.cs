using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace SmartHomeCalc.Desktop;

internal static class Program
{
    [STAThread]
    private static void Main(string[] args)
    {
        ApplicationConfiguration.Initialize();
        var applicationUrl = args.Length > 0 ? args[0] : "http://localhost:5173";
        Application.Run(new MainWindow(applicationUrl));
    }
}

internal sealed class MainWindow : Form
{
    private readonly string applicationUrl;
    private readonly WebView2 webView = new() { Dock = DockStyle.Fill };

    public MainWindow(string applicationUrl)
    {
        this.applicationUrl = applicationUrl;
        Text = "Smart Home Calc";
        StartPosition = FormStartPosition.CenterScreen;
        Width = 1440;
        Height = 900;
        MinimumSize = new Size(1024, 700);
        BackColor = Color.FromArgb(15, 23, 42);
        Controls.Add(webView);
    }

    protected override async void OnShown(EventArgs e)
    {
        base.OnShown(e);
        try
        {
            var localAppData = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
            var userDataFolder = Path.Combine(localAppData, "SmartHomeCalc", "WebView2");
            var environment = await CoreWebView2Environment.CreateAsync(userDataFolder: userDataFolder);
            await webView.EnsureCoreWebView2Async(environment);

            webView.CoreWebView2.Settings.AreDevToolsEnabled = false;
            webView.CoreWebView2.Settings.AreBrowserAcceleratorKeysEnabled = false;
            webView.CoreWebView2.Settings.IsStatusBarEnabled = false;
            webView.CoreWebView2.Settings.IsZoomControlEnabled = true;
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
                        "Не удалось загрузить локальный интерфейс Smart Home Calc. Перезапустите приложение и проверьте Docker Desktop.",
                        "Smart Home Calc",
                        MessageBoxButtons.OK,
                        MessageBoxIcon.Error);
                }
            };
            webView.CoreWebView2.Navigate(applicationUrl);
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
}
