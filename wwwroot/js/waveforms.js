// Waveform generation for patient vital signs monitor
// ECG uses absolute time (seconds) so the PQRST complex shape stays
// constant regardless of heart rate. Only the baseline gap between
// beats shrinks as HR increases. At very high rates (180+) the T wave
// of one beat merges with the P wave of the next.

const Waveforms = {
    // Generate a single ECG sample given time in seconds within the beat
    // PQRST morphology: P (up), Q (down), R (tall up), S (down), T (up)
    // Only 3 prominently visible upward deflections: P, R, T
    // U wave present but nearly invisible (kept for future scenario use)
    ecgNormal(t) {
        // P wave - small rounded upward bump (~60ms)
        let val = 0.12 * Math.exp(-Math.pow((t - 0.06) / 0.025, 2));
        // Q wave - downward deflection before R
        val -= 0.18 * Math.exp(-Math.pow((t - 0.135) / 0.008, 2));
        // R wave - tall sharp upward spike
        val += 0.85 * Math.exp(-Math.pow((t - 0.16) / 0.012, 2));
        // S wave - downward deflection after R
        val -= 0.25 * Math.exp(-Math.pow((t - 0.185) / 0.008, 2));
        // T wave - medium rounded upward bump (~280ms)
        val += 0.18 * Math.exp(-Math.pow((t - 0.28) / 0.04, 2));
        // U wave - barely visible, kept for future scenario use
        val += 0.005 * Math.exp(-Math.pow((t - 0.38) / 0.025, 2));
        return val;
    },

    // Atrial fibrillation: no P waves, fibrillatory baseline, fixed-duration QRS+T
    ecgAFib(t, globalTime) {
        let val = 0;
        // Fibrillatory baseline instead of P wave
        val += 0.03 * Math.sin(globalTime * 25) + 0.02 * Math.sin(globalTime * 37);
        // QRS complex
        val -= 0.18 * Math.exp(-Math.pow((t - 0.135) / 0.008, 2));
        val += 0.85 * Math.exp(-Math.pow((t - 0.16) / 0.012, 2));
        val -= 0.25 * Math.exp(-Math.pow((t - 0.185) / 0.008, 2));
        // T wave
        val += 0.15 * Math.exp(-Math.pow((t - 0.28) / 0.04, 2));
        return val;
    },

    // Ventricular tachycardia: no P wave, short R, deep wide S merged with peaked T
    // Rate is forced to 220+ bpm (beat duration ~0.27s), complex fills entire beat
    ecgVTach(t) {
        let val = 0;
        // Short R wave - small upward deflection
        val += 0.3 * Math.exp(-Math.pow((t - 0.03) / 0.015, 2));
        // Deep wide S wave - large downward deflection
        val -= 0.85 * Math.exp(-Math.pow((t - 0.10) / 0.04, 2));
        // Peaked T wave merging with S recovery
        val += 0.35 * Math.exp(-Math.pow((t - 0.19) / 0.03, 2));
        return val;
    },

    // Ventricular fibrillation: chaotic (time-based, no beat structure)
    ecgVFib(time) {
        return 0.3 * Math.sin(time * 15.7) * Math.sin(time * 3.1)
             + 0.15 * Math.sin(time * 23.3)
             + 0.1 * Math.cos(time * 7.9);
    },

    // Asystole: flatline with slight drift
    ecgAsystole(time) {
        return 0.005 * Math.sin(time * 0.5);
    },

    // SpO2 plethysmography waveform (phase-based, scales with HR)
    // SpO2 plethysmography: smooth single peak, fast rise, slow decay
    // Uses beta-curve shape: naturally rounded peak, starts and ends at 0
    // Dicrotic notch kept but nearly invisible (for future scenario use)
    spo2Pleth(phase) {
        // Beta-like curve: phase^a * (1-phase)^b, normalized to peak at 1.0
        const a = 2.0, b = 4.0;
        const raw = Math.pow(phase, a) * Math.pow(1 - phase, b);
        const peakPhase = a / (a + b);
        const peakVal = Math.pow(peakPhase, a) * Math.pow(1 - peakPhase, b);
        const val = raw / peakVal;
        // Subtle dicrotic notch on the decay (kept for future scenario use)
        const notch = 0.015 * Math.exp(-Math.pow((phase - 0.55) / 0.04, 2));
        return val + notch;
    },

    // Arterial blood pressure waveform — two-wave model
    // Based on nurse's decomposition: the ABP waveform is the sum of
    // two independent waves whose peak separation varies with vascular tone:
    //   Wave 1 (systolic ejection): steep rise, moderate fall
    //   Wave 2 (reflected/dicrotic): smaller wave that MOVES relative to wave 1
    // Close together (vasoconstriction) → waves merge → broad peak, notch at top
    // Moderate gap (normal) → visible dip between → classic dicrotic notch
    // Far apart (vasodilation) → sharp peak, tiny bump near baseline
    abpWaveform(phase, systolic, diastolic) {
        const range = systolic - diastolic;
        const pp = Math.max(range, 1);
        const ppRatio = pp / 40;

        // Vascular tone from diastolic (SVR indicator):
        // Positive vascTone = vasodilation (low diastolic)
        // Negative vascTone = vasoconstriction (high diastolic)
        const vascTone = Math.max(-1, Math.min(1, (80 - diastolic) / 40));

        // Wave 1: systolic ejection wave (steep rise, fixed descent width)
        // w1Right is constant — ejection time doesn't change with vascular tone;
        // the "sustained pressure" in vasoconstriction comes from wave2 (reflected)
        const c1 = 0.28;
        const w1Right = 0.10;
        const w1 = phase < c1 ? 0.04 : w1Right;
        const wave1 = Math.exp(-Math.pow((phase - c1) / w1, 2));

        // Wave 2: reflected/dicrotic wave (Wang et al., PLOS ONE 2014)
        // Separation scales gently; amplitude scales asymmetrically —
        // grows steeply in vasoconstriction (high SVR → large reflected wave
        // → "high dicrotic notch"), shrinks gently in vasodilation.
        const separation = 0.22 + vascTone * 0.06;
        const c2 = c1 + separation;
        const w2 = 0.07;
        const vcBoost = Math.max(0, -vascTone);
        const vdReduce = Math.max(0, vascTone);
        const amp2 = 0.22 * (1 + 1.2 * vcBoost - 0.5 * vdReduce);
        const wave2 = amp2 * Math.exp(-Math.pow((phase - c2) / w2, 2));

        // Dicrotic notch — aortic valve closure creates a brief dip
        // between the two wave peaks; slides with their separation
        const notchCenter = c1 + separation * 0.55;
        const notchWidth = 0.03;
        const notchAmp = 0.08;
        const notch = notchAmp * Math.exp(-Math.pow((phase - notchCenter) / notchWidth, 2));

        // Diastolic base — scales inversely with PP (faster runoff at wide PP)
        const g3Amp = 0.15 / Math.max(ppRatio, 0.75);
        const g3 = g3Amp * Math.exp(-Math.pow((phase - 0.48) / 0.22, 2));

        const shape = (wave1 + wave2 - notch + g3) / 1.08;
        const val = diastolic + range * shape;
        return (val - diastolic + 10) / (range + 20);
    },

    // Central venous pressure (CVP) complex — deviations around the mean.
    // Locked to the cardiac electrical cycle like the ECG (function of
    // absolute time-in-beat in seconds), so each wave tracks its ECG event:
    //   a wave  — atrial contraction,  follows the P wave  (~0.06s)
    //   c wave  — tricuspid bulge,     follows the QRS      (~0.16s)
    //   x descent — systolic RA descent + atrial relaxation (trough)
    //   v wave  — RA filling vs closed tricuspid, follows the T wave (~0.28s)
    //   y descent — tricuspid opens, RA empties (shallower trough)
    // a is the tallest peak; x is the deepest trough (ref: derangedphysiology).
    // aScale: 0 = absent a wave (AFib), 1 = normal, >1 = cannon a wave.
    cvpComplex(t, aScale) {
        let v = 0;
        v += aScale * 0.22 * Math.exp(-Math.pow((t - 0.11) / 0.040, 2)); // a wave
        v += 0.12 * Math.exp(-Math.pow((t - 0.21) / 0.032, 2));          // c wave
        v -= 0.16 * Math.exp(-Math.pow((t - 0.32) / 0.050, 2));          // x descent
        v += 0.15 * Math.exp(-Math.pow((t - 0.44) / 0.050, 2));          // v wave
        v -= 0.12 * Math.exp(-Math.pow((t - 0.55) / 0.045, 2));          // y descent
        return v;
    },

    // Intracranial pressure (ICP) pulse — one complex per heartbeat (it is the
    // arterial pulse transmitted into the skull), built on absolute beat-time
    // like CVP. Three overlapping peaks ride on the systolic upstroke:
    //   P1 percussion (arterial pulsation) ~0.20s
    //   P2 tidal (brain compliance)        ~0.33s
    //   P3 dicrotic (aortic valve closure) ~0.46s
    // Normal: P1>P2>P3 (descending staircase). As compliance falls P2 rises
    // above P1 and the peaks merge into a rounded wave. p1/p2/p3 are 0..1.
    icpComplex(t, p1, p2, p3) {
        if (t < 0.02 || t > 0.95) return 0;
        let v = 0;
        v += p1 * Math.exp(-Math.pow((t - 0.20) / 0.055, 2)); // P1 percussion
        v += p2 * Math.exp(-Math.pow((t - 0.33) / 0.060, 2)); // P2 tidal
        v += p3 * Math.exp(-Math.pow((t - 0.46) / 0.060, 2)); // P3 dicrotic
        return v;
    },

    // Capnography (EtCO2) waveform (phase-based, scales with RR)
    // Normal capnogram: I:E ratio ~1:2 (35% inspiration, 65% expiration)
    // Phase I: inspiratory baseline, Phase II: expiratory upstroke,
    // Phase III: alveolar plateau, Phase 0: inspiratory downstroke
    capnography(phase) {
        if (phase < 0.40) {
            // Inspiration — flat baseline (synced: RR is rising 0–0.4)
            return 0;
        } else if (phase < 0.52) {
            // Phase II: Expiratory upstroke (S-curve, starts when RR falls)
            const t = (phase - 0.40) / 0.12;
            return 0.90 * 0.5 * (1 - Math.cos(t * Math.PI));
        } else if (phase < 0.90) {
            // Phase III: Alveolar plateau (gentle upslope to EtCO2)
            const t = (phase - 0.52) / 0.38;
            return 0.90 + 0.10 * t;
        } else if (phase < 0.95) {
            // Inspiratory downstroke (steep S-curve, just before next breath)
            const t = (phase - 0.90) / 0.05;
            return 1.0 * 0.5 * (1 + Math.cos(t * Math.PI));
        } else {
            // Brief baseline before next inspiration
            return 0;
        }
    },

    // Respiration waveform (phase-based, scales with RR)
    // Slightly asymmetric: faster inspiration, slower expiration
    respiration(phase) {
        if (phase < 0.4) {
            // Inspiration (rise) — 40% of cycle
            const t = phase / 0.4;
            return 0.5 * (1 - Math.cos(t * Math.PI));
        } else {
            // Expiration (fall) — 60% of cycle
            const t = (phase - 0.4) / 0.6;
            return 0.5 * (1 + Math.cos(t * Math.PI));
        }
    }
};

