// Patient Monitor - Student Display
const connection = new signalR.HubConnectionBuilder()
    .withUrl("/vitalsHub")
    .withAutomaticReconnect()
    .build();

let sessionCode = null;
let vitals = {
    heartRate: 72, spO2: 98, systolicBP: 120, diastolicBP: 80,
    respiratoryRate: 16, temperature: 36.8, etCO2: 38, rhythm: 'nsr'
};

// Smooth transition targets
let targetVitals = { ...vitals };
const TRANSITION_SPEED = 0.08;

const ecgGen = new ECGGenerator();

// Audio context for heart beep
let audioCtx = null;
let lastBeepPhase = 1;

function initAudio() {
    if (!audioCtx) {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (audioCtx.state === 'suspended') {
        audioCtx.resume();
    }
}

// Resume audio on any user interaction (required by browsers)
document.addEventListener('click', initAudio, { once: false });
document.addEventListener('keydown', initAudio, { once: false });

function playBeep(frequency, duration) {
    if (!audioCtx) return;
    if (audioCtx.state === 'suspended') audioCtx.resume();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.frequency.value = frequency;
    osc.type = 'sine';
    gain.gain.setValueAtTime(0.08, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + duration);
    osc.start();
    osc.stop(audioCtx.currentTime + duration);
}

// Waveform rendering state
const waveformState = {
    ecg: { buffer: [], writePos: 0 },
    spo2: { buffer: [], writePos: 0 },
    abp: { buffer: [], writePos: 0 },
    capno: { buffer: [], writePos: 0 },
    resp: { buffer: [], writePos: 0 }
};

let lastTimestamp = 0;
const SAMPLE_RATE = 250; // samples per second
let sampleAccumulator = 0;
let respPhase = 0;

function resizeCanvases() {
    const canvases = ['ecgCanvas', 'spo2Canvas', 'abpCanvas', 'capnoCanvas', 'respCanvas'];
    const keys = ['ecg', 'spo2', 'abp', 'capno', 'resp'];
    canvases.forEach((id, i) => {
        const canvas = document.getElementById(id);
        const rect = canvas.getBoundingClientRect();
        canvas.width = rect.width * window.devicePixelRatio;
        canvas.height = rect.height * window.devicePixelRatio;
        const bufLen = Math.floor(rect.width * window.devicePixelRatio);
        waveformState[keys[i]].buffer = new Float32Array(bufLen);
        waveformState[keys[i]].writePos = 0;
    });
}

function smoothVitals() {
    vitals.heartRate += (targetVitals.heartRate - vitals.heartRate) * TRANSITION_SPEED;
    vitals.spO2 += (targetVitals.spO2 - vitals.spO2) * TRANSITION_SPEED;
    vitals.systolicBP += (targetVitals.systolicBP - vitals.systolicBP) * TRANSITION_SPEED;
    vitals.diastolicBP += (targetVitals.diastolicBP - vitals.diastolicBP) * TRANSITION_SPEED;
    vitals.respiratoryRate += (targetVitals.respiratoryRate - vitals.respiratoryRate) * TRANSITION_SPEED;
    vitals.temperature += (targetVitals.temperature - vitals.temperature) * TRANSITION_SPEED;
    vitals.etCO2 += (targetVitals.etCO2 - vitals.etCO2) * TRANSITION_SPEED;
}

function updateNumerics() {
    document.getElementById('hrValue').textContent = Math.round(ecgGen.getEffectiveHR());
    document.getElementById('spo2Value').textContent = Math.round(vitals.spO2);
    document.getElementById('bpValue').textContent =
        Math.round(vitals.systolicBP) + '/' + Math.round(vitals.diastolicBP);
    document.getElementById('rrValue').textContent = Math.round(vitals.respiratoryRate);
    document.getElementById('tempValue').textContent = vitals.temperature.toFixed(1);
    document.getElementById('etco2Value').textContent = Math.round(vitals.etCO2);
}

const rhythmNames = {
    nsr: 'Normal Sinus Rhythm',
    afib: 'Atrial Fibrillation',
    vtach: 'V-Tach',
    vfib: 'V-Fib',
    asystole: 'Asystole'
};

function drawWaveform(canvasId, state, color, lineWidth, valMin, valMax) {
    const canvas = document.getElementById(canvasId);
    const ctx = canvas.getContext('2d');
    const w = canvas.width;
    const h = canvas.height;
    const margin = 0.08;

    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, w, h);

    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth * window.devicePixelRatio;
    ctx.lineJoin = 'round';
    ctx.beginPath();

    const buf = state.buffer;
    const len = buf.length;
    const wp = state.writePos % len;
    const gapSize = Math.floor(SAMPLE_RATE * 0.12);
    const drawH = h * (1 - 2 * margin);
    const range = valMax - valMin;

    // Draw waveform: buffer index maps directly to screen X
    // The write position is the sweep head moving left-to-right
    let penDown = false;
    for (let x = 0; x < len; x++) {
        // Distance ahead of write position (in the gap = blank area)
        const distAhead = (x - wp + len) % len;
        const inGap = distAhead < gapSize && distAhead >= 0;

        if (inGap) {
            penDown = false;
            continue;
        }

        const normalized = (buf[x] - valMin) / range;
        const y = h * margin + (1 - normalized) * drawH;

        if (!penDown) {
            ctx.moveTo(x, y);
            penDown = true;
        } else {
            ctx.lineTo(x, y);
        }
    }
    ctx.stroke();

    // Draw sweep line at write position
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1;
    ctx.globalAlpha = 0.3;
    ctx.beginPath();
    ctx.moveTo(wp, 0);
    ctx.lineTo(wp, h);
    ctx.stroke();
    ctx.globalAlpha = 1.0;
}

