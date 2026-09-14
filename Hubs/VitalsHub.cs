using Microsoft.AspNetCore.SignalR;
using EduSim.Models;
using EduSim.Services;

namespace EduSim.Hubs;

public class VitalsHub : Hub
{
    private readonly SessionManager _sessionManager;

    public VitalsHub(SessionManager sessionManager)
    {
        _sessionManager = sessionManager;
    }

    public async Task CreateSession()
    {
        var session = _sessionManager.CreateSession();
        await Groups.AddToGroupAsync(Context.ConnectionId, session.Code);
        await Clients.Caller.SendAsync("SessionCreated", session.Code, session.Vitals, session.MonitorList());
    }

    public async Task JoinSession(string code)
    {
        code = code.ToUpper();
        var session = _sessionManager.GetSession(code);
        if (session == null)
        {
            await Clients.Caller.SendAsync("Error", "Session not found");
            return;
        }

        session.ConnectionIds.Add(Context.ConnectionId);
        await Groups.AddToGroupAsync(Context.ConnectionId, code);
        await Clients.Caller.SendAsync("SessionJoined", code, session.Vitals, session.MonitorList());
    }

    // Student monitor joins. requestedName is the name this browser used last
    // time (if any); it is kept unless another live monitor already has it,
    // otherwise the lowest free "Monitor N" is assigned. The caller is told the
    // final name and everyone else gets the refreshed monitor list.
    public async Task JoinMonitor(string code, string? requestedName)
    {
        code = code.ToUpper();
        var session = _sessionManager.GetSession(code);
        if (session == null)
        {
            await Clients.Caller.SendAsync("Error", "Session not found");
            return;
        }

        var name = Session.CleanName(requestedName);
        if (name == null || session.NameInUse(name, Context.ConnectionId))
            name = session.NextMonitorName();

        session.Monitors[Context.ConnectionId] = new MonitorInfo { Name = name };
        session.ConnectionIds.Add(Context.ConnectionId);
        await Groups.AddToGroupAsync(Context.ConnectionId, code);
        await Clients.Caller.SendAsync("MonitorJoined", code, session.Vitals, name);
        await Clients.OthersInGroup(code).SendAsync("MonitorsUpdated", session.MonitorList());
    }

    public async Task RenameMonitor(string code, string newName)
    {
        code = code.ToUpper();
        var session = _sessionManager.GetSession(code);
        if (session == null || !session.Monitors.TryGetValue(Context.ConnectionId, out var monitor)) return;

        var name = Session.CleanName(newName);
        if (name == null)
        {
            await Clients.Caller.SendAsync("MonitorRenamed", monitor.Name, "Name cannot be empty");
            return;
        }
        if (session.NameInUse(name, Context.ConnectionId))
        {
            await Clients.Caller.SendAsync("MonitorRenamed", monitor.Name, $"\"{name}\" is already in use");
            return;
        }
        monitor.Name = name;
        await Clients.Caller.SendAsync("MonitorRenamed", name, null);
        await Clients.OthersInGroup(code).SendAsync("MonitorsUpdated", session.MonitorList());
    }

    public async Task UpdateVitals(string code, VitalSigns vitals)
    {
        code = code.ToUpper();
        _sessionManager.UpdateVitals(code, vitals);
        await Clients.Group(code).SendAsync("VitalsUpdated", vitals);
    }

    public async Task ChangeRhythm(string code, string rhythm)
    {
        code = code.ToUpper();
        var session = _sessionManager.GetSession(code);
        if (session != null)
        {
            session.Vitals.Rhythm = rhythm;
            await Clients.Group(code).SendAsync("RhythmChanged", rhythm);
        }
    }

    // Student-set alarm limits and currently active limit alarms, pushed by a
    // monitor and mirrored (read-only) to the instructor's control panel.
    public async Task UpdateAlarms(string code, AlarmStatus status)
    {
        code = code.ToUpper();
        var session = _sessionManager.GetSession(code);
        if (session == null || !session.Monitors.TryGetValue(Context.ConnectionId, out var monitor)) return;
        monitor.Alarms = status;
        await Clients.OthersInGroup(code).SendAsync("MonitorsUpdated", session.MonitorList());
    }

    public async Task TriggerAlarm(string code, string alarmType)
    {
        await Clients.Group(code.ToUpper()).SendAsync("AlarmTriggered", alarmType);
    }

    public async Task PauseMonitor(string code)
    {
        await Clients.Group(code.ToUpper()).SendAsync("MonitorPaused");
    }

    public async Task ResumeMonitor(string code)
    {
        await Clients.Group(code.ToUpper()).SendAsync("MonitorResumed");
    }

    public override async Task OnDisconnectedAsync(Exception? exception)
    {
        // A monitor that drops off is removed from the instructor's list at once
        var session = _sessionManager.FindByMonitorConnection(Context.ConnectionId);
        if (session != null && session.Monitors.TryRemove(Context.ConnectionId, out _))
        {
            session.ConnectionIds.Remove(Context.ConnectionId);
            await Clients.Group(session.Code).SendAsync("MonitorsUpdated", session.MonitorList());
        }
        await base.OnDisconnectedAsync(exception);
    }
}
