// Student-set alarm limits.
//
// Each numeric reading is a "group" with one or more alarm channels (ABP has
// three: Sys, Dia, MAP; everything else has one). Clicking a reading slides in
// a GE-style panel with one column per channel: high/low limits, a scale bar
// with the live value, and an Alarm On/Off switch. Breaches flash the reading
// and sound a tone until the value returns in range or the student silences
// it. Limits persist in this browser and are mirrored to the instructor via
// SignalR (monitor.js calls evaluateAlarms() every frame and sendAlarmStatus()
// on join).

const ALARM_CHANNELS = {
    hr:    { group: 'hr',    label: 'HR',    unit: 'bpm',    min: 0,  max: 300, step: 1,   def: { low: 50, high: 120 } },
    sys:   { group: 'abp',   label: 'Sys',   unit: 'mmHg',   min: 0,  max: 250, step: 1,   def: { low: 90, high: 160 } },
    dia:   { group: 'abp',   label: 'Dia',   unit: 'mmHg',   min: 0,  max: 150, step: 1,   def: { low: 50, high: 100 } },
    map:   { group: 'abp',   label: 'MAP',   unit: 'mmHg',   min: 0,  max: 200, step: 1,   def: { low: 65, high: 110 } },
    cvp:   { group: 'cvp',   label: 'CVP',   unit: 'mmHg',   min: -5, max: 30,  step: 1,   def: { low: 0, high: 12 } },
    icp:   { group: 'icp',   label: 'ICP',   unit: 'mmHg',   min: 0,  max: 60,  step: 1,   def: { low: 0, high: 20 } },
    spo2:  { group: 'spo2',  label: 'SpO2',  unit: '%',      min: 30, max: 100, step: 1,   def: { low: 90, high: 100 } },
    rr:    { group: 'rr',    label: 'RR',    unit: '/min',   min: 0,  max: 60,  step: 1,   def: { low: 8, high: 30 } },
    etco2: { group: 'etco2', label: 'EtCO2', unit: 'mmHg',   min: 0,  max: 100, step: 1,   def: { low: 30, high: 50 } },
    temp:  { group: 'temp',  label: 'Temp',  unit: '°C', min: 30, max: 43,  step: 0.1, def: { low: 36.0, high: 38.5 } }
};

// A group is one clickable reading: its channels, the elements that flash on a
// breach (boxes) and the elements that show the range text (badges).
const ALARM_GROUPS = {
    hr:    { title: 'HR',   channels: ['hr'],                boxes: ['hrBox', 'hrMin'],     badges: ['hrRange', 'hrMinRange'] },
    abp:   { title: 'ABP',  channels: ['sys', 'dia', 'map'], boxes: ['abpBox', 'abpMin'],   badges: ['abpRange', 'abpMinRange'] },
    cvp:   { title: 'CVP',  channels: ['cvp'],               boxes: ['cvpBox', 'cvpMin'],   badges: ['cvpRange', 'cvpMinRange'] },
    icp:   { title: 'ICP',  channels: ['icp'],               boxes: ['icpBox', 'icpMin'],   badges: ['icpRange', 'icpMinRange'] },
    spo2:  { title: 'SpO2', channels: ['spo2'],              boxes: ['spo2Box', 'spo2Min'], badges: ['spo2Range', 'spo2MinRange'] },
    rr:    { title: 'RR',   channels: ['rr'],                boxes: ['rrBox', 'rrMin'],     badges: ['rrRange', 'rrMinRange'] },
    etco2: { title: 'EtCO2', channels: ['etco2'],            boxes: ['etco2Box'],           badges: ['etco2Range'] },
    temp:  { title: 'Temp', channels: ['temp'],              boxes: ['tempBox'],            badges: ['tempRange'] }
};

const ALARM_DELAY_MS = 2000;     // breach must persist this long before alarming
const ALARM_SILENCE_MS = 120000; // silence duration
const ALARM_STORAGE_KEY = 'edusim.alarmLimits';
const RANGE_SEP = ' ⌇ ';    // "⌇" as used on GE monitors

// ch -> { low, high, enabled }  (null bound = OFF)
const alarmLimits = {};
// ch -> { breachSince, active: null|'high'|'low', silencedUntil, lastLow, lastHigh }
const alarmState = {};
let alarmPanelGroup = null;
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

