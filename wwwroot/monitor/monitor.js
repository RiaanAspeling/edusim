// Patient Monitor - Student Display
const connection = new signalR.HubConnectionBuilder()
    .withUrl("/vitalsHub")
    .withAutomaticReconnect()
    .build();

let sessionCode = null;
let vitals = {
    heartRate: 72, spO2: 98, systolicBP: 120, diastolicBP: 80,
    respiratoryRate: 16, temperature: 36.8, etCO2: 38, cvp: 5, rhythm: 'nsr',
    icp: 10, icpP1: 100, icpP2: 65, icpP3: 40,
    hrDisplay: 'on', abpDisplay: 'on', cvpDisplay: 'on',
    icpDisplay: 'on', spo2Display: 'on', rrDisplay: 'on',
    irregularity: 0,
    spo2Irregularity: 0, bpIrregularity: 0, cvpIrregularity: 0,
    rrIrregularity: 0, etco2Irregularity: 0, tempIrregularity: 0, icpIrregularity: 0
};

// Per-vital natural variation. Cardiac-linked vitals (SpO2/BP/CVP) latch a
// fresh small random offset each beat; RR/EtCO2 latch each breath; Temp drifts
// on smooth low-frequency noise. The same offset drives the waveform and its
// numeric readout, so they always agree.
let jitter = { spo2: 0, bp: 0, cvp: 0, rr: 0, etco2: 0, icp: 0 };
function symRand() { return Math.random() * 2 - 1; }
function physioNoise(t, seed) {
    return 0.6 * Math.sin(t * 0.7 + seed) + 0.4 * Math.sin(t * 1.9 + seed * 2.3);
}

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
    cvp: { buffer: [], writePos: 0 },
    icp: { buffer: [], writePos: 0 },
    resp: { buffer: [], writePos: 0 }
};

let lastTimestamp = 0;
const SAMPLE_RATE = 250; // samples per second
let sampleAccumulator = 0;
let respPhase = 0;

