//! The tools as the server lists them (names, descriptions, input schemas).

use session_bridge_mcp::server::Bridge;

fn served() -> String {
    serde_json::to_string_pretty(&Bridge::tool_router().list_all()).unwrap()
}

/// A change to a tool's arguments, descriptions or schema generation shows up here. The
/// fixture was written from the server as it was before the unused `schemars = "0.8"`
/// dependency was removed, so it also proves that removal changed no schema.
#[test]
fn the_tool_schemas_are_pinned() {
    if std::env::var_os("SB_PRINT_TOOL_SCHEMAS").is_some() {
        println!("{}", served());
    }
    let want = include_str!("fixtures/tool-schemas.json");
    assert_eq!(served().trim(), want.trim());
}
