/**
 * Sound plays the game's SFX. For the quack it prefers a real recording dropped
 * in at public/quack.mp3 (served at /quack.mp3); if that file isn't there — or
 * hasn't decoded yet — it falls back to a synthesized quack, so the game always
 * makes a noise on Q.
 *
 * Browser autoplay rules: an AudioContext starts "suspended" and can only be
 * resumed from a real user gesture. So we resume it on the first click/keypress,
 * which means by the time a quack actually plays (from the game loop) it's live.
 */

// Where the optional recorded quack lives. BASE_URL keeps it correct even if the
// game is ever served from a sub-path.
const QUACK_URL = `${import.meta.env.BASE_URL}quack.mp3`

export class Sound {
  private ctx: AudioContext | null = null

  private rawQuack: ArrayBuffer | null = null // the file's bytes, pre-fetched
  private quackBuffer: AudioBuffer | null = null // decoded + ready to play
  private decoding = false

  constructor() {
    void this.fetchQuackFile() // optional — silently does nothing if absent

    const unlock = () => {
      this.getContext() // create + resume inside the gesture
      window.removeEventListener('pointerdown', unlock)
      window.removeEventListener('keydown', unlock)
    }
    window.addEventListener('pointerdown', unlock)
    window.addEventListener('keydown', unlock)
  }

  /** Play the quack: the real recording if we have it, else the synth. */
  quack(): void {
    const ctx = this.getContext()
    if (!ctx) return // no Web Audio support — stay silent

    if (this.quackBuffer) {
      this.playBuffer(ctx, this.quackBuffer)
      return
    }
    // We have the file bytes but haven't decoded them yet — kick that off, and
    // use the synth for this one quack so it's not silent.
    if (this.rawQuack) void this.decodeQuack()
    this.synthQuack(ctx)
  }

  // --- Recorded-file path ----------------------------------------------------

  private async fetchQuackFile(): Promise<void> {
    try {
      const res = await fetch(QUACK_URL)
      if (!res.ok) return // 404 = no recording yet; that's fine, we use synth
      // Vite's dev server answers a MISSING file with index.html (200, text/html)
      // rather than a 404, so guard on the type: only accept an actual audio file.
      const type = res.headers.get('content-type') ?? ''
      if (type.includes('text/html')) return // no recording present — use synth
      this.rawQuack = await res.arrayBuffer()
      if (this.ctx) await this.decodeQuack() // decode now if the context exists
    } catch {
      // Network/parse trouble — just stay on the synth.
    }
  }

  private async decodeQuack(): Promise<void> {
    if (!this.ctx || !this.rawQuack || this.quackBuffer || this.decoding) return
    this.decoding = true
    try {
      // decodeAudioData can "detach" the buffer, so decode a copy.
      this.quackBuffer = await this.ctx.decodeAudioData(this.rawQuack.slice(0))
      this.rawQuack = null // done with the raw bytes
    } catch {
      this.rawQuack = null // undecodable file — fall back to synth for good
    } finally {
      this.decoding = false
    }
  }

  private playBuffer(ctx: AudioContext, buffer: AudioBuffer): void {
    const src = ctx.createBufferSource()
    src.buffer = buffer
    const gain = ctx.createGain()
    gain.gain.value = 0.9 // tweak if your recording is too loud/quiet
    src.connect(gain)
    gain.connect(ctx.destination)
    src.start()
  }

  // --- Synthesized fallback --------------------------------------------------

  /** A short, nasal, pitch-bent quack built from scratch (no file needed). */
  private synthQuack(ctx: AudioContext): void {
    const now = ctx.currentTime
    const pitch = 1 + (Math.random() * 0.2 - 0.1) // ±10% per quack, for variety

    const osc = ctx.createOscillator()
    osc.type = 'sawtooth'
    const f = osc.frequency
    f.setValueAtTime(600 * pitch, now)
    f.linearRampToValueAtTime(720 * pitch, now + 0.03)
    f.exponentialRampToValueAtTime(170 * pitch, now + 0.18)

    const band = ctx.createBiquadFilter()
    band.type = 'bandpass'
    band.frequency.value = 1000
    band.Q.value = 4

    const gain = ctx.createGain()
    const g = gain.gain
    g.setValueAtTime(0.0001, now)
    g.exponentialRampToValueAtTime(0.35, now + 0.012)
    g.exponentialRampToValueAtTime(0.0001, now + 0.22)

    osc.connect(band)
    band.connect(gain)
    gain.connect(ctx.destination)

    osc.start(now)
    osc.stop(now + 0.25)
  }

  // --- Context plumbing ------------------------------------------------------

  private getContext(): AudioContext | null {
    if (!this.ctx) {
      const Ctor =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      if (!Ctor) return null
      this.ctx = new Ctor()
      if (this.rawQuack) void this.decodeQuack() // decode as soon as we can
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume()
    return this.ctx
  }
}
