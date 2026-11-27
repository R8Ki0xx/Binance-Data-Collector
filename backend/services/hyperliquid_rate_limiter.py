"""
Hyperliquid API Rate Limiter with exponential backoff retry.

Handles 429 (Too Many Requests) and connection instability with:
- Exponential backoff with jitter
- Retry-After header parsing
- Shared token-bucket rate limiter across all Hyperliquid API calls
- Circuit breaker that reduces request rate when API is degraded
- Critical path bypass for wallet setup operations
- Rate limit precondition checks before critical operations
"""
import time
import random
import logging
import threading
from typing import Dict, Any, Optional, Callable
from functools import wraps

logger = logging.getLogger(__name__)

# Retry configuration
MAX_RETRIES = 5
BASE_DELAY_SECONDS = 1.0
MAX_DELAY_SECONDS = 60.0
BACKOFF_MULTIPLIER = 2.0
JITTER_RANGE = (0.5, 1.5)

# Token bucket rate limiter: max requests per second across all Hyperliquid API calls
DEFAULT_RATE_PER_SECOND = 8
DEGRADED_RATE_PER_SECOND = 3

# Circuit breaker: track consecutive failures to detect degraded API
CIRCUIT_BREAKER_THRESHOLD = 3
CIRCUIT_BREAKER_COOLDOWN = 60.0

# Circuit breaker state
_circuit_state = "CLOSED"  # CLOSED, OPEN, HALF_OPEN
_circuit_failures = 0
_circuit_last_failure_time = 0.0
_circuit_state_changed_at = 0.0
_circuit_lock = threading.Lock()

# Token bucket state
_current_rate = DEFAULT_RATE_PER_SECOND
_token_bucket_lock = threading.Lock()
_token_bucket_tokens = float(DEFAULT_RATE_PER_SECOND * 2)
_token_bucket_last_refill = time.monotonic()


def _refill_tokens():
    """Refill the shared token bucket based on elapsed time."""
    global _token_bucket_tokens, _token_bucket_last_refill
    now = time.monotonic()
    elapsed = now - _token_bucket_last_refill
    rate = _current_rate
    capacity = rate * 2
    new_tokens = elapsed * rate
    _token_bucket_tokens = min(capacity, _token_bucket_tokens + new_tokens)
    _token_bucket_last_refill = now


def _consume_token() -> float:
    """
    Consume one token from the shared bucket.
    Returns the wait time in seconds (0 if token was immediately available).
    """
    with _token_bucket_lock:
        _refill_tokens()
        if _token_bucket_tokens >= 1.0:
            _token_bucket_tokens -= 1.0
            return 0.0
        wait = (1.0 - _token_bucket_tokens) / _current_rate
        return wait


def _wait_for_rate_limit():
    """Block until a request token is available."""
    wait = _consume_token()
    if wait > 0:
        time.sleep(wait)


def _calculate_backoff(attempt: int) -> float:
    """Calculate backoff delay with jitter for the given attempt (0-indexed)."""
    delay = BASE_DELAY_SECONDS * (BACKOFF_MULTIPLIER ** attempt)
    delay = min(delay, MAX_DELAY_SECONDS)
    jitter = random.uniform(*JITTER_RANGE)
    return delay * jitter


def _should_retry_http_error(status_code: int) -> bool:
    """Check if an HTTP status code warrants a retry."""
    return status_code in (429, 502, 503, 504)


def parse_retry_after(response_headers: Dict[str, str]) -> Optional[float]:
    """Extract Retry-After value from response headers (seconds)."""
    retry_after = response_headers.get("Retry-After") or response_headers.get("retry-after")
    if retry_after:
        try:
            return float(retry_after)
        except (ValueError, TypeError):
            pass
    return None


