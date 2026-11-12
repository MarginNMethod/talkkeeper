//! Validates dictation transitions before performing side effects.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Phase {
    Idle,
    Listening,
    Transcribing,
    Inserting,
    Cancelled,
    Error,
}
pub struct Flow(pub Phase);
impl Default for Flow {
    fn default() -> Self {
        Self(Phase::Idle)
    }
}
impl Flow {
    pub fn step<T>(
        &mut self,
        next: Phase,
        effect: impl FnOnce() -> Result<T, String>,
    ) -> Result<T, String> {
        use Phase::*;
        let allowed = matches!(
            (self.0, next),
            (Idle, Listening)
                | (Listening, Transcribing)
                | (Transcribing, Inserting)
                | (Inserting, Idle)
        ) || matches!(next, Cancelled | Error);
        if !allowed || matches!(self.0, Cancelled | Error) {
            return Err("Dictation is no longer active".into());
        }
        self.0 = next;
        match effect() {
            Ok(value) => Ok(value),
            Err(e) => {
                self.0 = Error;
                Err(e)
            }
        }
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[derive(Default)]
    struct Fakes {
        audio: usize,
        stt: usize,
        llm: usize,
        paste: usize,
    }
    #[test]
    fn pipeline_and_cancellation_gate_side_effects() {
        let mut f = Fakes::default();
        let mut flow = Flow::default();
        flow.step(Phase::Listening, || {
            f.audio += 1;
            Ok(())
        })
        .unwrap();
        let raw = flow
            .step(Phase::Transcribing, || {
                f.stt += 1;
                Ok("spoken")
            })
            .unwrap();
        f.llm += 1; // Failed/slow cleanup uses the raw STT result.
        flow.step(Phase::Inserting, || {
            f.paste += 1;
            assert_eq!(raw, "spoken");
            Ok(())
        })
        .unwrap();
        flow.step(Phase::Idle, || Ok(())).unwrap();
        assert_eq!((f.audio, f.stt, f.llm, f.paste), (1, 1, 1, 1));
        flow.step(Phase::Listening, || Ok(())).unwrap();
        flow.step(Phase::Cancelled, || Ok(())).unwrap();
        assert!(flow
            .step(Phase::Inserting, || {
                f.paste += 1;
                Ok(())
            })
            .is_err());
        assert_eq!(f.paste, 1);
    }
    #[test]
    fn audio_stt_and_paste_errors_are_terminal() {
        for failure in [Phase::Listening, Phase::Transcribing, Phase::Inserting] {
            let mut flow = Flow::default();
            for phase in [Phase::Listening, Phase::Transcribing, Phase::Inserting] {
                let result = flow.step(phase, || {
                    if phase == failure {
                        Err("provider unavailable".into())
                    } else {
                        Ok(())
                    }
                });
                if phase == failure {
                    assert!(result.is_err());
                    break;
                }
                result.unwrap();
            }
            assert_eq!(flow.0, Phase::Error);
            assert!(flow.step(Phase::Inserting, || Ok(())).is_err());
        }
    }
}
