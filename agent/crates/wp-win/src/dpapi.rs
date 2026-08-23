//! DPAPI-backed secret storage.
//!
//! The device secret is what lets a machine report as a given employee, so it
//! must not sit on disk in the clear. `CryptProtectData` binds the ciphertext
//! to the Windows user account, meaning a copied file is useless on another
//! machine or under another account.

use anyhow::Result;
use wp_core::SecretStore;

#[cfg(windows)]
mod imp {
    use anyhow::{anyhow, Result};
    use windows_sys::Win32::Foundation::{LocalFree, HLOCAL};
    use windows_sys::Win32::Security::Cryptography::{
        CryptProtectData, CryptUnprotectData, CRYPTPROTECT_UI_FORBIDDEN, CRYPT_INTEGER_BLOB,
    };

    /// Mixed into the ciphertext; unsealing fails if it does not match, which
    /// stops a blob from another WorkPulse artifact being swapped in.
    const ENTROPY: &[u8] = b"workpulse-device-identity-v1";

    fn blob(data: &[u8]) -> CRYPT_INTEGER_BLOB {
        CRYPT_INTEGER_BLOB {
            cbData: data.len() as u32,
            pbData: data.as_ptr() as *mut u8,
        }
    }

    fn empty_blob() -> CRYPT_INTEGER_BLOB {
        CRYPT_INTEGER_BLOB {
            cbData: 0,
            pbData: std::ptr::null_mut(),
        }
    }

    /// Copies out of the DPAPI-allocated buffer and frees it.
    unsafe fn take(out: &CRYPT_INTEGER_BLOB) -> Vec<u8> {
        if out.pbData.is_null() || out.cbData == 0 {
            return Vec::new();
        }

        let copied = std::slice::from_raw_parts(out.pbData, out.cbData as usize).to_vec();
        LocalFree(out.pbData as HLOCAL);
        copied
    }

    pub fn seal(plaintext: &[u8]) -> Result<Vec<u8>> {
        let input = blob(plaintext);
        let entropy = blob(ENTROPY);
        let mut output = empty_blob();

        // UI_FORBIDDEN because this runs in a service with no desktop.
        let ok = unsafe {
            CryptProtectData(
                &input,
                std::ptr::null(),
                &entropy,
                std::ptr::null(),
                std::ptr::null(),
                CRYPTPROTECT_UI_FORBIDDEN,
                &mut output,
            )
        };

        if ok == 0 {
            return Err(anyhow!("CryptProtectData failed"));
        }

        Ok(unsafe { take(&output) })
    }

    pub fn unseal(sealed: &[u8]) -> Result<Vec<u8>> {
        let input = blob(sealed);
        let entropy = blob(ENTROPY);
        let mut output = empty_blob();

        let ok = unsafe {
            CryptUnprotectData(
                &input,
                std::ptr::null_mut(),
                &entropy,
                std::ptr::null(),
                std::ptr::null(),
                CRYPTPROTECT_UI_FORBIDDEN,
                &mut output,
            )
        };

        if ok == 0 {
            return Err(anyhow!(
                "CryptUnprotectData failed (identity may belong to another user account)"
            ));
        }

        Ok(unsafe { take(&output) })
    }
}

#[cfg(not(windows))]
mod imp {
    use anyhow::Result;

    pub fn seal(plaintext: &[u8]) -> Result<Vec<u8>> {
        Ok(plaintext.to_vec())
    }

    pub fn unseal(sealed: &[u8]) -> Result<Vec<u8>> {
        Ok(sealed.to_vec())
    }
}

/// `SecretStore` implementation used by the shipped agent.
pub struct DpapiStore;

impl SecretStore for DpapiStore {
    fn seal(&self, plaintext: &[u8]) -> Result<Vec<u8>> {
        imp::seal(plaintext)
    }

    fn unseal(&self, sealed: &[u8]) -> Result<Vec<u8>> {
        imp::unseal(sealed)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trips_a_secret() {
        let store = DpapiStore;
        let secret = b"a-device-secret-value";

        let sealed = store.seal(secret).expect("seal");
        let opened = store.unseal(&sealed).expect("unseal");

        assert_eq!(opened, secret);
    }

    #[cfg(windows)]
    #[test]
    fn does_not_store_the_secret_in_the_clear() {
        let store = DpapiStore;
        let secret = b"SENSITIVE-DEVICE-SECRET";

        let sealed = store.seal(secret).expect("seal");

        assert_ne!(sealed.as_slice(), secret.as_slice());
        assert!(!String::from_utf8_lossy(&sealed).contains("SENSITIVE-DEVICE-SECRET"));
    }

    #[cfg(windows)]
    #[test]
    fn rejects_tampered_ciphertext() {
        let store = DpapiStore;
        let mut sealed = store.seal(b"value").expect("seal");

        // Flipping a byte must fail the integrity check rather than yielding
        // garbage that would be parsed as an identity.
        let last = sealed.len() - 1;
        sealed[last] ^= 0xFF;

        assert!(store.unseal(&sealed).is_err());
    }

    #[test]
    fn handles_empty_input() {
        let store = DpapiStore;
        let sealed = store.seal(b"").expect("seal");
        assert_eq!(store.unseal(&sealed).expect("unseal"), Vec::<u8>::new());
    }
}
