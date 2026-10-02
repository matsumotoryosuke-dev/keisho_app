/** Snapshot of audio analysis data for one frame, with sensitivity applied. */
export function buildAudioData(engine) {
  const s = engine.sensitivity;
  return {
    waveform:  engine.getWaveform(),
    frequency: engine.getFrequency(),
    bass:      Math.min(1, engine.getBass()      * s),
    mid:       Math.min(1, engine.getMid()       * s),
    treble:    Math.min(1, engine.getTreble()    * s),
    amplitude: Math.min(1, engine.getAmplitude() * s),
    hasAudio:  engine.isLoaded,
  };
}
