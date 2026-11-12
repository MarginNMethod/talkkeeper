//! External integration extension points for TalkKeeper.

/// Returns the component name for scaffold diagnostics.
pub fn component_name() -> &'static str {
    "integrations"
}

#[cfg(test)]
mod tests {
    #[test]
    fn component_is_identifiable() {
        assert_eq!(super::component_name(), "integrations");
    }
}
