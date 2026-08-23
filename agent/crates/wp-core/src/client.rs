//! HTTP client for the agent API.
//!
//! Owns exactly one concern beyond transport: keeping a valid access token.
//! Tokens live 15 minutes, so every call may need to refresh first; doing
//! that here means no caller has to think about it.

use crate::protocol::*;
use anyhow::Result;
use chrono::{DateTime, Duration as ChronoDuration, Utc};
use reqwest::{Client, StatusCode};
use std::sync::Arc;
use tokio::sync::Mutex;

#[derive(Debug, thiserror::Error)]
pub enum ClientError {
    /// The device is revoked or unknown: stop retrying, wipe local identity.
    #[error("terminal error from server: {code} - {message}")]
    Terminal { code: String, message: String },

    /// Wrong userId/password at enrollment. Not retryable, but not terminal
    /// for a device either — there is no device yet.
    #[error("invalid credentials: {0}")]
    InvalidCredentials(String),

    #[error("rate limited by server")]
    RateLimited,

    /// Anything transient: network down, 5xx, timeout. Retry with backoff.
    #[error("transport error: {0}")]
    Transport(String),

    #[error("unexpected server response ({status}): {body}")]
    Unexpected { status: u16, body: String },
}

impl ClientError {
    /// Whether the caller should retry after a backoff delay.
    pub fn is_retryable(&self) -> bool {
        matches!(self, Self::Transport(_) | Self::RateLimited | Self::Unexpected { .. })
    }

    pub fn is_terminal(&self) -> bool {
        matches!(self, Self::Terminal { .. })
    }
}

/// Refresh this long before actual expiry, so a request never races the clock.
const TOKEN_REFRESH_MARGIN_SEC: i64 = 60;

#[derive(Debug, Clone)]
struct Token {
    value: String,
    expires_at: DateTime<Utc>,
}

impl Token {
    fn is_fresh(&self) -> bool {
        Utc::now() + ChronoDuration::seconds(TOKEN_REFRESH_MARGIN_SEC) < self.expires_at
    }
}

pub struct ApiClient {
    http: Client,
    base_url: String,
    device_id: Option<String>,
    device_secret: Option<String>,
    token: Arc<Mutex<Option<Token>>>,
}

impl ApiClient {
    pub fn new(base_url: impl Into<String>) -> Result<Self> {
        let http = Client::builder()
            .timeout(std::time::Duration::from_secs(30))
            .connect_timeout(std::time::Duration::from_secs(10))
            .user_agent(format!("WorkPulseAgent/{}", crate::AGENT_VERSION))
            .build()?;

        Ok(Self {
            http,
            base_url: base_url.into().trim_end_matches('/').to_string(),
            device_id: None,
            device_secret: None,
            token: Arc::new(Mutex::new(None)),
        })
    }

    /// Supplies the device credentials so the client can refresh on its own.
    pub fn with_device(mut self, device_id: String, device_secret: String) -> Self {
        self.device_id = Some(device_id);
        self.device_secret = Some(device_secret);
        self
    }

    pub fn base_url(&self) -> &str {
        &self.base_url
    }

    fn url(&self, path: &str) -> String {
        format!("{}{}", self.base_url, path)
    }

    // -----------------------------------------------------------------------
    // Unauthenticated
    // -----------------------------------------------------------------------

    pub async fn enroll(
        &self,
        user_id: &str,
        password: &str,
        device: DeviceInfo,
    ) -> Result<EnrollResponse, ClientError> {
        let request = EnrollRequest {
            user_id: user_id.to_string(),
            password: password.to_string(),
            device,
        };

        let response = self
            .http
            .post(self.url("/api/agent/enroll"))
            .json(&request)
            .send()
            .await
            .map_err(|e| ClientError::Transport(e.to_string()))?;

        let enrolled: EnrollResponse = Self::parse(response).await?;

        // Cache the token that came with enrollment so the first heartbeat
        // does not need an immediate round trip.
        *self.token.lock().await = Some(Token {
            value: enrolled.access_token.clone(),
            expires_at: enrolled.access_token_expires_at,
        });

        Ok(enrolled)
    }

    // -----------------------------------------------------------------------
    // Authenticated
    // -----------------------------------------------------------------------

    /// Returns a valid access token, refreshing it if needed.
    async fn access_token(&self) -> Result<String, ClientError> {
        {
            let cached = self.token.lock().await;
            if let Some(token) = cached.as_ref() {
                if token.is_fresh() {
                    return Ok(token.value.clone());
                }
            }
        }

        let (device_id, device_secret) = match (&self.device_id, &self.device_secret) {
            (Some(id), Some(secret)) => (id.clone(), secret.clone()),
            _ => {
                return Err(ClientError::Terminal {
                    code: "DEVICE_UNKNOWN".into(),
                    message: "agent is not enrolled".into(),
                })
            }
        };

        let response = self
            .http
            .post(self.url("/api/agent/token"))
            .json(&TokenRequest {
                device_id,
                device_secret,
            })
            .send()
            .await
            .map_err(|e| ClientError::Transport(e.to_string()))?;

        let issued: TokenResponse = Self::parse(response).await?;

        *self.token.lock().await = Some(Token {
            value: issued.access_token.clone(),
            expires_at: issued.access_token_expires_at,
        });

        Ok(issued.access_token)
    }

