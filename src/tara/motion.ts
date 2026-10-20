/**
 * Copied from TARA Online (rdc-web-chatbot, src/lib/avatar/motion.ts) for the
 * Fresher interview; keep the two in step.
 *
 * What makes the 2D avatar look alive: small head gestures (tilt, rise, nod,
 * a glance to the side), breathing, and blinks at irregular moments.
 *
 * update() is called once per animation frame and returns the pose to draw.
 * Gestures ride on critically damped springs, so each one eases in and out
 * the way a head does instead of snapping. Nothing here draws; see
 * LiveAvatarCanvas for that.
 *
 * Units: tilt and sway in degrees; rise, nod and turn as fractions of the
 * image height (rise < 0 lifts the head, nod > 0 dips it); breath -1..1;
 * blink 0 (open) .. 1 (closed).
 */

export type AvatarMode = "idle" | "listening" | "thinking" | "speaking";

export interface AvatarPose {
  tilt: number;
  rise: number;
  turn: number;
  nod: number;
  /** Forward pitch of the head (a real nod), fraction of image height at eye level. */
  pitch: number;
  breath: number;
  sway: number;
  blink: number;
}

interface HeadPose {
  tilt: number;
  rise: number;
  turn: number;
}

const ZERO: HeadPose = { tilt: 0, rise: 0, turn: 0 };

// How far each gesture may go. A real head seldom tilts more than a few
// degrees in conversation; more than this reads as a cartoon.
export const LIMITS = { tilt: 5, rise: 0.02, turn: 0.012, nod: 0.01, pitch: 0.035 };

// The listening nod: the head tips forward (pitch) and dips a little (drop),
// quicker down than up, then comes back. Tuned on RDC's tests: a 1.5% pitch
// with a lean was missed (2026-10-10); 3.7% in all was too pronounced
// (2026-10-11, about 4% of the avatar's height on screen). Now about 2%,
// varying a little from nod to nod as a real listener's do.
const ACK_SECONDS = 1.1;
const ACK_PITCH = 0.017;
const ACK_DROP = 0.004;
const ACK_SCALE: [number, number] = [0.8, 1.05];
// A blink at the bottom of a nod, only a little slower than an ordinary one:
// a slow blink lingers on the half-closed frame, which looks smudged.
const NOD_BLINK_SCALE = 1.15;
// Where in the nod the head is lowest (fraction of ACK_SECONDS).
const ACK_BOTTOM = 0.4;
// While the visitor speaks (mic on), a nod every few seconds, and no other
// head movement at all (RDC, 2026-10-11).
const LISTEN_NOD_GAP: [number, number] = [1.5, 2.6];

class Spring {
  value = 0;
  private velocity = 0;
  step(goal: number, dt: number, omega: number): number {
    // Critically damped: reaches the goal smoothly, without overshoot.
    const accel = omega * omega * (goal - this.value) - 2 * omega * this.velocity;
    this.velocity += accel * dt;
    this.value += this.velocity * dt;
    return this.value;
  }
}

export class AvatarMotion {
  private t = 0;
  private readonly random: () => number;
  private readonly head = { tilt: new Spring(), rise: new Spring(), turn: new Spring() };
  private gesture: HeadPose = ZERO;
  private gestureEndsAt = 0;
  private nextGestureAt = 1.5;
  private side = 1;
  private lastMode: AvatarMode = "idle";

  private nodStartedAt = -10;
  private nodAmp = 0;
  private nodLength = 0.55;
  private energy = 0;
  private wasLoud = false;

  private nextBlinkAt = 1.2;
  private blinkStartedAt = -10;
  private secondBlinkAt = -1;
  /** 1 for an ordinary blink; larger stretches it into a slow, soft blink. */
  private blinkScale = 1;
  private slowBlinkAt = -1;

  // The understanding nod (acknowledge()): when it started, and until when it owns the head.
  private ackUntil = -1;
  private ackStartedAt = -10;
  private ackScale = 1;
  private nextListenNodAt = 0;
  /** 0 = the usual small movements; 1 = perfectly still apart from the nod (listening). */
  private readonly still = new Spring();

  constructor(random: () => number = Math.random) {
    this.random = random;
  }

  private between(low: number, high: number): number {
    return low + (high - low) * this.random();
  }

