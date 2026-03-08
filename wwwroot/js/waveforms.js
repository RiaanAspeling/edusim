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

    // Arterial blood pressure waveform (phase-based, scales with HR)
    // Matches textbook ABP: steep upstroke, sharp systolic peak, dicrotic notch
    // Waveform oscillates between diastolic and systolic (never drops to zero)
    abpWaveform(phase, systolic, diastolic) {
        const range = systolic - diastolic;
        // Sum of Gaussian model (Liu et al., BioMed Research Int., 2014)
        // G1: Systolic peak (skewed — steep upstroke, gentler descent)
        // Offset forward so ABP peaks after ECG R-wave (~0.1s physiological delay)
        const c1 = 0.28;
        const w1 = phase < c1 ? 0.04 : 0.11;
        const g1 = Math.exp(-Math.pow((phase - c1) / w1, 2));
        // G2: Dicrotic notch/wave — position and amplitude vary with pulse pressure
        // and vascular tone (indicated by diastolic BP level)
        // Normal pulse pressure ~40 mmHg: notch sits midway between systole/diastole
        // Wide pulse pressure (>40): notch drops towards diastole
        // Narrow pulse pressure (<40): notch rises towards systole
        // Low diastolic (vasodilation): notch drops further towards diastole
        const pp = Math.max(range, 1);
        const normalPP = 40;
        // Ratio: <1 = narrow PP (notch higher), >1 = wide PP (notch lower)
        const ppRatio = pp / normalPP;
        // Vasodilation factor: low diastolic (<70) pushes notch lower and later
        // Normal diastolic ~80: factor = 0, low diastolic 40: factor = 1
        const vasodilationFactor = Math.max(0, Math.min(1, (70 - diastolic) / 30));
        // Notch amplitude: lower when wide PP or vasodilated, higher when narrow PP
        // Clamp between 0.05 (nearly invisible) and 0.45 (prominent)
        const baseAmp = 0.20 / ppRatio;
        const notchAmp = Math.min(0.45, Math.max(0.05, baseAmp * (1 - 0.6 * vasodilationFactor)));
        // Notch phase position: shifts earlier (towards systole) when narrow,
        // later (towards diastole) when wide or vasodilated
        const baseCenter = 0.52 + 0.06 * ppRatio;
        const notchCenter = Math.min(0.75, Math.max(0.48, baseCenter + 0.10 * vasodilationFactor));
        const g2 = notchAmp * Math.exp(-Math.pow((phase - notchCenter) / 0.06, 2));
        // G3: Broad diastolic base (sustains pressure through diastole)
        const g3 = 0.25 * Math.exp(-Math.pow((phase - 0.48) / 0.22, 2));

        const shape = (g1 + g2 + g3) / 1.08;
        const val = diastolic + range * shape;
        return (val - diastolic + 10) / (range + 20);
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
}
