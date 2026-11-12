use crate::{AudioChunk, Channel, Error, Result};
use std::collections::HashMap;

#[derive(Clone, Debug)]
pub struct VadConfig {
    pub min_silence_ms: u64,
    pub energy_threshold: f32,
    pub max_zero_crossing_rate: f32,
}
impl Default for VadConfig {
    fn default() -> Self {
        Self {
            min_silence_ms: 600,
            energy_threshold: 0.01,
            max_zero_crossing_rate: 0.4,
        }
    }
}
impl VadConfig {
    pub fn is_speech(&self, samples: &[f32]) -> bool {
        if samples.is_empty() {
            return false;
        }
        let energy = (samples.iter().map(|x| x * x).sum::<f32>() / samples.len() as f32).sqrt();
        let crossings = samples
            .windows(2)
            .filter(|w| w[0].is_sign_positive() != w[1].is_sign_positive())
            .count();
        energy >= self.energy_threshold
            && crossings as f32 / samples.len() as f32 <= self.max_zero_crossing_rate
    }
}
#[derive(Default)]
struct State {
    samples: Vec<f32>,
    start: u64,
    silence: usize,
    next_ms: Option<u64>,
    pending: Vec<f32>,
    pending_start: u64,
}
pub struct Segmenter {
    config: VadConfig,
    states: HashMap<Channel, State>,
}
impl Segmenter {
    pub fn new(config: VadConfig) -> Self {
        Self {
            config,
            states: HashMap::new(),
        }
    }
    pub fn push(&mut self, chunk: AudioChunk) -> Result<Vec<AudioChunk>> {
        if chunk.sample_rate == 0 || chunk.samples.iter().any(|s| !s.is_finite()) {
            return Err(Error::Audio("invalid samples or rate".into()));
        }
        let normalized = crate::resample(&chunk.samples, chunk.sample_rate)?;
        let state = self.states.entry(chunk.channel).or_default();
        let mut out = Vec::new();
        if state
            .next_ms
            .is_some_and(|next| next.abs_diff(chunk.start_ms) > 2)
        {
            process_pending(state, chunk.channel, &self.config, true, &mut out);
            flush(state, chunk.channel, &mut out);
        }
        if state.pending.is_empty() {
            state.pending_start = chunk.start_ms;
        }
        state.pending.extend(normalized.iter().copied());
        process_pending(state, chunk.channel, &self.config, false, &mut out);
        state.next_ms = Some(chunk.start_ms + normalized.len() as u64 * 1000 / 16000);
        Ok(out)
    }
    pub fn finish(&mut self) -> Vec<AudioChunk> {
        let mut out = Vec::new();
        for channel in [Channel::Mic, Channel::System] {
            if let Some(state) = self.states.get_mut(&channel) {
                process_pending(state, channel, &self.config, true, &mut out);
                flush(state, channel, &mut out);
                state.next_ms = None;
            }
        }
        out
    }
}
fn process_pending(
    state: &mut State,
    channel: Channel,
    config: &VadConfig,
    finish: bool,
    out: &mut Vec<AudioChunk>,
) {
    let count = if finish {
        state.pending.len()
    } else {
        state.pending.len() / 320 * 320
    };
    let pending = std::mem::take(&mut state.pending);
    for (i, frame) in pending[..count].chunks(320).enumerate() {
        let speech = config.is_speech(frame);
        if state.samples.is_empty() {
            if !speech {
                continue;
            }
            state.start = state.pending_start + i as u64 * 20;
        }
        state.samples.extend_from_slice(frame);
        state.silence = if speech {
            0
        } else {
            state.silence + frame.len()
        };
        if state.samples.len() >= 480000
            || state.silence as u64 * 1000 >= config.min_silence_ms.saturating_mul(16000)
        {
            flush(state, channel, out);
        }
    }
    state.pending = pending[count..].to_vec();
    state.pending_start += count as u64 / 16;
}
fn flush(state: &mut State, channel: Channel, out: &mut Vec<AudioChunk>) {
    if !state.samples.is_empty() {
        out.push(AudioChunk {
            channel,
            sample_rate: 16000,
            samples: std::mem::take(&mut state.samples),
            start_ms: state.start,
        });
    }
    state.silence = 0;
}
#[derive(Debug, PartialEq)]
pub struct AutoStopSuggested;
/// Feed a monotonic recording clock, including during capture silence.
/// Speech on either channel resets the deadline. Emits once per silent interval.
pub struct SilenceMonitor {
    timeout_ms: u64,
    last_speech_ms: u64,
    emitted: bool,
}
impl SilenceMonitor {
    pub fn new(minutes: u64, start_ms: u64) -> Self {
        Self {
            timeout_ms: minutes.saturating_mul(60000),
            last_speech_ms: start_ms,
            emitted: false,
        }
    }
    pub fn observe(&mut self, now_ms: u64, speech: bool) -> Option<AutoStopSuggested> {
        if speech {
            self.last_speech_ms = now_ms;
            self.emitted = false;
        }
        if !self.emitted && now_ms.saturating_sub(self.last_speech_ms) >= self.timeout_ms {
            self.emitted = true;
            Some(AutoStopSuggested)
        } else {
            None
        }
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    fn tone(channel: Channel, start_ms: u64, seconds: usize) -> AudioChunk {
        AudioChunk {
            channel,
            start_ms,
            sample_rate: 16000,
            samples: (0..16000 * seconds)
                .map(|i| (i as f32 * 0.1728).sin() * 0.2)
                .collect(),
        }
    }
    #[test]
    fn segmentation_is_independent_and_bounded() {
        let mut vad = Segmenter::new(VadConfig::default());
        assert!(!vad.config.is_speech(&[0.0; 320]));
        assert!(!vad.config.is_speech(
            &(0..320)
                .map(|i| if i % 2 == 0 { 1.0 } else { -1.0 })
                .collect::<Vec<_>>()
        ));
        assert!(vad.push(tone(Channel::Mic, 0, 1)).unwrap().is_empty());
        assert!(vad.push(tone(Channel::System, 0, 1)).unwrap().is_empty());
        let silent = AudioChunk {
            channel: Channel::Mic,
            start_ms: 1000,
            sample_rate: 16000,
            samples: vec![0.0; 16000],
        };
        let out = vad.push(silent).unwrap();
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].samples.len(), 25600);
        assert_eq!(vad.finish()[0].channel, Channel::System);
        let out = vad.push(tone(Channel::Mic, 2000, 61)).unwrap();
        assert_eq!(out.len(), 2);
        assert!(out.iter().all(|x| x.samples.len() == 480000));
        assert_eq!(vad.finish()[0].start_ms, 62000);
    }
    #[test]
    fn arbitrary_chunk_boundaries_keep_frames_and_segment_limit() {
        let input = tone(Channel::Mic, 0, 31);
        let mut vad = Segmenter::new(VadConfig::default());
        let mut output = Vec::new();
        for (index, part) in input.samples.chunks(137).enumerate() {
            output.extend(
                vad.push(AudioChunk {
                    channel: Channel::Mic,
                    sample_rate: 16000,
                    samples: part.to_vec(),
                    start_ms: index as u64 * 137 / 16,
                })
                .unwrap(),
            );
        }
        output.extend(vad.finish());
        assert_eq!(output.len(), 2);
        assert_eq!(output[0].samples.len(), 480000);
        assert_eq!(output[1].samples.len(), 16000);
        assert_eq!(output[0].start_ms, 0);
        assert!(output[1].start_ms.abs_diff(30000) <= 1);
    }
    #[test]
    fn silence_deadline_resets_on_either_channel() {
        let mut m = SilenceMonitor::new(1, 0);
        assert_eq!(m.observe(59000, false), None);
        assert_eq!(m.observe(60000, true), None);
        assert_eq!(m.observe(120000, false), Some(AutoStopSuggested));
        assert_eq!(m.observe(121000, false), None);
        assert_eq!(m.observe(122000, true), None);
        assert_eq!(m.observe(182000, false), Some(AutoStopSuggested));
    }
}
