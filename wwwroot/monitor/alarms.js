// Student-set alarm limits.
//
// Each numeric reading carries a high/low limit pair the student configures by
// clicking the reading (a GE-style panel slides in). Breaches flash the reading
// and sound a tone until the value returns in range or the student silences
// it. Limits persist in this browser and are mirrored to the instructor via
// SignalR (monitor.js calls evaluateAlarms() every frame and sendAlarmStatus()
// on join).

const ALARM_CHANNELS = {
    hr:    { label: 'HR',    unit: 'bpm',  min: 0,  max: 300, step: 1,   def: { low: 50, high: 120 },  boxes: ['hrBox', 'hrMin'],     badges: ['hrRange', 'hrMinRange'] },
    sys:   { label: 'Sys',   unit: 'mmHg', min: 0,  max: 250, step: 1,   def: { low: 90, high: 160 },  boxes: ['abpBox', 'abpMin'],   badges: ['sysRange', 'sysMinRange'], title: 'ABP Systolic', prefix: 'Sys ' },
    cvp:   { label: 'CVP',   unit: 'mmHg', min: -5, max: 30,  step: 1,   def: { low: 0, high: 12 },    boxes: ['cvpBox', 'cvpMin'],   badges: ['cvpRange', 'cvpMinRange'] },
    icp:   { label: 'ICP',   unit: 'mmHg', min: 0,  max: 60,  step: 1,   def: { low: 0, high: 20 },    boxes: ['icpBox', 'icpMin'],   badges: ['icpRange', 'icpMinRange'] },
    spo2:  { label: 'SpO2',  unit: '%',    min: 30, max: 100, step: 1,   def: { low: 90, high: 100 },  boxes: ['spo2Box', 'spo2Min'], badges: ['spo2Range', 'spo2MinRange'] },
    rr:    { label: 'RR',    unit: '/min', min: 0,  max: 60,  step: 1,   def: { low: 8, high: 30 },    boxes: ['rrBox', 'rrMin'],     badges: ['rrRange', 'rrMinRange'] },
    etco2: { label: 'EtCO2', unit: 'mmHg', min: 0,  max: 100, step: 1,   def: { low: 30, high: 50 },   boxes: ['etco2Box'],           badges: ['etco2Range'] },
    temp:  { label: 'Temp',  unit: '°C', min: 30, max: 43, step: 0.1, def: { low: 36.0, high: 38.5 }, boxes: ['tempBox'],        badges: ['tempRange'] }
};

const ALARM_DELAY_MS = 2000;     // breach must persist this long before alarming
const ALARM_SILENCE_MS = 120000; // silence duration
const ALARM_STORAGE_KEY = 'edusim.alarmLimits';
const RANGE_SEP = ' ⌇ ';    // "⌇" as used on GE monitors

// ch -> { low, high, enabled }  (null bound = OFF)
const alarmLimits = {};
// ch -> { breachSince, active: null|'high'|'low', silencedUntil, lastLow, lastHigh }
const alarmState = {};
let alarmPanelChannel = null;
let alarmToneTimer = null;
let alarmSendTimer = null;
let alarmLastSentSig = '';
let alarmLatestValues = {};

// ---------------------------------------------------------------- persistence

function loadAlarmLimits() {
    let saved = {};
    try { saved = JSON.parse(localStorage.getItem(ALARM_STORAGE_KEY) || '{}') || {}; } catch (e) { saved = {}; }
    for (const ch in ALARM_CHANNELS) {
        const s = saved[ch] || {};
        alarmLimits[ch] = {
            low: (typeof s.low === 'number') ? s.low : null,
            high: (typeof s.high === 'number') ? s.high : null,
            enabled: (s.enabled !== false)
        };
        alarmState[ch] = { breachSince: null, active: null, silencedUntil: 0, lastLow: null, lastHigh: null };
    }
}

function saveAlarmLimits() {
    try { localStorage.setItem(ALARM_STORAGE_KEY, JSON.stringify(alarmLimits)); } catch (e) { /* ignore */ }
}

// ---------------------------------------------------------------- formatting

function fmtBound(ch, v) {
    if (v === null || v === undefined) return 'OFF';
    return ALARM_CHANNELS[ch].step < 1 ? v.toFixed(1) : String(Math.round(v));
}

function roundToStep(ch, v) {
    const step = ALARM_CHANNELS[ch].step;
    return Math.round(v / step) * step;
}

function clampBound(ch, v) {
    const c = ALARM_CHANNELS[ch];
    return roundToStep(ch, Math.max(c.min, Math.min(c.max, v)));
}

// ---------------------------------------------------------------- evaluation

