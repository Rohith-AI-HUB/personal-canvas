use std::collections::HashMap;
use std::ffi::OsString;
use std::fs;
use std::io;
use std::net::TcpStream;
#[cfg(windows)]
use std::os::windows::process::CommandExt;
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use tauri::path::BaseDirectory;
use tauri::{AppHandle, Manager, RunEvent, State};

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x08000000;

fn apply_no_window(cmd: &mut Command) -> &mut Command {
  #[cfg(windows)]
  {
    cmd.creation_flags(CREATE_NO_WINDOW);
  }
  cmd
}

// ── Backend process handle ───────────────────────────────────────────────────

#[derive(Default)]
struct BackendProcess(Mutex<Option<Child>>);

// ── Startup status (exposed to frontend via invoke) ──────────────────────────

#[derive(Clone, serde::Serialize)]
pub struct StartupStatus {
  pub phase: String,
  pub message: String,
  pub elapsed_ms: u64,
  pub logs: Vec<String>,
}

struct StartupState {
  phase: String,
  message: String,
  started_at: std::time::Instant,
  logs: Vec<String>,
}

impl StartupState {
  fn new() -> Self {
    Self {
      phase: "initializing".to_string(),
      message: "Starting up...".to_string(),
      started_at: std::time::Instant::now(),
      logs: Vec::new(),
    }
  }

  fn set_phase(&mut self, phase: &str, message: &str) {
    self.phase = phase.to_string();
    self.message = message.to_string();
    let entry = format!("[{:.1}s] {}", self.started_at.elapsed().as_secs_f32(), message);
    log::info!("[startup] {phase}: {message}");
    self.logs.push(entry);
  }

  fn add_log(&mut self, msg: &str) {
    let entry = format!("[{:.1}s] {}", self.started_at.elapsed().as_secs_f32(), msg);
    log::info!("[startup] {msg}");
    self.logs.push(entry);
  }

  fn to_status(&self) -> StartupStatus {
    StartupStatus {
      phase: self.phase.clone(),
      message: self.message.clone(),
      elapsed_ms: self.started_at.elapsed().as_millis() as u64,
      logs: self.logs.clone(),
    }
  }
}

type SharedStartupState = Arc<Mutex<StartupState>>;

/// Tauri command — polled by the frontend loading screen every ~400 ms.
#[tauri::command]
fn get_startup_status(state: State<SharedStartupState>) -> StartupStatus {
  state.lock().unwrap_or_else(|e| e.into_inner()).to_status()
}

// ── .env parser (so we never bake secrets at compile time) ──────────────────

fn parse_dotenv(cwd: &PathBuf) -> HashMap<String, String> {
  let mut vars = HashMap::new();
  let env_path = cwd.join(".env");
  match fs::read_to_string(&env_path) {
    Ok(content) => {
      for line in content.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') {
          continue;
        }
        if let Some(pos) = line.find('=') {
          let key = line[..pos].trim().to_string();
          let val = line[pos + 1..]
            .trim()
            .trim_matches('"')
            .trim_matches('\'')
            .to_string();
          if !key.is_empty() {
            vars.insert(key, val);
          }
        }
      }
      log::info!("[startup] Loaded {} vars from {:?}", vars.len(), env_path);
    }
    Err(e) => {
      log::warn!("[startup] Could not read {:?}: {e}", env_path);
    }
  }
  vars
}

// ── Project root / backend path resolution ───────────────────────────────────

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

  if let Ok(entry) = app.path().resolve("backend/dist/server.js", BaseDirectory::Resource) {
    if let Ok(cwd) = app.path().resolve("backend", BaseDirectory::Resource) {
      candidates.push((entry, cwd));
    }
  }

  if let Ok(entry) = app.path().resolve("dist/server.js", BaseDirectory::Resource) {
    if let Ok(cwd) = app.path().resolve(".", BaseDirectory::Resource) {
      candidates.push((entry, cwd));
    }
  }

  candidates.into_iter().find(|(entry, cwd)| entry.exists() && cwd.exists())
}

// ── Qdrant ───────────────────────────────────────────────────────────────────