function generateSamples(dt) {
    sampleAccumulator += dt * SAMPLE_RATE;
    const samplesToGen = Math.floor(sampleAccumulator);
    sampleAccumulator -= samplesToGen;

    const sampleDt = 1.0 / SAMPLE_RATE;

    ecgGen.setHeartRate(vitals.heartRate);
    ecgGen.setRhythm(vitals.rhythm);

    for (let i = 0; i < samplesToGen; i++) {
        // ECG
        const ecgSample = ecgGen.nextSample(sampleDt);
        pushSample(waveformState.ecg, ecgSample);

        // Heart beep on R-wave detection (no beep during V-Fib/Asystole)
        const phase = ecgGen.getPhase();
        const noOutput = ecgGen.hasNoOutput();
        if (!noOutput && phase < lastBeepPhase) {
            playBeep(880, 0.06);
        }
        lastBeepPhase = phase;

        // SpO2 and ABP: flat wavering lines when no cardiac output
        if (noOutput) {
            const spo2Sample = 0.02 * (Math.random() - 0.5);
            pushSample(waveformState.spo2, spo2Sample);
            const abpSample = 0.02 * (Math.random() - 0.5);
            pushSample(waveformState.abp, abpSample);
        } else {
            // SpO2 pleth (synced to heart rate, amplitude scales linearly with SpO2 %)
            const spo2Amplitude = Math.max(0, vitals.spO2 / 100);
            const spo2Sample = Waveforms.spo2Pleth(phase) * spo2Amplitude;
            pushSample(waveformState.spo2, spo2Sample);

            // ABP (amplitude reflects BP values)
            const bpScale = Math.max(0, vitals.systolicBP / 120);
            const abpSample = Waveforms.abpWaveform(phase, vitals.systolicBP, vitals.diastolicBP) * Math.min(bpScale, 1);
            pushSample(waveformState.abp, abpSample);
        }

        // Respiration phase (stops if RR is 0)
        if (vitals.respiratoryRate > 0) {
            respPhase += sampleDt * vitals.respiratoryRate / 60.0;
            if (respPhase >= 1) respPhase -= 1;
        }

        // Capnography (height reflects EtCO2 value; flat if RR is 0)
        const capnoScale = vitals.respiratoryRate > 0 ? Math.max(0, vitals.etCO2 / 80) : 0;
        const capnoSample = Waveforms.capnography(respPhase) * capnoScale;
        pushSample(waveformState.capno, capnoSample);

        // Respiration (flat if RR is 0)
        const respSample = vitals.respiratoryRate > 0 ? Waveforms.respiration(respPhase) : 0.5;
        pushSample(waveformState.resp, respSample);
    }
}

function pushSample(state, value) {
    if (state.buffer.length === 0) return;
    state.buffer[state.writePos] = value;
    state.writePos = (state.writePos + 1) % state.buffer.length;
}

function animate(timestamp) {
    if (lastTimestamp === 0) lastTimestamp = timestamp;
    const dt = Math.min((timestamp - lastTimestamp) / 1000, 0.05);
    lastTimestamp = timestamp;

    smoothVitals();
    generateSamples(dt);

    drawWaveform('ecgCanvas', waveformState.ecg, '#00ff41', 2, -0.95, 0.95);
    drawWaveform('spo2Canvas', waveformState.spo2, '#00e5ff', 2, 0, 1.1);
    drawWaveform('abpCanvas', waveformState.abp, '#ff3333', 2, -0.05, 1.1);
    drawWaveform('capnoCanvas', waveformState.capno, '#ffff00', 1.5, -0.05, 1.1);
    drawWaveform('respCanvas', waveformState.resp, '#ffaa00', 1.5, -0.05, 1.1);

    updateNumerics();

    requestAnimationFrame(animate);
}

// Alarm handling
let alarmInterval = null;
const dangerousRhythms = { vtach: 'V-TACH ALARM', vfib: 'V-FIB ALARM', asystole: 'ASYSTOLE' };

