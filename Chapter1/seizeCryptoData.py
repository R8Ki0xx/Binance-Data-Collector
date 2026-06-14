import requests as rq
from datetime import datetime
import os
import pandas as pd
import time


class CryptoDataDownloader:
    def __init__(self, base_folder):
        self.url = "https://www.binance.bh/api/v3/uiKlines"
        self.headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        }
        self.base_folder = base_folder
        self.column = [
            "Symbol",  # 1. 币种（自己加的）
            "Open_Time",  # 2. 开盘时间 (毫秒)
            "Open_Price",  # 3. 开盘价
            "High_Price",  # 4. 最高价
            "Low_Price",  # 5. 最低价
            "Close_Price",  # 6. 收盘价
            "Volume",  # 7. 成交量
            "Close_Time",  # 8. 收盘时间 (毫秒)
            "Quote_Asset_Volume",  # 9. 成交额
            "Number_of_Trades",  # 10. 成交笔数
            "Taker_Buy_Base_Asset_Volume",  # 11. 主买成交量
            "Taker_Buy_Quote_Asset_Volume",  # 12. 主买成交额
            "Ignore_Field"  # 13. uiKlines 专有的忽略字段
        ]
        if not os.path.exists(self.base_folder):
            os.makedirs(self.base_folder)
    def _date_to_timestamp(self, year, month, day, hour = 0, minute = 0, second = 0):
        dt = datetime(year, month, day, hour, minute, second)
        return int(dt.timestamp() * 1000)

    def _fetch_klines_page(self, symbol, interval, end_time):
        payload = {
            "symbol" : symbol,
            "interval" : interval,
            "endTime" : end_time,
            "limit" : 1000
        }
        try:
            response = rq.get(self.url, headers = self.headers, params = payload, timeout = 10)
            if response.status_code == 200:
                return response.json()
            else:
                print(f"请求失败，状态码：{response.status_code}")
                return None
        except Exception as e:
            print(f"网络异常: {e}")
            return None
    def download_func(self, symbols, start_args, end_args, interval = "1m"):
        start_timestamp = self._date_to_timestamp(*start_args)
        end_timestamp = self._date_to_timestamp(*end_args)
        for symbol in symbols:
            print(f"\n ======= 开始下载 {symbol} 并保存到独立文件 =======")
            csv_path = os.path.join(self.base_folder, f"{symbol}_Data.csv")
            if os.path.exists(csv_path):
                os.remove(csv_path)
            current_end_time = end_timestamp
            total_rows = 0
            while current_end_time > start_timestamp:
                raw_data = self._fetch_klines_page(symbol, interval, current_end_time)
                if not raw_data:
                    print(f"[{symbol}] 未获取到新历史数据或触发错误，结束当前循环")
                    break
                processed_data = [[symbol] + item for item in raw_data]
                earliest_open_time = raw_data[0][0]
                df = pd.DataFrame(processed_data, columns = self.column)
                df['Open_Time'] = pd.to_datetime(df['Open_Time'], unit='ms').dt.strftime('%Y/%m/%d %H:%M:%S')
                df['Close_Time'] = pd.to_datetime(df['Close_Time'], unit='ms').dt.strftime('%Y/%m/%d %H:%M:%S')
                file_exists = os.path.exists(csv_path)
                df.to_csv(csv_path, mode = "a", index = False, header = not file_exists, encoding="utf-8-sig")
                total_rows += len(raw_data)
                current_end_time = earliest_open_time - 1
                readable_time = datetime.fromtimestamp(earliest_open_time / 1000).strftime('%Y-%m-%d %H:%M:%S')
                print(f"   -> 成功向前追加 {len(raw_data)} 条数据，时间已倒推至: {readable_time}")
                time.sleep(0.2)


if __name__ == "__main__":
    my_folder = r"C:\Users\R8ki0xx\Desktop\爬虫学习\Chapter1"
    downloader = CryptoDataDownloader(base_folder=my_folder)
    target_symbols = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "ETCUSDT"]
    downloader.download_func(symbols = target_symbols, start_args = (2026, 5, 22, 0, 0, 0), end_args = (2026, 5, 22, 23, 59, 59), interval = "1m")