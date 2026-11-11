using System.Net;
using System.Net.Sockets;
using System.Text;
using SmartHomeCalc.Desktop;

// Exercise the same client used by the desktop with an intercepting default
// proxy. All servers and requests stay on loopback; no VPN or internet required.
await using var proxy = new TestServer(_ => (502, "Bad Gateway", "intercepted", ""));
await using var backend = new TestServer(path => path == "/redirect"
    ? (302, "Found", "", $"Location: {proxy.Address}/must-not-follow\r\n")
    : (200, "OK", "{\"status\":\"ok\"}", ""));
var originalProxy = HttpClient.DefaultProxy;
try
{
    HttpClient.DefaultProxy = new InterceptingProxy(new Uri(proxy.Address));
    using var control = new HttpClient { Timeout = TimeSpan.FromSeconds(5) };
    using var blocked = await control.GetAsync(backend.Address + "/api/health");
    Check(blocked.StatusCode == HttpStatusCode.BadGateway && proxy.Requests == 1 && backend.Requests == 0,
        "The default client must demonstrate the proxy interception that prevented desktop startup.");

    using var direct = LocalServerConnection.CreateHealthClient();
    using var ready = await direct.GetAsync(backend.Address + "/api/health");
    Check(ready.StatusCode == HttpStatusCode.OK && await ready.Content.ReadAsStringAsync() == "{\"status\":\"ok\"}",
        "Desktop health check must reach its backend with an intercepting default proxy enabled.");
    Check(proxy.Requests == 1 && backend.Requests == 1, "The health check must bypass the proxy.");

    using var redirect = await direct.GetAsync(backend.Address + "/redirect");
    Check(redirect.StatusCode == HttpStatusCode.Found && proxy.Requests == 1,
        "A health check must not follow redirects away from its backend.");
    Console.WriteLine("PASS: default-proxy failure reproduced; desktop health succeeds directly; redirects are rejected.");
}
finally
{
    HttpClient.DefaultProxy = originalProxy;
}

Check(DesktopWorkbenchState.TryRead(backend.Address + "/editor", backend.Address,
    "{\"type\":\"workbench-state\",\"dirty\":true,\"busy\":false}", out var dirtyState) && dirtyState.Dirty && !dirtyState.Busy,
    "The native close guard must receive the editor's unsaved state.");
Check(!DesktopWorkbenchState.TryRead(proxy.Address, backend.Address,
    "{\"type\":\"workbench-state\",\"dirty\":false,\"busy\":false}", out _), "Other origins must not clear the close guard.");
Check(!DesktopWorkbenchState.TryRead(backend.Address, backend.Address,
    "{\"type\":\"workbench-state\",\"dirty\":\"false\",\"busy\":0}", out _), "Malformed state must be ignored.");
Check(!DesktopWorkbenchState.TryRead(backend.Address, backend.Address,"not json",out _), "Invalid JSON must not crash the desktop.");
Console.WriteLine("PASS: native dirty/busy state is accepted only from the application's origin.");

static void Check(bool condition, string message)
{
    if (!condition) throw new InvalidOperationException(message);
}

sealed class InterceptingProxy(Uri address) : IWebProxy
{
    public ICredentials? Credentials { get; set; }
    public Uri GetProxy(Uri destination) => address;
    public bool IsBypassed(Uri host) => false;
}

sealed class TestServer : IAsyncDisposable
{
    private readonly TcpListener listener = new(IPAddress.Loopback, 0);
    private readonly CancellationTokenSource cancellation = new(TimeSpan.FromSeconds(20));
    private readonly Task serving;
    private int requests;
    public string Address { get; }
    public int Requests => Volatile.Read(ref requests);

    public TestServer(Func<string, (int Code, string Reason, string Body, string Headers)> response)
    {
        listener.Start();
        Address = $"http://127.0.0.1:{((IPEndPoint)listener.LocalEndpoint).Port}";
        serving = Serve(response);
    }

    private async Task Serve(Func<string, (int Code, string Reason, string Body, string Headers)> response)
    {
        try
        {
            while (!cancellation.IsCancellationRequested)
            {
                using var connection = await listener.AcceptTcpClientAsync(cancellation.Token);
                using var stream = connection.GetStream();
                using var reader = new StreamReader(stream, Encoding.ASCII, leaveOpen: true);
                var request = await reader.ReadLineAsync(cancellation.Token) ?? "";
                while (!string.IsNullOrEmpty(await reader.ReadLineAsync(cancellation.Token))) { }
                Interlocked.Increment(ref requests);
                var target = request.Split(' ')[1];
                var path = Uri.TryCreate(target, UriKind.Absolute, out var uri) ? uri.AbsolutePath : target;
                var result = response(path);
                var body = Encoding.UTF8.GetBytes(result.Body);
                var headers = Encoding.ASCII.GetBytes($"HTTP/1.1 {result.Code} {result.Reason}\r\nContent-Type: application/json\r\nContent-Length: {body.Length}\r\nConnection: close\r\n{result.Headers}\r\n");
                await stream.WriteAsync(headers, cancellation.Token);
                await stream.WriteAsync(body, cancellation.Token);
            }
        }
        catch (OperationCanceledException) when (cancellation.IsCancellationRequested) { }
    }

    public async ValueTask DisposeAsync()
    {
        cancellation.Cancel();
        try { await serving; }
        finally { listener.Stop(); cancellation.Dispose(); }
    }
}
