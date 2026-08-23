//! Durable, encrypted, size-capped event queue (spec §22).
//!
//! Telemetry collected while the network is down has to survive a reboot, so
//! it lives on disk. It describes what someone did all day, so it is
//! encrypted at rest with AES-256-GCM. And it cannot be allowed to fill the
//! employee's disk, so it is capped and drops oldest-first.
//!
//! redb is used rather than SQLite because it is pure Rust — this project
//! targets windows-gnu and cannot rely on a C toolchain being present.

use crate::protocol::TelemetryEvent;
use aes_gcm::aead::{Aead, KeyInit, OsRng};
use aes_gcm::{Aes256Gcm, Key, Nonce};
use anyhow::{anyhow, Context, Result};
use rand::RngCore;
use redb::{Database, ReadableTable, ReadableTableMetadata, TableDefinition};
use std::path::Path;

/// Monotonic sequence number -> encrypted event. An integer key preserves
/// insertion order, which is what makes replay chronological.
const EVENTS: TableDefinition<u64, &[u8]> = TableDefinition::new("events");
/// Small key/value table for the next sequence number.
const META: TableDefinition<&str, u64> = TableDefinition::new("meta");

const NEXT_SEQ: &str = "next_seq";
const NONCE_LEN: usize = 12;

pub struct EventQueue {
    db: Database,
    cipher: Aes256Gcm,
    max_bytes: u64,
}

