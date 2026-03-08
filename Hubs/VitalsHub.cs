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
        await Clients.Caller.SendAsync("SessionCreated", session.Code, session.Vitals);
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
        await Clients.Caller.SendAsync("SessionJoined", code, session.Vitals);
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
        await base.OnDisconnectedAsync(exception);
    }
}