// ECG rhythm dispatcher
// Uses absolute time (seconds) for ECG waveforms so PQRST shape is constant.
// Uses normalized phase (0..1) for SpO2/ABP which correctly scale with HR.
class ECGGenerator {
    constructor() {
        this.rhythm = 'nsr';
        this.heartRate = 72;
        this.time = 0;
        this.currentBeatDuration = 60.0 / this.heartRate;
        this.beatElapsed = 0;
        this.vtachBaseHR = 290;
        // Track previous R-R interval for Frank-Starling BP variation
        this.prevBeatDuration = this.currentBeatDuration;
        this.beatJustStarted = false;
        // Smoothed BP factor (avoids abrupt jumps at beat boundaries)
        this.currentSysFactor = 1.0;
        // Irregularity: 0–50, percentage of R-R variation
        this.irregularity = 0;
        // Independent atrial clock for CVP — in V-Tach the atria depolarise
        // independently of the ventricles (AV dissociation), producing
        // intermittent giant "cannon" a waves.
        this.atrialElapsed = 0;
        this.atrialDuration = 60.0 / 75;
    }

    setRhythm(rhythm) {
        if (rhythm === 'vtach' && this.rhythm !== 'vtach') {
            // Pick a base HR between 280-300 when V-Tach starts
            this.vtachBaseHR = 280 + Math.random() * 20;
        }
        this.rhythm = rhythm;
    }

