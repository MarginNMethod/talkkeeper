use crate::*;
use std::{path::Path, sync::Arc};
use whisper_rs::{FullParams, SamplingStrategy, WhisperContext, WhisperContextParameters};
pub struct LocalEngine {
    context: Arc<WhisperContext>,
}
impl LocalEngine {
    pub async fn load(path: impl AsRef<Path>) -> Result<Self> {
        let path = path.as_ref().to_path_buf();
        let context = tokio::task::spawn_blocking(move || {
            WhisperContext::new_with_params(path, WhisperContextParameters::default())
        })
        .await
        .map_err(|_| Error::Provider("model loader stopped".into()))?
        .map_err(|_| Error::Provider("cannot load model".into()))?;
        Ok(Self {
            context: Arc::new(context),
        })
    }
}
#[async_trait]
impl SttEngine for LocalEngine {
    async fn start(&self, opts: SttOptions) -> Result<SttSession> {
        if let Language::Code(code) = &opts.language {
            if code.contains('\0') || whisper_rs::get_lang_id(code).is_none() {
                return Err(Error::Provider("unsupported language code".into()));
            }
        }
        Ok(segmented_session(
            Self {
                context: self.context.clone(),
            },
            opts,
        ))
    }
}
#[async_trait]
impl SegmentDecoder for LocalEngine {
    async fn decode(&self, audio: AudioChunk, opts: &SttOptions) -> Result<Vec<TranscriptEvent>> {
        let context = self.context.clone();
        let opts = opts.clone();
        tokio::task::spawn_blocking(move || {
            let mut state = context
                .create_state()
                .map_err(|_| Error::Provider("cannot create inference state".into()))?;
            let mut params = FullParams::new(SamplingStrategy::Greedy { best_of: 1 });
            params.set_n_threads(4);
            params.set_print_progress(false);
            params.set_print_realtime(false);
            params.set_print_timestamps(false);
            params.set_print_special(false);
            params.set_no_context(true);
            params.set_language(match &opts.language {
                Language::Auto => None,
                Language::Code(code) => Some(code),
            });
            let prompt = opts
                .vocabulary
                .iter()
                .take(30)
                .cloned()
                .collect::<Vec<_>>()
                .join(", ");
            params.set_initial_prompt(&prompt.replace('\0', ""));
            state
                .full(params, &audio.samples)
                .map_err(|_| Error::Provider("inference failed".into()))?;
            let lang = whisper_rs::get_lang_str(state.full_lang_id_from_state()).map(str::to_owned);
            state
                .as_iter()
                .map(|segment| {
                    Ok(TranscriptEvent {
                        channel: audio.channel,
                        start_ms: audio.start_ms + segment.start_timestamp().max(0) as u64 * 10,
                        end_ms: audio.start_ms
                            + (segment.end_timestamp().max(0) as u64 * 10)
                                .min(audio.samples.len() as u64 / 16),
                        text: segment
                            .to_str_lossy()
                            .map_err(|_| Error::Provider("invalid transcript".into()))?
                            .trim()
                            .to_owned(),
                        lang: lang.clone(),
                        is_final: true,
                    })
                })
                .collect()
        })
        .await
        .map_err(|_| Error::Provider("inference worker stopped".into()))?
    }
}
