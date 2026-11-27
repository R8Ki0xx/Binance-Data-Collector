"""
Binance Account Snapshot Service

Periodically snapshots Binance Futures account states for asset curve display.
"""

import asyncio
import json
import logging
from datetime import datetime, timezone
from sqlalchemy.orm import Session

from database.connection import SessionLocal
from database.models import Account, BinanceWallet, BinanceAccountSnapshot
from services.binance_trading_client import BinanceTradingClient
from services.hyperliquid_environment import get_global_trading_mode
from api.ws import broadcast_arena_asset_update, manager

logger = logging.getLogger(__name__)


class BinanceSnapshotService:
    """Service to periodically snapshot Binance Futures account states"""

    def __init__(self, interval_seconds: int = 300):
        self.interval_seconds = interval_seconds
        self.running = False
        # Cache for trading clients (avoid recreating on each snapshot)
        self._client_cache: dict = {}

    async def start(self):
        """Start snapshot service"""
        self.running = True
        logger.info(f"[BINANCE SNAPSHOT] Service started, interval={self.interval_seconds}s")

        while self.running:
            try:
                await self.take_snapshots()
            except Exception as e:
                logger.error(f"[BINANCE SNAPSHOT] Error: {e}", exc_info=True)

            await asyncio.sleep(self.interval_seconds)

    def _get_client(self, wallet: BinanceWallet, db: Session) -> BinanceTradingClient:
        """Get or create trading client for a wallet"""
        cache_key = f"{wallet.account_id}_{wallet.environment}"

        if cache_key not in self._client_cache:
            # Decrypt API keys using existing encryption utility
            from utils.encryption import decrypt_private_key
            api_key = decrypt_private_key(wallet.api_key_encrypted)
            secret_key = decrypt_private_key(wallet.secret_key_encrypted)

            self._client_cache[cache_key] = BinanceTradingClient(
                api_key=api_key,
                secret_key=secret_key,
                environment=wallet.environment
            )

        return self._client_cache[cache_key]

    async def take_snapshots(self):
        """Take snapshots for all active Binance accounts"""
        db = SessionLocal()

        try:
            global_environment = get_global_trading_mode(db)
            if not global_environment:
                logger.debug("[BINANCE SNAPSHOT] No global trading mode set, skipping")
                return

            # Find all active AI accounts with Binance wallets for current environment
            accounts = db.query(Account).join(
                BinanceWallet,
                Account.id == BinanceWallet.account_id
            ).filter(
                Account.is_active == "true",
                Account.account_type == "AI",
                Account.is_deleted != True,
                BinanceWallet.environment == global_environment,
                BinanceWallet.is_active == "true"
            ).distinct().all()

            if not accounts:
                logger.debug(f"[BINANCE SNAPSHOT] No accounts with {global_environment} wallets")
                return

            snapshot_count = 0
            for account in accounts:
                try:
                    success = await self._take_account_snapshot(account, global_environment, db)
                    if success:
                        snapshot_count += 1
                except Exception as e:
                    logger.error(f"[BINANCE SNAPSHOT] Failed for account {account.id}: {e}")

            db.commit()
            logger.debug(f"[BINANCE SNAPSHOT] Took {snapshot_count} snapshots")

        except Exception as e:
            logger.error(f"[BINANCE SNAPSHOT] Error: {e}", exc_info=True)
            db.rollback()
        finally:
            db.close()

    async def _take_account_snapshot(
        self, account: Account, environment: str, db: Session
    ) -> bool:
        """
        Take snapshot for a single Binance account.

        Field mapping (Binance API -> Model):
            totalWalletBalance -> total_wallet_balance
            availableBalance -> available_balance
            totalUnrealizedProfit -> total_unrealized_profit
            totalMarginBalance -> total_margin_balance
            totalInitialMargin -> total_initial_margin
            totalMaintMargin -> total_maint_margin

        Returns:
            True if snapshot was taken successfully
        """
        # Get wallet for this account and environment
        wallet = db.query(BinanceWallet).filter(
            BinanceWallet.account_id == account.id,
            BinanceWallet.environment == environment,
            BinanceWallet.is_active == "true"
        ).first()

        if not wallet:
            logger.warning(f"[BINANCE SNAPSHOT] No wallet for account {account.id}")
            return False

        try:
            client = self._get_client(wallet, db)
            account_data = client.get_account()

            # Create snapshot with field mapping
            snapshot = BinanceAccountSnapshot(
                account_id=account.id,
                environment=environment,
                total_wallet_balance=float(account_data.get("totalWalletBalance", 0)),
                available_balance=float(account_data.get("availableBalance", 0)),
                total_unrealized_profit=float(account_data.get("totalUnrealizedProfit", 0)),
                total_margin_balance=float(account_data.get("totalMarginBalance", 0)),
                total_initial_margin=float(account_data.get("totalInitialMargin", 0)),
                total_maint_margin=float(account_data.get("totalMaintMargin", 0)),
                trigger_event="scheduled",
                snapshot_data=json.dumps(account_data)
            )

            db.add(snapshot)

            logger.debug(
                f"[BINANCE SNAPSHOT] Account {account.id} ({account.name}): "
                f"equity=${snapshot.total_margin_balance:.2f}, "
                f"available=${snapshot.available_balance:.2f}"
            )
            return True

        except Exception as e:
            logger.error(f"[BINANCE SNAPSHOT] Failed for account {account.id}: {e}")
            return False

    def stop(self):
        """Stop snapshot service"""
        self.running = False
        self._client_cache.clear()
        logger.info("[BINANCE SNAPSHOT] Service stopped")


# Global instance
binance_snapshot_service = BinanceSnapshotService(interval_seconds=300)
