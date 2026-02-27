use std::fs;
use std::ffi::OsString;
use std::net::TcpStream;
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::Duration;

use tauri::path::BaseDirectory;
use tauri::{AppHandle, Manager, RunEvent};

#[derive(Default)]
struct BackendProcess(Mutex<Option<Child>>);

fn find_project_root() -> Option<PathBuf> {
  let compile_time_root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
    .parent()
    .map(|p| p.to_path_buf());
  if let Some(root) = compile_time_root {
    if root.join("backend").join("package.json").exists() {
      return Some(root);
    }
  }

  let mut dir = std::env::current_dir().ok()?;
  for _ in 0..6 {
    if dir.join("backend").join("package.json").exists() {
      return Some(dir);
    }
    if !dir.pop() {
      break;
    }
  }
  None
}

fn resolve_backend_paths(app: &AppHandle) -> Option<(PathBuf, PathBuf)> {
  let mut candidates: Vec<(PathBuf, PathBuf)> = Vec::new();

  if let Some(root) = find_project_root() {
    candidates.push((
      root.join("backend").join("dist").join("server.js"),
      root.join("backend"),
    ));
  }

  if let Ok(resource_backend_entry) = app.path().resolve("backend/dist/server.js", BaseDirectory::Resource) {
    if let Ok(resource_backend_cwd) = app.path().resolve("backend", BaseDirectory::Resource) {
      candidates.push((resource_backend_entry, resource_backend_cwd));
    }
  }

  if let Ok(flat_entry) = app.path().resolve("dist/server.js", BaseDirectory::Resource) {
    if let Ok(flat_cwd) = app.path().resolve(".", BaseDirectory::Resource) {
      candidates.push((flat_entry, flat_cwd));
    }
  }

  candidates.into_iter().find(|(entry, cwd)| entry.exists() && cwd.exists())
}

fn ensure_qdrant_running() {
  const CONTAINER_NAME: &str = "canvaintel-qdrant";

  let started = Command::new("docker")
    .args(["start", CONTAINER_NAME])
    .stdout(Stdio::null())
    .stderr(Stdio::null())
    .status()
    .map(|status| status.success())
    .unwrap_or(false);

  if started {
    log::info!("Qdrant container started: {CONTAINER_NAME}");
    return;
  }

  let created = Command::new("docker")
    .args([
      "run",
      "-d",
      "--name",
      CONTAINER_NAME,
      "-p",
      "6333:6333",
      "-v",
      "canvaintel_qdrant_data:/qdrant/storage",
      "--restart",
      "unless-stopped",
      "qdrant/qdrant:latest",
    ])
    .stdout(Stdio::null())
    .stderr(Stdio::null())
    .status()
    .map(|status| status.success())
    .unwrap_or(false);

  if created {
    log::info!("Qdrant container created and started: {CONTAINER_NAME}");
  } else {
    log::warn!("Failed to start Qdrant automatically. Ensure Docker Desktop is running.");
  }
}

fn wait_for_port(port: u16, attempts: u32, delay_ms: u64) -> bool {
  for _ in 0..attempts {
    if TcpStream::connect(("127.0.0.1", port)).is_ok() {
      return true;
    }
    std::thread::sleep(Duration::from_millis(delay_ms));
  }
  false
}

fn start_backend(app: &AppHandle) {
  let Some((entry, cwd)) = resolve_backend_paths(app) else {
    log::error!("Backend entry not found. Expected backend/dist/server.js in project or resources.");
    return;
  };

  let storage_root = app
    .path()
    .app_data_dir()
    .map(|p| p.join("storage"))
    .unwrap_or_else(|_| cwd.join("storage"));

  if let Err(err) = fs::create_dir_all(&storage_root) {
    log::warn!("Could not create backend storage directory at {:?}: {}", storage_root, err);
  }

  let mut node_candidates: Vec<OsString> = vec![OsString::from("node")];

  if let Ok(program_files) = std::env::var("ProgramFiles") {
    node_candidates.push(PathBuf::from(program_files).join("nodejs").join("node.exe").into_os_string());
  }
  if let Ok(program_files_x86) = std::env::var("ProgramFiles(x86)") {
    node_candidates.push(PathBuf::from(program_files_x86).join("nodejs").join("node.exe").into_os_string());
  }
  if let Ok(local_app_data) = std::env::var("LocalAppData") {
    node_candidates.push(
      PathBuf::from(local_app_data)
        .join("Programs")
        .join("nodejs")
        .join("node.exe")
        .into_os_string(),
    );
  }

  let mut spawned: Option<Child> = None;
  for candidate in node_candidates {
    let child = Command::new(&candidate)
      .arg(&entry)
      .current_dir(&cwd)
      .env("NODE_ENV", "production")
      .env("BACKEND_PORT", "3001")
      .env("QDRANT_URL", "http://127.0.0.1:6333")
      .env("BACKEND_STORAGE_ROOT", &storage_root)
      // ── AI service credentials ──────────────────
      // These are embedded into the binary at build time to avoid hardcoding in source.
      // In development, you can set them in your .env file or environment.
      .env("GROQ_API_KEY", option_env!("GROQ_API_KEY").unwrap_or(""))
      .env("OLLAMA_BASE_URL", "http://localhost:11434")
      .env("OLLAMA_CHAT_MODEL", "minimax-m2.5:cloud")
      .stdout({
        let log_path = storage_root.parent().unwrap_or(&storage_root).join("backend.log");
        fs::OpenOptions::new()
          .create(true).append(true).open(&log_path)
          .map(Stdio::from)
          .unwrap_or(Stdio::null())
      })
      .stderr({
        let log_path = storage_root.parent().unwrap_or(&storage_root).join("backend-error.log");
        fs::OpenOptions::new()
          .create(true).append(true).open(&log_path)
          .map(Stdio::from)
          .unwrap_or(Stdio::null())
      })
      .spawn();

    match child {
      Ok(child) => {
        log::info!("Backend started with Node executable: {:?}", candidate);
        spawned = Some(child);
        break;
      }
      Err(err) => {
        log::warn!("Failed to start backend with {:?}: {}", candidate, err);
      }
    }
  }

  if let Some(child) = spawned {
    let state = app.state::<BackendProcess>();
    if let Ok(mut guard) = state.0.lock() {
      *guard = Some(child);
    }
    log::info!("Backend started at http://127.0.0.1:3001");
  } else {
    log::error!("Failed to start backend process with all Node candidates.");
    log::error!("Install Node.js and ensure node.exe is available system-wide.");
  }
}

fn stop_backend(app: &AppHandle) {
  let state = app.state::<BackendProcess>();
  let mut guard = match state.0.lock() {
    Ok(guard) => guard,
    Err(_) => return,
  };

  if let Some(mut child) = guard.take() {
    let _ = child.kill();
    let _ = child.wait();
    log::info!("Backend process stopped");
  }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  let app = tauri::Builder::default()
    .manage(BackendProcess::default())
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }

      let handle = app.handle().clone();
      std::thread::spawn(move || {
        ensure_qdrant_running();
        let _ = wait_for_port(6333, 20, 500);
        start_backend(&handle);
        // Wait for backend HTTP server to be ready before the UI makes API calls
        if wait_for_port(3001, 40, 500) {
          log::info!("Backend is ready on port 3001");
        } else {
          log::warn!("Backend did not become ready within 20s — UI may show errors on first load");
        }
      });

      Ok(())
    })
    .build(tauri::generate_context!())
    .expect("error while building tauri application");

  app.run(|app, event| {
      if matches!(event, RunEvent::Exit | RunEvent::ExitRequested { .. }) {
        stop_backend(app);
      }
    });
}
