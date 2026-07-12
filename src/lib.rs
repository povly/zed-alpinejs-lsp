use std::fs;
use zed_extension_api::{self as zed, LanguageServerId, Result};

const SERVER_FILES: &[(&str, &str)] = &[
    ("server/dist/index.js", include_str!("../server/dist/index.js")),
    ("server/dist/server.js", include_str!("../server/dist/server.js")),
    ("server/dist/extractor.js", include_str!("../server/dist/extractor.js")),
    ("server/dist/workspace.js", include_str!("../server/dist/workspace.js")),
    ("server/dist/xdata.js", include_str!("../server/dist/xdata.js")),
    ("server/dist/data.js", include_str!("../server/dist/data.js")),
];

struct AlpineExtension {
    did_install: bool,
}

impl AlpineExtension {
    fn server_exists(&self) -> bool {
        fs::metadata("server/dist/index.js").is_ok_and(|s| s.is_file())
    }

    fn install_server(&mut self, language_server_id: &LanguageServerId) -> Result<()> {
        if self.did_install && self.server_exists() {
            return Ok(());
        }

        zed::set_language_server_installation_status(
            language_server_id,
            &zed::LanguageServerInstallationStatus::Downloading,
        );

        for (path, content) in SERVER_FILES {
            if let Some(parent) = std::path::Path::new(path).parent() {
                let _ = fs::create_dir_all(parent);
            }
            fs::write(path, content)
                .map_err(|e| format!("Failed to write {path}: {e}"))?;
        }

        for (name, version) in [
            ("vscode-languageserver", "10.1.0"),
            ("vscode-languageserver-textdocument", "1.0.12"),
        ] {
            zed::npm_install_package(name, version)?;
        }

        self.did_install = true;
        Ok(())
    }
}

impl zed::Extension for AlpineExtension {
    fn new() -> Self {
        Self { did_install: false }
    }

    fn language_server_command(
        &mut self,
        _language_server_id: &LanguageServerId,
        _worktree: &zed::Worktree,
    ) -> Result<zed::Command> {
        self.install_server(_language_server_id)?;

        let server_path = std::env::current_dir()
            .map_err(|_| "Could not get current directory")?
            .join("server/dist/index.js");

        Ok(zed::Command {
            command: zed::node_binary_path()?,
            args: vec![
                server_path.to_string_lossy().to_string(),
                "--stdio".to_string(),
            ],
            env: Default::default(),
        })
    }
}

zed::register_extension!(AlpineExtension);