    setHeartRate(hr) {
        this.heartRate = hr;
    }

    setIrregularity(pct) {
        this.irregularity = pct;
    }

    nextSample(dt) {
        this.time += dt;
        this.beatElapsed += dt;

        // Advance the independent atrial clock (used by CVP in V-Tach)
        this.atrialElapsed += dt;
        if (this.atrialElapsed >= this.atrialDuration) {
            this.atrialElapsed -= this.atrialDuration;
        }

        // Always recalculate beat duration so HR changes take effect immediately
        let effectiveHR = Math.max(this.heartRate, 1);
        // V-Tach uses its own base HR (280-300)
        if (this.rhythm === 'vtach') {
            effectiveHR = this.vtachBaseHR;
        }
        // For regular rhythms (no irregularity, not afib/vtach),
        // update beat duration continuously so HR changes take effect immediately
        if (this.rhythm !== 'afib' && this.rhythm !== 'vtach' && this.irregularity === 0) {
            this.currentBeatDuration = 60.0 / effectiveHR;
        }

        this.beatJustStarted = false;
        if (this.beatElapsed >= this.currentBeatDuration) {
            // Save the R-R interval of the beat that just ended
            this.prevBeatDuration = this.currentBeatDuration;
            this.beatJustStarted = true;
            this.beatElapsed = this.beatElapsed % this.currentBeatDuration;
            if (this.rhythm === 'afib') {
                const base = 60.0 / effectiveHR;
                this.currentBeatDuration = base * (0.6 + Math.random() * 0.8);
            } else if (this.rhythm === 'vtach') {
                // V-Tach: fluctuate within 0-5 bpm of base rate
                const vtachHR = this.vtachBaseHR + Math.random() * 5;
                this.currentBeatDuration = 60.0 / vtachHR;
            } else if (this.irregularity > 0) {
                // Apply irregularity: vary R-R by ±irregularity%
                const base = 60.0 / effectiveHR;
                const variation = this.irregularity / 100;
                this.currentBeatDuration = base * (1 - variation + Math.random() * 2 * variation);
            }
        }

        // beatElapsed is absolute time in seconds within the current beat
        const t = this.beatElapsed;
        // At high HR the beat duration is shorter than the PQRST span,
        // so the T wave tail from the previous beat bleeds into the next.
        // Use prevBeatDuration since the tail belongs to the previous beat.
        const tPrev = t + this.prevBeatDuration;

        switch (this.rhythm) {
            case 'nsr': return Waveforms.ecgNormal(t) + Waveforms.ecgNormal(tPrev);
            case 'afib': return Waveforms.ecgAFib(t, this.time) + Waveforms.ecgAFib(tPrev, this.time);
            case 'vtach': return Waveforms.ecgVTach(t);
            case 'vfib': return Waveforms.ecgVFib(this.time);
            case 'asystole': return Waveforms.ecgAsystole(this.time);
            default: return Waveforms.ecgNormal(t) + Waveforms.ecgNormal(tPrev);
        }
    }