  /** The resting head position each mode leans toward. */
  private modePose(mode: AvatarMode): HeadPose {
    switch (mode) {
      // Listening: the head holds level; only the nods move it.
      case "listening":
        return ZERO;
      // Thinking: chin up, a glance away.
      case "thinking":
        return { tilt: -1.6 * this.side, rise: -0.008, turn: 0.005 * this.side };
      default:
        return ZERO;
    }
  }

  private startNod(amp: number, length = 0.55): void {
    this.nodStartedAt = this.t;
    this.nodAmp = amp;
    this.nodLength = length;
  }

  private maybeBlinkWithMovement(): void {
    // People often blink as the head starts to move.
    if (this.t - this.blinkStartedAt > 0.8 && this.random() < 0.35) this.nextBlinkAt = this.t;
  }

  /**
   * The "I understand" nod of someone listening: the head tips forward and
   * comes back, with nothing else moving (RDC's reference: an AI presenter
   * listening, 2026-10-10). Call it while the visitor is asking; calls during
   * a nod already under way are ignored. In listening mode it repeats by itself.
   */
  acknowledge(blink = true): void {
    const t = this.t;
    if (t < this.ackUntil + 0.8) return; // under way, or only just finished
    this.ackStartedAt = t;
    this.ackUntil = t + ACK_SECONDS;
    this.ackScale = this.between(...ACK_SCALE);
    this.gesture = ZERO;
    this.gestureEndsAt = t;
    this.nextGestureAt = this.ackUntil + this.between(1, 2.5);
    this.nextListenNodAt = this.ackUntil + this.between(...LISTEN_NOD_GAP);
    // A blink whose closed moment falls at the bottom of the nod. (Half-lowered
    // lids were tried: blending half of the closed-eye photo ghosts the eyes.)
    if (blink) this.slowBlinkAt = t + ACK_SECONDS * ACK_BOTTOM - 0.06 * NOD_BLINK_SCALE;
  }

  /** 0..1: how far down the nod the head is — eased, quicker down than up. */
  private ackDepth(): number {
    const s = (this.t - this.ackStartedAt) / ACK_SECONDS;
    if (s <= 0 || s >= 1) return 0;
    const ease = (x: number) => x * x * (3 - 2 * x);
    return s < ACK_BOTTOM ? ease(s / ACK_BOTTOM) : 1 - ease((s - ACK_BOTTOM) / (1 - ACK_BOTTOM));
  }

  private pickGesture(mode: AvatarMode): void {
    const speaking = mode === "speaking";
    const roll = this.random();
    let pose: HeadPose;
    if (mode === "listening") {
      pose = ZERO; // listening moves the head only by nodding
    } else if (roll < 0.34) {
      this.side = this.random() < 0.5 ? -1 : 1;
      pose = { tilt: this.side * this.between(1.8, 3.4), rise: this.between(-0.002, 0.002), turn: 0 };
    } else if (roll < 0.56) {
      // Head rises a little: chin up, often with a small tilt.
      pose = { tilt: this.between(-1, 1), rise: -this.between(0.006, 0.012), turn: 0 };
    } else if (roll < 0.74) {
      pose = { tilt: this.between(-1.2, 1.2), rise: 0, turn: (this.random() < 0.5 ? -1 : 1) * this.between(0.004, 0.008) };
    } else if (roll < 0.88) {
      this.startNod(this.between(0.004, 0.007));
      pose = ZERO;
    } else {
      pose = ZERO; // back to neutral for a while
    }
    this.gesture = pose;
    const hold = speaking ? this.between(0.9, 2.2) : this.between(1.4, 3.2);
    this.gestureEndsAt = this.t + hold;
    this.nextGestureAt = this.gestureEndsAt + (speaking ? this.between(0.6, 2.2) : this.between(1.8, 5));
    this.maybeBlinkWithMovement();
  }

  private blinkAmount(speaking: boolean): number {
    if (this.slowBlinkAt > 0 && this.t >= this.slowBlinkAt) {
      this.blinkStartedAt = this.t;
      this.blinkScale = NOD_BLINK_SCALE;
      this.slowBlinkAt = -1;
      this.secondBlinkAt = -1;
      this.nextBlinkAt = this.t + this.between(2.5, 5);
    } else if (this.t >= this.nextBlinkAt) {
      this.blinkStartedAt = this.t;
      this.blinkScale = 1;
      this.secondBlinkAt = this.random() < 0.15 ? this.t + 0.26 : -1;
      this.nextBlinkAt = this.t + (speaking ? this.between(2.6, 5.8) : this.between(2.2, 5.4));
    }
    if (this.secondBlinkAt > 0 && this.t >= this.secondBlinkAt) {
      this.blinkStartedAt = this.t;
      this.secondBlinkAt = -1;
    }
    // 60 ms closing, 40 ms shut, 80 ms opening (stretched for a slow blink).
    const since = (this.t - this.blinkStartedAt) / this.blinkScale;
    if (since < 0.06) return since / 0.06;
    if (since < 0.1) return 1;
    if (since < 0.18) return 1 - (since - 0.1) / 0.08;
    return 0;
  }

