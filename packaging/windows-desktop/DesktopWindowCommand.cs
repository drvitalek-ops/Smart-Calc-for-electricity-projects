using System.Text.Json;
namespace SmartHomeCalc.Desktop;
internal static class DesktopWindowCommand
{
    public static string? Read(string source, string applicationUrl, string json)
    {
        if (json.Length > 4096 || !Uri.TryCreate(source, UriKind.Absolute, out var origin) ||
            !Uri.TryCreate(applicationUrl, UriKind.Absolute, out var expected) ||
            origin.Scheme != expected.Scheme || origin.Host != expected.Host || origin.Port != expected.Port) return null;
        try
        {
            using var document = JsonDocument.Parse(json);
            var root = document.RootElement;
            if (root.ValueKind != JsonValueKind.Object || !root.TryGetProperty("type", out var type) ||
                type.ValueKind != JsonValueKind.String || type.GetString() != "window-control" ||
                !root.TryGetProperty("action", out var action) || action.ValueKind != JsonValueKind.String) return null;
            return action.GetString() is "drag" or "minimize" or "maximize" or "close" ? action.GetString() : null;
        }
        catch (JsonException) { return null; }
    }
}
