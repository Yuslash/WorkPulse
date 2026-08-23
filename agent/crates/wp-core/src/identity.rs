//! Persisted device identity.
//!
//! After enrollment the agent holds a `device_secret` that is equivalent to a
//! long-lived credential for one machine. It is stored via a pluggable
//! `SecretStore` so the Windows build can seal it with DPAPI while tests use
//! a plain file.

use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct DeviceIdentity {
    pub device_id: String,
    pub device_secret: String,
    pub employee_id: String,
    pub employee_name: String,
    pub organization_id: String,
    pub organization_name: String,
    pub server_url: String,
}

impl DeviceIdentity {
    /// Derives the queue encryption key from the device secret.
    ///
    /// Binding the two means a queue file copied to another machine is
    /// unreadable without also stealing the sealed secret, and revoking the
    /// device makes any lingering queue file permanently opaque.
    pub fn queue_key(&self) -> [u8; 32] {
        let mut hasher = Sha256::new();
        hasher.update(b"workpulse-queue-key-v1");
        hasher.update(self.device_secret.as_bytes());
        hasher.update(self.device_id.as_bytes());
        hasher.finalize().into()
    }
}

/// Platform hook for sealing bytes at rest. Windows implements this with
/// DPAPI; tests and non-Windows builds use the pass-through below.
pub trait SecretStore: Send + Sync {
    fn seal(&self, plaintext: &[u8]) -> Result<Vec<u8>>;
    fn unseal(&self, sealed: &[u8]) -> Result<Vec<u8>>;
}

/// No-op store. Used by tests; never selected on Windows.
pub struct PlaintextStore;

impl SecretStore for PlaintextStore {
    fn seal(&self, plaintext: &[u8]) -> Result<Vec<u8>> {
        Ok(plaintext.to_vec())
    }

    fn unseal(&self, sealed: &[u8]) -> Result<Vec<u8>> {
        Ok(sealed.to_vec())
    }
}

pub struct IdentityStore {
    path: PathBuf,
    secrets: Box<dyn SecretStore>,
}

impl IdentityStore {
    pub fn new(path: impl Into<PathBuf>, secrets: Box<dyn SecretStore>) -> Self {
        Self {
            path: path.into(),
            secrets,
        }
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    pub fn exists(&self) -> bool {
        self.path.exists()
    }

    pub fn load(&self) -> Result<Option<DeviceIdentity>> {
        if !self.path.exists() {
            return Ok(None);
        }

        let sealed = std::fs::read(&self.path).context("reading device identity")?;
        let plaintext = self
            .secrets
            .unseal(&sealed)
            .context("unsealing device identity")?;

        Ok(Some(
            serde_json::from_slice(&plaintext).context("parsing device identity")?,
        ))
    }

    pub fn save(&self, identity: &DeviceIdentity) -> Result<()> {
        if let Some(parent) = self.path.parent() {
            std::fs::create_dir_all(parent).context("creating identity directory")?;
        }

        let plaintext = serde_json::to_vec(identity).context("serializing device identity")?;
        let sealed = self.secrets.seal(&plaintext).context("sealing device identity")?;

        // Write-then-rename so an interrupted write cannot leave a truncated
        // identity that would force a re-enrollment.
        let temp = self.path.with_extension("tmp");
        std::fs::write(&temp, &sealed).context("writing device identity")?;
        std::fs::rename(&temp, &self.path).context("replacing device identity")?;
        Ok(())
    }

    /// Called when the server says the device is revoked or unknown. The
    /// agent returns to the un-enrolled state instead of retrying forever.
    pub fn clear(&self) -> Result<()> {
        if self.path.exists() {
            std::fs::remove_file(&self.path).context("removing device identity")?;
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn identity() -> DeviceIdentity {
        DeviceIdentity {
            device_id: "dev_123".into(),
            device_secret: "super-secret-value".into(),
            employee_id: "emp_1".into(),
            employee_name: "John Doe".into(),
            organization_id: "org_1".into(),
            organization_name: "Acme".into(),
            server_url: "https://api.example.com".into(),
        }
    }

    fn store(dir: &TempDir) -> IdentityStore {
        IdentityStore::new(dir.path().join("identity.bin"), Box::new(PlaintextStore))
    }

    #[test]
    fn returns_none_before_enrollment() {
        let dir = TempDir::new().unwrap();
        assert!(store(&dir).load().unwrap().is_none());
    }

    #[test]
    fn round_trips_an_identity() {
        let dir = TempDir::new().unwrap();
        let store = store(&dir);

        store.save(&identity()).unwrap();
        assert_eq!(store.load().unwrap().unwrap(), identity());
    }

    #[test]
    fn overwrites_on_re_enrollment() {
        let dir = TempDir::new().unwrap();
        let store = store(&dir);

        store.save(&identity()).unwrap();

        let mut rotated = identity();
        rotated.device_secret = "rotated-secret".into();
        store.save(&rotated).unwrap();

        assert_eq!(store.load().unwrap().unwrap().device_secret, "rotated-secret");
    }

    #[test]
    fn clear_returns_to_the_unenrolled_state() {
        let dir = TempDir::new().unwrap();
        let store = store(&dir);

        store.save(&identity()).unwrap();
        assert!(store.exists());

        store.clear().unwrap();
        assert!(!store.exists());
        assert!(store.load().unwrap().is_none());
    }

    #[test]
    fn clear_is_safe_when_nothing_is_stored() {
        let dir = TempDir::new().unwrap();
        assert!(store(&dir).clear().is_ok());
    }

    #[test]
    fn derives_a_stable_queue_key() {
        let first = identity().queue_key();
        let second = identity().queue_key();

        // The key must survive a restart, or the queue becomes unreadable.
        assert_eq!(first, second);
    }

    #[test]
    fn derives_a_different_key_for_a_different_secret() {
        let mut rotated = identity();
        rotated.device_secret = "a-different-secret".into();

        // Revoking a device must make any lingering queue file opaque.
        assert_ne!(identity().queue_key(), rotated.queue_key());
    }

    #[test]
    fn queue_key_is_not_the_raw_secret() {
        let identity = identity();
        let key = identity.queue_key();
        assert_ne!(&key[..], identity.device_secret.as_bytes());
    }
}