    pub async fn heartbeat(
        &self,
        request: &HeartbeatRequest,
    ) -> Result<HeartbeatResponse, ClientError> {
        let token = self.access_token().await?;

        let response = self
            .http
            .post(self.url("/api/agent/heartbeat"))
            .bearer_auth(token)
            .json(request)
            .send()
            .await
            .map_err(|e| ClientError::Transport(e.to_string()))?;

        Self::parse(response).await
    }

    pub async fn send_telemetry(
        &self,
        events: Vec<TelemetryEvent>,
    ) -> Result<TelemetryResponse, ClientError> {
        let token = self.access_token().await?;

        let request = TelemetryRequest {
            batch_id: crate::new_event_id("batch"),
            events,
        };

        let response = self
            .http
            .post(self.url("/api/agent/telemetry"))
            .bearer_auth(token)
            .json(&request)
            .send()
            .await
            .map_err(|e| ClientError::Transport(e.to_string()))?;

        Self::parse(response).await
    }

    pub async fn fetch_config(&self) -> Result<AgentConfigResponse, ClientError> {
        let token = self.access_token().await?;

        let response = self
            .http
            .get(self.url("/api/agent/config"))
            .bearer_auth(token)
            .send()
            .await
            .map_err(|e| ClientError::Transport(e.to_string()))?;

        Self::parse(response).await
    }

    pub async fn fetch_status(&self) -> Result<AgentStatusResponse, ClientError> {
        let token = self.access_token().await?;

        let response = self
            .http
            .get(self.url("/api/agent/status"))
            .bearer_auth(token)
            .send()
            .await
            .map_err(|e| ClientError::Transport(e.to_string()))?;

        Self::parse(response).await
    }

    /// Maps HTTP status plus the server's error envelope onto `ClientError`,
    /// which is what the run loop branches on.
    async fn parse<T: serde::de::DeserializeOwned>(
        response: reqwest::Response,
    ) -> Result<T, ClientError> {
        let status = response.status();

        if status.is_success() {
            return response
                .json::<T>()
                .await
                .map_err(|e| ClientError::Transport(format!("decoding response: {e}")));
        }

        let body = response.text().await.unwrap_or_default();

        if status == StatusCode::TOO_MANY_REQUESTS {
            return Err(ClientError::RateLimited);
        }

        if let Ok(parsed) = serde_json::from_str::<ApiErrorBody>(&body) {
            let code = parsed.error.code;
            let message = parsed.error.message;

            if is_terminal_error(&code) {
                return Err(ClientError::Terminal { code, message });
            }
            if code == "RATE_LIMITED" {
                return Err(ClientError::RateLimited);
            }
            if code == "INVALID_CREDENTIALS" {
                return Err(ClientError::InvalidCredentials(message));
            }

            return Err(ClientError::Unexpected {
                status: status.as_u16(),
                body: format!("{code}: {message}"),
            });
        }

        // 5xx with no envelope is the server being unwell — retry.
        if status.is_server_error() {
            return Err(ClientError::Transport(format!("server error {status}")));
        }

        Err(ClientError::Unexpected {
            status: status.as_u16(),
            body,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn trims_a_trailing_slash_from_the_base_url() {
        let client = ApiClient::new("https://api.example.com/").unwrap();
        assert_eq!(client.base_url(), "https://api.example.com");
        assert_eq!(
            client.url("/api/agent/heartbeat"),
            "https://api.example.com/api/agent/heartbeat"
        );
    }

    #[test]
    fn classifies_retryable_errors() {
        assert!(ClientError::Transport("offline".into()).is_retryable());
        assert!(ClientError::RateLimited.is_retryable());
        assert!(!ClientError::Terminal {
            code: "DEVICE_REVOKED".into(),
            message: "revoked".into()
        }
        .is_retryable());
        assert!(!ClientError::InvalidCredentials("nope".into()).is_retryable());
    }

    #[test]
    fn identifies_terminal_errors() {
        assert!(ClientError::Terminal {
            code: "DEVICE_UNKNOWN".into(),
            message: String::new()
        }
        .is_terminal());
        assert!(!ClientError::RateLimited.is_terminal());
    }

    #[test]
    fn treats_a_token_expiring_within_the_margin_as_stale() {
        // Refreshing early is what stops a request racing the expiry clock.
        let almost = Token {
            value: "t".into(),
            expires_at: Utc::now() + ChronoDuration::seconds(30),
        };
        assert!(!almost.is_fresh());

        let fresh = Token {
            value: "t".into(),
            expires_at: Utc::now() + ChronoDuration::seconds(900),
        };
        assert!(fresh.is_fresh());
    }

    #[tokio::test]
    async fn refuses_to_refresh_without_device_credentials() {
        let client = ApiClient::new("https://api.example.com").unwrap();
        let error = client.access_token().await.unwrap_err();
        assert!(error.is_terminal());
    }
}
