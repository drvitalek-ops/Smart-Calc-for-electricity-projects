using System.Text.Json;

namespace SmartHomeCalc.Desktop;

internal readonly record struct DesktopWorkbenchState(bool Dirty, bool Busy)
{
    public static bool TryRead(string source, string applicationUrl, string json, out DesktopWorkbenchState state)
    {
        state = default;
        if (json.Length > 4096 || !Uri.TryCreate(source, UriKind.Absolute, out var origin) ||
            !Uri.TryCreate(applicationUrl, UriKind.Absolute, out var expected) ||
            origin.Scheme != expected.Scheme || origin.Host != expected.Host || origin.Port != expected.Port) return false;
        try
        {
            using var document = JsonDocument.Parse(json);
            var root = document.RootElement;
            if (root.ValueKind != JsonValueKind.Object || !root.TryGetProperty("type", out var kind) ||
                kind.ValueKind != JsonValueKind.String || kind.GetString() != "workbench-state" ||
                !root.TryGetProperty("dirty", out var dirty) || !root.TryGetProperty("busy", out var busy) ||
                dirty.ValueKind is not (JsonValueKind.True or JsonValueKind.False) ||
                busy.ValueKind is not (JsonValueKind.True or JsonValueKind.False)) return false;
            state = new DesktopWorkbenchState(dirty.GetBoolean(), busy.GetBoolean());
            return true;
        }
        catch (JsonException) { return false; }
    }
}
