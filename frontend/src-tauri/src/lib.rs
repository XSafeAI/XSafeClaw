use std::{
    io::{Read, Write},
    net::{SocketAddr, TcpListener, TcpStream},
    sync::Mutex,
    thread,
    time::{Duration, Instant},
};

use tauri::{Manager, WebviewUrl, WebviewWindowBuilder, WindowEvent};
use tauri_plugin_shell::{process::CommandChild, ShellExt};

const LOOPBACK_HOST: &str = "127.0.0.1";
const DEV_FRONTEND_URL: &str = "http://127.0.0.1:3003";
const BACKEND_READY_TIMEOUT: Duration = Duration::from_secs(60);

struct BackendSidecar {
    child: Mutex<Option<CommandChild>>,
}

impl Default for BackendSidecar {
    fn default() -> Self {
        Self {
            child: Mutex::new(None),
        }
    }
}

impl BackendSidecar {
    fn set_child(&self, child: CommandChild) {
        if let Ok(mut current_child) = self.child.lock() {
            *current_child = Some(child);
        }
    }

    fn kill_backend_sidecar(&self) {
        if let Ok(mut current_child) = self.child.lock() {
            if let Some(mut child) = current_child.take() {
                let _ = child.kill();
            }
        }
    }
}

impl Drop for BackendSidecar {
    fn drop(&mut self) {
        self.kill_backend_sidecar();
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(BackendSidecar::default())
        .setup(setup_main_window)
        .on_window_event(|window, event| {
            if matches!(event, WindowEvent::CloseRequested { .. }) {
                window.state::<BackendSidecar>().kill_backend_sidecar();
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running XSafeClaw desktop app");
}

#[cfg(debug_assertions)]
fn setup_main_window(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    create_main_window(app, DEV_FRONTEND_URL)?;
    Ok(())
}

#[cfg(not(debug_assertions))]
fn setup_main_window(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    let port = find_available_port()?;
    let port_arg = port.to_string();
    let sidecar_command = app.shell().sidecar("xsafeclaw-backend")?.args([
        "--host",
        "127.0.0.1",
        "--port",
        port_arg.as_str(),
    ]);
    let (mut sidecar_events, child) = sidecar_command.spawn()?;

    tauri::async_runtime::spawn(async move {
        while sidecar_events.recv().await.is_some() {}
    });

    let backend_sidecar = app.state::<BackendSidecar>();
    backend_sidecar.set_child(child);

    if let Err(error) = wait_for_backend(port, BACKEND_READY_TIMEOUT) {
        backend_sidecar.kill_backend_sidecar();
        return Err(Box::new(error));
    }

    let backend_url = format!("http://{LOOPBACK_HOST}:{port}");
    create_main_window(app, &backend_url)?;
    Ok(())
}

fn create_main_window(
    app: &mut tauri::App,
    url: &str,
) -> Result<(), Box<dyn std::error::Error>> {
    WebviewWindowBuilder::new(app, "main", WebviewUrl::External(url.parse()?))
        .title("XSafeClaw")
        .inner_size(1200.0, 800.0)
        .min_inner_size(1000.0, 650.0)
        .decorations(false)
        .resizable(true)
        .center()
        .build()?;
    Ok(())
}

#[cfg(not(debug_assertions))]
fn find_available_port() -> std::io::Result<u16> {
    let listener = TcpListener::bind((LOOPBACK_HOST, 0))?;
    let port = listener.local_addr()?.port();
    drop(listener);
    Ok(port)
}

#[cfg(not(debug_assertions))]
fn wait_for_backend(port: u16, timeout: Duration) -> std::io::Result<()> {
    let deadline = Instant::now() + timeout;
    while Instant::now() < deadline {
        if backend_health_check(port) {
            return Ok(());
        }
        thread::sleep(Duration::from_millis(250));
    }

    Err(std::io::Error::new(
        std::io::ErrorKind::TimedOut,
        "XSafeClaw backend sidecar did not become ready in time",
    ))
}

#[cfg(not(debug_assertions))]
fn backend_health_check(port: u16) -> bool {
    let address = SocketAddr::from(([127, 0, 0, 1], port));
    let Ok(mut stream) = TcpStream::connect_timeout(&address, Duration::from_millis(500)) else {
        return false;
    };

    let _ = stream.set_read_timeout(Some(Duration::from_millis(500)));
    let _ = stream.set_write_timeout(Some(Duration::from_millis(500)));

    let request = format!(
        "GET /api/system/install-status HTTP/1.1\r\nHost: {LOOPBACK_HOST}:{port}\r\nConnection: close\r\n\r\n"
    );
    if stream.write_all(request.as_bytes()).is_err() {
        return false;
    }

    let mut response = [0_u8; 64];
    let Ok(read_len) = stream.read(&mut response) else {
        return false;
    };
    let status_line = String::from_utf8_lossy(&response[..read_len]);
    status_line.starts_with("HTTP/1.1 200") || status_line.starts_with("HTTP/1.0 200")
}
