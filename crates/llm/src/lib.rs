//! Language model providers for TalkKeeper.

/// Returns the component name for scaffold diagnostics.
pub fn component_name() -> &'static str {
    "llm"
}

#[cfg(test)]
mod tests {
    #[test]
    fn component_is_identifiable() {
        assert_eq!(super::component_name(), "llm");
    }
}