fn ensure_qdrant_running(ss: &SharedStartupState) {
  const NAME: &str = "canvaintel-qdrant";

  ss.lock().unwrap().set_phase("qdrant", "Starting Qdrant vector database...");

  // If anything is already serving Qdrant on localhost:6333, reuse it.
  if TcpStream::connect(("127.0.0.1", 6333)).is_ok() {
    ss.lock().unwrap().add_log("✓ Qdrant already reachable on 127.0.0.1:6333 (reusing existing instance)");
    return;
  }

  // ① Try to start an existing stopped container
  let mut start_cmd = Command::new("docker");
  start_cmd.args(["start", NAME]);
  match apply_no_window(&mut start_cmd).output() {
    Ok(out) if out.status.success() => {
      log_docker_output(&out.stdout, &out.stderr, ss);
      ss.lock().unwrap().add_log(&format!("✓ Qdrant container started: {NAME}"));
      return;
    }
    Ok(out) => {
      log_docker_output(&out.stdout, &out.stderr, ss);
      // Container not found → fall through to create
    }
    Err(e) => {
      ss.lock().unwrap()
        .add_log(&format!("⚠ docker start failed: {e} — ensure Docker Desktop is running"));
      return;
    }
  }

  // ② Create and start a fresh container
  ss.lock().unwrap().add_log(&format!("Creating Qdrant container: {NAME}"));
  let mut run_cmd = Command::new("docker");
  run_cmd.args([
    "run", "-d",
    "--name", NAME,
    "-p", "6333:6333",
    "-v", "canvaintel_qdrant_data:/qdrant/storage",
    "--restart", "unless-stopped",
    "qdrant/qdrant:latest",
  ]);
  match apply_no_window(&mut run_cmd).output() {
    Ok(out) => {
      log_docker_output(&out.stdout, &out.stderr, ss);
      if out.status.success() {
        ss.lock().unwrap().add_log("✓ Qdrant container created and started");
      } else {
        ss.lock().unwrap()
          .add_log("⚠ Failed to create Qdrant container — ensure Docker Desktop is running");
      }
    }
    Err(e) => {
      ss.lock().unwrap()
        .add_log(&format!("⚠ docker run failed: {e}"));
    }
  }
}

fn log_docker_output(stdout: &[u8], stderr: &[u8], ss: &SharedStartupState) {
  let mut guard = ss.lock().unwrap();
  for line in String::from_utf8_lossy(stdout).lines() {
    let l = line.trim();
    if !l.is_empty() {
      guard.add_log(&format!("  docker › {l}"));
    }
  }
  for line in String::from_utf8_lossy(stderr).lines() {
    let l = line.trim();
    if !l.is_empty() {
      guard.add_log(&format!("  docker › {l}"));
    }
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

fn stop_qdrant_container() {
  // Stop any running container currently publishing host port 6333.
  let mut by_port_cmd = Command::new("docker");
  by_port_cmd.args(["ps", "--filter", "publish=6333", "--format", "{{.Names}}"]);
  let by_port = apply_no_window(&mut by_port_cmd).output();

  if let Ok(out) = by_port {
    let names = String::from_utf8_lossy(&out.stdout);
    let mut stopped_any = false;
    for name in names.lines().map(str::trim).filter(|n| !n.is_empty()) {
      let mut stop_cmd = Command::new("docker");
      stop_cmd.args(["stop", name]);
      let _ = apply_no_window(&mut stop_cmd).output();
      log::info!("Stopped Qdrant container: {name}");
      stopped_any = true;
    }
    if stopped_any {
      return;
    }
  }

  // Fallback to the legacy managed name if port-based detection found nothing.
  const NAME: &str = "canvaintel-qdrant";
  let mut stop_cmd = Command::new("docker");
  stop_cmd.args(["stop", NAME]);
  let _ = apply_no_window(&mut stop_cmd).output();
  log::info!("Attempted to stop Qdrant container: {NAME}");
}

// ── node_modules extraction ───────────────────────────────────────────────────

fn ensure_node_modules_unpacked(app: &AppHandle, ss: &SharedStartupState) {
  let zip_path = match app.path().resolve("node_modules.zip", BaseDirectory::Resource) {
    Ok(p) if p.exists() => p,
    _ => {
      ss.lock().unwrap().add_log("node_modules.zip not found — running in dev mode");
      return;
    }
  };

  let backend_res = match app.path().resolve("backend", BaseDirectory::Resource) {
    Ok(p) => p,
    Err(e) => {
      ss.lock().unwrap().add_log(&format!("⚠ Could not resolve backend resource dir: {e}"));
      return;
    }
  };

  let dest = backend_res.join("node_modules");

  if dest.exists() {
    ss.lock().unwrap().add_log("node_modules already extracted — skipping");
    return;
  }

  ss.lock().unwrap()
    .set_phase("unpacking", "First launch: extracting dependencies (~30s)...");

  // PowerShell Expand-Archive is 3-5× faster than the Rust zip crate for
  // thousands of small files because it uses .NET's ZipFile class.
  let ps_cmd = format!(
    "Expand-Archive -Path '{}' -DestinationPath '{}' -Force",
    zip_path.display(),
    dest.display()
  );

  let mut ps_cmd_proc = Command::new("powershell");
  ps_cmd_proc.args(["-NoProfile", "-NonInteractive", "-Command", &ps_cmd]);
  match apply_no_window(&mut ps_cmd_proc).status() {
    Ok(s) if s.success() => {
      ss.lock().unwrap().add_log("✓ node_modules extracted via PowerShell");
      return;
    }
    Ok(s) => {
      ss.lock().unwrap()
        .add_log(&format!("PowerShell exited {s} — falling back to built-in extractor"));
    }
    Err(e) => {
      ss.lock().unwrap()
        .add_log(&format!("PowerShell unavailable ({e}) — using built-in extractor"));
    }
  }

  // Fallback: Rust zip crate (slower but no external dependency)
  let result = (|| -> io::Result<()> {
    let file = fs::File::open(&zip_path)?;
    let mut archive = zip::ZipArchive::new(file)
      .map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e))?;
    let total = archive.len();

    for i in 0..total {
      let mut zf = archive.by_index(i)
        .map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e))?;
      let out_path = match zf.enclosed_name() {
        Some(p) => dest.join(p),
        None => continue,
      };
      if zf.is_dir() {
        fs::create_dir_all(&out_path)?;
      } else {
        if let Some(parent) = out_path.parent() {
          fs::create_dir_all(parent)?;
        }
        let mut out_file = fs::File::create(&out_path)?;
        io::copy(&mut zf, &mut out_file)?;
      }
      // Emit progress every 500 files so the frontend sees movement
      if i % 500 == 0 && i > 0 {
        ss.lock().unwrap().set_phase(
          "unpacking",
          &format!("Extracting dependencies... ({}/{} files)", i, total),
        );
      }
    }
    Ok(())
  })();

  match result {
    Ok(()) => ss.lock().unwrap().add_log("✓ node_modules extracted"),
    Err(e) => ss.lock().unwrap().add_log(&format!("⚠ Extraction failed: {e}")),
  }
}