  update(dtSeconds: number, mode: AvatarMode, speechEnergy: number, reducedMotion = false): AvatarPose {
    const dt = Math.min(Math.max(dtSeconds, 0), 0.1);
    this.t += dt;
    const t = this.t;
    const speaking = mode === "speaking";

    const acknowledging = t < this.ackUntil;
    if (mode !== this.lastMode) {
      this.lastMode = mode;
      // A nod in progress finishes first (the question was just sent and the
      // mode turned to "thinking"); the new mode takes over after it.
      if (mode === "listening") this.nextListenNodAt = t + this.between(0.6, 1.2);
      if (!acknowledging) {
        this.gesture = ZERO;
        this.nextGestureAt = t + this.between(0.8, 2);
        this.maybeBlinkWithMovement();
      }
    }

    // Listening: a nod every few seconds, sometimes with a soft blink.
    if (mode === "listening" && !acknowledging && t >= this.nextListenNodAt) this.acknowledge(this.random() < 0.35);
    const nodding = t < this.ackUntil;
    const blink = this.blinkAmount(speaking);
    if (reducedMotion) return { tilt: 0, rise: 0, turn: 0, nod: 0, pitch: 0, breath: 0, sway: 0, blink };

    if (!nodding && mode !== "listening" && t >= this.nextGestureAt) this.pickGesture(mode);
    const gesture = t < this.gestureEndsAt ? this.gesture : ZERO;
    const base = nodding ? ZERO : this.modePose(mode);
    // Fade every other movement out while she listens or nods, and back in after.
    const calm = 1 - this.still.step(nodding || mode === "listening" ? 1 : 0, dt, 4);

    // Loudness, smoothed; a loud syllable after a pause earns an emphasis nod.
    this.energy += (Math.max(0, Math.min(1, speechEnergy)) - this.energy) * (1 - Math.exp(-dt / 0.12));
    const loud = speaking && this.energy > 0.68;
    if (loud && !this.wasLoud && t - this.nodStartedAt > 1.3 && this.random() < 0.55) {
      this.startNod(this.between(0.003, 0.006), 0.45);
    }
    this.wasLoud = loud;

    // Head springs: while nodding they only bring the head back to level.
    const omega = nodding ? 4 : speaking ? 5 : 3.4;
    const tilt = this.head.tilt.step(base.tilt + gesture.tilt, dt, omega);
    const rise = this.head.rise.step(base.rise + gesture.rise, dt, omega);
    const turn = this.head.turn.step(base.turn + gesture.turn, dt, omega);

    // Never perfectly still: slow drift on incommensurate periods.
    const lively = (speaking ? 1.4 : 1) * calm;
    const microTilt = lively * (0.45 * Math.sin(t * 0.41) + 0.25 * Math.sin(t * 1.07 + 1.1));
    const microRise = lively * 0.0015 * Math.sin(t * 0.53 + 0.4) - (speaking ? 0.0025 * this.energy : 0);
    const microTurn = lively * 0.0014 * Math.sin(t * 0.29 + 2);

    const sinceNod = t - this.nodStartedAt;
    const depth = this.ackDepth() * this.ackScale;
    const nod = (sinceNod < this.nodLength ? this.nodAmp * Math.sin((Math.PI * sinceNod) / this.nodLength) : 0) + ACK_DROP * depth;

    const breathPeriod = speaking ? 3.4 : 4.4;
    const clamp = (v: number, limit: number) => Math.max(-limit, Math.min(limit, v));
    return {
      tilt: clamp(tilt + microTilt, LIMITS.tilt),
      rise: clamp(rise + microRise, LIMITS.rise),
      turn: clamp(turn + microTurn, LIMITS.turn),
      nod: clamp(nod, LIMITS.nod),
      pitch: clamp(ACK_PITCH * depth, LIMITS.pitch),
      breath: calm * Math.sin((2 * Math.PI * t) / breathPeriod),
      sway: calm * 0.35 * Math.sin(t * 0.19 + 0.7),
      blink,
    };
  }
}
