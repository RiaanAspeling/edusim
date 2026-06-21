// Instructor Control Panel
const connection = new signalR.HubConnectionBuilder()
    .withUrl("/vitalsHub")
    .withAutomaticReconnect()
    .build();

let sessionCode = null;
let sendTimeout = null;
let isPaused = false;

const currentVitals = {
    heartRate: 72, spO2: 98, systolicBP: 120, diastolicBP: 80,
    respiratoryRate: 16, temperature: 36.8, etCO2: 38, cvp: 5, rhythm: 'nsr',
    icp: 10, icpP1: 100, icpP2: 65, icpP3: 40,
    hrDisplay: 'on', abpDisplay: 'on', cvpDisplay: 'on',
    icpDisplay: 'on', spo2Display: 'on', rrDisplay: 'on',
    irregularity: 0,
    spo2Irregularity: 0, bpIrregularity: 0, cvpIrregularity: 0,
    rrIrregularity: 0, etco2Irregularity: 0, tempIrregularity: 0, icpIrregularity: 0
};

// Per-vital natural-variation controls (key -> max %). Heart-rate irregularity
// keeps its own path; these all behave the same way for the other vitals.
const irregularityControls = {
    spo2Irregularity: 10, bpIrregularity: 10, cvpIrregularity: 10,
    rrIrregularity: 10, etco2Irregularity: 10, tempIrregularity: 10, icpIrregularity: 10
};

// ICP waveform morphology presets (P1/P2/P3 peak amplitudes, %), matching the
// classic A→D compliance progression: normal P1>P2>P3, then P2 rises and the
// peaks merge as compliance falls.
const icpMorphologies = {
    a: { icpP1: 100, icpP2: 65, icpP3: 40 },
    b: { icpP1: 75, icpP2: 100, icpP3: 55 },
    c: { icpP1: 50, icpP2: 100, icpP3: 88 },
    d: { icpP1: 88, icpP2: 92, icpP3: 85 }
};

// Per-channel display toggle (ON waveform / MIN bottom number / OFF hidden)
const displayChannelKeys = ['hr', 'abp', 'cvp', 'icp', 'spo2', 'rr'];

function setDisplay(channel, mode) {
    currentVitals[channel + 'Display'] = mode;
    updateDisplayToggles();
    sendVitals();
}

function updateDisplayToggles() {
    displayChannelKeys.forEach(ch => {
        const mode = currentVitals[ch + 'Display'] || 'on';
        const toggle = document.getElementById(ch + 'DisplayToggle');
        if (!toggle) return;
        toggle.querySelectorAll('.dt-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.mode === mode);
        });
    });
}

function setIcpMorphology(type) {
    const m = icpMorphologies[type];
    if (!m) return;
    Object.assign(currentVitals, m);
    document.getElementById('icpP1Slider').value = m.icpP1;
    document.getElementById('icpP2Slider').value = m.icpP2;
    document.getElementById('icpP3Slider').value = m.icpP3;
    sendVitals();
}

function updateIrregularity(key) {
    const val = parseInt(document.getElementById(key + 'Slider').value);
    currentVitals[key] = val;
    document.getElementById(key + 'Input').value = val;
    sendVitals();
}

function manualIrregularity(key) {
    const max = irregularityControls[key];
    const val = Math.max(0, Math.min(max, parseInt(document.getElementById(key + 'Input').value) || 0));
    currentVitals[key] = val;
    document.getElementById(key + 'Slider').value = val;
    document.getElementById(key + 'Input').value = val;
    sendVitals();
}

// SignalR events
connection.on("SessionCreated", (code, vitals) => {
    sessionCode = code;
    applyFromServer(vitals);
    showControlPanel();
});

connection.on("SessionJoined", (code, vitals) => {
    sessionCode = code;
    applyFromServer(vitals);
    showControlPanel();
});

connection.on("Error", (msg) => {
    document.getElementById('setupError').textContent = msg;
});

function showControlPanel() {
    document.getElementById('setupScreen').style.display = 'none';
    document.getElementById('controlPanel').style.display = 'block';
    document.getElementById('sessionCodeDisplay').textContent = sessionCode;
}