// ── Backend start / stop ─────────────────────────────────────────────────────

fn start_backend(app: &AppHandle, ss: &SharedStartupState) {
  ss.lock().unwrap().set_phase("backend_starting", "Starting Node.js backend server...");

  let Some((entry, cwd)) = resolve_backend_paths(app) else {
    ss.lock().unwrap()
      .add_log("⚠ Backend entry point not found (expected backend/dist/server.js)");
    return;
  };

  // ── Load API keys / config from backend/.env ─────────────────────────────
  // NOTE: We explicitly parse .env here rather than letting the Node process
  // dotenv load it because we previously passed GROQ_API_KEY="" which silently
  // overrode whatever was in the file.
  let env_vars = parse_dotenv(&cwd);

  // Storage root priority:
  // 1) BACKEND_STORAGE_ROOT from .env (explicit override)
  // 2) In local dev (backend/package.json exists), use project-root /storage
  //    so Tauri and start.bat read the same data.
  // 3) In packaged app, use app data directory.
  let storage_root = env_vars
    .get("BACKEND_STORAGE_ROOT")
    .map(|s| s.trim())
    .filter(|s| !s.is_empty())
    .map(PathBuf::from)
    .or_else(|| {
      if cwd.join("package.json").exists() {
        cwd.parent().map(|p| p.join("storage"))
      } else {
        None
      }
    })
    .or_else(|| app.path().app_data_dir().ok().map(|p| p.join("storage")))
    .unwrap_or_else(|| cwd.join("storage"));

  if let Err(e) = fs::create_dir_all(&storage_root) {
    ss.lock().unwrap().add_log(&format!("⚠ Could not create storage dir: {e}"));
  }

  let groq_ok = env_vars
    .get("GROQ_API_KEY")
    .map(|k| !k.is_empty() && k != "your_groq_api_key_here")
    .unwrap_or(false);

  if groq_ok {
    ss.lock().unwrap().add_log("✓ GROQ_API_KEY loaded from .env");
  } else {
    ss.lock().unwrap()
      .add_log("⚠ GROQ_API_KEY missing or placeholder — AI chat will be disabled");
  }

  // ── Find Node.js ─────────────────────────────────────────────────────────
  let mut node_candidates: Vec<OsString> = Vec::new();
  if let Ok(node_res) = app.path().resolve("node/node.exe", BaseDirectory::Resource) {
    node_candidates.push(node_res.into_os_string());
  }
  node_candidates.push(OsString::from("node"));
  if let Ok(pf) = std::env::var("ProgramFiles") {
    node_candidates.push(PathBuf::from(pf).join("nodejs").join("node.exe").into_os_string());
  }
  if let Ok(pf86) = std::env::var("ProgramFiles(x86)") {
    node_candidates.push(PathBuf::from(pf86).join("nodejs").join("node.exe").into_os_string());
  }
  if let Ok(lad) = std::env::var("LocalAppData") {
    node_candidates.push(
      PathBuf::from(lad).join("Programs").join("nodejs").join("node.exe").into_os_string(),
    );
  }

  // Probe for a working Node executable before spawning
  let node_exe = node_candidates.into_iter().find(|candidate| {
    let mut check = Command::new(candidate);
    check
      .arg("--version")
      .stdout(Stdio::null())
      .stderr(Stdio::null());
    apply_no_window(&mut check)
      .status()
      .map(|s| s.success())
      .unwrap_or(false)
  });

  let Some(node_exe) = node_exe else {
    ss.lock().unwrap()
      .add_log("⚠ Node.js not found in PATH or common locations — install Node.js first");
    return;
  };

  ss.lock().unwrap().add_log(&format!("Using Node: {}", node_exe.to_string_lossy()));

  let log_dir = storage_root.parent().unwrap_or(&storage_root).to_path_buf();

  let mut cmd = Command::new(&node_exe);
  cmd.arg(&entry)
    .current_dir(&cwd)
    // These are the safe defaults — overridden by .env below if present
    .env("NODE_ENV",               "production")
    .env("BACKEND_PORT",           "3001")
    .env("QDRANT_URL",             "http://127.0.0.1:6333")
    .env("BACKEND_STORAGE_ROOT",   &storage_root)
    .env("OLLAMA_BASE_URL",        "http://localhost:11434")
    .env("OLLAMA_CHAT_MODEL",      "minimax-m2.5:cloud");

  // Apply all .env values (including GROQ_API_KEY, overrides defaults above)
  for (k, v) in &env_vars {
    cmd.env(k, v);
  }

  cmd.stdout(
    fs::OpenOptions::new().create(true).append(true)
      .open(log_dir.join("backend.log"))
      .map(Stdio::from)
      .unwrap_or(Stdio::null()),
  );
  cmd.stderr(
    fs::OpenOptions::new().create(true).append(true)
      .open(log_dir.join("backend-error.log"))
      .map(Stdio::from)
      .unwrap_or(Stdio::null()),
  );

  match apply_no_window(&mut cmd).spawn() {
    Ok(child) => {
      if let Ok(mut guard) = app.state::<BackendProcess>().0.lock() {
        *guard = Some(child);
      }
      ss.lock().unwrap().add_log("✓ Backend process spawned");
    }
    Err(e) => {
      ss.lock().unwrap().add_log(&format!("⚠ Failed to spawn backend: {e}"));
    }
  }
}

