//! Local domain models, transactional SQLite storage, search, and exports.
mod models;
mod store;
pub use models::*;
pub use store::{Error, Store};
pub type Result<T> = std::result::Result<T, Error>;
pub fn component_name() -> &'static str {
    "core"
}

mod directory;
pub use directory::{Company, Person};
mod workspace;
pub use workspace::*;

mod snapshots;
pub use snapshots::*;