    // Normalized phase (0..1) for ECG beat tracking
    getPhase() {
        return this.beatElapsed / this.currentBeatDuration;
    }

    // Phase for pulse waveforms (ABP, SpO2).
    // The arterial pulse shape has an intrinsic duration determined by
    // left ventricular ejection time and arterial compliance (Windkessel
    // model). This duration is largely independent of heart rate — only
    // the diastolic decay time between pulses varies with R-R interval.
    // We enforce a minimum effective duration so that short irregular
    // beats don't compress the waveform into unrealistic spikes.
    getPulsePhase() {
        const MIN_PULSE_DURATION = 0.50; // seconds (~120bpm pulse width)
        const effectiveDuration = Math.max(this.currentBeatDuration, MIN_PULSE_DURATION);
        return Math.min(this.beatElapsed / effectiveDuration, 1.0);
    }

    // Previous beat's pulse phase at the current time — for bleed-through
    // so ABP/SpO2 decay smoothly across beat boundaries (same principle
    // as ECG T-wave bleed-through).
    getPrevPulsePhase() {
        const MIN_PULSE_DURATION = 0.50;
        const timeSincePrevBeat = this.prevBeatDuration + this.beatElapsed;
        const effectiveDuration = Math.max(this.prevBeatDuration, MIN_PULSE_DURATION);
        return Math.min(timeSincePrevBeat / effectiveDuration, 1.0);
    }