function applyFromServer(v) {
    currentVitals.heartRate = v.heartRate;
    currentVitals.spO2 = v.spO2;
    currentVitals.systolicBP = v.systolicBP;
    currentVitals.diastolicBP = v.diastolicBP;
    currentVitals.respiratoryRate = v.respiratoryRate;
    currentVitals.temperature = v.temperature;
    currentVitals.etCO2 = v.etCO2;
    if (v.cvp !== undefined) currentVitals.cvp = v.cvp;
    currentVitals.rhythm = v.rhythm;
    currentVitals.irregularity = v.irregularity || 0;

    // Sync sliders
    document.getElementById('hrSlider').value = v.heartRate;
    document.getElementById('irregularitySlider').value = v.irregularity || 0;
    document.getElementById('spo2Slider').value = v.spO2;
    document.getElementById('sysSlider').value = v.systolicBP;
    document.getElementById('diaSlider').value = v.diastolicBP;
    document.getElementById('rrSlider').value = v.respiratoryRate;
    document.getElementById('etco2Slider').value = v.etCO2;
    if (v.cvp !== undefined) document.getElementById('cvpSlider').value = v.cvp;
    if (v.icp !== undefined) {
        currentVitals.icp = v.icp;
        document.getElementById('icpSlider').value = v.icp;
    }
    if (v.icpP1 !== undefined) {
        currentVitals.icpP1 = v.icpP1; currentVitals.icpP2 = v.icpP2; currentVitals.icpP3 = v.icpP3;
        document.getElementById('icpP1Slider').value = v.icpP1;
        document.getElementById('icpP2Slider').value = v.icpP2;
        document.getElementById('icpP3Slider').value = v.icpP3;
    }
    document.getElementById('tempSlider').value = Math.round(v.temperature * 10);

    // Per-vital irregularity
    for (const key in irregularityControls) {
        if (v[key] !== undefined) {
            currentVitals[key] = v[key];
            document.getElementById(key + 'Slider').value = v[key];
        }
    }

    // Per-channel display modes
    displayChannelKeys.forEach(ch => {
        if (v[ch + 'Display']) currentVitals[ch + 'Display'] = v[ch + 'Display'];
    });
    updateDisplayToggles();

    updateAllDisplays();
    updateRhythmButtons(v.rhythm);
}

function updateAllDisplays() {
    document.getElementById('hrInput').value = currentVitals.heartRate;
    document.getElementById('irregularityInput').value = currentVitals.irregularity;
    document.getElementById('spo2Input').value = currentVitals.spO2;
    document.getElementById('bpInput').value = currentVitals.systolicBP + '/' + currentVitals.diastolicBP;
    document.getElementById('rrInput').value = currentVitals.respiratoryRate;
    document.getElementById('etco2Input').value = currentVitals.etCO2;
    document.getElementById('cvpInput').value = currentVitals.cvp;
    document.getElementById('icpInput').value = currentVitals.icp;
    document.getElementById('tempInput').value = currentVitals.temperature.toFixed(1);
    for (const key in irregularityControls) {
        document.getElementById(key + 'Input').value = currentVitals[key];
    }
}

function updateRhythmButtons(rhythm) {
    document.querySelectorAll('.rhythm-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.rhythm === rhythm);
    });
    const names = {
        nsr: 'NSR', afib: 'A-Fib', vtach: 'V-Tach', vfib: 'V-Fib', asystole: 'Asystole'
    };
    document.getElementById('rhythmDisplay').textContent = names[rhythm] || rhythm;
}

// Debounced send
function sendVitals() {
    clearTimeout(sendTimeout);
    sendTimeout = setTimeout(() => {
        if (sessionCode) {
            connection.invoke("UpdateVitals", sessionCode, currentVitals);
        }
    }, 50);
}

