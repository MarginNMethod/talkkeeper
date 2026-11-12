use rmcp::ServiceExt;
use std::path::PathBuf;
use talkkeeper_mcp::{default_database, Server};
#[tokio::main]
async fn main() {
    if let Err(message) = run().await {
        eprintln!("{message}");
        std::process::exit(1);
    }
}
async fn run() -> Result<(), String> {
    let mut args = std::env::args_os().skip(1);
    let mut database = None;
    let mut check = false;
    while let Some(arg) = args.next() {
        match arg.to_str() {
            Some("--db") if database.is_none() => {
                database = Some(PathBuf::from(args.next().ok_or("--db requires a path")?))
            }
            Some("--check") => check = true,
            Some("--help") => {
                eprintln!("talkkeeper-mcp [--db <existing database>] [--check]\nstdio only. Enable access in TalkKeeper settings.");
                return Ok(());
            }
            _ => return Err("Unknown argument".into()),
        }
    }
    let database = database.map(Ok).unwrap_or_else(default_database)?;
    let database = if database.is_absolute() {
        database
    } else {
        std::env::current_dir()
            .map_err(|_| "Cannot resolve database path")?
            .join(database)
    };
    if check {
        println!("Database: {}", database.display());
        println!("{}", talkkeeper_mcp::check(&database)?);
        return Ok(());
    }
    // Clients may discover tools even before the app has run; each call checks the database.
    let log_directory = database.parent().ok_or("Invalid database path")?.to_owned();
    let server = Server {
        database,
        log_directory,
    };
    let transport = talkkeeper_mcp::stdio::transport();
    server
        .serve(transport)
        .await
        .map_err(|_| "Initialization failed")?
        .waiting()
        .await
        .map_err(|_| "Server failed")?;
    Ok(())
}