def _record_failure():
    """Record an API failure - may trip circuit breaker."""
    global _circuit_state, _circuit_failures, _circuit_last_failure_time, _circuit_state_changed_at, _current_rate
    with _circuit_lock:
        _circuit_failures += 1
        _circuit_last_failure_time = time.monotonic()

        if _circuit_state == "HALF_OPEN":
            _circuit_state = "OPEN"
            _circuit_state_changed_at = time.monotonic()
            _current_rate = DEGRADED_RATE_PER_SECOND
            logger.warning(
                f"[CIRCUIT BREAKER] HALF_OPEN probe failed. "
                f"Reverting to OPEN (rate: {DEGRADED_RATE_PER_SECOND} req/s)"
            )
        elif _circuit_failures >= CIRCUIT_BREAKER_THRESHOLD and _circuit_state == "CLOSED":
            _circuit_state = "OPEN"
            _circuit_state_changed_at = time.monotonic()
            _current_rate = DEGRADED_RATE_PER_SECOND
            logger.warning(
                f"[CIRCUIT BREAKER] TRIPPED after {_circuit_failures} consecutive failures. "
                f"Entering OPEN state. Rate reduced to {DEGRADED_RATE_PER_SECOND} req/s. "
                f"Will attempt recovery in {CIRCUIT_BREAKER_COOLDOWN}s."
            )


def _record_success():
    """Record a successful API call - may close circuit breaker."""
    global _circuit_state, _circuit_failures, _circuit_state_changed_at, _current_rate
    with _circuit_lock:
        if _circuit_state == "OPEN":
            elapsed = time.monotonic() - _circuit_state_changed_at
            if elapsed >= CIRCUIT_BREAKER_COOLDOWN:
                _circuit_state = "HALF_OPEN"
                _circuit_failures = 0
                logger.info(f"[CIRCUIT BREAKER] Cooldown elapsed. Entering HALF_OPEN state.")
                return

        if _circuit_state == "HALF_OPEN":
            _circuit_state = "CLOSED"
            _circuit_failures = 0
            _current_rate = DEFAULT_RATE_PER_SECOND
            logger.info(
                f"[CIRCUIT BREAKER] Recovery confirmed. "
                f"CLOSED state restored. Rate restored to {DEFAULT_RATE_PER_SECOND} req/s."
            )
        elif _circuit_state == "CLOSED" and _circuit_failures > 0:
            _circuit_failures = 0


def get_circuit_state() -> Dict[str, Any]:
    """Get current circuit breaker state for monitoring."""
    with _circuit_lock:
        return {
            "state": _circuit_state,
            "failures": _circuit_failures,
            "rate": _current_rate,
            "last_failure_time": _circuit_last_failure_time,
            "state_changed_at": _circuit_state_changed_at,
        }


def rate_limited_post_urgent(
    url: str,
    json: dict = None,
    timeout: int = 20,
    proxies: dict = None,
    max_retries: int = 3,
    context: str = "URGENT API call",
):
    """
    Rate-limited POST that BYPASSES the circuit breaker for critical operations.

    Use this for wallet setup, builder fee checks, and other user-initiated
    operations that must not be blocked by background task failures.

    Still respects token bucket rate limiting and retries on transient errors.
    """
    import requests as _requests

    if proxies is None:
        proxies = {'http': None, 'https': None}

    last_exception = None

    for attempt in range(max_retries + 1):
        _wait_for_rate_limit()

        try:
            response = _requests.post(url, json=json, timeout=timeout, proxies=proxies)

            if response.status_code == 429 or (response.status_code >= 500 and response.status_code < 600):
                if response.status_code == 429:
                    retry_after = parse_retry_after(response.headers)
                    delay = retry_after if retry_after else _calculate_backoff(attempt)
                else:
                    delay = _calculate_backoff(attempt)

                logger.warning(
                    f"[URGENT] {response.status_code} on {context} "
                    f"(attempt {attempt + 1}/{max_retries + 1}). "
                    f"Retrying in {delay:.1f}s (circuit breaker bypassed)"
                )

                if attempt < max_retries:
                    time.sleep(delay)
                    continue
                else:
                    response.raise_for_status()

            response.raise_for_status()
            return response

        except _requests.exceptions.ConnectionError as e:
            last_exception = e
            delay = _calculate_backoff(attempt)
            logger.warning(f"[URGENT] Connection error on {context}: {e}. Retrying in {delay:.1f}s")
            if attempt < max_retries:
                time.sleep(delay)
                continue
            raise
        except _requests.exceptions.Timeout as e:
            last_exception = e
            delay = _calculate_backoff(attempt)
            logger.warning(f"[URGENT] Timeout on {context}: {e}. Retrying in {delay:.1f}s")
            if attempt < max_retries:
                time.sleep(delay)
                continue
            raise
        except _requests.exceptions.RequestException as e:
            response = getattr(e, 'response', None)
            if response is not None and _should_retry_http_error(response.status_code):
                last_exception = e
                delay = _calculate_backoff(attempt)
                if attempt < max_retries:
                    time.sleep(delay)
                    continue
            raise

    raise last_exception


