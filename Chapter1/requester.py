import json
import logging
import re
import time
from pathlib import Path
import subprocess
import requests
import base64
import urllib.parse
import threading
import queue
from concurrent.futures import ThreadPoolExecutor


class QueuePool:
    def __init__(self, resources):
        self._original = list(resources)
        self._queue = queue.Queue()
        # 初始把所有资源放入队列
        for r in self._original:
            self._queue.put(r)

    def acquire(self):
        resource = self._queue.get()
        return resource

    def release(self, resource):
        self._queue.put(resource)


def singleton(cls):
    instances = {}

    def get_instance(*args, **kwargs):
        if cls not in instances:
            instances[cls] = cls(*args, **kwargs)
        return instances[cls]

    return get_instance


class ProxyPool:
    def __init__(self, config_file):
        self.config_file = config_file

    def generate_config(self):
        with open(self.config_file) as f:
            for line in f.readlines():
                print(line)

@singleton
class Requester:
    def __init__(self, ss_config_path=Path('./ss/ss-config.json')):
        self.ss_config_path = ss_config_path
        if type(ss_config_path) == str:
            ss_config_path = Path(ss_config_path)
        self.ss_path = ss_config_path.parent
        self.proc_list = list() #记录线程
        self.generate_config()
        self.file_list = self.get_file_list()
        self.PROXY_POOL = self.get_proxy()
        self._proxy_queue = QueuePool(self.PROXY_POOL)
        self._look = threading.Lock()
        for ss_file in self.file_list:
            self.start_proxy(ss_file)
        time.sleep(5)

    def get(self, url, headers=None, params=None, timeout=None):
        i = 0
        while i < 10:
            proxy = self._proxy_queue.acquire()
            try:
                proxies = {"http": proxy, "https": proxy}
                response = requests.get(url, proxies=proxies, params=params, headers=headers, timeout=timeout)
                if response.status_code == 429:
                    logging.error("429")
                    time.sleep(30)
                elif response.status_code == 200:
                    logging.info("200")
                    return response
                else:
                    logging.error(response.status_code)
            except requests.exceptions.SSLError:
                logging.error("requests SSLError")
                i = i + 1
            except requests.exceptions.ConnectionError:
                logging.error("requests ConnectionError")
                i = i + 1
            except requests.exceptions.ReadTimeout:
                logging.error("requests ReadTimeout")
                i = i + 1
            except requests.exceptions.Timeout:
                logging.error("requests Timeout")
                i = i + 1
            except Exception as e:
                logging.error(e)
                i = i + 1
            finally:
                self._proxy_queue.release(proxy)
        else:
            logging.error("requests Error")

    def fast_get(self, url_list, headers_list=None, params_list=None, timeout_list=None, max_workers=10):
        if headers_list is None:
            headers_list = [None] * len(url_list)
        if params_list is None:
            params_list = [None] * len(url_list)
        if timeout_list is None:
            timeout_list = [10] * len(url_list)
        if len(headers_list) != len(params_list) or len(headers_list) != len(timeout_list) or len(params_list) != len(
                timeout_list):
            raise "headers_list, params_list, timeout_list have different length"
        responses = list()
        with ThreadPoolExecutor(max_workers=max_workers) as executor:
            results = executor.map(self.get, url_list, headers_list, params_list, timeout_list)
            for r ,url in zip(results, url_list):
                responses.append([url, r])
        return responses

    def parse_ss_uri(self, ss_url):
        if not ss_url.startswith("ss://"):
            raise ValueError("Not a Shadowsocks URI")

        # 去掉 ss:// 前缀
        s = ss_url[5:]

        # 分离主体和标签（# 后面）
        if "#" in s:
            s, tag = s.split("#", 1)
            tag = urllib.parse.unquote(tag)
        else:
            tag = ""

        # 分离认证部分和 host:port
        auth_part, host_port = s.split("@", 1)
        host_port = host_port.strip("?")

        # 尝试 Base64 解码 auth_part
        try:
            # Base64 字符串可能缺少 padding，补全
            missing_padding = len(auth_part) % 4
            if missing_padding:
                auth_part += "=" * (4 - missing_padding)
            decoded = base64.b64decode(auth_part).decode('utf-8')
            if ":" in decoded:
                method, password = decoded.split(":", 1)
            else:
                # 旧格式：只有密码，method 需手动指定（不推荐）
                method = "chacha20-ietf-poly1305"
                password = decoded
        except Exception as e:
            print(f"Warning: Base64 decode failed, assuming plain text: {e}")
            # 尝试当作明文处理
            if ":" in auth_part:
                method, password = auth_part.split(":", 1)
            else:
                raise ValueError("Cannot parse auth part")

        # 解析 host:port
        if ":" in host_port:
            server, port_str = host_port.rsplit(":", 1)
            server_port = int(port_str)
        else:
            raise ValueError("Missing port")

        return {
            "server": server,
            "server_port": server_port,
            "password": password,
            "method": method,
            "tag": tag
        }

    def generate_config(self):
        with open(self.ss_config_path, "r") as f:
            data = json.load(f)

        for i, ss_url in enumerate(data):
            config = self.parse_ss_uri(ss_url)
            config["local_address"] = "127.0.0.1"
            config["local_port"] = 1080 + i
            config["proxy"] = f"socks5h://127.0.0.1:{config['local_port']}"
            with open(self.ss_path / f"ss-{i + 1}.json", "w") as f:
                json.dump(config, f)

    def get_file_list(self):
        pattern = re.compile(r'^ss-(\d+)\.json$')
        matching_files = [
            f for f in self.ss_path.iterdir()
            if f.is_file() and pattern.match(f.name)
        ]
        return matching_files

    def get_proxy(self):
        proxy_list = list()
        for ss_file in self.file_list:
            with open(ss_file, "r") as f:
                proxy_list.append(json.load(f)["proxy"])
        return proxy_list

    def start_proxy(self, ss_file):
        try:
            logging.info(
                " ".join(["ss-local", "-c", str(ss_file), "-f", f"/tmp/{str(ss_file).split('/')[-1].split('.')[0]}"]))
            self.proc_list.append(subprocess.Popen(
                ["ss-local", "-c", str(ss_file), "-f", f"/tmp/{str(ss_file).split('/')[-1].split('.')[0]}"]))
        except Exception as e:
            logging.error(e)

    def stop_proxy(self):
        for proc in self.proc_list:
            try:
                logging.info(f"stopping {proc.pid}")
                proc.kill()
            except Exception as e:
                logging.error(f"Error stopping {proc.pid}: {e}")
                pass

    def __del__(self):
        self.stop_proxy()