// Slider handlers
function updateSlider(type) {
    switch (type) {
        case 'hr':
            currentVitals.heartRate = parseInt(document.getElementById('hrSlider').value);
            document.getElementById('hrInput').value = currentVitals.heartRate;
            break;
        case 'irregularity':
            currentVitals.irregularity = parseInt(document.getElementById('irregularitySlider').value);
            document.getElementById('irregularityInput').value = currentVitals.irregularity;
            break;
        case 'spo2':
            currentVitals.spO2 = parseInt(document.getElementById('spo2Slider').value);
            document.getElementById('spo2Input').value = currentVitals.spO2;
            break;
        case 'bp':
            let sys = parseInt(document.getElementById('sysSlider').value);
            let dia = parseInt(document.getElementById('diaSlider').value);
            if (sys <= dia) {
                sys = dia + 1;
                document.getElementById('sysSlider').value = sys;
            }
            currentVitals.systolicBP = sys;
            currentVitals.diastolicBP = dia;
            document.getElementById('bpInput').value = sys + '/' + dia;
            break;
        case 'rr':
            currentVitals.respiratoryRate = parseInt(document.getElementById('rrSlider').value);
            document.getElementById('rrInput').value = currentVitals.respiratoryRate;
            break;
        case 'etco2':
            currentVitals.etCO2 = parseInt(document.getElementById('etco2Slider').value);
            document.getElementById('etco2Input').value = currentVitals.etCO2;
            break;
        case 'cvp':
            currentVitals.cvp = parseInt(document.getElementById('cvpSlider').value);
            document.getElementById('cvpInput').value = currentVitals.cvp;
            break;
        case 'icp':
            currentVitals.icp = parseInt(document.getElementById('icpSlider').value);
            document.getElementById('icpInput').value = currentVitals.icp;
            break;
        case 'icpP1':
            currentVitals.icpP1 = parseInt(document.getElementById('icpP1Slider').value);
            break;
        case 'icpP2':
            currentVitals.icpP2 = parseInt(document.getElementById('icpP2Slider').value);
            break;
        case 'icpP3':
            currentVitals.icpP3 = parseInt(document.getElementById('icpP3Slider').value);
            break;
        case 'temp':
            currentVitals.temperature = parseInt(document.getElementById('tempSlider').value) / 10;
            document.getElementById('tempInput').value = currentVitals.temperature.toFixed(1);
            break;
    }
    sendVitals();
}

// Preset setters
function setHR(val) {
    currentVitals.heartRate = val;
    document.getElementById('hrSlider').value = val;
    document.getElementById('hrInput').value = val;
    sendVitals();
}

function setSpO2(val) {
    currentVitals.spO2 = val;
    document.getElementById('spo2Slider').value = val;
    document.getElementById('spo2Input').value = val;
    sendVitals();
}

function setBP(sys, dia) {
    if (sys <= dia) sys = dia + 1;
    currentVitals.systolicBP = sys;
    currentVitals.diastolicBP = dia;
    document.getElementById('sysSlider').value = sys;
    document.getElementById('diaSlider').value = dia;
    document.getElementById('bpInput').value = sys + '/' + dia;
    sendVitals();
}

function setRR(val) {
    currentVitals.respiratoryRate = val;
    document.getElementById('rrSlider').value = val;
    document.getElementById('rrInput').value = val;
    sendVitals();
}

function setEtCO2(val) {
    currentVitals.etCO2 = val;
    document.getElementById('etco2Slider').value = val;
    document.getElementById('etco2Input').value = val;
    sendVitals();
}

function setCVP(val) {
    currentVitals.cvp = val;
    document.getElementById('cvpSlider').value = val;
    document.getElementById('cvpInput').value = val;
    sendVitals();
}

function setICP(val) {
    currentVitals.icp = val;
    document.getElementById('icpSlider').value = val;
    document.getElementById('icpInput').value = val;
    sendVitals();
}

function setTemp(val) {
    currentVitals.temperature = val;
    document.getElementById('tempSlider').value = Math.round(val * 10);
    document.getElementById('tempInput').value = val.toFixed(1);
    sendVitals();
}