    // Effective HR derived from current R-R interval (fluctuates in A-Fib)
    getEffectiveHR() {
        if (this.rhythm === 'vfib' || this.rhythm === 'asystole') return 0;
        return 60.0 / this.currentBeatDuration;
    }

    // Returns true if current rhythm has no effective cardiac output
    hasNoOutput() {
        return this.rhythm === 'vfib' || this.rhythm === 'asystole';
    }

    // Frank-Starling BP adjustment based on preceding R-R interval.
    // Longer pause before a beat = more filling = higher SBP, lower DBP.
    // Shorter pause = less filling = lower SBP, higher DBP.
    // The factor is smoothly interpolated to avoid abrupt jumps at beat boundaries.
    // Returns { sysFactor } as a multiplier around 1.0.
    updateBPFactor(dt) {
        const normalDuration = 60.0 / Math.max(this.heartRate, 1);
        const rrRatio = this.prevBeatDuration / normalDuration;
        const deviation = (rrRatio - 1.0) * 0.20;
        const targetFactor = 1.0 + deviation;
        // Smooth towards target — fast enough to settle within ~0.1s
        const smoothing = 1.0 - Math.exp(-dt * 30);
        this.currentSysFactor += (targetFactor - this.currentSysFactor) * smoothing;
    }

    getSysFactor() {
        return this.currentSysFactor;
    }

    // Normalized CVP sample (~0.5 baseline = mean CVP) with rhythm-specific
    // morphology. Caller flatlines this when hasNoOutput() is true.
    getCvpSample() {
        const t = this.beatElapsed;
        // Previous beat's tail bleeds through at high HR (same as ECG/ABP)
        const tPrev = t + this.prevBeatDuration;

        if (this.rhythm === 'afib') {
            // No organised atrial contraction → a wave absent; c/v remain
            return 0.5 + Waveforms.cvpComplex(t, 0) + Waveforms.cvpComplex(tPrev, 0);
        }

        if (this.rhythm === 'vtach') {
            // AV dissociation: ventricular c/v waves at the (fast) ventricular
            // rate, plus independent atrial a waves. When an atrial contraction
            // lands during ventricular systole (tricuspid shut) it becomes a
            // giant cannon a wave; otherwise it is a normal-sized a wave.
            const inSystole = t > 0.12 && t < 0.34;
            const aScale = inSystole ? 2.5 : 0.8;
            const ventricular = Waveforms.cvpComplex(t, 0) + Waveforms.cvpComplex(tPrev, 0);
            const atrial = aScale * 0.22 * Math.exp(-Math.pow((this.atrialElapsed - 0.11) / 0.040, 2));
            return 0.5 + ventricular + atrial;
        }

        // Normal sinus (sinus brady/tachy are just NSR at a different HR)
        return 0.5 + Waveforms.cvpComplex(t, 1) + Waveforms.cvpComplex(tPrev, 1);
    }

    // ICP pulse (0 at baseline, positive during systole). p1/p2/p3 are 0..1
    // peak amplitudes. Previous beat's tail bleeds through at high HR.
    getIcpSample(p1, p2, p3) {
        const t = this.beatElapsed;
        const tPrev = t + this.prevBeatDuration;
        return Waveforms.icpComplex(t, p1, p2, p3) + Waveforms.icpComplex(tPrev, p1, p2, p3);
    }
}
