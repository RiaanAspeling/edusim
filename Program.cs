using EduSim.Hubs;
using EduSim.Services;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddSignalR();
builder.Services.AddSingleton<SessionManager>();

var app = builder.Build();

app.UseDefaultFiles();
app.UseStaticFiles();

app.MapHub<VitalsHub>("/vitalsHub");

app.MapPost("/api/session", (SessionManager sm) =>
{
    var session = sm.CreateSession();
    return Results.Ok(new { code = session.Code });
});

app.MapGet("/", () => Results.Redirect("/dashboard/"));

app.Run();