// Manual numeric input handler
function manualInput(type) {
    switch (type) {
        case 'hr': {
            const val = Math.max(20, Math.min(300, parseInt(document.getElementById('hrInput').value) || 72));
            setHR(val);
            break;
        }
        case 'irregularity': {
            const val = Math.max(0, Math.min(50, parseInt(document.getElementById('irregularityInput').value) || 0));
            currentVitals.irregularity = val;
            document.getElementById('irregularitySlider').value = val;
            document.getElementById('irregularityInput').value = val;
            sendVitals();
            break;
        }
        case 'spo2': {
            const val = Math.max(0, Math.min(100, parseInt(document.getElementById('spo2Input').value) || 98));
            setSpO2(val);
            break;
        }
        case 'bp': {
            const parts = document.getElementById('bpInput').value.split('/');
            if (parts.length === 2) {
                const sys = Math.max(0, Math.min(250, parseInt(parts[0]) || 120));
                const dia = Math.max(0, Math.min(150, parseInt(parts[1]) || 80));
                setBP(sys, dia);
            }
            break;
        }
        case 'rr': {
            const val = Math.max(0, Math.min(40, parseInt(document.getElementById('rrInput').value) || 16));
            setRR(val);
            break;
        }
        case 'etco2': {
            const val = Math.max(0, Math.min(80, parseInt(document.getElementById('etco2Input').value) || 38));
            setEtCO2(val);
            break;
        }
        case 'cvp': {
            const val = Math.max(0, Math.min(25, parseInt(document.getElementById('cvpInput').value) || 5));
            setCVP(val);
            break;
        }
        case 'icp': {
            const val = Math.max(0, Math.min(40, parseInt(document.getElementById('icpInput').value) || 10));
            setICP(val);
            break;
        }
        case 'temp': {
            const val = Math.max(33.0, Math.min(42.0, parseFloat(document.getElementById('tempInput').value) || 36.8));
            setTemp(val);
            break;
        }
    }
}

// Vital overrides applied automatically when certain rhythms are selected
const rhythmVitals = {
    nsr: { heartRate: 72, spO2: 98, systolicBP: 120, diastolicBP: 80, respiratoryRate: 16, etCO2: 38, cvp: 5 },
    vtach: { heartRate: 220, spO2: 82, systolicBP: 70, diastolicBP: 40, respiratoryRate: 6, etCO2: 15, cvp: 12 },
    vfib: { heartRate: 0, spO2: 0, systolicBP: 0, diastolicBP: 0, respiratoryRate: 0, etCO2: 0, cvp: 0 },
    asystole: { heartRate: 0, spO2: 0, systolicBP: 0, diastolicBP: 0, respiratoryRate: 0, etCO2: 0, cvp: 0 }
};

function setRhythm(rhythm) {
    currentVitals.rhythm = rhythm;
    updateRhythmButtons(rhythm);

    // Apply vital overrides for this rhythm
    const overrides = rhythmVitals[rhythm];
    if (overrides) {
        Object.assign(currentVitals, overrides);
        document.getElementById('hrSlider').value = currentVitals.heartRate;
        document.getElementById('spo2Slider').value = currentVitals.spO2;
        document.getElementById('sysSlider').value = currentVitals.systolicBP;
        document.getElementById('diaSlider').value = currentVitals.diastolicBP;
        document.getElementById('rrSlider').value = currentVitals.respiratoryRate;
        document.getElementById('etco2Slider').value = currentVitals.etCO2;
        document.getElementById('cvpSlider').value = currentVitals.cvp;
        updateAllDisplays();
        sendVitals();
    }

    if (sessionCode) {
        connection.invoke("ChangeRhythm", sessionCode, rhythm);
    }
}

// Quick scenarios
const scenarios = {
    healthy: {
        heartRate: 72, spO2: 98, systolicBP: 120, diastolicBP: 80,
        respiratoryRate: 16, temperature: 36.8, etCO2: 38, cvp: 5, rhythm: 'nsr'
    },
    sepsis: {
        heartRate: 125, spO2: 91, systolicBP: 85, diastolicBP: 55,
        respiratoryRate: 28, temperature: 39.5, etCO2: 28, cvp: 4, rhythm: 'nsr'
    },
    mi: {
        heartRate: 100, spO2: 94, systolicBP: 90, diastolicBP: 60,
        respiratoryRate: 22, temperature: 37.0, etCO2: 32, cvp: 9, rhythm: 'nsr'
    },
    cardiac_arrest: {
        heartRate: 0, spO2: 60, systolicBP: 0, diastolicBP: 0,
        respiratoryRate: 0, temperature: 36.5, etCO2: 8, cvp: 0, rhythm: 'vfib'
    },
    respiratory_failure: {
        heartRate: 110, spO2: 78, systolicBP: 140, diastolicBP: 90,
        respiratoryRate: 34, temperature: 37.2, etCO2: 65, cvp: 11, rhythm: 'nsr'
    },
    hemorrhage: {
        heartRate: 130, spO2: 92, systolicBP: 75, diastolicBP: 45,
        respiratoryRate: 26, temperature: 36.0, etCO2: 25, cvp: 1, rhythm: 'nsr'
    },
    anaphylaxis: {
        heartRate: 140, spO2: 85, systolicBP: 70, diastolicBP: 40,
        respiratoryRate: 30, temperature: 37.0, etCO2: 22, cvp: 2, rhythm: 'nsr'
    },
    pe: {
        heartRate: 120, spO2: 82, systolicBP: 90, diastolicBP: 60,
        respiratoryRate: 32, temperature: 37.3, etCO2: 18, cvp: 15, rhythm: 'nsr'
    }
};

