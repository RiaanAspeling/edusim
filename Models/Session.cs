namespace EduSim.Models;

public class Session
{
    public string Code { get; set; } = string.Empty;
    public VitalSigns Vitals { get; set; } = new();
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public HashSet<string> ConnectionIds { get; set; } = new();
}
