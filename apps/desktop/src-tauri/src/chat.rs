use super::*;
use talkkeeper_core::ChatMessage;

#[tauri::command]
pub async fn chat_note(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    note_id: Uuid,
    question: String,
    revise: bool,
    redo: bool,
) -> Result<Value> {
    let (provider, model) = provider(&state)?;
    run(
        &state,
        note_id,
        question,
        revise,
        redo,
        provider.as_ref(),
        model,
        |delta| {
            app.emit("chat://delta", json!({"note_id":note_id,"delta":delta}))
                .map_err(err)
        },
    )
    .await
}
#[allow(clippy::too_many_arguments)]
pub async fn run(
    state: &AppState,
    note_id: Uuid,
    question: String,
    revise: bool,
    redo: bool,
    provider: &dyn talkkeeper_llm::LlmProvider,
    model: String,
    mut emit: impl FnMut(&str) -> Result<()> + Send,
) -> Result<Value> {
    if question.trim().is_empty() {
        return Err("Enter a question or revision instruction".into());
    }
    if model.is_empty() {
        return Err("AI engine is not ready. Retry setup or choose a model in Settings.".into());
    }
    let (mut input, enhanced, history, template_id) = {
        let store = state.store.lock().map_err(err)?;
        let note = store
            .get_note(note_id)
            .map_err(err)?
            .ok_or("Note not found")?;
        let note = store
            .calendar_safe_note(note, preferences(&store)?["calendar_details"] == true)
            .map_err(err)?;
        let all = store.list_transcript_segments(note_id).map_err(err)?;
        if all.is_empty() {
            return Err("This note has no transcript yet.".into());
        }
        let relevant = store
            .relevant_segments(note_id, &question, 64)
            .map_err(err)?;
        let selected = if redo || all.iter().map(|s| s.text.len()).sum::<usize>() < 24000 {
            all
        } else {
            relevant
        };
        (
            talkkeeper_templates::EnhanceInput {
                title: note.title,
                attendees: note.attendees.iter().map(|a| a.name.clone()).collect(),
                user_notes_markdown: note.notes_markdown,
                transcript: selected
                    .into_iter()
                    .map(|s| talkkeeper_templates::Seg {
                        idx: s.seq as usize,
                        speaker: Some(s.speaker.to_string()),
                        start_ms: s.start_ms,
                        text: s.text,
                    })
                    .collect(),
                context_snippets: vec![],
            },
            note.summary_markdown.unwrap_or_default(),
            store.chat_history(note_id).map_err(err)?,
            note.template_id,
        )
    };
    let request = |(system, user)| CompletionRequest {
        model: model.clone(),
        system,
        messages: vec![Message {
            role: Role::User,
            content: user,
        }],
        max_tokens: Some(4096),
        temperature: None,
    };
    let revise = revise || redo || talkkeeper_templates::requests_revision(&question);
    let prompt = if redo {
        let mut template = templates(state)?
            .into_iter()
            .find(|t| Some(&t.id) == template_id.as_ref())
            .unwrap_or_default();
        template
            .extra_instructions
            .push_str(&format!("\n{question}"));
        input
            .context_snippets
            .push(format!("Current enhanced notes:\n{enhanced}"));
        match talkkeeper_templates::plan_enhancement(&template, &input, 6000) {
            talkkeeper_templates::EnhancePlan::Direct { system, user } => (system, user),
            talkkeeper_templates::EnhancePlan::MapReduce {
                map_prompts,
                reduce_template,
                input,
            } => {
                let mut summaries = Vec::new();
                for prompt in map_prompts {
                    summaries.push(provider.complete(request(prompt)).await.map_err(err)?.text);
                }
                talkkeeper_templates::build_reduce_prompt(&reduce_template, &input, &summaries)
            }
        }
    } else {
        let input = talkkeeper_templates::chat_context(&input, &enhanced, 8000);
        talkkeeper_templates::build_chat_prompt(&input, &question, revise)
    };
    let user = ChatMessage {
        id: Uuid::new_v4(),
        note_id,
        role: "user".into(),
        content: question,
        created_at: chrono::Utc::now(),
        proposed_edit_id: None,
        revision: None,
    };
    state
        .store
        .lock()
        .map_err(err)?
        .add_chat_message(&user)
        .map_err(err)?;
    let mut req = request(prompt);
    // Bound conversation context independently of the current note sources.
    let mut prior = Vec::new();
    let mut chars = 0;
    for message in history.iter().rev().take(12) {
        chars += message.content.chars().count();
        if chars > 8000 {
            break;
        }
        prior.push(Message {
            role: if message.role == "user" {
                Role::User
            } else {
                Role::Assistant
            },
            content: message.content.clone(),
        });
    }
    prior.reverse();
    prior.append(&mut req.messages);
    req.messages = prior;
    let mut stream = provider.stream(req).await.map_err(err)?;
    let mut content = String::new();
    while let Some(delta) = stream.next().await {
        let delta = delta.map_err(err)?;
        content.push_str(&delta);
        emit(&delta)?;
    }
    if content.trim().is_empty() {
        return Err("The AI returned an empty answer. Retry.".into());
    }
    let message = ChatMessage {
        id: Uuid::new_v4(),
        note_id,
        role: "assistant".into(),
        revision: revise.then(|| content.clone()),
        content,
        created_at: chrono::Utc::now(),
        proposed_edit_id: revise.then(Uuid::new_v4),
    };
    state
        .store
        .lock()
        .map_err(err)?
        .add_chat_message(&message)
        .map_err(err)?;
    Ok(json!(message))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    async fn streamed_revision_requires_explicit_apply() {
        let state = crate::tests::state();
        let note = Note::new("Planning");
        {
            let mut store = state.store.lock().unwrap();
            store.create_note(&note).unwrap();
            store
                .append_transcript_segments(&[talkkeeper_core::TranscriptSegment {
                    id: Uuid::new_v4(),
                    note_id: note.id,
                    seq: 1,
                    start_ms: 0,
                    end_ms: 100,
                    speaker: talkkeeper_core::Speaker::Me,
                    text: "Plant herbs".into(),
                    lang: None,
                    created_at: chrono::Utc::now(),
                }])
                .unwrap();
        }
        let mut deltas = Vec::new();
        let result = run(
            &state,
            note.id,
            "Shorten the notes".into(),
            true,
            false,
            &crate::tests::MockProvider,
            "user-selected".into(),
            |delta| {
                deltas.push(delta.to_string());
                Ok(())
            },
        )
        .await
        .unwrap();
        assert_eq!(deltas.len(), 2);
        assert_eq!(
            state
                .store
                .lock()
                .unwrap()
                .get_note(note.id)
                .unwrap()
                .unwrap()
                .summary_markdown,
            None
        );
        let edit = result["proposed_edit_id"].as_str().unwrap();
        data_inner(
            &state,
            "apply_revision".into(),
            json!({"id":note.id,"edit":edit}),
        )
        .unwrap();
        assert!(state
            .store
            .lock()
            .unwrap()
            .get_note(note.id)
            .unwrap()
            .unwrap()
            .summary_markdown
            .unwrap()
            .contains("Plant herbs"));
        assert_eq!(
            state
                .store
                .lock()
                .unwrap()
                .chat_history(note.id)
                .unwrap()
                .len(),
            2
        );
        let previous = state
            .store
            .lock()
            .unwrap()
            .get_note(note.id)
            .unwrap()
            .unwrap()
            .summary_markdown;
        let redo = run(
            &state,
            note.id,
            "Focus on action items".into(),
            false,
            true,
            &crate::tests::MockProvider,
            "user-selected".into(),
            |_| Ok(()),
        )
        .await
        .unwrap();
        assert!(redo["proposed_edit_id"].is_string());
        assert_eq!(
            state
                .store
                .lock()
                .unwrap()
                .get_note(note.id)
                .unwrap()
                .unwrap()
                .summary_markdown,
            previous
        );
    }
}
