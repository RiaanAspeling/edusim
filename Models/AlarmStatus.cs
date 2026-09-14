using System.Text.Json.Serialization;

namespace EduSim.Models;

// Alarm limits are set by the student on the monitor and mirrored to the
// instructor's control panel. Each connected monitor is the source of truth
// for its own limits; the server keeps the last status per monitor so the
// instructor sees every student's limits, labelled by monitor name.

public class AlarmLimit
{
    // null = that bound is OFF
    [JsonPropertyName("low")] public double? Low { get; set; }
    [JsonPropertyName("high")] public double? High { get; set; }
    [JsonPropertyName("enabled")] public bool Enabled { get; set; } = true;
}

public class ActiveAlarm
{
    [JsonPropertyName("channel")] public string Channel { get; set; } = string.Empty;
    [JsonPropertyName("direction")] public string Direction { get; set; } = string.Empty; // "high" | "low"
    [JsonPropertyName("silenced")] public bool Silenced { get; set; }
}

public class AlarmStatus
{
    // Keyed by channel: hr, sys, cvp, icp, spo2, rr, etco2, temp
    [JsonPropertyName("limits")] public Dictionary<string, AlarmLimit> Limits { get; set; } = new();
    [JsonPropertyName("active")] public List<ActiveAlarm> Active { get; set; } = new();
}

// One connected student monitor within a session.
public class MonitorInfo
{
    [JsonPropertyName("name")] public string Name { get; set; } = string.Empty;
    [JsonPropertyName("alarms")] public AlarmStatus Alarms { get; set; } = new();
    [JsonPropertyName("joinedAt")] public DateTime JoinedAt { get; set; } = DateTime.UtcNow;
}
