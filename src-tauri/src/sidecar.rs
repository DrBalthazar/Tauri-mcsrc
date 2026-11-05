use serde_json::{json, Value};
use std::io::{BufRead, BufReader, Write};
use std::process::{Child, ChildStdin, ChildStdout, Command, Stdio};

pub struct SidecarProcess {
    child: Child,
    stdin: ChildStdin,
    stdout: BufReader<ChildStdout>,
    next_id: u64,
}

impl SidecarProcess {
    pub fn spawn(java_path: &str, jar_path: &str) -> std::io::Result<Self> {
        let mut child = Command::new(java_path)
            .args(["-jar", jar_path])
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit())
            .spawn()?;

        let stdin = child.stdin.take().expect("stdin piped");
        let stdout = BufReader::new(child.stdout.take().expect("stdout piped"));

        Ok(Self {
            child,
            stdin,
            stdout,
            next_id: 1,
        })
    }

    pub fn send(&mut self, cmd: &str, params: Value) -> std::io::Result<String> {
        let id = self.next_id.to_string();
        self.next_id += 1;

        let request = json!({
            "id": id,
            "cmd": cmd,
            "params": params,
        });

        writeln!(self.stdin, "{}", request)?;
        self.stdin.flush()?;

        Ok(id)
    }

    pub fn read_message(&mut self) -> std::io::Result<Option<Value>> {
        loop {
            let mut line = String::new();
            let n = self.stdout.read_line(&mut line)?;
            if n == 0 {
                return Ok(None);
            }

            let trimmed = line.trim();
            if trimmed.is_empty() {
                continue;
            }

            if let Ok(v) = serde_json::from_str::<Value>(trimmed) {
                return Ok(Some(v));
            }
        }
    }

    pub fn request(&mut self, cmd: &str, params: Value) -> std::io::Result<Value> {
        let id = self.send(cmd, params)?;
        loop {
            match self.read_message()? {
                Some(v) => {
                    if v.get("id").and_then(|x| x.as_str()) == Some(&id) {
                        return Ok(v);
                    }
                }
                None => {
                    return Err(std::io::Error::new(
                        std::io::ErrorKind::UnexpectedEof,
                        "sidecar process closed stdout",
                    ));
                }
            }
        }
    }

    /// کشتن پروسه (برای cancel)
    pub fn kill(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

impl Drop for SidecarProcess {
    fn drop(&mut self) {
        let _ = writeln!(self.stdin, "{}", json!({"id": "shutdown", "cmd": "shutdown"}));
        let _ = self.stdin.flush();
        std::thread::sleep(std::time::Duration::from_millis(200));
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}