// values: { hr, sys, dia, map, cvp, icp, spo2, rr, etco2, temp } as displayed.
// Called every animation frame from updateNumerics().
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
    if (alarmPanelGroup) updateAlarmPanelLive();
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

// Channels in a group that are currently alarming
function activeInGroup(group) {
    return ALARM_GROUPS[group].channels.filter(ch => alarmState[ch].active);
}

// ---------------------------------------------------------------- visuals

// Range text for one channel, e.g. "Sys 90 ⌇ 160" (label optional)
function channelRangeHtml(ch, withLabel) {
    const lim = alarmLimits[ch];
    const st = alarmState[ch];
    const label = withLabel ? ALARM_CHANNELS[ch].label + ' ' : '';
    let html;
    if (channelIsOff(ch)) {
        // Off (switched off, or no limits set): "ALARM OFF" alone, or
        // "Sys OFF" when several channels share one badge
        html = withLabel ? label + 'OFF' : 'ALARM OFF';
    } else {
        const lowCls = st.active === 'low' ? ' class="hit"' : '';
        const highCls = st.active === 'high' ? ' class="hit"' : '';
        html = label +
            '<span' + lowCls + '>' + fmtBound(ch, lim.low) + '</span>' + RANGE_SEP +
            '<span' + highCls + '>' + fmtBound(ch, lim.high) + '</span>';
    }
    if (st.active && isSilenced(ch)) html = '🔕 ' + html;
    return html;
}

// A channel with its alarm switched off, or with no limits set, is "off"
function channelIsOff(ch) {
    const lim = alarmLimits[ch];
    return !lim.enabled || (lim.low === null && lim.high === null);
}