// values: { hr, sys, cvp, icp, spo2, rr, etco2, temp } as displayed. Called
// every animation frame from updateNumerics().
function evaluateAlarms(values, now) {
    alarmLatestValues = values;
    let changed = false;
    for (const ch in ALARM_CHANNELS) {
        const lim = alarmLimits[ch];
        const st = alarmState[ch];
        const v = values[ch];
        let dir = null;
        if (lim.enabled && typeof v === 'number' && !isNaN(v)) {
            if (lim.high !== null && v > lim.high) dir = 'high';
            else if (lim.low !== null && v < lim.low) dir = 'low';
        }
        if (dir) {
            if (st.breachSince === null) st.breachSince = now;
            if (!st.active) {
                if (now - st.breachSince >= ALARM_DELAY_MS) { st.active = dir; changed = true; }
            } else if (st.active !== dir) {
                st.active = dir; changed = true;
            }
        } else {
            st.breachSince = null;
            if (st.active) { st.active = null; st.silencedUntil = 0; changed = true; }
        }
        if (st.silencedUntil && now >= st.silencedUntil) { st.silencedUntil = 0; changed = true; }
    }
    if (changed) {
        renderAlarmVisuals();
        updateAlarmAudio();
        sendAlarmStatus();
    }
    if (alarmPanelChannel) updateAlarmPanelLive();
}

function isSilenced(ch) {
    return alarmState[ch].silencedUntil > Date.now();
}

function anyAudibleAlarm() {
    for (const ch in ALARM_CHANNELS) {
        if (alarmState[ch].active && !isSilenced(ch)) return true;
    }
    return false;
}

// ---------------------------------------------------------------- visuals

function renderAlarmVisuals() {
    for (const ch in ALARM_CHANNELS) {
        const c = ALARM_CHANNELS[ch];
        const lim = alarmLimits[ch];
        const st = alarmState[ch];
        const silenced = st.active && isSilenced(ch);

        c.boxes.forEach(id => {
            const el = document.getElementById(id);
            if (!el) return;
            el.classList.toggle('alarm-breach', !!st.active);
            el.classList.toggle('alarm-silenced', !!silenced);
        });

        let html;
        let cls = 'badge';
        if (!lim.enabled) {
            html = 'ALARM OFF';
            cls += ' unset';
        } else {
            const lowCls = st.active === 'low' ? ' class="hit"' : '';
            const highCls = st.active === 'high' ? ' class="hit"' : '';
            html = (c.prefix || '') +
                '<span' + lowCls + '>' + fmtBound(ch, lim.low) + '</span>' + RANGE_SEP +
                '<span' + highCls + '>' + fmtBound(ch, lim.high) + '</span>';
            if (lim.low === null && lim.high === null) cls += ' unset';
        }
        if (silenced) html = '🔕 ' + html;
        c.badges.forEach(id => {
            const el = document.getElementById(id);
            if (!el) return;
            el.innerHTML = html;
            el.className = el.className.replace(/\b(unset)\b/g, '').trim();
            if (cls.includes('unset')) el.classList.add('unset');
        });
    }
}

// ---------------------------------------------------------------- audio

function playLimitAlarmTone() {
    if (typeof audioCtx === 'undefined' || !audioCtx) return;
    if (audioCtx.state === 'suspended') audioCtx.resume();
    // Two short beeps, distinct from the rhythm alarm's long square tone
    for (let i = 0; i < 2; i++) {
        const t0 = audioCtx.currentTime + i * 0.22;
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.frequency.value = 960;
        osc.type = 'triangle';
        gain.gain.setValueAtTime(0.0001, t0);
        gain.gain.exponentialRampToValueAtTime(0.12, t0 + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.15);
        osc.start(t0);
        osc.stop(t0 + 0.16);
    }
}

function updateAlarmAudio() {
    if (anyAudibleAlarm()) {
        if (!alarmToneTimer) {
            playLimitAlarmTone();
            alarmToneTimer = setInterval(() => {
                if (!anyAudibleAlarm()) { updateAlarmAudio(); return; }
                playLimitAlarmTone();
            }, 2000);
        }
    } else if (alarmToneTimer) {
        clearInterval(alarmToneTimer);
        alarmToneTimer = null;
    }
}

function silenceAlarm(ch) {
    alarmState[ch].silencedUntil = Date.now() + ALARM_SILENCE_MS;
    renderAlarmVisuals();
    updateAlarmAudio();
    sendAlarmStatus();
}

function unsilenceAlarm(ch) {
    alarmState[ch].silencedUntil = 0;
    renderAlarmVisuals();
    updateAlarmAudio();
    sendAlarmStatus();
}

// ---------------------------------------------------------------- instructor sync

function buildAlarmStatus() {
    const active = [];
    for (const ch in ALARM_CHANNELS) {
        const st = alarmState[ch];
        if (st.active) active.push({ channel: ch, direction: st.active, silenced: isSilenced(ch) });
    }
    return { limits: alarmLimits, active };
}

