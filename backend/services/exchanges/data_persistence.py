"""
Exchange data persistence service.

Handles writing unified exchange data to database tables.
Works with any exchange adapter that produces unified data structures.
"""

import logging
from decimal import Decimal
from typing import List, Optional
from datetime import datetime, timezone
from sqlalchemy.orm import Session

from database.models import (
    CryptoKline,
    MarketTradesAggregated,
    MarketOrderbookSnapshots,
    MarketAssetMetrics,
    MarketSentimentMetrics,
)
from services.exchanges.base_adapter import (
    UnifiedKline,
    UnifiedOrderbook,
    UnifiedFunding,
    UnifiedOpenInterest,
    UnifiedSentiment,
)

logger = logging.getLogger(__name__)


class ExchangeDataPersistence:
    """
    Persists unified exchange data to database.

    All data is stored with exchange identifier to support multi-exchange queries.
    """

    def __init__(self, db: Session):
        self.db = db

    def save_klines(
        self,
        klines: List[UnifiedKline],
        environment: str = "mainnet",
    ) -> dict:
        """
        Save K-line data to crypto_klines table.

        Args:
            klines: List of UnifiedKline objects
            environment: "mainnet" or "testnet"

        Returns:
            Dict with inserted and updated counts
        """
        inserted = 0
        updated = 0

        for kline in klines:
            # Generate datetime string
            dt = datetime.fromtimestamp(kline.timestamp, tz=timezone.utc)
            datetime_str = dt.strftime("%Y-%m-%d %H:%M:%S")

            # Check existing record
            existing = self.db.query(CryptoKline).filter(
                CryptoKline.exchange == kline.exchange,
                CryptoKline.symbol == kline.symbol,
                CryptoKline.market == "CRYPTO",
                CryptoKline.period == kline.interval,
                CryptoKline.timestamp == kline.timestamp,
                CryptoKline.environment == environment,
            ).first()

            if existing:
                existing.open_price = kline.open_price
                existing.high_price = kline.high_price
                existing.low_price = kline.low_price
                existing.close_price = kline.close_price
                existing.volume = kline.volume
                existing.amount = kline.quote_volume
                updated += 1
            else:
                record = CryptoKline(
                    exchange=kline.exchange,
                    symbol=kline.symbol,
                    market="CRYPTO",
                    period=kline.interval,
                    timestamp=kline.timestamp,
                    datetime_str=datetime_str,
                    environment=environment,
                    open_price=kline.open_price,
                    high_price=kline.high_price,
                    low_price=kline.low_price,
                    close_price=kline.close_price,
                    volume=kline.volume,
                    amount=kline.quote_volume,
                )
                self.db.add(record)
                inserted += 1

        self.db.commit()
        logger.info(f"Saved klines: {inserted} inserted, {updated} updated")
        return {"inserted": inserted, "updated": updated}

    def save_taker_volumes_from_klines(
        self,
        klines: List[UnifiedKline],
    ) -> dict:
        """
        Save taker buy/sell volumes from K-line data to market_trades_aggregated.

        This is used for exchanges like Binance where K-lines include taker volumes,
        eliminating the need for separate trade stream collection.
        """
        inserted = 0
        updated = 0

        for kline in klines:
            if kline.taker_buy_volume is None:
                continue

            # Convert timestamp from seconds to milliseconds
            timestamp_ms = kline.timestamp * 1000

            # Calculate notional if not provided (fallback: volume * close_price)
            taker_buy_notional = kline.taker_buy_notional
            taker_sell_notional = kline.taker_sell_notional
            if taker_buy_notional is None and kline.close_price:
                taker_buy_notional = kline.taker_buy_volume * kline.close_price
            if taker_sell_notional is None and kline.close_price:
                taker_sell_notional = kline.taker_sell_volume * kline.close_price

            existing = self.db.query(MarketTradesAggregated).filter(
                MarketTradesAggregated.exchange == kline.exchange,
                MarketTradesAggregated.symbol == kline.symbol,
                MarketTradesAggregated.timestamp == timestamp_ms,
            ).first()

            if existing:
                existing.taker_buy_volume = kline.taker_buy_volume
                existing.taker_sell_volume = kline.taker_sell_volume
                existing.taker_buy_count = kline.trade_count or 0
                existing.taker_buy_notional = taker_buy_notional or 0
                existing.taker_sell_notional = taker_sell_notional or 0
                existing.high_price = kline.high_price
                existing.low_price = kline.low_price
                updated += 1
            else:
                record = MarketTradesAggregated(
                    exchange=kline.exchange,
                    symbol=kline.symbol,
                    timestamp=timestamp_ms,
                    taker_buy_volume=kline.taker_buy_volume,
                    taker_sell_volume=kline.taker_sell_volume,
                    taker_buy_count=kline.trade_count or 0,
                    taker_sell_count=0,
                    taker_buy_notional=taker_buy_notional or 0,
                    taker_sell_notional=taker_sell_notional or 0,
                    high_price=kline.high_price,
                    low_price=kline.low_price,
                )
                self.db.add(record)
                inserted += 1

        self.db.commit()
        return {"inserted": inserted, "updated": updated}

    def save_orderbook(self, orderbook: UnifiedOrderbook) -> bool:
        """Save orderbook snapshot to market_orderbook_snapshots table."""
        try:
            existing = self.db.query(MarketOrderbookSnapshots).filter(
                MarketOrderbookSnapshots.exchange == orderbook.exchange,
                MarketOrderbookSnapshots.symbol == orderbook.symbol,
                MarketOrderbookSnapshots.timestamp == orderbook.timestamp,
            ).first()

            if existing:
                existing.best_bid = orderbook.best_bid
                existing.best_ask = orderbook.best_ask
                existing.bid_depth_5 = orderbook.bid_depth_sum
                existing.ask_depth_5 = orderbook.ask_depth_sum
                existing.bid_depth_10 = orderbook.bid_depth_sum
                existing.ask_depth_10 = orderbook.ask_depth_sum
                existing.spread = orderbook.spread
            else:
                record = MarketOrderbookSnapshots(
                    exchange=orderbook.exchange,
                    symbol=orderbook.symbol,
                    timestamp=orderbook.timestamp,
                    best_bid=orderbook.best_bid,
                    best_ask=orderbook.best_ask,
                    bid_depth_5=orderbook.bid_depth_sum,
                    ask_depth_5=orderbook.ask_depth_sum,
                    bid_depth_10=orderbook.bid_depth_sum,
                    ask_depth_10=orderbook.ask_depth_sum,
                    spread=orderbook.spread,
                )
                self.db.add(record)

            self.db.commit()
            return True
        except Exception as e:
            logger.error(f"Failed to save orderbook: {e}")
            self.db.rollback()
            return False

    def save_asset_metrics(
        self,
        symbol: str,
        exchange: str,
        timestamp_ms: int,
        open_interest: Optional[Decimal] = None,
        funding_rate: Optional[Decimal] = None,
        mark_price: Optional[Decimal] = None,
    ) -> bool:
        """Save asset metrics (OI, funding rate) to market_asset_metrics table."""
        try:
            existing = self.db.query(MarketAssetMetrics).filter(
                MarketAssetMetrics.exchange == exchange,
                MarketAssetMetrics.symbol == symbol,
                MarketAssetMetrics.timestamp == timestamp_ms,
            ).first()

            if existing:
                if open_interest is not None:
                    existing.open_interest = open_interest
                if funding_rate is not None:
                    existing.funding_rate = funding_rate
                if mark_price is not None:
                    existing.mark_price = mark_price
            else:
                record = MarketAssetMetrics(
                    exchange=exchange,
                    symbol=symbol,
                    timestamp=timestamp_ms,
                    open_interest=open_interest,
                    funding_rate=funding_rate,
                    mark_price=mark_price,
                )
                self.db.add(record)

            self.db.commit()
            return True
        except Exception as e:
            logger.error(f"Failed to save asset metrics: {e}")
            self.db.rollback()
            return False

    def save_open_interest(self, oi: UnifiedOpenInterest) -> bool:
        """Save open interest data."""
        return self.save_asset_metrics(
            symbol=oi.symbol,
            exchange=oi.exchange,
            timestamp_ms=oi.timestamp,
            open_interest=oi.open_interest,
        )

    def save_funding_rate(self, funding: UnifiedFunding) -> bool:
        """Save funding rate data."""
        return self.save_asset_metrics(
            symbol=funding.symbol,
            exchange=funding.exchange,
            timestamp_ms=funding.timestamp,
            funding_rate=funding.funding_rate,
            mark_price=funding.mark_price,
        )

    def save_open_interest_batch(self, oi_list: List[UnifiedOpenInterest]) -> dict:
        """Save batch of open interest records."""
        inserted = 0
        updated = 0
        for oi in oi_list:
            existing = self.db.query(MarketAssetMetrics).filter(
                MarketAssetMetrics.exchange == oi.exchange,
                MarketAssetMetrics.symbol == oi.symbol,
                MarketAssetMetrics.timestamp == oi.timestamp,
            ).first()

            if existing:
                existing.open_interest = oi.open_interest
                updated += 1
            else:
                record = MarketAssetMetrics(
                    exchange=oi.exchange,
                    symbol=oi.symbol,
                    timestamp=oi.timestamp,
                    open_interest=oi.open_interest,
                )
                self.db.add(record)
                inserted += 1

        self.db.commit()
        return {"inserted": inserted, "updated": updated}

    def save_funding_rate_batch(self, funding_list: List[UnifiedFunding]) -> dict:
        """Save batch of funding rate records."""
        inserted = 0
        updated = 0
        for funding in funding_list:
            existing = self.db.query(MarketAssetMetrics).filter(
                MarketAssetMetrics.exchange == funding.exchange,
                MarketAssetMetrics.symbol == funding.symbol,
                MarketAssetMetrics.timestamp == funding.timestamp,
            ).first()

            if existing:
                existing.funding_rate = funding.funding_rate
                if funding.mark_price:
                    existing.mark_price = funding.mark_price
                updated += 1
            else:
                record = MarketAssetMetrics(
                    exchange=funding.exchange,
                    symbol=funding.symbol,
                    timestamp=funding.timestamp,
                    funding_rate=funding.funding_rate,
                    mark_price=funding.mark_price,
                )
                self.db.add(record)
                inserted += 1

        self.db.commit()
        return {"inserted": inserted, "updated": updated}

    def save_sentiment(
        self,
        sentiment: UnifiedSentiment,
        data_type: str = "top_position",
    ) -> bool:
        """Save sentiment data to market_sentiment_metrics table."""
        try:
            existing = self.db.query(MarketSentimentMetrics).filter(
                MarketSentimentMetrics.exchange == sentiment.exchange,
                MarketSentimentMetrics.symbol == sentiment.symbol,
                MarketSentimentMetrics.timestamp == sentiment.timestamp,
                MarketSentimentMetrics.data_type == data_type,
            ).first()

            if existing:
                existing.long_ratio = sentiment.long_ratio
                existing.short_ratio = sentiment.short_ratio
                existing.long_short_ratio = sentiment.long_short_ratio
            else:
                record = MarketSentimentMetrics(
                    exchange=sentiment.exchange,
                    symbol=sentiment.symbol,
                    timestamp=sentiment.timestamp,
                    long_ratio=sentiment.long_ratio,
                    short_ratio=sentiment.short_ratio,
                    long_short_ratio=sentiment.long_short_ratio,
                    data_type=data_type,
                )
                self.db.add(record)

            self.db.commit()
            return True
        except Exception as e:
            logger.error(f"Failed to save sentiment: {e}")
            self.db.rollback()
            return False

    def save_sentiment_batch(
        self,
        sentiment_list: List[UnifiedSentiment],
        data_type: str = "top_position",
    ) -> dict:
        """Save batch of sentiment records."""
        inserted = 0
        updated = 0
        for sentiment in sentiment_list:
            existing = self.db.query(MarketSentimentMetrics).filter(
                MarketSentimentMetrics.exchange == sentiment.exchange,
                MarketSentimentMetrics.symbol == sentiment.symbol,
                MarketSentimentMetrics.timestamp == sentiment.timestamp,
                MarketSentimentMetrics.data_type == data_type,
            ).first()

            if existing:
                existing.long_ratio = sentiment.long_ratio
                existing.short_ratio = sentiment.short_ratio
                existing.long_short_ratio = sentiment.long_short_ratio
                updated += 1
            else:
                record = MarketSentimentMetrics(
                    exchange=sentiment.exchange,
                    symbol=sentiment.symbol,
                    timestamp=sentiment.timestamp,
                    long_ratio=sentiment.long_ratio,
                    short_ratio=sentiment.short_ratio,
                    long_short_ratio=sentiment.long_short_ratio,
                    data_type=data_type,
                )
                self.db.add(record)
                inserted += 1

        self.db.commit()
        return {"inserted": inserted, "updated": updated}
