use std::net::IpAddr;
use tower_governor::key_extractor::KeyExtractor;
use tower_governor::GovernorError;

/// Rate-limit key extractor that reads the real client IP from Cloudflare headers.
///
/// Header priority (most trusted → least trusted):
/// 1. `CF-Connecting-IP` — set by Cloudflare, stripped/overwritten on ingress (not spoofable)
/// 2. `X-Real-IP` — set by the ALB or upstream proxy
/// 3. `X-Forwarded-For` — rightmost non-private entry (ALB appends its entry last)
/// 4. Peer socket IP — last resort (often the ALB or NAT gateway IP)
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct CloudflareIpKeyExtractor;

impl KeyExtractor for CloudflareIpKeyExtractor {
    type Key = IpAddr;

    fn extract<T>(&self, req: &http::Request<T>) -> Result<Self::Key, GovernorError> {
        // 1. CF-Connecting-IP — Cloudflare's guaranteed real client IP
        if let Some(cf_ip) = req.headers().get("cf-connecting-ip") {
            if let Ok(s) = cf_ip.to_str() {
                if let Ok(ip) = s.trim().parse::<IpAddr>() {
                    return Ok(ip);
                }
            }
        }

        // 2. X-Real-IP
        if let Some(real_ip) = req.headers().get("x-real-ip") {
            if let Ok(s) = real_ip.to_str() {
                if let Ok(ip) = s.trim().parse::<IpAddr>() {
                    return Ok(ip);
                }
            }
        }

        // 3. X-Forwarded-For — rightmost non-private IP (ALB appends, so rightmost is most trusted)
        if let Some(xff) = req.headers().get("x-forwarded-for") {
            if let Ok(s) = xff.to_str() {
                for segment in s.rsplit(',') {
                    if let Ok(ip) = segment.trim().parse::<IpAddr>() {
                        if !is_private_ip(ip) {
                            return Ok(ip);
                        }
                    }
                }
                // If all are private, use the first one
                if let Some(first) = s.split(',').next() {
                    if let Ok(ip) = first.trim().parse::<IpAddr>() {
                        return Ok(ip);
                    }
                }
            }
        }

        // 4. Peer IP from ConnectInfo
        req.extensions()
            .get::<axum::extract::ConnectInfo<std::net::SocketAddr>>()
            .map(|ci| ci.0.ip())
            .ok_or(GovernorError::UnableToExtractKey)
    }
}

fn is_private_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(v4) => v4.is_private() || v4.is_loopback() || v4.is_link_local(),
        IpAddr::V6(v6) => v6.is_loopback(),
    }
}