impl EventQueue {
    /// Opens (or creates) the queue. `key` must be 32 bytes; it is derived
    /// from the device secret so a copied queue file is useless on its own.
    pub fn open(path: &Path, key: &[u8; 32], max_bytes: u64) -> Result<Self> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).context("creating queue directory")?;
        }

        let db = Database::create(path).context("opening queue database")?;

        // Create both tables up front so readers never hit a missing table.
        {
            let tx = db.begin_write()?;
            tx.open_table(EVENTS)?;
            tx.open_table(META)?;
            tx.commit()?;
        }

        Ok(Self {
            db,
            cipher: Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(key)),
            max_bytes,
        })
    }

    pub fn set_max_bytes(&mut self, max_bytes: u64) {
        self.max_bytes = max_bytes;
    }

    /// Appends one event. Enforces the size cap afterwards, dropping the
    /// oldest events first — recent activity is more useful than stale.
    pub fn push(&self, event: &TelemetryEvent) -> Result<u64> {
        let plaintext = serde_json::to_vec(event).context("serializing event")?;
        let sealed = self.seal(&plaintext)?;

        let seq = {
            let tx = self.db.begin_write()?;
            let seq = {
                let mut meta = tx.open_table(META)?;
                let next = meta.get(NEXT_SEQ)?.map(|v| v.value()).unwrap_or(0);
                meta.insert(NEXT_SEQ, next + 1)?;
                next
            };
            {
                let mut events = tx.open_table(EVENTS)?;
                events.insert(seq, sealed.as_slice())?;
            }
            tx.commit()?;
            seq
        };

        self.enforce_cap()?;
        Ok(seq)
    }

    /// Reads up to `limit` events in insertion order without removing them.
    /// Events are only deleted once the server has acknowledged them, so a
    /// crash mid-upload replays rather than loses.
    pub fn peek(&self, limit: usize) -> Result<Vec<(u64, TelemetryEvent)>> {
        let tx = self.db.begin_read()?;
        let table = tx.open_table(EVENTS)?;

        let mut out = Vec::with_capacity(limit.min(64));
        for entry in table.iter()? {
            if out.len() >= limit {
                break;
            }
            let (key, value) = entry?;
            match self.open_sealed(value.value()) {
                Ok(event) => out.push((key.value(), event)),
                Err(error) => {
                    // A corrupt record must not wedge the queue forever; skip
                    // it here and let `remove` drop it with its batch.
                    tracing::warn!(seq = key.value(), %error, "dropping undecodable queue entry");
                    out.push((key.value(), TelemetryEvent::AgentLog {
                        event_id: crate::new_event_id("corrupt"),
                        level: crate::protocol::LogLevel::Warn,
                        message: "Dropped an unreadable queued event".into(),
                        occurred_at: chrono::Utc::now(),
                    }));
                }
            }
        }
        Ok(out)
    }

    /// Deletes acknowledged events.
    pub fn remove(&self, keys: &[u64]) -> Result<()> {
        if keys.is_empty() {
            return Ok(());
        }

        let tx = self.db.begin_write()?;
        {
            let mut table = tx.open_table(EVENTS)?;
            for key in keys {
                table.remove(*key)?;
            }
        }
        tx.commit()?;
        Ok(())
    }

    pub fn len(&self) -> Result<u64> {
        let tx = self.db.begin_read()?;
        Ok(tx.open_table(EVENTS)?.len()?)
    }

    pub fn is_empty(&self) -> Result<bool> {
        Ok(self.len()? == 0)
    }

    /// Approximate on-disk size of the queued payloads.
    pub fn size_bytes(&self) -> Result<u64> {
        let tx = self.db.begin_read()?;
        let table = tx.open_table(EVENTS)?;

        let mut total = 0u64;
        for entry in table.iter()? {
            let (_, value) = entry?;
            total += value.value().len() as u64;
        }
        Ok(total)
    }

    /// Drops oldest events until the queue fits under the cap.
    fn enforce_cap(&self) -> Result<()> {
        if self.size_bytes()? <= self.max_bytes {
            return Ok(());
        }

        let mut dropped = 0usize;
        loop {
            let victims = {
                let tx = self.db.begin_read()?;
                let table = tx.open_table(EVENTS)?;
                table
                    .iter()?
                    .take(64)
                    .filter_map(|entry| entry.ok().map(|(key, _)| key.value()))
                    .collect::<Vec<_>>()
            };

            if victims.is_empty() {
                break;
            }

            self.remove(&victims)?;
            dropped += victims.len();

            if self.size_bytes()? <= self.max_bytes {
                break;
            }
        }

        if dropped > 0 {
            tracing::warn!(dropped, "queue over capacity; dropped oldest events");
        }
        Ok(())
    }

    /// AES-256-GCM with a fresh random nonce, stored as `nonce || ciphertext`.
    fn seal(&self, plaintext: &[u8]) -> Result<Vec<u8>> {
        let mut nonce_bytes = [0u8; NONCE_LEN];
        OsRng.fill_bytes(&mut nonce_bytes);
        let nonce = Nonce::from_slice(&nonce_bytes);

        let ciphertext = self
            .cipher
            .encrypt(nonce, plaintext)
            .map_err(|_| anyhow!("failed to encrypt queue entry"))?;

        let mut sealed = Vec::with_capacity(NONCE_LEN + ciphertext.len());
        sealed.extend_from_slice(&nonce_bytes);
        sealed.extend_from_slice(&ciphertext);
        Ok(sealed)
    }

    fn open_sealed(&self, sealed: &[u8]) -> Result<TelemetryEvent> {
        if sealed.len() <= NONCE_LEN {
            return Err(anyhow!("queue entry too short"));
        }

        let (nonce_bytes, ciphertext) = sealed.split_at(NONCE_LEN);
        let plaintext = self
            .cipher
            .decrypt(Nonce::from_slice(nonce_bytes), ciphertext)
            .map_err(|_| anyhow!("failed to decrypt queue entry"))?;

        serde_json::from_slice(&plaintext).context("deserializing queued event")
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::protocol::LogLevel;
    use chrono::Utc;
    use tempfile::TempDir;

    fn key() -> [u8; 32] {
        [7u8; 32]
    }

    fn log_event(message: &str) -> TelemetryEvent {
        TelemetryEvent::AgentLog {
            event_id: crate::new_event_id("test"),
            level: LogLevel::Info,
            message: message.to_string(),
            occurred_at: Utc::now(),
        }
    }

    fn open_queue(dir: &TempDir, max_bytes: u64) -> EventQueue {
        EventQueue::open(&dir.path().join("queue.redb"), &key(), max_bytes).unwrap()
    }

    #[test]
    fn stores_and_reads_back_an_event() {
        let dir = TempDir::new().unwrap();
        let queue = open_queue(&dir, 1024 * 1024);

        queue.push(&log_event("hello")).unwrap();

        let items = queue.peek(10).unwrap();
        assert_eq!(items.len(), 1);
        match &items[0].1 {
            TelemetryEvent::AgentLog { message, .. } => assert_eq!(message, "hello"),
            _ => panic!("wrong event type"),
        }
    }

    #[test]
    fn preserves_insertion_order() {
        let dir = TempDir::new().unwrap();
        let queue = open_queue(&dir, 1024 * 1024);

        for i in 0..5 {
            queue.push(&log_event(&format!("event-{i}"))).unwrap();
        }

        let items = queue.peek(10).unwrap();
        let messages: Vec<String> = items
            .iter()
            .map(|(_, event)| match event {
                TelemetryEvent::AgentLog { message, .. } => message.clone(),
                _ => String::new(),
            })
            .collect();

        assert_eq!(messages, vec!["event-0", "event-1", "event-2", "event-3", "event-4"]);
    }

    #[test]
    fn peek_does_not_consume() {
        let dir = TempDir::new().unwrap();
        let queue = open_queue(&dir, 1024 * 1024);
        queue.push(&log_event("still here")).unwrap();

        // Events survive until the server acknowledges them, so a crash
        // mid-upload replays instead of losing data.
        assert_eq!(queue.peek(10).unwrap().len(), 1);
        assert_eq!(queue.peek(10).unwrap().len(), 1);
        assert_eq!(queue.len().unwrap(), 1);
    }

    #[test]
    fn remove_deletes_acknowledged_events() {
        let dir = TempDir::new().unwrap();
        let queue = open_queue(&dir, 1024 * 1024);

        for i in 0..3 {
            queue.push(&log_event(&format!("e{i}"))).unwrap();
        }

        let keys: Vec<u64> = queue.peek(2).unwrap().iter().map(|(key, _)| *key).collect();
        queue.remove(&keys).unwrap();

        assert_eq!(queue.len().unwrap(), 1);
    }

    #[test]
    fn survives_a_reopen() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("queue.redb");

        {
            let queue = EventQueue::open(&path, &key(), 1024 * 1024).unwrap();
            queue.push(&log_event("persisted")).unwrap();
        }

        // A reboot mid-outage must not lose the day's telemetry.
        let queue = EventQueue::open(&path, &key(), 1024 * 1024).unwrap();
        assert_eq!(queue.len().unwrap(), 1);
    }

    #[test]
    fn keeps_sequence_numbers_unique_across_reopens() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("queue.redb");

        {
            let queue = EventQueue::open(&path, &key(), 1024 * 1024).unwrap();
            queue.push(&log_event("first")).unwrap();
        }

        let queue = EventQueue::open(&path, &key(), 1024 * 1024).unwrap();
        let seq = queue.push(&log_event("second")).unwrap();

        // Reusing sequence 0 would overwrite the pending event.
        assert_eq!(seq, 1);
        assert_eq!(queue.len().unwrap(), 2);
    }

    #[test]
    fn stores_events_encrypted_on_disk() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("queue.redb");

        {
            let queue = EventQueue::open(&path, &key(), 1024 * 1024).unwrap();
            queue
                .push(&log_event("SENSITIVE-MARKER-STRING"))
                .unwrap();
        }

        let raw = std::fs::read(&path).unwrap();
        let haystack = String::from_utf8_lossy(&raw);

        // Telemetry describes someone's whole day; it must not sit in
        // plaintext on their laptop.
        assert!(!haystack.contains("SENSITIVE-MARKER-STRING"));
    }

    #[test]
    fn a_different_key_cannot_read_the_queue() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("queue.redb");

        {
            let queue = EventQueue::open(&path, &key(), 1024 * 1024).unwrap();
            queue.push(&log_event("secret")).unwrap();
        }

        let other = EventQueue::open(&path, &[9u8; 32], 1024 * 1024).unwrap();
        let items = other.peek(10).unwrap();

        // Decryption fails, so the entry surfaces as a corruption marker
        // rather than as readable data.
        match &items[0].1 {
            TelemetryEvent::AgentLog { message, .. } => {
                assert!(message.contains("unreadable"));
            }
            _ => panic!("expected the corruption marker"),
        }
    }

    #[test]
    fn drops_oldest_events_when_over_capacity() {
        let dir = TempDir::new().unwrap();
        // Small cap so a handful of events trips it.
        let queue = open_queue(&dir, 2048);

        for i in 0..200 {
            queue.push(&log_event(&format!("event-{i}"))).unwrap();
        }

        assert!(queue.size_bytes().unwrap() <= 2048);
        assert!(queue.len().unwrap() < 200);

        // What survives must be the most recent, not the oldest.
        let items = queue.peek(500).unwrap();
        match &items.last().unwrap().1 {
            TelemetryEvent::AgentLog { message, .. } => assert_eq!(message, "event-199"),
            _ => panic!("wrong event type"),
        }
    }

    #[test]
    fn limits_the_peek_batch_size() {
        let dir = TempDir::new().unwrap();
        let queue = open_queue(&dir, 1024 * 1024);

        for i in 0..50 {
            queue.push(&log_event(&format!("e{i}"))).unwrap();
        }

        assert_eq!(queue.peek(10).unwrap().len(), 10);
    }

    #[test]
    fn reports_empty_correctly() {
        let dir = TempDir::new().unwrap();
        let queue = open_queue(&dir, 1024 * 1024);

        assert!(queue.is_empty().unwrap());
        queue.push(&log_event("x")).unwrap();
        assert!(!queue.is_empty().unwrap());
    }
}
