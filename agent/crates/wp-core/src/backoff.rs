//! Reconnect backoff.
//!
//! Kept separate and pure so the retry curve can be asserted in tests rather
//! than discovered in production. A fleet of a thousand agents reconnecting
//! after an outage is itself a load event, which is why there is jitter.

use std::time::Duration;

#[derive(Debug, Clone)]
pub struct Backoff {
    base: Duration,
    max: Duration,
    attempt: u32,
    /// Fraction of the delay that is randomized, 0.0..=1.0.
    jitter: f64,
}

impl Default for Backoff {
    fn default() -> Self {
        Self::new(Duration::from_secs(5), Duration::from_secs(300))
    }
}

impl Backoff {
    pub fn new(base: Duration, max: Duration) -> Self {
        Self {
            base,
            max,
            attempt: 0,
            jitter: 0.2,
        }
    }

    pub fn attempt(&self) -> u32 {
        self.attempt
    }

    /// Returns the next delay and advances the sequence.
    pub fn next_delay(&mut self) -> Duration {
        // Cap the exponent before shifting; 1u32 << 32 would overflow.
        let exponent = self.attempt.min(16);
        let multiplier = 1u64 << exponent;

        let raw = self
            .base
            .saturating_mul(multiplier.min(u32::MAX as u64) as u32);
        let capped = raw.min(self.max);

        self.attempt = self.attempt.saturating_add(1);
        Self::apply_jitter(capped, self.jitter)
    }

    /// Called after a success; the next failure starts from the base delay.
    pub fn reset(&mut self) {
        self.attempt = 0;
    }

    fn apply_jitter(delay: Duration, jitter: f64) -> Duration {
        if jitter <= 0.0 {
            return delay;
        }

        let millis = delay.as_millis() as f64;
        let spread = millis * jitter;
        // Deterministic-enough pseudo-randomness without pulling `rand` into
        // the hot path; the goal is only to de-synchronize a fleet.
        let factor = (std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.subsec_nanos())
            .unwrap_or(0) as f64
            / u32::MAX as f64)
            * 2.0
            - 1.0;

        let jittered = (millis + spread * factor).max(0.0);
        Duration::from_millis(jittered as u64)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Jitter is disabled in tests so the curve itself can be asserted.
    fn no_jitter(base_secs: u64, max_secs: u64) -> Backoff {
        let mut backoff = Backoff::new(Duration::from_secs(base_secs), Duration::from_secs(max_secs));
        backoff.jitter = 0.0;
        backoff
    }

    #[test]
    fn starts_at_the_base_delay() {
        let mut backoff = no_jitter(5, 300);
        assert_eq!(backoff.next_delay(), Duration::from_secs(5));
    }

    #[test]
    fn doubles_on_each_attempt() {
        let mut backoff = no_jitter(5, 300);
        assert_eq!(backoff.next_delay(), Duration::from_secs(5));
        assert_eq!(backoff.next_delay(), Duration::from_secs(10));
        assert_eq!(backoff.next_delay(), Duration::from_secs(20));
        assert_eq!(backoff.next_delay(), Duration::from_secs(40));
    }

    #[test]
    fn saturates_at_the_maximum() {
        let mut backoff = no_jitter(5, 60);
        for _ in 0..20 {
            backoff.next_delay();
        }
        assert_eq!(backoff.next_delay(), Duration::from_secs(60));
    }

    #[test]
    fn does_not_overflow_after_many_attempts() {
        let mut backoff = no_jitter(5, 300);
        // A machine offline for weeks must not panic on a shift overflow.
        for _ in 0..10_000 {
            let delay = backoff.next_delay();
            assert!(delay <= Duration::from_secs(300));
        }
    }

    #[test]
    fn reset_returns_to_the_base_delay() {
        let mut backoff = no_jitter(5, 300);
        backoff.next_delay();
        backoff.next_delay();
        backoff.reset();

        assert_eq!(backoff.attempt(), 0);
        assert_eq!(backoff.next_delay(), Duration::from_secs(5));
    }

    #[test]
    fn jitter_keeps_delays_within_the_expected_band() {
        let mut backoff = Backoff::new(Duration::from_secs(10), Duration::from_secs(300));

        for _ in 0..50 {
            let delay = backoff.next_delay();
            // +/-20% of a value that is itself capped at the maximum.
            assert!(delay <= Duration::from_secs(360));
        }
    }
}
