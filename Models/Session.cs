using System.Collections.Concurrent;

namespace EduSim.Models;

public class Session
{
    public string Code { get; set; } = string.Empty;
    public VitalSigns Vitals { get; set; } = new();
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public HashSet<string> ConnectionIds { get; set; } = new();

    // Connected student monitors, keyed by SignalR connection id.
    public ConcurrentDictionary<string, MonitorInfo> Monitors { get; } = new();

    public const int MaxMonitorNameLength = 30;

    // Monitors sorted by join order — the shape sent to the instructor.
    public List<MonitorInfo> MonitorList() =>
        Monitors.Values.OrderBy(m => m.JoinedAt).ToList();

    public bool NameInUse(string name, string? exceptConnectionId = null) =>
        Monitors.Any(kv => kv.Key != exceptConnectionId &&
                           string.Equals(kv.Value.Name, name, StringComparison.OrdinalIgnoreCase));

    // Lowest unused "Monitor N".
    public string NextMonitorName()
    {
        for (var n = 1; ; n++)
        {
            var candidate = $"Monitor {n}";
            if (!NameInUse(candidate)) return candidate;
        }
    }

    // Trim/limit a requested name; null if unusable.
    public static string? CleanName(string? requested)
    {
        if (string.IsNullOrWhiteSpace(requested)) return null;
        var name = requested.Trim();
        if (name.Length > MaxMonitorNameLength) name = name[..MaxMonitorNameLength];
        return name;
    }
}