def rate_limited_post(
    url: str,
    json: dict = None,
    timeout: int = 20,
    proxies: dict = None,
    max_retries: int = MAX_RETRIES,
    context: str = "API call",
):
    """
    Rate-limited HTTP POST with exponential backoff retry and circuit breaker.

    For critical operations (wallet setup etc.), use rate_limited_post_urgent()
    which bypasses the circuit breaker.

    Args:
        url: The Hyperliquid API endpoint URL
        json: JSON payload
        timeout: Request timeout in seconds (default 20s)
        proxies: Proxy configuration
        max_retries: Maximum number of retry attempts
        context: Description for logging

    Returns:
        requests.Response object

    Raises:
        requests.exceptions.RequestException: If all retries are exhausted
    """
    import requests as _requests

    if proxies is None:
        proxies = {'http': None, 'https': None}

    last_exception = None

    for attempt in range(max_retries + 1):
        if attempt > 0:
            with _circuit_lock:
                if _circuit_state == "OPEN":
                    elapsed = time.monotonic() - _circuit_state_changed_at
                    if elapsed < CIRCUIT_BREAKER_COOLDOWN:
                        remaining = CIRCUIT_BREAKER_COOLDOWN - elapsed
                        logger.debug(
                            f"[CIRCUIT BREAKER] OPEN - skipping {context}, "
                            f"cooldown remaining: {remaining:.0f}s"
                        )
                        if attempt < max_retries:
                            time.sleep(min(remaining, MAX_DELAY_SECONDS))
                            continue
                        else:
                            raise _requests.exceptions.ConnectionError(
                                f"Circuit breaker OPEN: {context} - "
                                f"API is degraded, retry after {remaining:.0f}s"
                            )
                    else:
                        _circuit_state = "HALF_OPEN"
                        _circuit_failures = 0
                        logger.info(f"[CIRCUIT BREAKER] Cooldown expired. Probing recovery.")

        _wait_for_rate_limit()

        try:
            response = _requests.post(url, json=json, timeout=timeout, proxies=proxies)

            if response.status_code == 429 or (response.status_code >= 500 and response.status_code < 600):
                _record_failure()
                if response.status_code == 429:
                    retry_after = parse_retry_after(response.headers)
                    if retry_after:
                        delay = retry_after
                        logger.warning(
                            f"[RATE LIMIT] 429 on {context} (attempt {attempt + 1}/{max_retries + 1}). "
                            f"Retry-After: {retry_after}s | Circuit: {get_circuit_state()['state']}"
                        )
                    else:
                        delay = _calculate_backoff(attempt)
                        logger.warning(
                            f"[RATE LIMIT] 429 on {context} (attempt {attempt + 1}/{max_retries + 1}). "
                            f"Backing off {delay:.1f}s | Circuit: {get_circuit_state()['state']}"
                        )
                else:
                    delay = _calculate_backoff(attempt)
                    logger.warning(
                        f"[RETRY] {response.status_code} on {context} "
                        f"(attempt {attempt + 1}/{max_retries + 1}). "
                        f"Backing off {delay:.1f}s | Circuit: {get_circuit_state()['state']}"
                    )

                if attempt < max_retries:
                    time.sleep(delay)
                    continue
                else:
                    response.raise_for_status()

            _record_success()
            response.raise_for_status()
            return response

        except _requests.exceptions.ConnectionError as e:
            _record_failure()
            last_exception = e
            delay = _calculate_backoff(attempt)
            logger.warning(
                f"[CONNECTION ERROR] {context} (attempt {attempt + 1}/{max_retries + 1}): {e}. "
                f"Retrying in {delay:.1f}s | Circuit: {get_circuit_state()['state']}"
            )
            if attempt < max_retries:
                time.sleep(delay)
                continue
            raise
        except _requests.exceptions.Timeout as e:
            _record_failure()
            last_exception = e
            delay = _calculate_backoff(attempt)
            logger.warning(
                f"[TIMEOUT] {context} (attempt {attempt + 1}/{max_retries + 1}): {e}. "
                f"Retrying in {delay:.1f}s | Circuit: {get_circuit_state()['state']}"
            )
            if attempt < max_retries:
                time.sleep(delay)
                continue
            raise
        except _requests.exceptions.RequestException as e:
            _record_failure()
            response = getattr(e, 'response', None)
            if response is not None and _should_retry_http_error(response.status_code):
                last_exception = e
                delay = _calculate_backoff(attempt)
                logger.warning(
                    f"[HTTP ERROR] {response.status_code} on {context} "
                    f"(attempt {attempt + 1}/{max_retries + 1}). "
                    f"Retrying in {delay:.1f}s | Circuit: {get_circuit_state()['state']}"
                )
                if attempt < max_retries:
                    time.sleep(delay)
                    continue
            raise

    raise last_exception