function sendAlarmStatus(force) {
    if (typeof connection === 'undefined' || typeof sessionCode === 'undefined' || !sessionCode) return;
    const status = buildAlarmStatus();
    const sig = JSON.stringify(status);
    if (!force && sig === alarmLastSentSig) return;
    alarmLastSentSig = sig;
    clearTimeout(alarmSendTimer);
    alarmSendTimer = setTimeout(() => {
        connection.invoke('UpdateAlarms', sessionCode, status).catch(err => console.warn('UpdateAlarms failed', err));
    }, 150);
}

// ---------------------------------------------------------------- limit editing

function setBound(ch, bound, value) {
    const lim = alarmLimits[ch];
    const st = alarmState[ch];
    if (value === null) {
        if (lim[bound] !== null) st[bound === 'low' ? 'lastLow' : 'lastHigh'] = lim[bound];
        lim[bound] = null;
    } else {
        let v = clampBound(ch, value);
        // keep low < high
        if (bound === 'low' && lim.high !== null && v >= lim.high) v = roundToStep(ch, lim.high - ALARM_CHANNELS[ch].step);
        if (bound === 'high' && lim.low !== null && v <= lim.low) v = roundToStep(ch, lim.low + ALARM_CHANNELS[ch].step);
        lim[bound] = clampBound(ch, v);
    }
    // A limit change re-evaluates from scratch (no stale breach timer)
    st.breachSince = null;
    saveAlarmLimits();
    renderAlarmVisuals();
    renderAlarmPanel();
    sendAlarmStatus();
}

function stepBound(ch, bound, dir) {
    const lim = alarmLimits[ch];
    const c = ALARM_CHANNELS[ch];
    if (lim[bound] === null) {
        // Turning a bound back on: restore previous, else a sensible default
        const st = alarmState[ch];
        const prev = bound === 'low' ? st.lastLow : st.lastHigh;
        setBound(ch, bound, prev !== null ? prev : c.def[bound]);
        return;
    }
    setBound(ch, bound, lim[bound] + dir * c.step);
}

// A focused number box is left alone by renderAlarmPanel() (the student may be
// typing), so buttons that change a bound release focus first.
function blurAlarmInputs() {
    const el = document.activeElement;
    if (el && el.classList && el.classList.contains('alarm-spinner-input')) el.blur();
}

function toggleBoundOff(bound) {
    const ch = alarmPanelChannel;
    if (!ch) return;
    blurAlarmInputs();
    if (alarmLimits[ch][bound] === null) stepBound(ch, bound, 0);
    else setBound(ch, bound, null);
}

function alarmInputChanged(bound) {
    const ch = alarmPanelChannel;
    if (!ch) return;
    const input = document.getElementById(bound === 'high' ? 'alarmHighInput' : 'alarmLowInput');
    const raw = input.value.trim();
    if (raw === '' || raw.toUpperCase() === 'OFF') { setBound(ch, bound, null); return; }
    const v = parseFloat(raw);
    if (isNaN(v)) { renderAlarmPanel(); return; }
    setBound(ch, bound, v);
}

function setAlarmEnabled(enabled) {
    const ch = alarmPanelChannel;
    if (!ch) return;
    const lim = alarmLimits[ch];
    if (lim.enabled === enabled) return;
    lim.enabled = enabled;
    if (!lim.enabled) {
        const st = alarmState[ch];
        st.active = null; st.breachSince = null; st.silencedUntil = 0;
    }
    saveAlarmLimits();
    renderAlarmVisuals();
    renderAlarmPanel();
    updateAlarmAudio();
    sendAlarmStatus();
}

function silenceCurrent() {
    const ch = alarmPanelChannel;
    if (!ch) return;
    if (isSilenced(ch)) unsilenceAlarm(ch); else silenceAlarm(ch);
    renderAlarmPanel();
}

// ---------------------------------------------------------------- panel

function openAlarmPanel(ch) {
    if (!ALARM_CHANNELS[ch]) return;
    alarmPanelChannel = ch;
    const panel = document.getElementById('alarmPanel');
    panel.classList.add('open');
    renderAlarmPanel();
}

function closeAlarmPanel() {
    alarmPanelChannel = null;
    document.getElementById('alarmPanel').classList.remove('open');
}