function resizeCanvases() {
    const canvases = ['ecgCanvas', 'spo2Canvas', 'abpCanvas', 'cvpCanvas', 'icpCanvas', 'respCanvas'];
    const keys = ['ecg', 'spo2', 'abp', 'cvp', 'icp', 'resp'];
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

// Per-channel display mode: 'on' = waveform row, 'min' = number at the bottom,
// 'off' = hidden. row is the waveform row id, min is the bottom-bar slot id.
const displayChannels = [
    { key: 'hrDisplay', row: 'ecgRow', min: 'hrMin' },
    { key: 'abpDisplay', row: 'abpRow', min: 'abpMin' },
    { key: 'cvpDisplay', row: 'cvpRow', min: 'cvpMin' },
    { key: 'icpDisplay', row: 'icpRow', min: 'icpMin' },
    { key: 'spo2Display', row: 'spo2Row', min: 'spo2Min' },
    { key: 'rrDisplay', row: 'respRow', min: 'rrMin' }
];
let lastLayoutSig = '';

function updateLayout() {
    const sig = displayChannels.map(c => vitals[c.key]).join(',');
    if (sig === lastLayoutSig) return; // unchanged — don't disturb the buffers
    lastLayoutSig = sig;
    displayChannels.forEach(c => {
        const mode = vitals[c.key] || 'on';
        document.getElementById(c.row).style.display = (mode === 'on') ? '' : 'none';
        document.getElementById(c.min).style.display = (mode === 'min') ? '' : 'none';
    });
    // Rows reflow to fill; recompute canvas backing sizes for the new heights
    // (only once the monitor is on screen — the join handler resizes after).
    if (document.getElementById('monitorScreen').style.display !== 'none') {
        resizeCanvases();
    }
}

function smoothVitals() {
    vitals.heartRate += (targetVitals.heartRate - vitals.heartRate) * TRANSITION_SPEED;
    vitals.spO2 += (targetVitals.spO2 - vitals.spO2) * TRANSITION_SPEED;
    vitals.systolicBP += (targetVitals.systolicBP - vitals.systolicBP) * TRANSITION_SPEED;
    vitals.diastolicBP += (targetVitals.diastolicBP - vitals.diastolicBP) * TRANSITION_SPEED;
    vitals.respiratoryRate += (targetVitals.respiratoryRate - vitals.respiratoryRate) * TRANSITION_SPEED;
    vitals.temperature += (targetVitals.temperature - vitals.temperature) * TRANSITION_SPEED;
    vitals.etCO2 += (targetVitals.etCO2 - vitals.etCO2) * TRANSITION_SPEED;
    vitals.cvp += (targetVitals.cvp - vitals.cvp) * TRANSITION_SPEED;
    vitals.icp += (targetVitals.icp - vitals.icp) * TRANSITION_SPEED;
    vitals.icpP1 += (targetVitals.icpP1 - vitals.icpP1) * TRANSITION_SPEED;
    vitals.icpP2 += (targetVitals.icpP2 - vitals.icpP2) * TRANSITION_SPEED;
    vitals.icpP3 += (targetVitals.icpP3 - vitals.icpP3) * TRANSITION_SPEED;
}

// Write a readout to both its waveform-box element and its bottom-bar
// minimized slot, so whichever is visible shows the same value.
function setNum(mainId, minId, text) {
    document.getElementById(mainId).textContent = text;
    document.getElementById(minId).textContent = text;
}

function updateNumerics() {
    // Readouts carry the same natural-variation offset as their waveforms, so
    // numbers and traces always agree. HR already varies via the R-R interval.
    setNum('hrValue', 'hrMinValue', Math.round(ecgGen.getEffectiveHR()));
    setNum('spo2Value', 'spo2MinValue',
        Math.round(Math.min(100, Math.max(0, vitals.spO2 * (1 + jitter.spo2)))));
    const sysDisp = vitals.systolicBP * (1 + jitter.bp);
    const diaDisp = vitals.diastolicBP * (1 + jitter.bp);
    setNum('bpValue', 'bpMinValue', Math.round(sysDisp) + '/' + Math.round(diaDisp));
    // MAP = diastolic + (pulse pressure / 3)
    const mapDisp = diaDisp + (sysDisp - diaDisp) / 3;
    setNum('mapValue', 'mapMinValue', Math.round(mapDisp));
    setNum('rrValue', 'rrMinValue', Math.round(vitals.respiratoryRate * (1 + jitter.rr)));
    setNum('cvpValue', 'cvpMinValue', Math.round(vitals.cvp * (1 + jitter.cvp)));
    // ICP and cerebral perfusion pressure (CPP = MAP − ICP)
    const icpDisp = vitals.icp * (1 + jitter.icp);
    setNum('icpValue', 'icpMinValue', Math.round(icpDisp));
    setNum('cppValue', 'cppMinValue', Math.round(mapDisp - icpDisp));
    // EtCO2 and Temp live at the bottom only (no waveform, no toggle)
    const tempJitter = (vitals.tempIrregularity / 100) * physioNoise(ecgGen.time, 7);
    document.getElementById('tempValue').textContent =
        (vitals.temperature * (1 + tempJitter)).toFixed(1);
    document.getElementById('etco2Value').textContent =
        Math.round(vitals.etCO2 * (1 + jitter.etco2));
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
    ecgGen.setIrregularity(vitals.irregularity);

    for (let i = 0; i < samplesToGen; i++) {
        // ECG
        const ecgSample = ecgGen.nextSample(sampleDt);
        pushSample(waveformState.ecg, ecgSample);

        // Latch a fresh natural-variation offset for cardiac-linked vitals at
        // the start of each beat (held constant through the beat so the pulse
        // shape isn't warped mid-beat)
        if (ecgGen.beatJustStarted) {
            jitter.spo2 = symRand() * (vitals.spo2Irregularity / 100);
            jitter.bp = symRand() * (vitals.bpIrregularity / 100);
            jitter.cvp = symRand() * (vitals.cvpIrregularity / 100);
            jitter.icp = symRand() * (vitals.icpIrregularity / 100);
        }

        // Update smoothed Frank-Starling BP factor
        ecgGen.updateBPFactor(sampleDt);

        // Heart beep on R-wave detection (no beep during V-Fib/Asystole)
        const phase = ecgGen.getPhase();
        const noOutput = ecgGen.hasNoOutput();
        if (!noOutput && phase < lastBeepPhase) {
            playBeep(880, 0.06);
        }
        lastBeepPhase = phase;

        // CVP trace baseline rides up/down the pressure scale with the mean
        // CVP value (0–25 mmHg → vertical position), leaving headroom above
        // and below for the a/c/v peaks and x/y descents.
        const cvpLive = vitals.cvp * (1 + jitter.cvp);
        const cvpBaseline = 0.18 + Math.min(Math.max(cvpLive, 0), 25) / 25 * 0.67;

        // ICP trace baseline rides up/down with the mean ICP (0–40 mmHg), with
        // the P1/P2/P3 pulse riding on top during systole.
        const icpLive = vitals.icp * (1 + jitter.icp);
        const icpBaseline = 0.15 + Math.min(Math.max(icpLive, 0), 40) / 40 * 0.50;

        // SpO2 and ABP: flat wavering lines when no cardiac output
        if (noOutput) {
            const spo2Sample = 0.02 * (Math.random() - 0.5);
            pushSample(waveformState.spo2, spo2Sample);
            const abpSample = 0.02 * (Math.random() - 0.5);
            pushSample(waveformState.abp, abpSample);
            // CVP — no cardiac cycle, so flat at the mean baseline with slight drift
            pushSample(waveformState.cvp, cvpBaseline + 0.01 * (Math.random() - 0.5));
            // ICP — no pulse without cardiac output; flat at the mean baseline
            pushSample(waveformState.icp, icpBaseline + 0.01 * (Math.random() - 0.5));
        } else {
            const pulsePhase = ecgGen.getPulsePhase();
            const prevPulsePhase = ecgGen.getPrevPulsePhase();
            const sysFactor = ecgGen.getSysFactor();

            // SpO2 pleth — amplitude scales with pulse pressure because
            // the plethysmograph measures the same arterial pulsation as ABP
            // (correlation r=0.85, Shamir et al. 1999). At zero BP, pleth is flat.
            const pulsePressure = Math.max(0, vitals.systolicBP - vitals.diastolicBP);
            const ppFactor = Math.min(pulsePressure / 40, 1); // normalize to typical PP of 40mmHg
            const spo2Live = Math.min(100, Math.max(0, vitals.spO2 * (1 + jitter.spo2)));
            const spo2Amplitude = Math.max(0, spo2Live / 100) * sysFactor * ppFactor;
            const spo2Current = Waveforms.spo2Pleth(pulsePhase) * spo2Amplitude;
            const spo2Prev = Waveforms.spo2Pleth(prevPulsePhase) * spo2Amplitude;
            pushSample(waveformState.spo2, Math.max(spo2Current, spo2Prev));

            // ABP — previous beat's tail provides diastolic decay bridge
            const sysLive = vitals.systolicBP * (1 + jitter.bp);
            const diaLive = vitals.diastolicBP * (1 + jitter.bp);
            const abpCurrent = Waveforms.abpWaveform(pulsePhase, sysLive, diaLive) * sysFactor;
            const abpPrev = Waveforms.abpWaveform(prevPulsePhase, sysLive, diaLive) * sysFactor;
            pushSample(waveformState.abp, Math.max(abpCurrent, abpPrev));

            // CVP — locked to the cardiac cycle (a/c/v waves track P/QRS/T);
            // getCvpSample() centres morphology at 0.5, shifted to the baseline
            pushSample(waveformState.cvp, ecgGen.getCvpSample() - 0.5 + cvpBaseline);

            // ICP — arterial pulse transmitted into the skull; P1/P2/P3 pulse
            // (amplitudes from vitals) rides on top of the mean-ICP baseline
            const icpPulse = ecgGen.getIcpSample(vitals.icpP1 / 100, vitals.icpP2 / 100, vitals.icpP3 / 100);
            pushSample(waveformState.icp, icpBaseline + 0.30 * icpPulse);
        }

        // Respiration phase (stops if RR is 0). Each breath latches a fresh
        // natural-variation offset for the rate (RR) and EtCO2.
        if (vitals.respiratoryRate > 0) {
            const rrLive = vitals.respiratoryRate * (1 + jitter.rr);
            respPhase += sampleDt * rrLive / 60.0;
            if (respPhase >= 1) {
                respPhase -= 1;
                jitter.rr = symRand() * (vitals.rrIrregularity / 100);
                jitter.etco2 = symRand() * (vitals.etco2Irregularity / 100);
            }
        }

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

let monitorPaused = false;

function animate(timestamp) {
    if (monitorPaused) return;
    if (lastTimestamp === 0) lastTimestamp = timestamp;
    const dt = Math.min((timestamp - lastTimestamp) / 1000, 0.05);
    lastTimestamp = timestamp;

    smoothVitals();
    generateSamples(dt);

    drawWaveform('ecgCanvas', waveformState.ecg, '#00ff41', 2, -0.95, 0.95);
    drawWaveform('spo2Canvas', waveformState.spo2, '#00e5ff', 2, 0, 1.1);
    drawWaveform('abpCanvas', waveformState.abp, '#ff3333', 2, -0.05, 1.1);
    drawWaveform('cvpCanvas', waveformState.cvp, '#ffff00', 1.5, 0, 1.15);
    drawWaveform('icpCanvas', waveformState.icp, '#e066ff', 1.5, 0, 1.2);
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

connection.on("MonitorPaused", () => {
    monitorPaused = true;
});

connection.on("MonitorResumed", () => {
    monitorPaused = false;
    lastTimestamp = 0; // reset so we don't get a huge dt jump
    requestAnimationFrame(animate);
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
    if (v.cvp !== undefined) targetVitals.cvp = v.cvp;
    if (v.icp !== undefined) targetVitals.icp = v.icp;
    if (v.icpP1 !== undefined) targetVitals.icpP1 = v.icpP1;
    if (v.icpP2 !== undefined) targetVitals.icpP2 = v.icpP2;
    if (v.icpP3 !== undefined) targetVitals.icpP3 = v.icpP3;
    vitals.icpIrregularity = v.icpIrregularity || 0;
    if (v.hrDisplay) vitals.hrDisplay = v.hrDisplay;
    if (v.abpDisplay) vitals.abpDisplay = v.abpDisplay;
    if (v.cvpDisplay) vitals.cvpDisplay = v.cvpDisplay;
    if (v.icpDisplay) vitals.icpDisplay = v.icpDisplay;
    if (v.spo2Display) vitals.spo2Display = v.spo2Display;
    if (v.rrDisplay) vitals.rrDisplay = v.rrDisplay;
    updateLayout();
    vitals.spo2Irregularity = v.spo2Irregularity || 0;
    vitals.bpIrregularity = v.bpIrregularity || 0;
    vitals.cvpIrregularity = v.cvpIrregularity || 0;
    vitals.rrIrregularity = v.rrIrregularity || 0;
    vitals.etco2Irregularity = v.etco2Irregularity || 0;
    vitals.tempIrregularity = v.tempIrregularity || 0;
    vitals.irregularity = v.irregularity || 0;
    targetVitals.irregularity = v.irregularity || 0;
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