function showAlarm(type) {
    const overlay = document.getElementById('alarmOverlay');
    const text = document.getElementById('alarmText');
    const alarmMessages = {
        ...dangerousRhythms,
        bradycardia: 'BRADYCARDIA',
        tachycardia: 'TACHYCARDIA',
        hypotension: 'HYPOTENSION',
        desaturation: 'LOW SpO2'
    };
    text.textContent = alarmMessages[type] || type.toUpperCase();
    overlay.style.display = 'block';
    overlay.className = 'alarm-overlay alarm-active';
    playAlarmTone();
}

function hideAlarm() {
    const overlay = document.getElementById('alarmOverlay');
    overlay.style.display = 'none';
    overlay.className = 'alarm-overlay';
}

function playAlarmTone() {
    if (!audioCtx) return;
    if (audioCtx.state === 'suspended') audioCtx.resume();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.frequency.value = 660;
    osc.type = 'square';
    gain.gain.setValueAtTime(0.1, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 1.5);
    osc.start();
    osc.stop(audioCtx.currentTime + 1.5);
}

// Persistent alarm: flash on 3s / off 2s while dangerous rhythm is active
function startPersistentAlarm(type) {
    stopPersistentAlarm();
    showAlarm(type);
    let visible = true;
    alarmInterval = setInterval(() => {
        // Stop if rhythm is no longer dangerous
        if (!dangerousRhythms[vitals.rhythm]) {
            stopPersistentAlarm();
            return;
        }
        visible = !visible;
        if (visible) {
            showAlarm(vitals.rhythm);
        } else {
            hideAlarm();
        }
    }, visible ? 3000 : 2000);
}

function stopPersistentAlarm() {
    clearInterval(alarmInterval);
    alarmInterval = null;
    hideAlarm();
}

// SignalR event handlers
connection.on("SessionJoined", (code, v) => {
    sessionCode = code;
    document.getElementById('sessionCode').textContent = code;
    applyVitals(v);
    document.getElementById('joinScreen').style.display = 'none';
    document.getElementById('monitorScreen').style.display = 'block';
    resizeCanvases();
    initAudio();
    requestAnimationFrame(animate);
});

connection.on("VitalsUpdated", (v) => {
    applyVitals(v);
});

connection.on("RhythmChanged", (rhythm) => {
    targetVitals.rhythm = rhythm;
    vitals.rhythm = rhythm;
    document.getElementById('rhythmLabel').textContent = rhythmNames[rhythm] || rhythm;

    // Start/stop persistent alarm for dangerous rhythms
    if (dangerousRhythms[rhythm]) {
        startPersistentAlarm(rhythm);
    } else {
        stopPersistentAlarm();
    }
});

connection.on("AlarmTriggered", (type) => {
    showAlarm(type);
});

connection.on("Error", (msg) => {
    document.getElementById('joinError').textContent = msg;
});

function applyVitals(v) {
    targetVitals.heartRate = v.heartRate;
    targetVitals.spO2 = v.spO2;
    targetVitals.systolicBP = v.systolicBP;
    targetVitals.diastolicBP = v.diastolicBP;
    targetVitals.respiratoryRate = v.respiratoryRate;
    targetVitals.temperature = v.temperature;
    targetVitals.etCO2 = v.etCO2;
    if (v.rhythm) {
        vitals.rhythm = v.rhythm;
        targetVitals.rhythm = v.rhythm;
        document.getElementById('rhythmLabel').textContent = rhythmNames[v.rhythm] || v.rhythm;
    }
}

// Join session
async function joinSession() {
    const code = document.getElementById('sessionCodeInput').value.trim().toUpperCase();
    if (code.length < 4) {
        document.getElementById('joinError').textContent = 'Please enter a valid session code';
        return;
    }
    document.getElementById('joinError').textContent = '';
    await connection.invoke("JoinSession", code);
}

// Handle Enter key on input
document.getElementById('sessionCodeInput').addEventListener('keyup', (e) => {
    if (e.key === 'Enter') joinSession();
});

// Handle resize
window.addEventListener('resize', () => {
    if (document.getElementById('monitorScreen').style.display !== 'none') {
        resizeCanvases();
    }
});

// Fullscreen on double-click
document.addEventListener('dblclick', () => {
    if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen();
    } else {
        document.exitFullscreen();
    }
});

// Auto-join if session code is in URL query string
function getSessionFromURL() {
    const params = new URLSearchParams(window.location.search);
    return params.get('session');
}

// Start SignalR connection
connection.start().then(() => {
    const code = getSessionFromURL();
    if (code) {
        connection.invoke("JoinSession", code.toUpperCase());
    }
}).catch(err => {
    console.error('SignalR connection error:', err);
    document.getElementById('joinError').textContent = 'Failed to connect to server';
});
