# HBEmu - Patient Vital Signs Monitor Simulator

A web-based patient vital signs monitor simulator for medical and nursing education. An instructor controls the patient's vitals from a phone or tablet while students observe and respond to changes on a fullscreen PC monitor display.

## Features

- **Realistic monitor display** with animated waveforms (ECG, SpO2 pleth, arterial BP, capnography, respiration)
- **Real-time control** via SignalR WebSocket connection - changes appear instantly
- **Session-based** - instructor creates a session, student joins with a 6-character code
- **ECG rhythms** - Normal Sinus, Sinus Tachycardia/Bradycardia, Atrial Fibrillation, V-Tach, V-Fib, Asystole
- **Adjustable vitals** - Heart Rate, SpO2, Blood Pressure, Respiratory Rate, EtCO2, Temperature
- **Quick scenarios** - Healthy Adult, Sepsis, Acute MI, Cardiac Arrest, Respiratory Failure, Hemorrhage, Anaphylaxis, Pulmonary Embolism
- **Audio** - heart beep on each QRS complex, alarm tones for critical rhythms
- **Responsive control panel** - optimized for phone, tablet, and desktop

## Requirements

- [.NET 8 SDK](https://dotnet.microsoft.com/download/dotnet/8.0)

## Getting Started

```bash
dotnet run
```

The app starts on `http://0.0.0.0:5100`.

### Student (PC)

Open `http://localhost:5100/monitor/` in a browser and enter the session code. Double-click to toggle fullscreen.

### Instructor (Phone/Tablet)

Open `http://<pc-ip-address>:5100/control/` on your device. Create a new session and share the code with the student.

> Both devices must be on the same network.

## Project Structure

```
HBEmu/
├── Program.cs                     # App entry point, SignalR + static files
├── Hubs/VitalsHub.cs              # SignalR hub for session and vitals
├── Models/
│   ├── VitalSigns.cs              # Vitals data model
│   └── Session.cs                 # Session state
├── Services/SessionManager.cs     # In-memory session management
└── wwwroot/
    ├── monitor/                   # Student monitor display
    ├── control/                   # Instructor control panel
    └── js/waveforms.js            # Waveform generation (ECG, SpO2, ABP, etc.)
```

## How It Works

1. The instructor opens the control panel and creates a session
2. The student opens the monitor display and enters the session code
3. Both connect to the same SignalR group
4. The instructor adjusts vitals via sliders, presets, or scenario buttons
5. Changes are pushed in real-time to the student monitor
6. Waveforms are generated client-side using mathematical models, driven by the current vital sign parameters

## Technology

- **Backend**: ASP.NET Core 8 with SignalR
- **Frontend**: Vanilla HTML5, CSS, JavaScript with Canvas API for waveform rendering
- **Communication**: WebSocket via SignalR (automatic fallback to long polling)