def with_retry(
    max_retries: int = MAX_RETRIES,
    context: str = None,
    rate_limit: bool = True,
):
    """
    Decorator for SDK methods that may receive 429 errors.
    """
    def decorator(func: Callable) -> Callable:
        ctx = context or func.__name__

        @wraps(func)
        def wrapper(*args, **kwargs):
            last_exception = None

            for attempt in range(max_retries + 1):
                if rate_limit:
                    _wait_for_rate_limit()

                try:
                    result = func(*args, **kwargs)
                    _record_success()
                    return result
                except Exception as e:
                    _record_failure()
                    last_exception = e
                    error_msg = str(e).lower()

                    is_429 = (
                        '429' in str(e)
                        or 'rate limit' in error_msg
                        or 'too many requests' in error_msg
                        or 'throttled' in error_msg
                    )
                    is_server_error = (
                        '502' in str(e)
                        or '503' in str(e)
                        or '504' in str(e)
                        or 'bad gateway' in error_msg
                        or 'service unavailable' in error_msg
                        or 'gateway timeout' in error_msg
                    )
                    is_connection_error = (
                        'connection' in error_msg
                        and ('reset' in error_msg or 'refused' in error_msg or 'timeout' in error_msg)
                    )

                    should_retry = is_429 or is_server_error or is_connection_error

                    if not should_retry:
                        raise

                    if attempt < max_retries:
                        delay = _calculate_backoff(attempt)
                        logger.warning(
                            f"[RETRY] {ctx} (attempt {attempt + 1}/{max_retries + 1}): {e}. "
                            f"Backing off {delay:.1f}s | Circuit: {get_circuit_state()['state']}"
                        )
                        time.sleep(delay)
                        continue
                    else:
                        logger.error(
                            f"[RETRY EXHAUSTED] {ctx} failed after {max_retries + 1} attempts: {e}"
                        )
                        raise

            raise last_exception
        return wrapper
    return decorator


def check_rate_limit_before_trade(usage_percent: float) -> bool:
    """
    Check if it's safe to make a trade given current rate limit usage.
    """
    if usage_percent >= 95:
        logger.warning(
            f"[RATE LIMIT GUARD] Rate limit at {usage_percent:.1f}%. "
            f"Skipping trade to avoid 429 errors."
        )
        return False
    if usage_percent >= 85:
        logger.warning(
            f"[RATE LIMIT GUARD] Rate limit at {usage_percent:.1f}%. "
            f"Proceeding with caution."
        )
    return True