function scenario(name) {
    const s = scenarios[name];
    if (!s) return;

    Object.assign(currentVitals, s);
    currentVitals.irregularity = s.irregularity || 0;

    // Sync all sliders
    document.getElementById('hrSlider').value = s.heartRate;
    document.getElementById('irregularitySlider').value = currentVitals.irregularity;
    document.getElementById('spo2Slider').value = s.spO2;
    document.getElementById('sysSlider').value = s.systolicBP;
    document.getElementById('diaSlider').value = s.diastolicBP;
    document.getElementById('rrSlider').value = s.respiratoryRate;
    document.getElementById('etco2Slider').value = s.etCO2;
    if (s.cvp !== undefined) document.getElementById('cvpSlider').value = s.cvp;
    document.getElementById('tempSlider').value = Math.round(s.temperature * 10);

    updateAllDisplays();
    updateRhythmButtons(s.rhythm);

    // Send rhythm change first, then vitals
    if (sessionCode) {
        connection.invoke("ChangeRhythm", sessionCode, s.rhythm);
    }
    sendVitals();
}

// Session management
async function createSession() {
    document.getElementById('setupError').textContent = '';
    try {
        await connection.invoke("CreateSession");
    } catch (err) {
        document.getElementById('setupError').textContent = 'Connection error: ' + err.message;
    }
}

async function joinExisting() {
    const code = document.getElementById('joinCodeInput').value.trim().toUpperCase();
    if (code.length < 4) {
        document.getElementById('setupError').textContent = 'Enter a valid session code';
        return;
    }
    document.getElementById('setupError').textContent = '';
    try {
        await connection.invoke("JoinSession", code);
    } catch (err) {
        document.getElementById('setupError').textContent = 'Connection error: ' + err.message;
    }
}

document.getElementById('joinCodeInput').addEventListener('keyup', (e) => {
    if (e.key === 'Enter') joinExisting();
});

// Copy monitor URL to clipboard (fallback for non-HTTPS)
function copyMonitorURL() {
    if (!sessionCode) return;
    const url = window.location.origin + '/monitor/?session=' + sessionCode;
    const btn = document.getElementById('copyBtn');
    const textarea = document.createElement('textarea');
    textarea.value = url;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand('copy');
    document.body.removeChild(textarea);
    btn.textContent = 'Copied!';
    setTimeout(() => { btn.textContent = 'Copy Monitor URL'; }, 2000);
}

// Pause/Resume monitor
function togglePause() {
    if (!sessionCode) return;
    isPaused = !isPaused;
    const btn = document.getElementById('pauseBtn');
    if (isPaused) {
        connection.invoke("PauseMonitor", sessionCode);
        btn.textContent = 'Resume';
        btn.classList.add('paused');
    } else {
        connection.invoke("ResumeMonitor", sessionCode);
        btn.textContent = 'Pause';
        btn.classList.remove('paused');
    }
}

// Auto-join if session code is in URL query string
function getSessionFromURL() {
    const params = new URLSearchParams(window.location.search);
    return params.get('session');
}

// Start connection
connection.start().then(() => {
    const code = getSessionFromURL();
    if (code) {
        connection.invoke("JoinSession", code.toUpperCase());
    }
}).catch(err => {
    console.error('SignalR error:', err);
    document.getElementById('setupError').textContent = 'Failed to connect to server';
});
