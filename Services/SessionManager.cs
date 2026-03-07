using System.Collections.Concurrent;
using EduSim.Models;

namespace EduSim.Services;

public class SessionManager
{
    private readonly ConcurrentDictionary<string, Session> _sessions = new();
    private static readonly Random _random = new();

    public Session CreateSession()
    {
        var code = GenerateCode();
        var session = new Session { Code = code };
        _sessions[code] = session;
        return session;
    }

    public Session? GetSession(string code)
    {
        _sessions.TryGetValue(code.ToUpper(), out var session);
        return session;
    }

    public bool SessionExists(string code)
    {
        return _sessions.ContainsKey(code.ToUpper());
    }

    public void UpdateVitals(string code, VitalSigns vitals)
    {
        if (_sessions.TryGetValue(code.ToUpper(), out var session))
        {
            session.Vitals = vitals;
        }
    }

    public void RemoveSession(string code)
    {
        _sessions.TryRemove(code.ToUpper(), out _);
    }

    private static string GenerateCode()
    {
        const string chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
        return new string(Enumerable.Range(0, 6).Select(_ => chars[_random.Next(chars.Length)]).ToArray());
    }
}