function renderAlarmPanel() {
    const ch = alarmPanelChannel;
    if (!ch) return;
    const c = ALARM_CHANNELS[ch];
    const lim = alarmLimits[ch];

    document.getElementById('alarmPanelTitle').textContent = c.title || c.label;
    document.getElementById('alarmBarMax').textContent = fmtBound(ch, c.max);
    document.getElementById('alarmBarMin').textContent = fmtBound(ch, c.min);
    document.getElementById('alarmBarUnit').textContent = c.unit;

    ['high', 'low'].forEach(bound => {
        const input = document.getElementById(bound === 'high' ? 'alarmHighInput' : 'alarmLowInput');
        const offBtn = document.getElementById(bound === 'high' ? 'alarmHighOff' : 'alarmLowOff');
        const spinner = document.getElementById(bound === 'high' ? 'alarmSpinnerHigh' : 'alarmSpinnerLow');
        input.step = c.step;
        input.min = c.min;
        input.max = c.max;
        if (lim[bound] === null) {
            input.value = '';
            offBtn.textContent = 'Switch ' + bound + ' limit on';
            offBtn.classList.add('active');
            spinner.classList.add('is-off');
        } else {
            if (document.activeElement !== input) input.value = fmtBound(ch, lim[bound]);
            offBtn.textContent = 'Switch ' + bound + ' limit off';
            offBtn.classList.remove('active');
            spinner.classList.remove('is-off');
        }
    });

    const panel = document.getElementById('alarmPanel');
    panel.classList.toggle('disabled', !lim.enabled);
    document.getElementById('alarmEnableOn').classList.toggle('active', lim.enabled);
    document.getElementById('alarmEnableOff').classList.toggle('active', !lim.enabled);

    updateAlarmPanelLive();
}

// Cheap per-frame refresh: current-value marker, range shading, silence countdown
function updateAlarmPanelLive() {
    const ch = alarmPanelChannel;
    if (!ch) return;
    const c = ALARM_CHANNELS[ch];
    const lim = alarmLimits[ch];
    const st = alarmState[ch];
    const span = c.max - c.min;
    const pct = v => Math.max(0, Math.min(100, (v - c.min) / span * 100));

    const range = document.getElementById('alarmBarRange');
    const hi = lim.high !== null ? lim.high : c.max;
    const lo = lim.low !== null ? lim.low : c.min;
    range.style.top = (100 - pct(hi)) + '%';
    range.style.height = Math.max(0, pct(hi) - pct(lo)) + '%';
    range.style.display = lim.enabled ? '' : 'none';

    const cur = document.getElementById('alarmBarCurrent');
    const v = alarmLatestValues[ch];
    if (typeof v === 'number' && !isNaN(v)) {
        cur.style.display = '';
        cur.style.top = (100 - pct(v)) + '%';
        cur.setAttribute('data-value', fmtBound(ch, v));
        cur.classList.toggle('breach', !!st.active);
    } else {
        cur.style.display = 'none';
    }

    const silenceBtn = document.getElementById('alarmSilenceBtn');
    if (isSilenced(ch)) {
        const s = Math.max(0, Math.ceil((st.silencedUntil - Date.now()) / 1000));
        silenceBtn.textContent = 'Silenced ' + Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
        silenceBtn.classList.add('active');
        silenceBtn.disabled = false;
    } else {
        silenceBtn.textContent = 'Silence 2 min';
        silenceBtn.classList.remove('active');
        silenceBtn.disabled = !st.active;
    }
}

// ---------------------------------------------------------------- wiring

function initAlarms() {
    loadAlarmLimits();
    renderAlarmVisuals();

    // Click a reading: silence it if alarming, and open its limits panel
    document.querySelectorAll('[data-alarm]').forEach(el => {
        el.addEventListener('click', (e) => {
            e.stopPropagation();
            const ch = el.getAttribute('data-alarm');
            if (alarmState[ch].active && !isSilenced(ch)) silenceAlarm(ch);
            openAlarmPanel(ch);
        });
    });

    const panel = document.getElementById('alarmPanel');
    panel.addEventListener('click', e => e.stopPropagation());
    panel.addEventListener('dblclick', e => e.stopPropagation());
    document.addEventListener('click', () => { if (alarmPanelChannel) closeAlarmPanel(); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && alarmPanelChannel) closeAlarmPanel(); });

    // Spinner arrows: click steps once, press-and-hold auto-repeats
    panel.querySelectorAll('.alarm-spinner-btns button').forEach(btn => {
        const bound = btn.dataset.bound;
        const dir = parseInt(btn.dataset.dir, 10);
        let holdTimer = null, repeatTimer = null;
        const stop = () => { clearTimeout(holdTimer); clearInterval(repeatTimer); holdTimer = repeatTimer = null; };
        btn.addEventListener('pointerdown', (e) => {
            e.preventDefault();
            if (!alarmPanelChannel) return;
            blurAlarmInputs();
            stepBound(alarmPanelChannel, bound, dir);
            holdTimer = setTimeout(() => {
                repeatTimer = setInterval(() => stepBound(alarmPanelChannel, bound, dir), 70);
            }, 450);
        });
        ['pointerup', 'pointerleave', 'pointercancel'].forEach(ev => btn.addEventListener(ev, stop));
    });
}

document.addEventListener('DOMContentLoaded', initAlarms);