function renderAlarmVisuals() {
    for (const g in ALARM_GROUPS) {
        const grp = ALARM_GROUPS[g];
        const active = activeInGroup(g);
        const allSilenced = active.length > 0 && active.every(ch => isSilenced(ch));

        grp.boxes.forEach(id => {
            const el = document.getElementById(id);
            if (!el) return;
            el.classList.toggle('alarm-breach', active.length > 0);
            el.classList.toggle('alarm-silenced', allSilenced);
        });

        const multi = grp.channels.length > 1;
        const unset = grp.channels.every(channelIsOff);
        const parts = grp.channels.map(ch => channelRangeHtml(ch, multi));
        // Main badge (in the numeric box): first channel on its own line, the
        // rest smaller beneath. Bottom-bar badge: everything on one line. A
        // multi-channel reading with everything off collapses to "ALARM OFF".
        let mainHtml, minHtml;
        if (!multi || unset) {
            mainHtml = minHtml = unset ? 'ALARM OFF' : parts[0];
        } else {
            mainHtml = '<div>' + parts[0] + '</div><div class="sub">' + parts.slice(1).join(' · ') + '</div>';
            minHtml = parts.join(' · ');
        }

        grp.badges.forEach((id, i) => {
            const el = document.getElementById(id);
            if (!el) return;
            el.innerHTML = (i === 0) ? mainHtml : minHtml;
            el.classList.toggle('unset', unset);
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

function silenceChannels(chs, silence) {
    chs.forEach(ch => { alarmState[ch].silencedUntil = silence ? Date.now() + ALARM_SILENCE_MS : 0; });
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

function toggleBoundOff(ch, bound) {
    blurAlarmInputs();
    if (alarmLimits[ch][bound] === null) stepBound(ch, bound, 0);
    else setBound(ch, bound, null);
}

function alarmInputChanged(ch, bound) {
    const input = document.getElementById('alarmInput-' + bound + '-' + ch);
    if (!input) return;
    const raw = input.value.trim();
    if (raw === '' || raw.toUpperCase() === 'OFF') { setBound(ch, bound, null); return; }
    const v = parseFloat(raw);
    if (isNaN(v)) { renderAlarmPanel(); return; }
    setBound(ch, bound, v);
}

function setAlarmEnabled(ch, enabled) {
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

// Silence button: silences every alarming channel in the open group, or
// cancels the silence if they are all already silenced.
function silenceCurrent() {
    if (!alarmPanelGroup) return;
    const active = activeInGroup(alarmPanelGroup);
    if (!active.length) return;
    const allSilenced = active.every(ch => isSilenced(ch));
    silenceChannels(active, !allSilenced);
    renderAlarmPanel();
}

// ---------------------------------------------------------------- panel

function openAlarmPanel(group) {
    if (!ALARM_GROUPS[group]) return;
    alarmPanelGroup = group;
    buildAlarmPanel(group);
    const panel = document.getElementById('alarmPanel');
    panel.classList.remove('cols-1', 'cols-2', 'cols-3');
    panel.classList.add('cols-' + ALARM_GROUPS[group].channels.length);
    panel.classList.add('open');
    renderAlarmPanel();
}

function closeAlarmPanel() {
    alarmPanelGroup = null;
    document.getElementById('alarmPanel').classList.remove('open');
}

function spinnerHtml(ch, bound) {
    const cap = bound === 'high' ? 'High' : 'Low';
    return '<div class="alarm-spinner" id="alarmSpinner-' + bound + '-' + ch + '">' +
        '<div class="alarm-spinner-label">' + cap + '</div>' +
        '<input type="number" id="alarmInput-' + bound + '-' + ch + '" class="alarm-spinner-input" placeholder="OFF" ' +
            'onchange="alarmInputChanged(\'' + ch + '\',\'' + bound + '\')" onkeydown="if(event.key===\'Enter\')this.blur()">' +
        '<div class="alarm-spinner-btns">' +
            '<button data-ch="' + ch + '" data-bound="' + bound + '" data-dir="1" aria-label="Raise ' + bound + ' limit">&#9650;</button>' +
            '<button data-ch="' + ch + '" data-bound="' + bound + '" data-dir="-1" aria-label="Lower ' + bound + ' limit">&#9660;</button>' +
        '</div>' +
        '<button class="alarm-off-btn" id="alarmOff-' + bound + '-' + ch + '" onclick="toggleBoundOff(\'' + ch + '\',\'' + bound + '\')"></button>' +
        '</div>';
}

// One column per channel; the same layout is repeated for multi-channel groups
function buildAlarmPanel(group) {
    const grp = ALARM_GROUPS[group];
    const multi = grp.channels.length > 1;
    document.getElementById('alarmPanelTitle').textContent = grp.title;
    document.getElementById('alarmPanelBody').innerHTML = grp.channels.map(ch => {
        const c = ALARM_CHANNELS[ch];
        return '<div class="alarm-col" id="alarmCol-' + ch + '">' +
            (multi ? '<div class="alarm-col-title">' + c.label + '</div>' : '') +
            '<div class="alarm-col-main">' +
                '<div class="alarm-spinners">' + spinnerHtml(ch, 'high') + spinnerHtml(ch, 'low') + '</div>' +
                '<div class="alarm-bar-wrap">' +
                    '<div class="alarm-bar-scale">' + fmtBound(ch, c.max) + '</div>' +
                    '<div class="alarm-bar">' +
                        '<div class="alarm-bar-range" id="alarmBarRange-' + ch + '"></div>' +
                        '<div class="alarm-bar-current" id="alarmBarCurrent-' + ch + '"></div>' +
                    '</div>' +
                    '<div class="alarm-bar-scale">' + fmtBound(ch, c.min) + '</div>' +
                    '<div class="alarm-bar-unit">' + c.unit + '</div>' +
                '</div>' +
            '</div>' +
            '<div class="alarm-enable-group">' +
                '<span class="alarm-enable-label">Alarm</span>' +
                '<button id="alarmEnableOn-' + ch + '" class="alarm-enable-btn" onclick="setAlarmEnabled(\'' + ch + '\',true)">On</button>' +
                '<button id="alarmEnableOff-' + ch + '" class="alarm-enable-btn" onclick="setAlarmEnabled(\'' + ch + '\',false)">Off</button>' +
            '</div>' +
        '</div>';
    }).join('');
}

function renderAlarmPanel() {
    if (!alarmPanelGroup) return;
    ALARM_GROUPS[alarmPanelGroup].channels.forEach(ch => {
        const c = ALARM_CHANNELS[ch];
        const lim = alarmLimits[ch];
        ['high', 'low'].forEach(bound => {
            const input = document.getElementById('alarmInput-' + bound + '-' + ch);
            const offBtn = document.getElementById('alarmOff-' + bound + '-' + ch);
            const spinner = document.getElementById('alarmSpinner-' + bound + '-' + ch);
            if (!input) return;
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
        document.getElementById('alarmCol-' + ch).classList.toggle('disabled', !lim.enabled);
        document.getElementById('alarmEnableOn-' + ch).classList.toggle('active', lim.enabled);
        document.getElementById('alarmEnableOff-' + ch).classList.toggle('active', !lim.enabled);
    });
    updateAlarmPanelLive();
}

// Cheap per-frame refresh: current-value markers, range shading, silence countdown
function updateAlarmPanelLive() {
    if (!alarmPanelGroup) return;
    const chs = ALARM_GROUPS[alarmPanelGroup].channels;
    chs.forEach(ch => {
        const c = ALARM_CHANNELS[ch];
        const lim = alarmLimits[ch];
        const st = alarmState[ch];
        const span = c.max - c.min;
        const pct = v => Math.max(0, Math.min(100, (v - c.min) / span * 100));

        const range = document.getElementById('alarmBarRange-' + ch);
        const cur = document.getElementById('alarmBarCurrent-' + ch);
        if (!range || !cur) return;
        const hi = lim.high !== null ? lim.high : c.max;
        const lo = lim.low !== null ? lim.low : c.min;
        range.style.top = (100 - pct(hi)) + '%';
        range.style.height = Math.max(0, pct(hi) - pct(lo)) + '%';
        range.style.display = lim.enabled ? '' : 'none';

        const v = alarmLatestValues[ch];
        if (typeof v === 'number' && !isNaN(v)) {
            cur.style.display = '';
            cur.style.top = (100 - pct(v)) + '%';
            cur.setAttribute('data-value', fmtBound(ch, v));
            cur.classList.toggle('breach', !!st.active);
        } else {
            cur.style.display = 'none';
        }
    });

    const silenceBtn = document.getElementById('alarmSilenceBtn');
    const active = chs.filter(ch => alarmState[ch].active);
    const silenced = active.filter(ch => isSilenced(ch));
    if (active.length && silenced.length === active.length) {
        const until = Math.min(...silenced.map(ch => alarmState[ch].silencedUntil));
        const s = Math.max(0, Math.ceil((until - Date.now()) / 1000));
        silenceBtn.textContent = 'Silenced ' + Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
        silenceBtn.classList.add('active');
        silenceBtn.disabled = false;
    } else {
        silenceBtn.textContent = 'Silence 2 min';
        silenceBtn.classList.remove('active');
        silenceBtn.disabled = active.length === 0;
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
            const group = el.getAttribute('data-alarm');
            const audible = activeInGroup(group).filter(ch => !isSilenced(ch));
            if (audible.length) silenceChannels(audible, true);
            openAlarmPanel(group);
        });
    });

    const panel = document.getElementById('alarmPanel');
    panel.addEventListener('click', e => e.stopPropagation());
    panel.addEventListener('dblclick', e => e.stopPropagation());
    document.addEventListener('click', () => { if (alarmPanelGroup) closeAlarmPanel(); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && alarmPanelGroup) closeAlarmPanel(); });

    // Spinner arrows (delegated, since columns are built per group): click
    // steps once, press-and-hold auto-repeats.
    let holdTimer = null, repeatTimer = null;
    const stopRepeat = () => { clearTimeout(holdTimer); clearInterval(repeatTimer); holdTimer = repeatTimer = null; };
    document.getElementById('alarmPanelBody').addEventListener('pointerdown', (e) => {
        const btn = e.target.closest && e.target.closest('.alarm-spinner-btns button');
        if (!btn) return;
        e.preventDefault();
        stopRepeat();
        const ch = btn.dataset.ch, bound = btn.dataset.bound, dir = parseInt(btn.dataset.dir, 10);
        blurAlarmInputs();
        stepBound(ch, bound, dir);
        holdTimer = setTimeout(() => {
            repeatTimer = setInterval(() => stepBound(ch, bound, dir), 70);
        }, 450);
    });
    ['pointerup', 'pointercancel'].forEach(ev => document.addEventListener(ev, stopRepeat));
    document.getElementById('alarmPanelBody').addEventListener('pointerleave', stopRepeat);
}

document.addEventListener('DOMContentLoaded', initAlarms);
