using System.Net.Http;

namespace SmartHomeCalc.Desktop;

internal static class LocalServerConnection
{
    // The embedded window and its health check only need our loopback server.
    // VPN system proxies must not intercept either connection.
    internal const string BrowserArguments = "--no-proxy-server";

    internal static HttpClient CreateHealthClient() => new(new HttpClientHandler
    {
        UseProxy = false,
        AllowAutoRedirect = false,
    })
    {
        Timeout = TimeSpan.FromSeconds(2),
    };
}