fn stop_backend(app: &AppHandle) {
  let state = app.state::<BackendProcess>();
  let mut guard = match state.0.lock() {
    Ok(g) => g,
    Err(_) => return,
  };
  if let Some(mut child) = guard.take() {
    let _ = child.kill();
    let _ = child.wait();
    log::info!("Backend process stopped");
  }
}

// ── Entry point ──────────────────────────────────────────────────────────────

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  let startup_state: SharedStartupState = Arc::new(Mutex::new(StartupState::new()));

  let app = tauri::Builder::default()
    .manage(BackendProcess::default())
    .manage(startup_state.clone())
    .invoke_handler(tauri::generate_handler![get_startup_status])
    .setup(move |app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }

      let handle = app.handle().clone();
      let ss = startup_state.clone();

      std::thread::spawn(move || {
        // 1. Start Qdrant (captures docker output)
        ensure_qdrant_running(&ss);

        // 2. Wait for Qdrant port
        ss.lock().unwrap().set_phase("qdrant_wait", "Waiting for Qdrant on port 6333...");
        if wait_for_port(6333, 20, 500) {
          ss.lock().unwrap().add_log("✓ Qdrant is ready");
        } else {
          ss.lock().unwrap()
            .add_log("⚠ Qdrant not ready after 10s — vector search may be unavailable");
        }

        // 3. Unpack node_modules.zip (first launch only, PowerShell-fast)
        ensure_node_modules_unpacked(&handle, &ss);

        // 4. Start Node.js backend (reads .env properly)
        start_backend(&handle, &ss);

        // 5. Wait for backend HTTP server
        ss.lock().unwrap().set_phase("backend_wait", "Waiting for backend on port 3001...");
        if wait_for_port(3001, 60, 500) {
          ss.lock().unwrap().set_phase("ready", "✓ Backend is ready!");
        } else {
          ss.lock().unwrap()
            .set_phase("timeout", "⚠ Backend did not start in 30s — check backend.log");
        }
      });

      Ok(())
    })
    .build(tauri::generate_context!())
    .expect("error while building tauri application");

  app.run(|app, event| {
    if matches!(event, RunEvent::Exit | RunEvent::ExitRequested { .. }) {
      stop_backend(app);
      stop_qdrant_container();
    }
  });
}
