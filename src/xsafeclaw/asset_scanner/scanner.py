"""
Asset Scanner for local system security assessment.
"""
import platform
import re
import threading
from pathlib import Path
from typing import List, Dict, Set, Optional
from collections import deque
from concurrent.futures import ThreadPoolExecutor, as_completed
from .models import AssetItem, RiskLevel, HardwareAsset, SoftwareAsset

# 需要忽略的文件夹和文件模式
IGNORE_PATTERNS = {
    'node_modules',
    '.git',
    '.svn',
    '.hg',
    '__pycache__',
    '.pytest_cache',
    '.mypy_cache',
    '.tox',
    'venv',
    '.venv',
    'env',
    '.env',
    '$Recycle.Bin',
    '$RECYCLE.BIN',
    'System Volume Information',
    '.Trash',
    '.Trashes',
    'Thumbs.db',
    '.DS_Store',
    'Containers',  # macOS 应用容器目录（避免重复扫描符号链接）
}


class ScanCancelledError(Exception):
    """Raised when an in-flight asset scan is cancelled."""


class AssetScanner:
    """
    Scans local system assets and assesses security risks.

    Automatically detects the operating system and identifies critical
    system paths for security assessment.
    """

    # ========== 风险定级扩展名常量 ==========

    # Level 0: 系统关键文件扩展名
    _L0_EXTENSIONS = {
        '.exe', '.app', '.sh', '.bat', '.cmd',  # 可执行文件
        '.dll', '.so', '.dylib',  # 动态链接库
        '.sys', '.kext', '.ko', '.efi'  # 驱动与引导文件
    }

    # Level 0: 应用程序资源文件扩展名（软件运行依赖）
    _L0_APP_RESOURCES = {
        '.pak',  # Chrome/Electron 资源包
        '.asar',  # Electron 归档文件
        '.node',  # Node.js 原生模块
        '.dat',  # 通用数据文件
        '.bin',  # 二进制数据文件
        '.rdb',  # 常见应用数据库
        '.car',  # macOS 资源文件
        '.framework',  # macOS 框架目录
        '.nib',  # macOS Interface Builder 文件
        '.strings',  # macOS 本地化字符串
        '.plist',  # macOS 属性列表
        '.bundle',  # macOS/iOS Bundle
        '.plugin',  # 插件文件
        '.xpc'  # macOS XPC 服务
    }

    # Level 0: 关键系统文件名（完全匹配）
    _L0_CRITICAL_FILENAMES = {
        'ntuser.dat', 'sam', 'system', 'hiberfil.sys', 'pagefile.sys',
        'software', 'security'  # 注册表文件
    }

    # Level 0: 安全软件关键词
    _L0_SECURITY_SOFTWARE = [
        'windows defender', 'norton', 'symantec', 'crowdstrike',
        'sentinelone', 'kaspersky', 'mcafee', 'avast', 'avg'
    ]

    # Level 1: 敏感凭证扩展名
    _L1_EXTENSIONS = {
        '.key', '.pem', '.p12', '.pfx',  # 密钥文件
        '.kdbx',  # KeePass 密码库
        '.1pux',  # 1Password
        '.ovpn',  # OpenVPN
        '.rdp',  # 远程桌面
        '.vnc'  # VNC
    }

    # Level 1: 浏览器隐私数据文件名
    _L1_BROWSER_FILES = {
        'cookies', 'login data', 'local state', 'history',
        'web data', 'preferences'
    }

    # Level 1: 敏感目录关键词
    _L1_SENSITIVE_DIRS = {
        '.ssh', '.aws', '.kube', '.gnupg', '.config/gcloud'
    }

    # Level 2: 源代码文件扩展名
    _L2_CODE_EXTENSIONS = {
        '.py', '.js', '.ts', '.jsx', '.tsx', '.java', '.cpp', '.c', '.h',
        '.go', '.rs', '.php', '.rb', '.swift', '.sql', '.kt', '.scala',
        '.r', '.m', '.mm', '.cs', '.vb', '.pl', '.lua', '.dart'
    }

    # Level 2: 设计与媒体源文件扩展名
    _L2_DESIGN_EXTENSIONS = {
        '.psd', '.ai', '.sketch', '.fig', '.blend', '.obj', '.stl',
        '.prproj', '.ae', '.dwg', '.dxf', '.max', '.ma', '.mb'
    }

    # Level 2: 虚拟机与容器扩展名
    _L2_VM_EXTENSIONS = {
        '.iso', '.vmdk', '.vdi', '.qcow2', '.ova', '.ovf'
    }

    # Level 2: 邮件存档扩展名
    _L2_EMAIL_EXTENSIONS = {
        '.pst', '.ost', '.mbox', '.eml', '.msg'
    }

    # Level 2: 办公文档扩展名
    _L2_DOCUMENT_EXTENSIONS = {
        '.docx', '.doc', '.xlsx', '.xls', '.pptx', '.ppt',
        '.pdf', '.txt', '.rtf', '.odt', '.ods', '.odp',
        '.csv', '.json', '.xml', '.yaml', '.yml'
    }

    # Level 2: 数据库文件扩展名
    _L2_DATABASE_EXTENSIONS = {
        '.db', '.sqlite', '.sqlite3', '.mdb', '.accdb'
    }

    # Level 2: 媒体文件扩展名
    _L2_MEDIA_EXTENSIONS = {
        # 图片
        '.jpg', '.jpeg', '.png', '.gif', '.bmp', '.svg', '.webp', '.tiff', '.tif', '.ico',
        # 音频
        '.mp3', '.wav', '.flac', '.aac', '.ogg', '.m4a', '.wma',
        # 视频
        '.mp4', '.avi', '.mov', '.mkv', '.wmv', '.flv', '.webm', '.m4v', '.mpg', '.mpeg'
    }

    # Level 3: 开发缓存目录关键词
    _L3_DEV_CACHE_DIRS = [
        '.npm', 'node_cache', '.m2/repository', 'pip/cache',
        '.gradle', '.cargo', 'composer/cache'
    ]

    # Level 3: 浏览器缓存关键词（注意区分 Cookies）
    _L3_BROWSER_CACHE = ['cache', 'code cache', 'gpu cache']

    def __init__(self):
        """
        Initialize the AssetScanner with automatic OS detection.
        """
        self.os_type = self._detect_os()
        self.system_paths: List[Path] = []
        self.home_directory: Path = Path.home()
        self.ignored_items: List[Dict] = []  # 记录被忽略的项目
        self.scanned_count: int = 0  # 已扫描的项目计数
        self.ignored_count: int = 0  # 被忽略的项目计数

        # 线程安全锁
        self._lock = threading.Lock()
        self._cancel_event = threading.Event()

        # 大文件阈值（100MB）
        self.large_file_threshold = 100 * 1024 * 1024

        # 存储空间统计
        self.ignored_size: int = 0  # 被忽略目录的总大小

        print(f"AssetScanner initialized for {self.os_type}")
        print(f"Home directory: {self.home_directory}")

    def request_stop(self) -> None:
        """Request the current scan to stop as soon as possible."""
        self._cancel_event.set()

    @property
    def stop_requested(self) -> bool:
        """Whether the current scan has been asked to stop."""
        return self._cancel_event.is_set()

    def _ensure_not_cancelled(self) -> None:
        """Abort the current scan when a stop has been requested."""
        if self.stop_requested:
            raise ScanCancelledError("Scan cancelled by user")

    def _detect_os(self) -> str:
        """
        Detect the current operating system.

        Returns:
            str: 'Windows', 'macOS', or 'Linux'
        """
        system = platform.system()

        if system == "Windows":
            return "Windows"
        elif system == "Darwin":
            return "macOS"
        elif system == "Linux":
            return "Linux"
        else:
            return f"Unknown ({system})"

    def identify_system_paths(self) -> List[Path]:
        """
        Identify critical system paths based on the detected OS.

        Returns:
            List[Path]: List of critical system paths to scan

        The method identifies:
        - Windows: C:\\Windows, C:\\Program Files, C:\\Program Files (x86), User home
        - macOS: /System, /Library, /Applications, User home
        - Linux: /etc, /usr, /bin, /sbin, /var, User home
        """
        paths = []

        if self.os_type == "Windows":
            # Windows system paths
            paths.extend([
                Path("C:/Windows"),
                Path("C:/Program Files"),
                Path("C:/Program Files (x86)"),
                Path("C:/ProgramData"),
            ])
        elif self.os_type == "macOS":
            # macOS system paths
            paths.extend([
                Path("/System"),
                Path("/Library"),
                Path("/Applications"),
                Path("/usr"),
                Path("/private/etc"),
            ])
        elif self.os_type == "Linux":
            # Linux system paths
            paths.extend([
                Path("/etc"),
                Path("/usr"),
                Path("/bin"),
                Path("/sbin"),
                Path("/var"),
                Path("/opt"),
            ])

        # Add user home directory for all OS types
        paths.append(self.home_directory)

        # Filter to only existing paths
        self.system_paths = [p for p in paths if p.exists()]

        print(f"Identified {len(self.system_paths)} system paths:")
        for path in self.system_paths:
            print(f"  - {path}")

        return self.system_paths

    def _check_file_magic(self, path: Path) -> str:
        """
        检查文件的 Magic Bytes（文件头）来识别真实文件类型。

        Args:
            path: 文件路径

        Returns:
            str: 识别出的文件类型，如 'exe', 'elf', 'java_class', 'unknown'
        """
        try:
            if not path.is_file():
                return 'unknown'

            # 读取文件的前 4 个字节
            with open(path, 'rb') as f:
                magic_bytes = f.read(4)

            if len(magic_bytes) < 2:
                return 'unknown'

            # Windows 可执行文件 (MZ)
            if magic_bytes[:2] == b'MZ':
                return 'exe'

            # Linux/Unix 可执行文件 (ELF)
            if magic_bytes[:4] == b'\x7fELF':
                return 'elf'

            # Java class 文件
            if magic_bytes[:4] == b'\xca\xfe\xba\xbe':
                return 'java_class'

            # Mach-O (macOS 可执行文件)
            if magic_bytes[:4] in [b'\xfe\xed\xfa\xce', b'\xfe\xed\xfa\xcf',
                                   b'\xce\xfa\xed\xfe', b'\xcf\xfa\xed\xfe']:
                return 'macho'

            # PE32+ (64-bit Windows)
            if magic_bytes[:2] == b'MZ':
                return 'exe'

            return 'unknown'

        except (PermissionError, OSError, IOError):
            return 'unknown'

    def _detect_spoofing(self, path: Path, path_suffix: str) -> bool:
        """
        检测文件是否存在伪装（扩展名与实际文件类型不匹配）。

        Args:
            path: 文件路径
            path_suffix: 文件扩展名（小写）

        Returns:
            bool: 如果检测到伪装返回 True，否则返回 False
        """
        # 定义低风险扩展名（可能被用于伪装）
        low_risk_extensions = {
            '.jpg', '.jpeg', '.png', '.gif', '.bmp', '.svg',  # 图片
            '.txt', '.md', '.log', '.csv',  # 文本
            '.mp3', '.mp4', '.avi', '.mov', '.wav',  # 媒体
            '.pdf', '.doc', '.docx', '.xls', '.xlsx'  # 文档
        }

        # 只检查声称是低风险的文件
        if path_suffix not in low_risk_extensions:
            return False

        # 检查文件的真实类型
        real_type = self._check_file_magic(path)

        # 如果真实类型是可执行文件，则判定为伪装
        if real_type in ['exe', 'elf', 'java_class', 'macho']:
            return True

        return False

    def _has_subdirectories(self, path: Path) -> bool:
        """
        检查目录是否包含子目录。

        Args:
            path: 要检查的目录路径

        Returns:
            bool: 如果包含子目录返回 True，否则返回 False
        """
        try:
            for item in path.iterdir():
                if item.is_dir():
                    return True
            return False
        except (PermissionError, OSError):
            return False

    def _get_direct_size(self, path: Path) -> int:
        """
        计算目录中直接文件的大小（不包括子目录中的文件）。

        Args:
            path: 要计算的目录路径

        Returns:
            int: 直接文件的总字节数
        """
        total_size = 0
        try:
            for item in path.iterdir():
                try:
                    # 检查是否为符号链接，如果是则跳过
                    if not item.is_symlink() and item.is_file():
                        total_size += item.stat().st_size
                except (PermissionError, OSError):
                    # 忽略无法访问的文件
                    continue
        except (PermissionError, OSError):
            # 无法访问该目录
            pass

        return total_size

    def _get_tree_size(self, path: Path) -> int:
        """
        快速计算目录树的总大小（不创建 AssetItem）。

        使用 os.scandir 进行高效遍历，适用于计算被忽略目录的大小。

        Args:
            path: 要计算大小的路径

        Returns:
            int: 目录树的总字节数
        """
        import os

        total_size = 0

        try:
            # 如果是文件，直接返回文件大小
            if path.is_file():
                return path.stat().st_size

            # 如果是目录，递归计算
            if path.is_dir():
                try:
                    with os.scandir(path) as entries:
                        for entry in entries:
                            try:
                                if entry.is_file(follow_symlinks=False):
                                    total_size += entry.stat(follow_symlinks=False).st_size
                                elif entry.is_dir(follow_symlinks=False):
                                    # 递归计算子目录
                                    total_size += self._get_tree_size(Path(entry.path))
                            except (PermissionError, OSError):
                                # 忽略无法访问的文件/目录
                                continue
                except (PermissionError, OSError):
                    # 无法访问该目录
                    pass

        except Exception:
            # 其他错误，返回0
            pass

        return total_size

    def scan_path(self, path: Path, max_depth: int = 1) -> List[AssetItem]:
        """
        Scan a specific path and create AssetItem objects.

        Args:
            path: Path to scan
            max_depth: Maximum depth for recursive scanning (default: 1)

        Returns:
            List[AssetItem]: List of scanned assets
        """
        assets = []

        try:
            if not path.exists():
                print(f"Warning: Path does not exist: {path}")
                return assets

            # Scan the path itself
            asset = self._create_asset_item(path)
            if asset:
                assets.append(asset)

            # Recursively scan subdirectories if it's a directory
            if path.is_dir() and max_depth > 0:
                try:
                    for item in path.iterdir():
                        assets.extend(self.scan_path(item, max_depth - 1))
                except PermissionError:
                    print(f"Permission denied: {path}")

        except Exception as e:
            print(f"Error scanning {path}: {e}")

        return assets

    def scan_hardware_info(self) -> Optional[HardwareAsset]:
        """
        扫描系统硬件信息（使用 psutil 库）。

        采集信息包括：
        - CPU: 型号、物理核心数、逻辑核心数、当前频率、使用率
        - 内存: 总内存、已用内存、空闲内存、使用率
        - 硬盘: 所有挂载点的总空间、已用空间、使用率、文件系统类型
        - 系统/主板: 操作系统版本、架构、计算机名称、开机时间
        - 网络: 网络接口信息
        - GPU: 基础显示信息（如果可获取）

        Returns:
            HardwareAsset: 硬件信息对象，如果扫描失败返回 None
        """
        try:
            import psutil
            import datetime
        except ImportError:
            print("⚠️  警告: psutil 库未安装，无法扫描硬件信息")
            print("   请运行: pip install psutil")
            return None

        print("\n" + "=" * 70)
        print("开始硬件资产扫描")
        print("=" * 70)

        try:
            # ========== CPU 信息 ==========
            print("扫描 CPU 信息...")
            cpu_info = {}
            try:
                # CPU 型号（尝试多种方法获取）
                cpu_model = "Unknown"
                try:
                    if platform.system() == "Darwin":  # macOS
                        import subprocess
                        result = subprocess.run(['sysctl', '-n', 'machdep.cpu.brand_string'],
                                              capture_output=True, text=True, timeout=5)
                        if result.returncode == 0:
                            cpu_model = result.stdout.strip()
                    elif platform.system() == "Linux":
                        with open('/proc/cpuinfo', 'r') as f:
                            for line in f:
                                if 'model name' in line:
                                    cpu_model = line.split(':')[1].strip()
                                    break
                    elif platform.system() == "Windows":
                        cpu_model = platform.processor()
                except Exception:
                    cpu_model = platform.processor() or "Unknown"

                cpu_info['model'] = cpu_model
                cpu_info['physical_cores'] = psutil.cpu_count(logical=False) or 0
                cpu_info['logical_cores'] = psutil.cpu_count(logical=True) or 0

                # CPU 频率
                cpu_freq = psutil.cpu_freq()
                if cpu_freq:
                    cpu_info['current_freq_mhz'] = round(cpu_freq.current, 2)
                    cpu_info['min_freq_mhz'] = round(cpu_freq.min, 2) if cpu_freq.min else None
                    cpu_info['max_freq_mhz'] = round(cpu_freq.max, 2) if cpu_freq.max else None
                else:
                    cpu_info['current_freq_mhz'] = None

                # CPU 使用率
                cpu_info['usage_percent'] = psutil.cpu_percent(interval=1)

                print(f"  ✓ CPU: {cpu_info['model']}")
                print(f"    核心数: {cpu_info['physical_cores']} 物理 / {cpu_info['logical_cores']} 逻辑")
                print(f"    使用率: {cpu_info['usage_percent']}%")

            except Exception as e:
                print(f"  ⚠️  CPU 信息获取失败: {e}")
                cpu_info = {'error': str(e)}

            # ========== 内存信息 ==========
            print("\n扫描内存信息...")
            memory_info = {}
            try:
                mem = psutil.virtual_memory()
                memory_info['total_bytes'] = mem.total
                memory_info['total_gb'] = round(mem.total / (1024**3), 2)
                memory_info['used_bytes'] = mem.used
                memory_info['used_gb'] = round(mem.used / (1024**3), 2)
                memory_info['free_bytes'] = mem.available
                memory_info['free_gb'] = round(mem.available / (1024**3), 2)
                memory_info['usage_percent'] = mem.percent

                print(f"  ✓ 内存: {memory_info['total_gb']} GB 总量")
                print(f"    已用: {memory_info['used_gb']} GB ({memory_info['usage_percent']}%)")
                print(f"    可用: {memory_info['free_gb']} GB")

            except Exception as e:
                print(f"  ⚠️  内存信息获取失败: {e}")
                memory_info = {'error': str(e)}

            # ========== 硬盘信息 ==========
            print("\n扫描硬盘信息...")
            disk_info = []
            try:
                partitions = psutil.disk_partitions()
                for partition in partitions:
                    try:
                        usage = psutil.disk_usage(partition.mountpoint)
                        disk_data = {
                            'device': partition.device,
                            'mountpoint': partition.mountpoint,
                            'fstype': partition.fstype,
                            'total_bytes': usage.total,
                            'total_gb': round(usage.total / (1024**3), 2),
                            'used_bytes': usage.used,
                            'used_gb': round(usage.used / (1024**3), 2),
                            'free_bytes': usage.free,
                            'free_gb': round(usage.free / (1024**3), 2),
                            'usage_percent': usage.percent
                        }
                        disk_info.append(disk_data)
                        print(f"  ✓ 分区: {partition.mountpoint}")
                        print(f"    设备: {partition.device} ({partition.fstype})")
                        print(f"    容量: {disk_data['total_gb']} GB (已用 {disk_data['usage_percent']}%)")
                    except PermissionError:
                        # 某些分区可能没有权限访问
                        print(f"  ⚠️  无权限访问分区: {partition.mountpoint}")
                    except Exception as e:
                        print(f"  ⚠️  分区 {partition.mountpoint} 信息获取失败: {e}")

            except Exception as e:
                print(f"  ⚠️  硬盘信息获取失败: {e}")
                disk_info = [{'error': str(e)}]

            # ========== 系统/主板信息 ==========
            print("\n扫描系统信息...")
            system_info = {}
            try:
                system_info['os_name'] = platform.system()
                system_info['os_version'] = platform.version()
                system_info['os_release'] = platform.release()
                system_info['architecture'] = platform.machine()
                system_info['hostname'] = platform.node()
                system_info['platform'] = platform.platform()

                # 开机时间
                boot_time = psutil.boot_time()
                boot_datetime = datetime.datetime.fromtimestamp(boot_time)
                system_info['boot_time'] = boot_datetime.isoformat()
                system_info['uptime_seconds'] = int(datetime.datetime.now().timestamp() - boot_time)

                print(f"  ✓ 操作系统: {system_info['os_name']} {system_info['os_release']}")
                print(f"    架构: {system_info['architecture']}")
                print(f"    主机名: {system_info['hostname']}")
                print(f"    开机时间: {boot_datetime.strftime('%Y-%m-%d %H:%M:%S')}")

            except Exception as e:
                print(f"  ⚠️  系统信息获取失败: {e}")
                system_info = {'error': str(e)}

            # ========== 网络信息 ==========
            print("\n扫描网络信息...")
            network_info = []
            try:
                net_if_addrs = psutil.net_if_addrs()
                net_if_stats = psutil.net_if_stats()

                for interface_name, addresses in net_if_addrs.items():
                    interface_data = {
                        'interface': interface_name,
                        'addresses': []
                    }

                    # 获取接口状态
                    if interface_name in net_if_stats:
                        stats = net_if_stats[interface_name]
                        interface_data['is_up'] = stats.isup
                        interface_data['speed_mbps'] = stats.speed
                    else:
                        interface_data['is_up'] = None
                        interface_data['speed_mbps'] = None

                    # 获取地址信息
                    for addr in addresses:
                        addr_data = {
                            'family': str(addr.family),
                            'address': addr.address
                        }
                        if addr.netmask:
                            addr_data['netmask'] = addr.netmask
                        if addr.broadcast:
                            addr_data['broadcast'] = addr.broadcast
                        interface_data['addresses'].append(addr_data)

                    network_info.append(interface_data)
                    print(f"  ✓ 网络接口: {interface_name} ({'UP' if interface_data['is_up'] else 'DOWN'})")

            except Exception as e:
                print(f"  ⚠️  网络信息获取失败: {e}")
                network_info = [{'error': str(e)}]

            # ========== GPU 信息（智能检测）==========
            print("\n扫描 GPU 信息...")
            gpu_info = {
                'available': False,
                'gpus': [],
                'detection_method': None,
                'note': None
            }

            # 策略 1: 尝试使用 pynvml 检测 NVIDIA GPU
            try:
                import pynvml
                pynvml.nvmlInit()
                device_count = pynvml.nvmlDeviceGetCount()

                if device_count > 0:
                    for i in range(device_count):
                        try:
                            handle = pynvml.nvmlDeviceGetHandleByIndex(i)
                            gpu_data = {
                                'index': i,
                                'name': pynvml.nvmlDeviceGetName(handle).decode('utf-8') if isinstance(pynvml.nvmlDeviceGetName(handle), bytes) else pynvml.nvmlDeviceGetName(handle),
                                'vendor': 'NVIDIA'
                            }

                            # 获取显存信息
                            try:
                                vram_info = pynvml.nvmlDeviceGetMemoryInfo(handle)
                                # 构建纯 Python 字典，避免 C 对象导致的 JSON 序列化错误
                                gpu_data['memory_info'] = {
                                    'total_mb': round(float(vram_info.total) / (1024**2), 2),
                                    'used_mb': round(float(vram_info.used) / (1024**2), 2),
                                    'free_mb': round(float(vram_info.free) / (1024**2), 2)
                                }
                            except:
                                pass

                            # 获取温度
                            try:
                                temp = pynvml.nvmlDeviceGetTemperature(handle, pynvml.NVML_TEMPERATURE_GPU)
                                # 确保是 Python int 类型
                                gpu_data['temperature_c'] = int(temp)
                            except:
                                pass

                            # 获取使用率
                            try:
                                utilization = pynvml.nvmlDeviceGetUtilizationRates(handle)
                                # 确保是 Python int/float 类型
                                gpu_data['gpu_utilization_percent'] = int(utilization.gpu)
                                gpu_data['memory_utilization_percent'] = int(utilization.memory)
                            except:
                                pass

                            gpu_info['gpus'].append(gpu_data)
                        except Exception as e:
                            print(f"  ⚠️  无法获取 GPU {i} 的详细信息: {e}")

                    if gpu_info['gpus']:
                        gpu_info['available'] = True
                        gpu_info['detection_method'] = 'pynvml (NVIDIA)'
                        print(f"  ✓ 检测到 {len(gpu_info['gpus'])} 个 NVIDIA GPU")
                        for gpu in gpu_info['gpus']:
                            print(f"    - {gpu['name']}")

                pynvml.nvmlShutdown()

            except ImportError:
                # pynvml 未安装，继续尝试其他方法
                pass
            except Exception as e:
                # NVIDIA GPU 检测失败（可能没有 NVIDIA GPU 或驱动问题）
                pass

            # 策略 2: 如果是 macOS，尝试使用 system_profiler 检测 GPU
            if not gpu_info['available'] and platform.system() == "Darwin":
                try:
                    import subprocess
                    result = subprocess.run(
                        ['system_profiler', 'SPDisplaysDataType'],
                        capture_output=True,
                        text=True,
                        timeout=10
                    )

                    if result.returncode == 0:
                        output = result.stdout
                        # 解析输出，查找 GPU 信息
                        lines = output.split('\n')
                        current_gpu = None

                        for line in lines:
                            line = line.strip()

                            # 检测 GPU 名称（通常在 "Chipset Model:" 后面）
                            if 'Chipset Model:' in line or 'Graphics:' in line:
                                gpu_name = line.split(':', 1)[1].strip() if ':' in line else 'Unknown'
                                current_gpu = {
                                    'name': gpu_name,
                                    'vendor': 'Apple' if 'Apple' in gpu_name else 'Unknown'
                                }
                                gpu_info['gpus'].append(current_gpu)

                            # 检测 VRAM
                            elif current_gpu and ('VRAM' in line or 'Memory' in line) and ':' in line:
                                vram_str = line.split(':', 1)[1].strip()
                                current_gpu['vram'] = vram_str

                        if gpu_info['gpus']:
                            gpu_info['available'] = True
                            gpu_info['detection_method'] = 'system_profiler (macOS)'
                            print(f"  ✓ 检测到 {len(gpu_info['gpus'])} 个 GPU (macOS)")
                            for gpu in gpu_info['gpus']:
                                print(f"    - {gpu['name']}")

                except Exception as e:
                    # macOS GPU 检测失败
                    pass

            # 策略 3: 尝试使用 GPUtil (备用方案，适用于 NVIDIA)
            if not gpu_info['available']:
                try:
                    import GPUtil
                    gpus = GPUtil.getGPUs()

                    if gpus:
                        for gpu in gpus:
                            gpu_data = {
                                'index': gpu.id,
                                'name': gpu.name,
                                'vendor': 'NVIDIA',
                                'memory_total_mb': gpu.memoryTotal,
                                'memory_used_mb': gpu.memoryUsed,
                                'memory_free_mb': gpu.memoryFree,
                                'gpu_utilization_percent': gpu.load * 100,
                                'temperature_c': gpu.temperature
                            }
                            gpu_info['gpus'].append(gpu_data)

                        gpu_info['available'] = True
                        gpu_info['detection_method'] = 'GPUtil (NVIDIA)'
                        print(f"  ✓ 检测到 {len(gpu_info['gpus'])} 个 NVIDIA GPU")
                        for gpu_data in gpu_info['gpus']:
                            print(f"    - {gpu_data['name']}")

                except ImportError:
                    # GPUtil 未安装
                    pass
                except Exception as e:
                    # GPUtil 检测失败
                    pass

            # 如果所有方法都失败
            if not gpu_info['available']:
                gpu_info['note'] = 'GPU 信息不可用。可安装 pynvml (NVIDIA) 或 GPUtil 以启用 GPU 检测。'
                print(f"  ⚠️  未检测到 GPU 或 GPU 信息不可用")
                print(f"     提示: 安装 pynvml 或 GPUtil 以启用 NVIDIA GPU 检测")

            print("=" * 70)
            print("硬件扫描完成")
            print("=" * 70)

            # 创建 HardwareAsset 对象
            hardware_asset = HardwareAsset(
                cpu_info=cpu_info,
                memory_info=memory_info,
                disk_info=disk_info,
                system_info=system_info,
                network_info=network_info,
                gpu_info=gpu_info
            )

            return hardware_asset

        except Exception as e:
            print(f"\n❌ 硬件扫描失败: {e}")
            import traceback
            traceback.print_exc()
            return None

    def _create_asset_item(self, path: Path) -> AssetItem:
        """
        Create an AssetItem from a path.

        Args:
            path: Path to create asset from

        Returns:
            AssetItem: Created asset item with risk assessment, or None if error
        """
        try:
            stat_info = path.stat()

            # Determine file type
            if path.is_dir():
                file_type = "directory"
            elif path.is_symlink():
                file_type = "symlink"
            elif path.is_file():
                file_type = "file"
            else:
                file_type = "unknown"

            # Get owner (platform-specific)
            try:
                import pwd
                owner = pwd.getpwuid(stat_info.st_uid).pw_name
            except (ImportError, KeyError):
                # Windows or owner not found
                owner = str(stat_info.st_uid)

            # Get permissions
            permissions = oct(stat_info.st_mode)[-3:]

            # 使用新的详细风险评估方法
            risk_level = self.assess_risk_level(path, file_type)

            # ========== 防伪装检测 (Anti-Spoofing) ==========
            path_suffix = path.suffix.lower()
            is_spoofed = False

            if file_type == "file":
                is_spoofed = self._detect_spoofing(path, path_suffix)
                if is_spoofed:
                    # 检测到伪装，强制提升风险等级为 LEVEL_0
                    risk_level = RiskLevel.LEVEL_0
                    print(f"  ⚠️  检测到伪装文件: {path}")

            # ========== 符号链接防御 (Symlink Defense) ==========
            real_path = None
            resolved_risk = None

            if path.is_symlink():
                try:
                    # 获取真实路径
                    real_path = path.resolve()

                    # 基于真实路径重新评估风险
                    # 确定真实路径的文件类型
                    if real_path.is_dir():
                        real_file_type = "directory"
                    elif real_path.is_file():
                        real_file_type = "file"
                    else:
                        real_file_type = "unknown"

                    resolved_risk = self.assess_risk_level(real_path, real_file_type)

                except (OSError, RuntimeError) as e:
                    # 符号链接可能损坏或循环引用
                    pass

            # ========== Windows 增强 (Windows Enhancement) ==========
            metadata = {}

            if self.os_type == "Windows":
                try:
                    import stat as stat_module

                    # 检查只读属性
                    is_readonly = not (stat_info.st_mode & stat_module.S_IWRITE)
                    metadata['readonly'] = is_readonly

                    # 检查隐藏属性 (Windows specific)
                    try:
                        import ctypes
                        FILE_ATTRIBUTE_HIDDEN = 0x02

                        # 获取文件属性
                        attrs = ctypes.windll.kernel32.GetFileAttributesW(str(path))
                        if attrs != -1:  # -1 表示失败
                            is_hidden = bool(attrs & FILE_ATTRIBUTE_HIDDEN)
                            metadata['hidden'] = is_hidden
                    except Exception:
                        # 如果无法获取隐藏属性，跳过
                        pass

                except Exception:
                    # 如果获取 Windows 属性失败，跳过
                    pass

            # ========== 大文件标记和目录大小计算 ==========
            direct_size = None

            if path.is_file():
                file_size = stat_info.st_size
                direct_size = stat_info.st_size
            elif path.is_dir():
                # 计算直接文件大小（不递归，不包括子目录）
                direct_size = self._get_direct_size(path)

                # 只为叶子目录计算总大小
                if not self._has_subdirectories(path):
                    file_size = self._get_tree_size(path)
                else:
                    file_size = None
            else:
                file_size = None
                direct_size = None

            # 只为文件标记"大文件"，不为目录标记
            if file_size and file_size > self.large_file_threshold and path.is_file():
                metadata['is_large_file'] = True
                # 转换为 MB 显示
                size_mb = file_size / (1024 * 1024)
                print(f"  📦 发现大文件 ({size_mb:.1f} MB): {path}")

            # ========== 防伪装标记 ==========
            if is_spoofed:
                metadata['is_spoofed'] = True
                metadata['spoofing_detected'] = '文件扩展名与实际类型不匹配'

            return AssetItem(
                path=path,
                file_type=file_type,
                owner=owner,
                risk_level=risk_level,
                size=file_size,
                permissions=permissions,
                real_path=real_path,
                resolved_risk=resolved_risk,
                metadata=metadata if metadata else None,
                direct_size=direct_size
            )

        except PermissionError:
            # 权限错误 - 记录但不打印（避免输出过多）
            # 这些已经在 _scan_path_bfs 中被记录
            return None
        except FileNotFoundError:
            # 文件不存在（可能在扫描过程中被删除）
            return None
        except OSError as e:
            # 其他操作系统错误（如符号链接损坏等）
            # 静默处理，避免输出过多错误信息
            return None
        except Exception as e:
            # 其他未预期的错误 - 打印警告
            print(f"  警告: 无法处理 {path}: {e}")
            return None

    def _assess_risk(self, path: Path, file_type: str, permissions: str) -> RiskLevel:
        """
        Assess the risk level of an asset.

        Args:
            path: Path to the asset
            file_type: Type of the file
            permissions: File permissions string

        Returns:
            RiskLevel: Assessed risk level (0-3)
        """
        # Basic risk assessment logic
        risk_score = 0

        # System directories are higher risk
        path_str = str(path).lower()
        if any(sys_path in path_str for sys_path in ['/system', '/windows', '/etc', '/bin']):
            risk_score += 2

        # Executable files are higher risk
        if path.suffix in ['.exe', '.sh', '.bat', '.cmd', '.app']:
            risk_score += 1

        # World-writable files are higher risk
        if permissions and permissions[-1] in ['2', '3', '6', '7']:
            risk_score += 1

        # Map score to risk level
        if risk_score >= 3:
            return RiskLevel.LEVEL_0  # 修改：高风险改为 LEVEL_0
        elif risk_score == 2:
            return RiskLevel.LEVEL_1  # 修改：中高风险改为 LEVEL_1
        elif risk_score == 1:
            return RiskLevel.LEVEL_2  # 修改：中低风险改为 LEVEL_2
        else:
            return RiskLevel.LEVEL_3  # 修改：低风险改为 LEVEL_3

    def _is_in_app_directory(self, path_str: str) -> bool:
        """
        判断路径是否位于应用程序安装目录中。

        应用程序目录的文件（如图标、配置、资源）应被视为系统关键文件，
        而不是用户数据。

        Args:
            path_str: 小写的路径字符串

        Returns:
            bool: 如果在应用程序目录中返回 True
        """
        # 统一路径分隔符为正斜杠，便于跨平台匹配
        path_str_normalized = path_str.replace('\\', '/')

        # Windows 应用程序目录特征（移除 C 盘硬编码，支持任意盘符）
        windows_app_paths = [
            'program files', 'program files (x86)',  # 任意盘符的 Program Files
            '/windows/',  # 任意盘符的 Windows 目录
            '/system32/'  # 任意盘符的 System32 目录
        ]

        # macOS 应用程序目录特征
        macos_app_paths = [
            '/applications/',  # 系统应用
            '/system/',  # 系统目录
            '/library/',  # 系统库（排除用户库）
            '.app/contents/',  # .app 包内部
            '/contents/macos',  # macOS 可执行文件目录
            '/contents/resources'  # macOS 资源目录
        ]

        # Linux 应用程序目录特征
        linux_app_paths = [
            '/usr/bin', '/usr/sbin', '/usr/lib', '/usr/share',
            '/opt/',  # 第三方软件安装目录
            '/bin/', '/sbin/', '/lib/', '/lib64/'
        ]

        # Electron 应用特征（跨平台，已规范化为正斜杠）
        electron_app_features = [
            'resources/app',  # Electron 应用资源
            '/electron'
        ]

        # 检查 Windows 路径
        if self.os_type == "Windows":
            if any(app_path in path_str_normalized for app_path in windows_app_paths):
                return True

        # 检查 macOS 路径
        elif self.os_type == "macOS":
            for app_path in macos_app_paths:
                # 特殊处理：排除用户 Library 目录
                if app_path == '/library/' and '/users/' in path_str_normalized:
                    continue
                if app_path in path_str_normalized:
                    return True

        # 检查 Linux 路径
        elif self.os_type == "Linux":
            if any(app_path in path_str_normalized for app_path in linux_app_paths):
                return True

        # 检查 Electron 应用特征（所有平台）
        if any(feature in path_str_normalized for feature in electron_app_features):
            return True

        # 启发式检测：基于目录结构特征识别应用程序目录
        if self._detect_app_directory_heuristics(path_str_normalized, Path(path_str)):
            return True

        return False

    def _detect_app_directory_heuristics(self, path_str_normalized: str, path_obj: Path) -> bool:
        """
        基于目录结构特征启发式检测应用程序目录。

        检测规则：
        1. 包含 versions/ 目录结构（如 QQ、Chrome）
        2. 包含 Electron 应用特征（app.asar、resources/app/）
        3. 包含常见软件名称模式
        4. 检测父目录中的可执行文件（用户提议）
        5. 排除用户数据目录和开发项目

        Args:
            path_str_normalized: 规范化后的路径字符串（小写+正斜杠）
            path_obj: Path 对象（用于文件系统检查）

        Returns:
            bool: 如果检测到应用程序目录特征返回 True
        """
        # 排除规则：用户数据目录和开发项目
        exclude_patterns = [
            '/documents/', '/desktop/', '/downloads/', '/pictures/',
            '/music/', '/videos/', '/userdata/', '/user data/',
            '/.git/', '/node_modules/', '/src/', '/__pycache__/'
        ]
        if any(pattern in path_str_normalized for pattern in exclude_patterns):
            return False

        # 规则 1: 检测 versions/ 目录结构（QQ、Chrome、Electron 应用）
        if '/versions/' in path_str_normalized:
            # 检查是否符合版本号模式：versions/9.9.25-42941/
            import re
            if re.search(r'/versions/[\d.]+[-\d]*/', path_str_normalized):
                return True

        # 规则 2: 检测 Electron 应用特征
        electron_markers = [
            '/resources/app.asar',
            '/resources/app/',
            '/app.asar'
        ]
        if any(marker in path_str_normalized for marker in electron_markers):
            return True

        # 规则 3: 检测常见软件名称模式（仅当路径较短时，避免误判）
        # 例如：D:/QQ/、D:/WeChat/、E:/Photoshop/
        path_parts = path_str_normalized.split('/')
        if len(path_parts) <= 4:  # 限制路径深度，避免误判子目录
            common_software_names = [
                'qq', 'wechat', 'weixin', 'chrome', 'firefox', 'edge',
                'photoshop', 'illustrator', 'office', 'vscode', 'pycharm',
                'steam', 'epic games', 'ubisoft', 'origin', 'battle.net'
            ]
            for part in path_parts:
                if part in common_software_names:
                    return True

        # 规则 4: 检测父目录及祖先目录中的可执行文件（用户提议的启发式规则）
        # 例如：D:/UPDF/subfolder/file.dll → 向上回溯检查 D:/UPDF/subfolder 和 D:/UPDF
        # 如果 D:/UPDF 有可执行文件，则 D:/UPDF 下所有文件归为 LEVEL_0
        # 防止 agent 误删应用程序文件
        try:
            # 从父目录开始向上回溯
            current_dir = path_obj.parent

            # 向上回溯，检查所有祖先目录（直到路径深度 > 4）
            while current_dir:
                # 路径深度检查：只检查深度 ≤ 4 的目录
                dir_parts = str(current_dir).replace('\\', '/').lower().split('/')
                # 过滤空字符串（split 可能产生空字符串）
                dir_parts = [p for p in dir_parts if p]
                if len(dir_parts) > 4:
                    break  # 超过深度限制，停止回溯

                # 检查当前目录是否存在且可访问
                if not current_dir.exists() or not current_dir.is_dir():
                    break

                # 统计当前目录第一层的可执行文件数量
                exe_count = 0
                try:
                    for item in current_dir.iterdir():
                        # 只检查第一层文件，不递归
                        if item.is_file():
                            ext = item.suffix.lower()
                            if ext in ['.exe', '.msi', '.app', '.dmg']:
                                exe_count += 1
                                # 优化：找到 2 个即可判定为应用目录
                                if exe_count >= 2:
                                    return True
                except (OSError, PermissionError):
                    # 无法访问当前目录，继续向上回溯
                    pass

                # 单个 .exe 文件也可能是应用目录（如 UPDF.exe）
                # 但需要结合目录名称判断，避免误判 Downloads 文件夹
                if exe_count == 1:
                    # 检查目录名称是否像应用程序名称（非通用名称）
                    dir_name = current_dir.name.lower()
                    generic_names = ['downloads', 'desktop', 'documents', 'temp', 'tmp', 'cache']
                    if dir_name not in generic_names:
                        return True

                # 向上回溯到父目录
                if current_dir.parent == current_dir:
                    break  # 已经到达根目录
                current_dir = current_dir.parent

        except (OSError, PermissionError):
            # 文件系统访问错误，跳过此规则
            pass

        return False

    def assess_risk_level(self, path: Path, file_type: str = None) -> RiskLevel:
        """
        详细的安全定级方法，根据路径和文件类型评估风险等级。

        定级规则（数字越小风险越高）：
        - Level 0 (操作系统核心和应用程序 - 红色): 系统核心目录、可执行文件、驱动、应用程序及其数据
        - Level 1 (敏感凭证 - 橙色): 密钥、密码、浏览器隐私数据、Git配置等敏感信息
        - Level 2 (用户数据 - 黄色): 用户文档、个人数据、下载内容、源代码、设计文件等
        - Level 3 (可清理 - 绿色): 临时文件、缓存、垃圾箱、日志等可安全清理的内容

        Args:
            path: 要评估的路径
            file_type: 文件类型（可选）

        Returns:
            RiskLevel: 评估的风险等级
        """
        path_str = str(path).lower()
        path_name = path.name.lower()
        path_suffix = path.suffix.lower()

        # ========== Level 0: 操作系统核心和应用程序（最高风险）==========

        # 1. 可执行文件和驱动（所有操作系统）
        if path_suffix in self._L0_EXTENSIONS:
            return RiskLevel.LEVEL_0

        # 1.5. 应用程序资源文件（软件运行依赖）
        if path_suffix in self._L0_APP_RESOURCES:
            return RiskLevel.LEVEL_0

        # 2. 关键系统文件名（完全匹配）
        if path_name in self._L0_CRITICAL_FILENAMES:
            return RiskLevel.LEVEL_0

        # 3. Windows 注册表文件
        if self.os_type == "Windows":
            if 'system32' in path_str and 'config' in path_str:
                if path_name in self._L0_CRITICAL_FILENAMES:
                    return RiskLevel.LEVEL_0

        # 4. Windows 系统关键路径
        if self.os_type == "Windows":
            windows_critical = [
                'c:\\windows', 'c:/windows',
                'program files', 'program files (x86)',
                'c:\\system32', 'c:/system32',
                'c:\\programdata', 'c:/programdata'
            ]
            if any(critical in path_str for critical in windows_critical):
                return RiskLevel.LEVEL_0

            # Windows 应用程序数据目录
            windows_appdata = ['appdata\\\\roaming', 'appdata\\\\local', 'appdata/roaming', 'appdata/local']
            if any(appdata in path_str for appdata in windows_appdata):
                return RiskLevel.LEVEL_0

        # 5. macOS/Linux 系统关键路径和应用程序
        elif self.os_type in ["macOS", "Linux"]:
            if self.os_type == "macOS":
                macos_critical = ['/system', '/library', '/applications', '/usr', '/bin', '/sbin', '/private/etc', '/boot']
                # 检查路径是否以这些关键路径开头
                for critical in macos_critical:
                    if path_str.startswith(critical.lower()):
                        return RiskLevel.LEVEL_0

                # macOS 应用程序数据目录（用户级和系统级）
                # ~/Library/Application Support 和 /Library/Application Support
                if 'library/application support' in path_str:
                    return RiskLevel.LEVEL_0

            elif self.os_type == "Linux":
                linux_critical = ['/bin', '/sbin', '/usr', '/etc', '/boot', '/lib', '/lib64', '/opt']
                # 检查路径是否以这些关键路径开头
                for critical in linux_critical:
                    if path_str.startswith(critical.lower()):
                        return RiskLevel.LEVEL_0

                # Linux 应用程序数据目录
                if '.local/share' in path_str:
                    return RiskLevel.LEVEL_0

        # 6. 安全软件自我保护
        for security_sw in self._L0_SECURITY_SOFTWARE:
            if security_sw in path_str:
                return RiskLevel.LEVEL_0

        # 7. 上下文感知：应用程序目录中的文件提升为 Level 0
        # 软件安装目录中的图片是图标，文本是许可协议，JSON是配置，不是用户数据
        if self._is_in_app_directory(path_str):
            # 排除日志和临时文件（它们应该保持 Level 3）
            if path_suffix not in {'.log', '.logs', '.tmp', '.temp'}:
                if not any(temp_dir in path_str for temp_dir in ['temp', 'tmp', 'cache', 'caches']):
                    # 原本会被归类为 Level 2 的文件类型，在应用目录中提升为 Level 0
                    if (path_suffix in self._L2_MEDIA_EXTENSIONS or
                        path_suffix in self._L2_DOCUMENT_EXTENSIONS or
                        path_suffix in {'.txt', '.json', '.xml', '.ini', '.config', '.cfg'}):
                        return RiskLevel.LEVEL_0

        # ========== Level 1: 敏感凭证（高风险）==========

        # 1. 敏感凭证扩展名
        if path_suffix in self._L1_EXTENSIONS:
            return RiskLevel.LEVEL_1

        # 2. 浏览器隐私数据（最重要）
        # Windows: User Data, macOS: Application Support
        if ('user data' in path_str or 'application support' in path_str):
            if path_name in self._L1_BROWSER_FILES:
                return RiskLevel.LEVEL_1

        # 3. 敏感目录
        if any(sens_dir in path_str for sens_dir in self._L1_SENSITIVE_DIRS):
            return RiskLevel.LEVEL_1

        # 4. Git 配置
        if path_name == '.gitconfig':
            return RiskLevel.LEVEL_1
        if '.git' in path_str and path_name == 'config':
            return RiskLevel.LEVEL_1

        # 5. 敏感文件名关键词（使用正则表达式）
        sensitive_patterns = [
            r'password', r'passwd', r'secret', r'credential',
            r'private.*key', r'token', r'api.*key',
            r'\bauth\b',  # 使用单词边界，避免匹配 "author"
            r'authentication', r'authorize',  # 明确的认证相关词
            r'\.env$'
        ]
        for pattern in sensitive_patterns:
            if re.search(pattern, path_name):
                return RiskLevel.LEVEL_1

        # ========== Level 2: 用户数据（中等风险）==========

        # 1. 源代码文件
        if path_suffix in self._L2_CODE_EXTENSIONS:
            return RiskLevel.LEVEL_2

        # 2. 设计与媒体源文件
        if path_suffix in self._L2_DESIGN_EXTENSIONS:
            return RiskLevel.LEVEL_2

        # 3. 虚拟机与容器
        if path_suffix in self._L2_VM_EXTENSIONS:
            return RiskLevel.LEVEL_2

        # 4. 邮件存档
        if path_suffix in self._L2_EMAIL_EXTENSIONS:
            return RiskLevel.LEVEL_2

        # 5. 办公文档
        if path_suffix in self._L2_DOCUMENT_EXTENSIONS:
            return RiskLevel.LEVEL_2

        # 6. 数据库文件
        if path_suffix in self._L2_DATABASE_EXTENSIONS:
            return RiskLevel.LEVEL_2

        # 7. 用户数据目录（Documents, Desktop, Pictures, Music, Videos, Downloads）
        user_data_dirs = [
            'documents', 'desktop', 'pictures', 'photos', 'music', 'videos',
            'downloads', 'download'  # Downloads 移到 Level 2
        ]
        if any(data_dir in path_str for data_dir in user_data_dirs):
            return RiskLevel.LEVEL_2

        # 8. 媒体文件（图片、音频、视频）
        if path_suffix in self._L2_MEDIA_EXTENSIONS:
            return RiskLevel.LEVEL_2

        # ========== Level 3: 可清理（最低风险）==========

        # 1. 垃圾箱
        trash_dirs = [
            '.trash', '.trashes',  # macOS
            '$recycle.bin', 'recycle.bin',  # Windows
            '.local/share/trash'  # Linux
        ]
        if any(trash_dir in path_str for trash_dir in trash_dirs):
            return RiskLevel.LEVEL_3

        # 2. 开发包缓存
        for cache_dir in self._L3_DEV_CACHE_DIRS:
            if cache_dir in path_str:
                return RiskLevel.LEVEL_3

        # 3. 浏览器缓存（注意区分 Cookies）
        # 只有当路径包含 cache 且不包含 cookies 时才判定为缓存
        if any(cache_keyword in path_str for cache_keyword in self._L3_BROWSER_CACHE):
            if 'cookies' not in path_str and 'cookie' not in path_str:
                return RiskLevel.LEVEL_3

        # 4. 系统缓存目录
        cache_dirs = ['caches', '/cache', '\\cache']
        if any(cache_dir in path_str for cache_dir in cache_dirs):
            return RiskLevel.LEVEL_3

        # 5. 临时目录
        temp_dirs = ['temp', 'tmp', 'temporary']
        if any(temp_dir in path_str for temp_dir in temp_dirs):
            return RiskLevel.LEVEL_3

        # 6. agent_workspace 目录
        if 'agent_workspace' in path_str:
            return RiskLevel.LEVEL_3

        # 7. 日志文件
        if path_suffix in {'.log', '.logs'}:
            return RiskLevel.LEVEL_3

        # 8. 备份文件
        if path_name.endswith(('.bak', '.backup', '.old')):
            return RiskLevel.LEVEL_3

        # ========== 默认：根据文件类型判断 ==========

        # 如果是目录，默认为 Level 2（用户数据）
        if file_type == "directory" or (path.exists() and path.is_dir()):
            return RiskLevel.LEVEL_2

        # 其他文件默认为 Level 2（用户数据）
        return RiskLevel.LEVEL_2

    def _should_ignore(self, path: Path) -> bool:
        """
        判断是否应该忽略某个路径。

        Args:
            path: 要检查的路径

        Returns:
            bool: 如果应该忽略返回 True，否则返回 False
        """
        # 检查是否是隐藏文件/文件夹（以.开头）
        if path.name.startswith('.') and path.name not in ['.', '..']:
            return True

        # 检查是否在忽略列表中
        if path.name in IGNORE_PATTERNS:
            return True

        return False

    def _process_single_item(self, current_path: Path, depth: int, visited: Set[Path]) -> tuple:
        """
        处理单个文件或目录项（线程安全）。

        Args:
            current_path: 当前路径
            depth: 当前深度
            visited: 已访问路径集合

        Returns:
            tuple: (asset, child_paths, ignored_info)
        """
        try:
            self._ensure_not_cancelled()
            # 检查路径是否存在
            if not current_path.exists():
                return None, [], None

            # 检查是否应该忽略
            if self._should_ignore(current_path):
                # 计算被忽略项目的大小
                ignored_size = self._get_tree_size(current_path)
                ignored_info = {
                    'path': str(current_path),
                    'reason': '隐藏文件或忽略列表中的项目',
                    'depth': depth,
                    'size': ignored_size
                }
                return None, [], ignored_info

            # 创建资产项
            asset = self._create_asset_item(current_path)

            # 收集子路径
            child_paths = []
            if current_path.is_dir():
                self._ensure_not_cancelled()
                try:
                    for item in current_path.iterdir():
                        if item not in visited:
                            child_paths.append(item)
                except PermissionError:
                    ignored_info = {
                        'path': str(current_path),
                        'reason': '权限被拒绝',
                        'depth': depth
                    }
                    return asset, [], ignored_info
                except Exception as e:
                    print(f"  错误: 无法读取目录 {current_path}: {e}")

            return asset, child_paths, None

        except ScanCancelledError:
            raise
        except Exception as e:
            print(f"  错误: 扫描 {current_path} 时出错: {e}")
            return None, [], None

    def _scan_path_walk(self, root_path: Path) -> List[AssetItem]:
        """
        使用 os.walk 进行高效的全盘扫描（无深度限制）。

        Args:
            root_path: 要扫描的根路径

        Returns:
            List[AssetItem]: 扫描到的资产列表
        """
        import os

        assets = []
        progress_counter = 0

        # 定义操作系统特定的黑名单目录
        MAC_SKIP_DIRS = {'/System/Volumes', '/Volumes', '/dev', '/net'}
        LINUX_SKIP_DIRS = {'/proc', '/sys', '/dev', '/run', '/snap', '/mnt', '/media'}

        print(f"\n开始扫描: {root_path}")

        try:
            for root, dirs, files in os.walk(root_path, topdown=True, followlinks=False):
                self._ensure_not_cancelled()
                current_root = Path(root)

                # ========== macOS 特殊处理：剪枝黑名单目录 ==========
                if self.os_type == "macOS":
                    # 检查当前路径是否在黑名单中
                    skip_current = False
                    for skip_dir in MAC_SKIP_DIRS:
                        if str(current_root).startswith(skip_dir):
                            skip_current = True
                            break

                    if skip_current:
                        dirs[:] = []  # 清空子目录列表，阻断进入
                        continue

                    # 从 dirs 列表中移除黑名单目录
                    dirs_to_remove = []
                    for d in dirs:
                        dir_path = current_root / d
                        # 检查是否是 Volumes 且位于根目录下
                        if d == 'Volumes' and current_root == Path('/'):
                            dirs_to_remove.append(d)
                        # 检查是否在黑名单中
                        for skip_dir in MAC_SKIP_DIRS:
                            if str(dir_path).startswith(skip_dir):
                                dirs_to_remove.append(d)
                                break

                    for d in dirs_to_remove:
                        if d in dirs:
                            dirs.remove(d)

                # ========== Linux 特殊处理：剪枝黑名单目录 ==========
                elif self.os_type == "Linux":
                    # 检查当前路径是否在黑名单中
                    skip_current = False
                    for skip_dir in LINUX_SKIP_DIRS:
                        if str(current_root).startswith(skip_dir):
                            skip_current = True
                            break

                    if skip_current:
                        dirs[:] = []  # 清空子目录列表，阻断进入
                        continue

                    # 从 dirs 列表中移除黑名单目录
                    dirs_to_remove = []
                    for d in dirs:
                        dir_path = current_root / d
                        for skip_dir in LINUX_SKIP_DIRS:
                            if str(dir_path).startswith(skip_dir):
                                dirs_to_remove.append(d)
                                break

                    for d in dirs_to_remove:
                        if d in dirs:
                            dirs.remove(d)

                # ========== 通用处理：过滤 IGNORE_PATTERNS ==========
                dirs_to_remove = []
                for d in dirs:
                    if self._should_ignore(current_root / d):
                        dirs_to_remove.append(d)
                        # 记录被忽略的目录
                        with self._lock:
                            ignored_size = self._get_tree_size(current_root / d)
                            self.ignored_items.append({
                                'path': str(current_root / d),
                                'reason': '隐藏文件或忽略列表中的项目',
                                'size': ignored_size
                            })
                            self.ignored_count += 1
                            self.ignored_size += ignored_size

                for d in dirs_to_remove:
                    if d in dirs:
                        dirs.remove(d)

                # ========== 处理当前目录 ==========
                try:
                    self._ensure_not_cancelled()
                    # 创建当前目录的资产项
                    dir_asset = self._create_asset_item(current_root)
                    if dir_asset:
                        assets.append(dir_asset)
                        with self._lock:
                            self.scanned_count += 1
                            progress_counter += 1
                except (PermissionError, OSError):
                    with self._lock:
                        self.ignored_items.append({
                            'path': str(current_root),
                            'reason': '权限被拒绝'
                        })
                        self.ignored_count += 1

                # ========== 处理当前目录下的文件 ==========
                for filename in files:
                    self._ensure_not_cancelled()
                    file_path = current_root / filename

                    # 检查是否应该忽略
                    if self._should_ignore(file_path):
                        with self._lock:
                            self.ignored_items.append({
                                'path': str(file_path),
                                'reason': '隐藏文件或忽略列表中的项目'
                            })
                            self.ignored_count += 1
                        continue

                    try:
                        # 创建文件资产项
                        file_asset = self._create_asset_item(file_path)
                        if file_asset:
                            assets.append(file_asset)
                            with self._lock:
                                self.scanned_count += 1
                                progress_counter += 1
                    except (PermissionError, OSError):
                        with self._lock:
                            self.ignored_items.append({
                                'path': str(file_path),
                                'reason': '权限被拒绝'
                            })
                            self.ignored_count += 1
                    except Exception as e:
                        # 其他错误，静默处理
                        pass

                    # ========== 进度显示：每 5000 个文件刷新一次 ==========
                    if progress_counter % 5000 == 0:
                        print(f"\r已扫描: {self.scanned_count} 个项目...", end="", flush=True)

        except ScanCancelledError:
            raise
        except PermissionError:
            print(f"\n  ⚠️  权限不足，无法访问: {root_path}")
        except Exception as e:
            print(f"\n  ⚠️  扫描 {root_path} 时出错: {e}")

        # 换行，结束进度显示
        if progress_counter > 0:
            print()

        return assets

    def _scan_path_bfs(self, root_path: Path, max_depth: int = 5, exclude_paths: Set[Path] = None) -> List[AssetItem]:
        """
        使用广度优先策略和多线程扫描路径。

        Args:
            root_path: 要扫描的根路径
            max_depth: 最大扫描深度（默认5层）
            exclude_paths: 要排除的路径集合（可选）

        Returns:
            List[AssetItem]: 扫描到的资产列表
        """
        assets = []
        # 使用队列实现广度优先遍历，队列元素为 (路径, 当前深度)
        queue = deque([(root_path, 0)])
        visited: Set[Path] = set()

        print(f"\n开始扫描: {root_path}")

        # 使用线程池进行并发扫描
        with ThreadPoolExecutor(max_workers=4) as executor:
            while queue:
                self._ensure_not_cancelled()
                # 批量处理当前层级的所有项目
                current_batch = []
                batch_size = min(len(queue), 50)  # 每批最多处理50个项目

                for _ in range(batch_size):
                    if not queue:
                        break
                    current_path, depth = queue.popleft()

                    # 避免重复扫描
                    if current_path in visited:
                        continue

                    visited.add(current_path)

                    # 检查是否在排除列表中
                    if exclude_paths and current_path in exclude_paths:
                        print(f"  ⏭️  跳过已扫描路径: {current_path}")
                        continue

                    # 检查深度限制
                    if depth > max_depth:
                        continue

                    current_batch.append((current_path, depth))

                # 并发处理当前批次
                if current_batch:
                    futures = {
                        executor.submit(self._process_single_item, path, depth, visited): (path, depth)
                        for path, depth in current_batch
                    }

                    for future in as_completed(futures):
                        self._ensure_not_cancelled()
                        path, depth = futures[future]
                        try:
                            asset, child_paths, ignored_info = future.result()

                            # 线程安全地更新共享变量
                            with self._lock:
                                if asset:
                                    assets.append(asset)
                                    self.scanned_count += 1

                                if ignored_info:
                                    self.ignored_items.append(ignored_info)
                                    self.ignored_count += 1
                                    # 累加被忽略项目的大小
                                    if 'size' in ignored_info:
                                        self.ignored_size += ignored_info['size']

                            # 将子路径加入队列（如果未达到最大深度）
                            if depth < max_depth:
                                for child_path in child_paths:
                                    if child_path not in visited:
                                        queue.append((child_path, depth + 1))

                        except ScanCancelledError:
                            raise
                        except Exception as e:
                            print(f"  错误: 处理 {path} 时出错: {e}")

        return assets

    def scan_assets(self, max_depth: int = 5, scan_system_root: bool = False, target_path: Optional[Path] = None) -> List[AssetItem]:
        """
        核心扫描方法：使用 os.walk 进行高效的全盘资产扫描。

        扫描策略：
        1. 如果指定了 target_path：仅扫描该路径及其子目录（无深度限制）
        2. 如果未指定 target_path（全盘模式）：
           - 默认：仅扫描用户Home目录（无深度限制）
           - scan_system_root=True：扫描整个系统（Windows 下扫描所有分区，macOS/Linux 扫描根目录）
        3. 自动忽略隐藏文件和垃圾文件夹
        4. 自动剪枝黑名单目录（macOS/Linux 特定）
        5. 记录所有被忽略的项目

        Args:
            max_depth: 保留参数以保持接口兼容（实际不使用，os.walk 无深度限制）
            scan_system_root: 是否扫描系统根目录（默认False）
            target_path: 指定要扫描的路径（可选）。如果提供，则只扫描该路径

        Returns:
            List[AssetItem]: 所有扫描到的资产列表
        """
        print("=" * 70)
        print("开始资产扫描")
        print("=" * 70)
        print(f"操作系统: {self.os_type}")

        # 如果指定了 target_path，显示目标路径
        if target_path:
            print(f"扫描模式: 指定路径扫描（无深度限制）")
            print(f"目标路径: {target_path}")
        else:
            if scan_system_root:
                print(f"扫描模式: 全盘扫描（无深度限制）")
            else:
                print(f"扫描模式: 用户主目录扫描（无深度限制）")

        print()

        # 重置计数器
        self.scanned_count = 0
        self.ignored_count = 0
        self.ignored_items = []
        self.ignored_size = 0
        if self.stop_requested:
            raise ScanCancelledError("Scan cancelled before start")

        all_assets = []

        # ========== 指定路径扫描模式 ==========
        if target_path:
            # 验证路径是否存在
            if not target_path.exists():
                print(f"❌ 错误: 指定的路径不存在: {target_path}")
                return []

            print(f"扫描指定路径: {target_path}")
            target_assets = self._scan_path_walk(target_path)
            all_assets.extend(target_assets)
            print(f"  ✓ 指定路径扫描完成: 发现 {len(target_assets)} 个资产")

        # ========== 全盘扫描模式 ==========
        else:
            if scan_system_root:
                # 全盘扫描：扫描整个系统
                print(f"[全盘扫描] 扫描整个系统...")

                # ========== Windows 系统：扫描所有分区 ==========
                if self.os_type == "Windows":
                    try:
                        import psutil
                        partitions = psutil.disk_partitions()

                        print(f"  检测到 {len(partitions)} 个分区")

                        for partition in partitions:
                            self._ensure_not_cancelled()
                            try:
                                root_path = Path(partition.mountpoint)
                                print(f"\n  正在扫描分区: {partition.mountpoint} ({partition.fstype})")

                                partition_assets = self._scan_path_walk(root_path)
                                all_assets.extend(partition_assets)

                                print(f"  ✓ 分区 {partition.mountpoint} 扫描完成: 发现 {len(partition_assets)} 个资产")

                            except ScanCancelledError:
                                raise
                            except PermissionError:
                                print(f"  ⚠️  权限不足，无法访问分区: {partition.mountpoint}")
                            except Exception as e:
                                print(f"  ⚠️  扫描分区 {partition.mountpoint} 时出错: {e}")

                    except ScanCancelledError:
                        raise
                    except Exception as e:
                        print(f"  ⚠️  获取分区列表失败: {e}")

                # ========== macOS/Linux 系统：扫描根目录 ==========
                else:
                    self._ensure_not_cancelled()
                    root_path = Path("/")
                    print(f"  正在扫描根目录: {root_path}")

                    try:
                        root_assets = self._scan_path_walk(root_path)
                        all_assets.extend(root_assets)
                        print(f"  ✓ 根目录扫描完成: 发现 {len(root_assets)} 个资产")

                    except ScanCancelledError:
                        raise
                    except PermissionError:
                        print(f"  ⚠️  权限不足，无法访问系统根目录")
                    except Exception as e:
                        print(f"  ⚠️  扫描系统根目录时出错: {e}")

            else:
                # 仅扫描用户主目录
                print(f"[用户主目录扫描] 扫描用户主目录...")
                self._ensure_not_cancelled()
                home_assets = self._scan_path_walk(self.home_directory)
                all_assets.extend(home_assets)
                print(f"  ✓ 用户主目录扫描完成: 发现 {len(home_assets)} 个资产")

        # 打印扫描统计
        print()
        print("=" * 70)
        print("扫描完成 - 统计信息")
        print("=" * 70)
        print(f"总共扫描: {self.scanned_count} 个项目")
        print(f"总共忽略: {self.ignored_count} 个项目")
        print(f"返回资产: {len(all_assets)} 个")
        print()

        # 按风险等级分组统计
        risk_stats = {level: 0 for level in RiskLevel}
        for asset in all_assets:
            risk_stats[asset.risk_level] += 1

        print("风险等级分布:")
        for level in sorted(RiskLevel, reverse=True):
            count = risk_stats[level]
            percentage = (count / len(all_assets) * 100) if all_assets else 0
            print(f"  {level.name}: {count} ({percentage:.1f}%)")

        print("=" * 70)

        return all_assets

    def get_ignored_items(self, limit: int = 10) -> List[Dict]:
        """
        获取被忽略的项目列表。

        Args:
            limit: 返回的最大数量（默认10）

        Returns:
            List[Dict]: 被忽略项目的信息列表
        """
        return self.ignored_items[:limit]

    def get_scan_summary(self) -> Dict:
        """
        获取扫描摘要信息。

        Returns:
            Dict: 包含扫描统计信息的字典
        """
        return {
            'os_type': self.os_type,
            'home_directory': str(self.home_directory),
            'scanned_count': self.scanned_count,
            'ignored_count': self.ignored_count,
            'total_ignored_items': len(self.ignored_items)
        }

    def generate_security_report(self, assets: List[AssetItem], hardware_asset: Optional[HardwareAsset] = None) -> Dict:
        """
        生成结构化的安全报告（JSON 格式）。

        报告包含：
        - 扫描统计信息
        - 各风险等级的资产数量和百分比
        - 存储空间占用统计
        - Level 0 和 Level 1 的高危路径列表（完整文件列表）
        - Level 2 和 Level 3 的目录摘要（仅统计，不列出具体文件，节省 Token）
        - 被忽略的项目统计
        - 硬件信息（如果提供）

        Args:
            assets: 扫描得到的资产列表
            hardware_asset: 硬件信息对象（可选）

        Returns:
            Dict: 结构化的安全报告
        """
        import datetime

        # 字节格式化辅助函数
        def format_bytes(size: int) -> str:
            """将字节数转换为易读的格式"""
            if size is None:
                return "0 B"

            for unit in ['B', 'KB', 'MB', 'GB', 'TB']:
                if size < 1024.0:
                    return f"{size:.2f} {unit}"
                size /= 1024.0
            return f"{size:.2f} PB"

        # 按风险等级分组
        risk_groups = {level: [] for level in RiskLevel}
        for asset in assets:
            risk_groups[asset.risk_level].append(asset)

        # 统计各风险等级的数量
        risk_statistics = {}
        for level in RiskLevel:
            count = len(risk_groups[level])
            percentage = (count / len(assets) * 100) if assets else 0

            risk_statistics[level.name] = {
                'count': count,
                'percentage': round(percentage, 2),
                'description': {
                    RiskLevel.LEVEL_0: '操作系统核心和应用程序 - 红色',
                    RiskLevel.LEVEL_1: '敏感凭证 - 橙色',
                    RiskLevel.LEVEL_2: '用户数据 - 黄色',
                    RiskLevel.LEVEL_3: '可清理 - 绿色'
                }[level]
            }

        # 提取高危路径（Level 0 和 Level 1）- 保留完整文件列表
        critical_assets = []
        for asset in risk_groups[RiskLevel.LEVEL_0]:
            critical_assets.append({
                'path': str(asset.path),
                'type': asset.file_type,
                'owner': asset.owner,
                'risk_level': 'LEVEL_0',
                'risk_description': '操作系统核心和应用程序',
                'permissions': asset.permissions
            })

        sensitive_assets = []
        for asset in risk_groups[RiskLevel.LEVEL_1]:
            sensitive_assets.append({
                'path': str(asset.path),
                'type': asset.file_type,
                'owner': asset.owner,
                'risk_level': 'LEVEL_1',
                'risk_description': '敏感凭证',
                'permissions': asset.permissions
            })

        # Level 2 - 用户数据，保留完整文件列表
        user_data_assets = []
        for asset in risk_groups[RiskLevel.LEVEL_2]:
            user_data_assets.append({
                'path': str(asset.path),
                'type': asset.file_type,
                'owner': asset.owner,
                'risk_level': 'LEVEL_2',
                'risk_description': '用户数据',
                'permissions': asset.permissions
            })

        # Level 3 - 可清理文件，保留完整文件列表
        safe_temp_assets = []
        for asset in risk_groups[RiskLevel.LEVEL_3]:
            safe_temp_assets.append({
                'path': str(asset.path),
                'type': asset.file_type,
                'owner': asset.owner,
                'risk_level': 'LEVEL_3',
                'risk_description': '可清理',
                'permissions': asset.permissions
            })

        # 生成报告
        report = {
            'report_metadata': {
                'generated_at': datetime.datetime.now().isoformat(),
                'scanner_version': '1.0.0',
                'os_type': self.os_type,
                'home_directory': str(self.home_directory)
            },
            'scan_summary': {
                'total_scanned': self.scanned_count,
                'total_ignored': self.ignored_count,
                'total_assets': len(assets),
                'scan_status': 'completed'
            },
            'risk_statistics': risk_statistics,
            'high_risk_assets': {
                'critical_system_files': {
                    'level': 'LEVEL_0',
                    'description': '操作系统核心和应用程序',
                    'count': len(critical_assets),
                    'assets': critical_assets
                },
                'sensitive_credentials': {
                    'level': 'LEVEL_1',
                    'description': '包含密钥、密码等敏感信息',
                    'count': len(sensitive_assets),
                    'assets': sensitive_assets
                }
            },
            'medium_risk_assets': {
                'user_data': {
                    'level': 'LEVEL_2',
                    'description': '用户文档和个人数据',
                    'count': len(user_data_assets),
                    'assets': user_data_assets
                }
            },
            'low_risk_assets': {
                'safe_temp': {
                    'level': 'LEVEL_3',
                    'description': '可清理的临时文件和缓存',
                    'count': len(safe_temp_assets),
                    'assets': safe_temp_assets
                }
            },
            'ignored_items': {
                'count': self.ignored_count,
                'sample': self.ignored_items[:10]  # 只包含前10个示例
            }
        }

        # 添加硬件信息（如果提供）
        if hardware_asset:
            report['hardware_assets'] = hardware_asset.to_dict()

        return report

    def _sanitize_data(self, obj):
        """
        递归清理数据，确保所有对象都可以被 JSON 序列化。

        处理 ctypes 结构体、bytes 等不可序列化类型。

        Args:
            obj: 要清理的对象

        Returns:
            清理后的对象（可 JSON 序列化）
        """
        # 处理字典
        if isinstance(obj, dict):
            return {key: self._sanitize_data(value) for key, value in obj.items()}

        # 处理列表
        elif isinstance(obj, list):
            return [self._sanitize_data(item) for item in obj]

        # 处理基本类型
        elif isinstance(obj, (int, float, str, bool, type(None))):
            return obj

        # 处理 Path 对象
        elif isinstance(obj, Path):
            return str(obj)

        # 处理其他所有类型（包括 ctypes 结构体、bytes 等）
        else:
            try:
                # 尝试转换为字符串
                return str(obj)
            except Exception:
                # 如果转换失败，返回类型名称
                return f"<{type(obj).__name__}>"

    def export_hardware_json(self, hardware_asset: Optional[HardwareAsset], output_file: str = None) -> str:
        """
        导出硬件信息报告为 JSON 文件（快速模式）。

        Args:
            hardware_asset: 硬件信息对象
            output_file: 输出文件路径（可选，默认自动生成）

        Returns:
            str: 输出文件的路径
        """
        import json
        import datetime

        if hardware_asset is None:
            raise ValueError("硬件信息对象不能为 None")

        # 构建硬件报告字典
        hardware_report = {
            'report_metadata': {
                'generated_at': datetime.datetime.now().isoformat(),
                'scanner_version': '1.0.0',
                'report_type': 'hardware_only',
                'os_type': self.os_type,
                'home_directory': str(self.home_directory)
            },
            'hardware_info': hardware_asset.to_dict()
        }

        # 清理数据，确保可以 JSON 序列化（修复 c_nvmlMemory_t 等问题）
        hardware_report = self._sanitize_data(hardware_report)

        # 如果没有指定输出文件，自动生成文件名
        if output_file is None:
            timestamp = datetime.datetime.now().strftime('%Y%m%d_%H%M%S')
            output_file = f"hardware_report_{timestamp}.json"

        # 写入文件
        with open(output_file, 'w', encoding='utf-8') as f:
            json.dump(hardware_report, f, ensure_ascii=False, indent=2)

        return output_file

    def export_report_json(self, assets: List[AssetItem], output_file: str = None, hardware_asset: Optional[HardwareAsset] = None) -> str:
        """
        导出安全报告为 JSON 文件。

        Args:
            assets: 扫描得到的资产列表
            output_file: 输出文件路径（可选，默认自动生成）
            hardware_asset: 硬件信息对象（可选）

        Returns:
            str: 输出文件的路径
        """
        import json
        import datetime

        # 生成报告
        report = self.generate_security_report(assets, hardware_asset)

        # 清理数据，确保可以 JSON 序列化
        report = self._sanitize_data(report)

        # 如果没有指定输出文件，自动生成文件名
        if output_file is None:
            timestamp = datetime.datetime.now().strftime('%Y%m%d_%H%M%S')
            output_file = f"security_report_{timestamp}.json"

        # 写入文件
        with open(output_file, 'w', encoding='utf-8') as f:
            json.dump(report, f, ensure_ascii=False, indent=2)

        return output_file

    # ========== 已安装软件扫描功能 ==========

    def _extract_guid_from_msi_string(self, uninstall_string: str) -> Optional[str]:
        """
        从MSI格式的UninstallString中提取GUID。

        MSI UninstallString格式通常为：
        - MsiExec.exe /X{GUID}
        - MsiExec.exe /I{GUID}
        - {GUID}

        Args:
            uninstall_string: UninstallString字符串

        Returns:
            Optional[str]: 提取出的GUID，如果不是MSI格式返回 None
        """
        if not uninstall_string:
            return None

        try:
            import re
            # GUID格式: {XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX}
            guid_pattern = r'\{[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}\}'
            match = re.search(guid_pattern, uninstall_string)
            if match:
                return match.group(0)
        except Exception:
            pass

        return None

    def _query_msi_install_location(self, guid: str) -> Optional[Path]:
        """
        通过GUID查询Windows Installer数据库获取InstallLocation。

        查询路径：
        HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Installer\\UserData\\S-1-5-18\\Products\\{GUID}\\InstallProperties

        Args:
            guid: 软件的GUID（格式：{XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX}）

        Returns:
            Optional[Path]: InstallLocation路径，如果查询失败返回 None
        """
        if not guid:
            return None

        try:
            import winreg
            import re

            # 将GUID转换为注册表格式（去除大括号和连字符，重新排列）
            # 例如: {12345678-1234-1234-1234-123456789012} -> 87654321432143214321210987654321
            guid_clean = guid.strip('{}')
            parts = guid_clean.split('-')
            if len(parts) != 5:
                return None

            # Windows Installer使用特殊的GUID格式
            # 需要反转某些部分的字节顺序
            transformed_guid = (
                parts[0][::-1] +  # 反转第一部分
                parts[1][::-1] +  # 反转第二部分
                parts[2][::-1] +  # 反转第三部分
                ''.join([parts[3][i:i+2][::-1] for i in range(0, len(parts[3]), 2)]) +  # 反转第四部分的每对字符
                ''.join([parts[4][i:i+2][::-1] for i in range(0, len(parts[4]), 2)])    # 反转第五部分的每对字符
            ).upper()

            # 尝试查询 Windows Installer 数据库
            registry_paths = [
                # 系统级安装
                (winreg.HKEY_LOCAL_MACHINE, f"SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Installer\\UserData\\S-1-5-18\\Products\\{transformed_guid}\\InstallProperties"),
                # 用户级安装（需要获取当前用户的SID，这里简化处理）
                (winreg.HKEY_CURRENT_USER, f"SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Installer\\UserData\\Products\\{transformed_guid}\\InstallProperties"),
            ]

            for hkey, subkey_path in registry_paths:
                try:
                    with winreg.OpenKey(hkey, subkey_path, 0, winreg.KEY_READ) as key:
                        try:
                            location_str = winreg.QueryValueEx(key, "InstallLocation")[0]
                            if location_str and location_str.strip():
                                return Path(location_str.strip())
                        except FileNotFoundError:
                            pass
                except FileNotFoundError:
                    continue
                except PermissionError:
                    continue

        except Exception:
            pass

        return None

    def _extract_path_from_string(self, path_string: str) -> Optional[Path]:
        """
        从字符串中提取文件路径并返回其父目录。

        用于从 UninstallString 或 DisplayIcon 等字段中提取安装路径。
        例如:
        - "C:\\Program Files\\App\\uninstall.exe" /S -> C:\\Program Files\\App
        - "\"C:\\Program Files\\App\\app.exe\",0" -> C:\\Program Files\\App
        - MsiExec.exe /X{GUID} -> None (MSI格式，需要特殊处理)

        Args:
            path_string: 包含路径的字符串

        Returns:
            Optional[Path]: 提取出的父目录路径，如果提取失败返回 None
        """
        if not path_string:
            return None

        try:
            import shlex
            import re

            # 去除首尾空格
            path_string = path_string.strip()

            # 跳过 MSI 格式（应该由 MSI 专用方法处理）
            if 'msiexec' in path_string.lower() or ('{' in path_string and '}' in path_string):
                return None

            # 方法 1: 使用 shlex 分割（处理引号）
            try:
                parts = shlex.split(path_string)
                if parts:
                    candidate_path = parts[0]
                else:
                    candidate_path = path_string
            except ValueError:
                # shlex 解析失败，使用正则表达式
                # 提取引号内的路径或第一个空格前的路径
                match = re.match(r'^"([^"]+)"', path_string)
                if match:
                    candidate_path = match.group(1)
                else:
                    # 提取第一个空格前的内容
                    candidate_path = path_string.split()[0] if ' ' in path_string else path_string

            # 去除可能的逗号和参数（如 ",0" 或 "/S"）
            candidate_path = candidate_path.split(',')[0].strip()

            # 去除可能的引号残留
            candidate_path = candidate_path.strip('"').strip("'")

            # 转换为 Path 对象
            file_path = Path(candidate_path)

            # 检查路径是否存在
            if file_path.exists():
                # 如果是文件，返回其父目录
                if file_path.is_file():
                    return file_path.parent
                # 如果是目录，直接返回
                elif file_path.is_dir():
                    return file_path

            # 如果路径不存在，但格式合理（包含盘符），仍然返回父目录
            if file_path.is_absolute() and len(str(file_path)) > 3:
                # 尝试返回父目录
                parent = file_path.parent
                if parent and len(str(parent)) > 3:
                    # 检查父目录是否存在
                    if parent.exists():
                        return parent
                    # 即使不存在，如果路径看起来合理，也返回
                    # （某些软件可能已卸载但注册表残留）
                    if ':' in str(parent) and len(str(parent).split('\\')) > 1:
                        return parent

        except Exception:
            # 解析失败，返回 None
            pass

        return None

    def _generate_publisher_variants(self, publisher: str) -> List[str]:
        """
        生成 Publisher 的多个变体名称，用于模糊匹配。

        清洗规则：
        - 去除常见公司后缀 (Inc., Ltd., Corp., etc.)
        - 去除中文公司后缀（有限公司、科技、股份等）
        - 去除括号及内容
        - 提取第一个单词/关键词
        - 提取中文关键词
        - 去除特殊字符

        Args:
            publisher: 原始发行商名称

        Returns:
            List[str]: 变体名称列表（从最完整到最简化）
        """
        if not publisher or publisher == "Unknown":
            return []

        variants = []
        import re

        # 变体 1: 原始名称
        variants.append(publisher)

        # 变体 2: 去除常见英文后缀
        suffixes = [
            r'\s+Inc\.?$', r'\s+Ltd\.?$', r'\s+Corp\.?$', r'\s+Corporation$',
            r'\s+Technology$', r'\s+Technologies$', r'\s+Co\.?$',
            r'\s+Company$', r'\s+LLC$', r'\s+Limited$', r'\s+Software$',
            r'\s+Group$', r'\s+International$', r'\s+GmbH$', r'\s+s\.r\.o\.$'
        ]
        cleaned = publisher
        for suffix in suffixes:
            cleaned = re.sub(suffix, '', cleaned, flags=re.IGNORECASE)
        if cleaned != publisher:
            variants.append(cleaned.strip())

        # 变体 3: 去除中文公司后缀
        chinese_suffixes = [
            r'有限公司$', r'股份有限公司$', r'科技有限公司$', r'信息技术有限公司$',
            r'网络科技有限公司$', r'软件有限公司$', r'科技股份有限公司$',
            r'科技$', r'软件$', r'网络$', r'信息$', r'技术$', r'集团$',
            r'\(深圳\)$', r'\(北京\)$', r'\(上海\)$', r'\(广州\)$'
        ]
        chinese_cleaned = cleaned
        for suffix in chinese_suffixes:
            chinese_cleaned = re.sub(suffix, '', chinese_cleaned)
        if chinese_cleaned != cleaned:
            variants.append(chinese_cleaned.strip())
            cleaned = chinese_cleaned

        # 变体 4: 去除括号及内容
        no_parens = re.sub(r'\s*\([^)]*\)', '', cleaned)
        no_parens = re.sub(r'\s*（[^）]*）', '', no_parens)  # 中文括号
        if no_parens != cleaned:
            variants.append(no_parens.strip())

        # 变体 5: 提取第一个单词（英文）
        first_word = no_parens.split()[0] if no_parens.split() else no_parens
        if first_word and first_word != no_parens:
            variants.append(first_word.strip())

        # 变体 6: 提取中文关键词（常见公司名称模式）
        # 例如："腾讯科技(深圳)有限公司" -> "腾讯", "Tencent"
        chinese_keywords = {
            '腾讯': ['Tencent', 'QQ', 'WeChat', 'WeMeet'],
            '百度': ['Baidu', 'BaiduNetdisk'],
            '度友': ['Baidu'],  # 百度网盘的公司名
            '阿里巴巴': ['Alibaba', 'ALIBABA', 'Alipay'],
            '字节跳动': ['ByteDance', 'Doubao', 'Feishu', 'Lark'],
            '春田智云': ['ByteDance', 'Doubao'],  # 豆包的公司名
            '网易': ['NetEase'],
            '小米': ['Xiaomi', 'Mi'],
            '华为': ['Huawei'],
            '金山': ['Kingsoft', 'WPS'],
            '搜狗': ['Sogou'],
            '360': ['Qihoo'],
            '迅雷': ['Xunlei'],
            '优酷': ['Youku'],
            '爱奇艺': ['iQIYI'],
            '美团': ['Meituan'],
            '滴滴': ['Didi'],
            '京东': ['JD', 'JingDong'],
            '拼多多': ['Pinduoduo'],
            '携程': ['Ctrip'],
            '新浪': ['Sina', 'Weibo'],
            '搜狐': ['Sohu'],
            '贝锐': ['Oray', 'SunloginClient'],
            '动悦': ['Quark'],
            '月之暗面': ['Moonshot', 'Kimi'],
            '智谱': ['Zhipu'],
            '深度求索': ['DeepSeek'],
            '优趣': ['ToDesk', 'YouQu'],  # ToDesk的公司名
            '商汤': ['SenseTime'],
            '科大讯飞': ['iFlytek'],
            '瑞星': ['Rising'],
            '猎豹': ['Cheetah'],
            '完美世界': ['Perfect World'],
            '盛大': ['Shanda'],
            '巨人': ['Giant'],
            '畅游': ['Changyou']
        }

        for chinese_key, english_variants in chinese_keywords.items():
            if chinese_key in publisher:
                variants.append(chinese_key)
                variants.extend(english_variants)

        # 变体 7: 提取纯中文部分（去除英文和数字）
        chinese_only = re.sub(r'[a-zA-Z0-9\s\.\-_]+', '', no_parens)
        if chinese_only and len(chinese_only) >= 2:
            variants.append(chinese_only.strip())
            # 如果中文部分较长，提取前2-3个字
            if len(chinese_only) > 3:
                variants.append(chinese_only[:2])
                variants.append(chinese_only[:3])

        # 去重并保持顺序
        seen = set()
        unique_variants = []
        for v in variants:
            v_stripped = v.strip()
            v_lower = v_stripped.lower()
            if v_stripped and v_lower and v_lower not in seen and len(v_stripped) >= 2:
                seen.add(v_lower)
                unique_variants.append(v_stripped)

        return unique_variants

    def _clean_software_name(self, name: str) -> List[str]:
        """
        清理软件名称并生成多个变体，用于路径推断。

        Args:
            name: 原始软件名称

        Returns:
            List[str]: 清理后的名称变体列表
        """
        import re

        variants = []

        # 变体 1: 原始名称
        variants.append(name)

        # 变体 2: 去除版本号（如 "Chrome 120.0" -> "Chrome"）
        no_version = re.sub(r'\s+\d+[\.\d]*\s*$', '', name)
        no_version = re.sub(r'\s+v?\d+[\.\d]*', '', no_version)
        if no_version != name:
            variants.append(no_version.strip())

        # 变体 3: 去除括号及内容
        no_parens = re.sub(r'\s*\([^)]*\)', '', no_version)
        no_parens = re.sub(r'\s*（[^）]*）', '', no_parens)
        if no_parens != no_version:
            variants.append(no_parens.strip())

        # 变体 4: 去除特殊字符和空格
        no_special = re.sub(r'[^\w\s]', '', no_parens)
        no_special = re.sub(r'\s+', '', no_special)
        if no_special and no_special != no_parens:
            variants.append(no_special)

        # 变体 5: 提取第一个单词
        first_word = no_parens.split()[0] if no_parens.split() else no_parens
        if first_word and first_word != no_parens:
            variants.append(first_word)

        # 变体 6: 提取纯中文部分（用于中文软件名）
        chinese_only = re.sub(r'[a-zA-Z0-9\s\.\-_]+', '', no_parens)
        if chinese_only and len(chinese_only) >= 2:
            variants.append(chinese_only.strip())

        # 变体 7: 提取纯英文部分（用于混合名称）
        english_only = re.sub(r'[^\x00-\x7F]+', '', no_parens).strip()
        if english_only and len(english_only) >= 2:
            variants.append(english_only)

        # 变体 8: 常见软件名称映射（用于特殊情况）
        name_mappings = {
            '腾讯会议': ['WeMeet', 'TencentMeeting'],
            '微信': ['WeChat', 'Weixin'],
            'QQ': ['QQ', 'Tencent'],
            '百度网盘': ['BaiduNetdisk', 'Baidu'],
            '豆包': ['Doubao'],
            '夸克': ['Quark'],
            '向日葵': ['SunloginClient', 'Oray'],
            '钉钉': ['DingTalk'],
            '企业微信': ['WeCom'],
            '飞书': ['Feishu', 'Lark']
        }

        for chinese_name, english_names in name_mappings.items():
            if chinese_name in name:
                variants.extend(english_names)

        # 去重
        seen = set()
        unique_variants = []
        for v in variants:
            v_stripped = v.strip()
            v_lower = v_stripped.lower()
            if v_stripped and v_lower and v_lower not in seen and len(v_stripped) >= 2:
                seen.add(v_lower)
                unique_variants.append(v_stripped)

        return unique_variants

    def _infer_related_paths(self, name: str, publisher: str = None, bundle_id: str = None) -> List[Path]:
        """
        推断软件的关联数据/配置路径。

        根据操作系统和已知信息，检查可能的数据目录是否存在。
        如果存在，加入返回列表。

        Args:
            name: 软件名称
            publisher: 发行商名称（可选）
            bundle_id: Bundle ID（macOS 专用，可选）

        Returns:
            List[Path]: 存在的关联路径列表
        """
        related_paths = []

        try:
            # ========== Windows 路径推断 ==========
            if self.os_type == "Windows":
                import os

                # 获取环境变量
                appdata_roaming = os.getenv('APPDATA')  # %APPDATA% (Roaming)
                appdata_local = os.getenv('LOCALAPPDATA')  # %LOCALAPPDATA% (Local)
                programdata = os.getenv('PROGRAMDATA')  # %PROGRAMDATA%

                # 候选路径列表
                candidate_paths = []

                # 生成软件名称的多个变体
                name_variants = self._clean_software_name(name)

                # 基于软件名称的路径（使用多个变体）
                for name_variant in name_variants:
                    if appdata_roaming:
                        candidate_paths.append(Path(appdata_roaming) / name_variant)
                    if appdata_local:
                        candidate_paths.append(Path(appdata_local) / name_variant)
                    if programdata:
                        candidate_paths.append(Path(programdata) / name_variant)

                # 基于 Publisher 的路径（使用模糊匹配）
                if publisher and publisher != "Unknown":
                    # 生成 Publisher 的多个变体
                    publisher_variants = self._generate_publisher_variants(publisher)

                    for variant in publisher_variants:
                        if appdata_roaming:
                            # 仅 Publisher
                            candidate_paths.append(Path(appdata_roaming) / variant)
                            # Publisher\Name 组合（使用清理后的名称）
                            for name_variant in name_variants[:2]:  # 只用前2个名称变体
                                candidate_paths.append(Path(appdata_roaming) / variant / name_variant)

                        if appdata_local:
                            # 仅 Publisher
                            candidate_paths.append(Path(appdata_local) / variant)
                            # Publisher\Name 组合
                            for name_variant in name_variants[:2]:
                                candidate_paths.append(Path(appdata_local) / variant / name_variant)

                        if programdata:
                            # 仅 Publisher
                            candidate_paths.append(Path(programdata) / variant)
                            # Publisher\Name 组合
                            for name_variant in name_variants[:2]:
                                candidate_paths.append(Path(programdata) / variant / name_variant)

                # 检查路径是否存在
                for path in candidate_paths:
                    if path.exists():
                        related_paths.append(path)

            # ========== macOS 路径推断 ==========
            elif self.os_type == "macOS":
                home = Path.home()

                # 候选路径列表
                candidate_paths = []

                # 基于软件名称的路径
                candidate_paths.append(home / "Library" / "Application Support" / name)
                candidate_paths.append(home / "Library" / "Caches" / name)
                candidate_paths.append(home / "Library" / "Preferences" / f"{name}.plist")

                # 基于 Bundle ID 的路径（最重要）
                if bundle_id:
                    candidate_paths.append(home / "Library" / "Application Support" / bundle_id)
                    candidate_paths.append(home / "Library" / "Containers" / bundle_id)
                    candidate_paths.append(home / "Library" / "Caches" / bundle_id)
                    candidate_paths.append(home / "Library" / "Preferences" / f"{bundle_id}.plist")
                    # Group Containers (用于应用组共享数据)
                    group_containers = home / "Library" / "Group Containers"
                    if group_containers.exists():
                        for group_path in group_containers.glob(f"*{bundle_id}*"):
                            candidate_paths.append(group_path)

                # 检查路径是否存在
                for path in candidate_paths:
                    if path.exists():
                        related_paths.append(path)

            # ========== Linux 路径推断 ==========
            elif self.os_type == "Linux":
                home = Path.home()

                # 候选路径列表
                candidate_paths = [
                    home / ".config" / name,
                    home / ".config" / name.lower(),
                    home / ".local" / "share" / name,
                    home / ".local" / "share" / name.lower(),
                    home / ".cache" / name,
                    home / ".cache" / name.lower(),
                ]

                # 检查路径是否存在
                for path in candidate_paths:
                    if path.exists():
                        related_paths.append(path)

        except Exception as e:
            # 推断失败，返回空列表
            pass

        return related_paths

    def _scan_software_windows(self) -> List[SoftwareAsset]:
        """
        扫描 Windows 系统已安装软件（通过注册表）。

        遍历 HKLM 和 HKCU 下的 Uninstall 注册表项，
        支持 32位 和 64位 视图，确保能扫描到所有盘符的软件。

        Returns:
            List[SoftwareAsset]: 已安装软件列表
        """
        try:
            import winreg
        except ImportError:
            print("⚠️  警告: winreg 模块不可用（非 Windows 系统）")
            return []

        software_list = []
        seen_names = set()  # 用于去重

        # 定义要扫描的注册表路径
        registry_paths = [
            # HKEY_LOCAL_MACHINE (系统级软件)
            (winreg.HKEY_LOCAL_MACHINE, r"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall", winreg.KEY_READ | winreg.KEY_WOW64_64KEY),
            (winreg.HKEY_LOCAL_MACHINE, r"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall", winreg.KEY_READ | winreg.KEY_WOW64_32KEY),
            # HKEY_CURRENT_USER (用户级软件)
            (winreg.HKEY_CURRENT_USER, r"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall", winreg.KEY_READ),
        ]

        for hkey, subkey_path, access_flag in registry_paths:
            try:
                # 打开注册表项
                with winreg.OpenKey(hkey, subkey_path, 0, access_flag) as key:
                    # 遍历所有子项
                    index = 0
                    while True:
                        try:
                            subkey_name = winreg.EnumKey(key, index)
                            index += 1

                            # 打开子项
                            with winreg.OpenKey(key, subkey_name) as subkey:
                                try:
                                    # 读取软件信息
                                    display_name = winreg.QueryValueEx(subkey, "DisplayName")[0]

                                    # 跳过空名称或已扫描的软件
                                    if not display_name or display_name in seen_names:
                                        continue

                                    seen_names.add(display_name)

                                    # 读取版本号
                                    try:
                                        version = winreg.QueryValueEx(subkey, "DisplayVersion")[0]
                                    except FileNotFoundError:
                                        version = "Unknown"

                                    # 读取发行商
                                    try:
                                        publisher = winreg.QueryValueEx(subkey, "Publisher")[0]
                                    except FileNotFoundError:
                                        publisher = "Unknown"

                                    # 读取安装位置（核心字段）- 增强版
                                    install_location = None
                                    uninstall_str = None  # 保存UninstallString供后续使用

                                    # 尝试 1: 从 InstallLocation 读取
                                    try:
                                        location_str = winreg.QueryValueEx(subkey, "InstallLocation")[0]
                                        if location_str and location_str.strip():
                                            # 清理引号
                                            location_str = location_str.strip().strip('"').strip("'")
                                            install_location = Path(location_str)
                                    except FileNotFoundError:
                                        pass

                                    # 尝试 2: 如果 InstallLocation 为空，从 UninstallString 推断
                                    if not install_location:
                                        try:
                                            uninstall_str = winreg.QueryValueEx(subkey, "UninstallString")[0]
                                            if uninstall_str:
                                                # 检查是否为MSI格式
                                                if 'msiexec' in uninstall_str.lower() or '{' in uninstall_str:
                                                    # MSI格式，尝试提取GUID并查询Windows Installer数据库
                                                    guid = self._extract_guid_from_msi_string(uninstall_str)
                                                    if guid:
                                                        install_location = self._query_msi_install_location(guid)

                                                # 如果不是MSI或MSI查询失败，尝试直接提取路径
                                                if not install_location:
                                                    install_location = self._extract_path_from_string(uninstall_str)
                                        except FileNotFoundError:
                                            pass

                                    # 尝试 3: 如果仍为空，从 DisplayIcon 推断
                                    if not install_location:
                                        try:
                                            icon_str = winreg.QueryValueEx(subkey, "DisplayIcon")[0]
                                            if icon_str:
                                                install_location = self._extract_path_from_string(icon_str)
                                        except FileNotFoundError:
                                            pass

                                    # 尝试 4: 尝试读取 InstallSource 字段
                                    if not install_location:
                                        try:
                                            source_str = winreg.QueryValueEx(subkey, "InstallSource")[0]
                                            if source_str and source_str.strip():
                                                source_str = source_str.strip().strip('"').strip("'")
                                                source_path = Path(source_str)
                                                if source_path.exists():
                                                    install_location = source_path
                                        except FileNotFoundError:
                                            pass

                                    # 尝试 5: 尝试读取其他可能的路径字段
                                    if not install_location:
                                        for field_name in ["InstallDir", "Path", "AppLocation"]:
                                            try:
                                                field_str = winreg.QueryValueEx(subkey, field_name)[0]
                                                if field_str and field_str.strip():
                                                    field_str = field_str.strip().strip('"').strip("'")
                                                    field_path = Path(field_str)
                                                    if field_path.exists():
                                                        install_location = field_path
                                                        break
                                            except FileNotFoundError:
                                                continue

                                    # 推断关联路径
                                    related_paths = self._infer_related_paths(
                                        name=display_name,
                                        publisher=publisher if publisher != "Unknown" else None,
                                        bundle_id=None
                                    )

                                    # 创建 SoftwareAsset 对象
                                    software = SoftwareAsset(
                                        name=display_name,
                                        version=version,
                                        install_location=install_location,
                                        publisher=publisher,
                                        source="Registry",
                                        bundle_id=None,
                                        related_paths=related_paths
                                    )
                                    software_list.append(software)

                                except FileNotFoundError:
                                    # DisplayName 不存在，跳过
                                    continue
                                except Exception as e:
                                    # 其他错误，静默跳过
                                    continue

                        except OSError:
                            # 没有更多子项
                            break

            except FileNotFoundError:
                # 注册表路径不存在
                continue
            except PermissionError:
                # 权限不足
                print(f"  ⚠️  权限不足，无法访问注册表: {subkey_path}")
                continue
            except Exception as e:
                print(f"  ⚠️  扫描注册表时出错: {e}")
                continue

        return software_list

    def _scan_software_macos(self) -> List[SoftwareAsset]:
        """
        扫描 macOS 系统已安装软件（通过 /Applications 和 Info.plist）。

        遍历 /Applications 和用户主目录下的 Applications，
        解析 .app/Contents/Info.plist 获取软件信息。

        Returns:
            List[SoftwareAsset]: 已安装软件列表
        """
        try:
            import plistlib
        except ImportError:
            print("⚠️  警告: plistlib 模块不可用")
            return []

        software_list = []
        seen_names = set()  # 用于去重

        # 定义要扫描的应用程序目录
        app_directories = [
            Path("/Applications"),
            Path.home() / "Applications"
        ]

        for app_dir in app_directories:
            if not app_dir.exists():
                continue

            try:
                # 遍历所有 .app 包
                for app_path in app_dir.glob("*.app"):
                    try:
                        # 读取 Info.plist
                        plist_path = app_path / "Contents" / "Info.plist"
                        if not plist_path.exists():
                            continue

                        with open(plist_path, 'rb') as f:
                            plist_data = plistlib.load(f)

                        # 提取软件信息
                        name = plist_data.get("CFBundleName") or plist_data.get("CFBundleDisplayName") or app_path.stem

                        # 跳过已扫描的软件
                        if name in seen_names:
                            continue

                        seen_names.add(name)

                        version = plist_data.get("CFBundleShortVersionString") or plist_data.get("CFBundleVersion") or "Unknown"
                        publisher = plist_data.get("NSHumanReadableCopyright") or "Unknown"

                        # 提取 Bundle ID（关键字段）
                        bundle_id = plist_data.get("CFBundleIdentifier")

                        # 清理发行商信息（去除版权符号等）
                        if publisher != "Unknown":
                            publisher = publisher.replace("©", "").replace("Copyright", "").strip()
                            # 只保留前50个字符
                            if len(publisher) > 50:
                                publisher = publisher[:50] + "..."

                        # 推断关联路径
                        related_paths = self._infer_related_paths(
                            name=name,
                            publisher=publisher if publisher != "Unknown" else None,
                            bundle_id=bundle_id
                        )

                        # 创建 SoftwareAsset 对象
                        software = SoftwareAsset(
                            name=name,
                            version=version,
                            install_location=app_path,
                            publisher=publisher,
                            source="App Bundle",
                            bundle_id=bundle_id,
                            related_paths=related_paths
                        )
                        software_list.append(software)

                    except Exception as e:
                        # 解析单个应用失败，继续下一个
                        continue

            except Exception as e:
                print(f"  ⚠️  扫描 {app_dir} 时出错: {e}")
                continue

        return software_list

    def _scan_software_linux(self) -> List[SoftwareAsset]:
        """
        扫描 Linux 系统已安装软件（通过 .desktop 文件）。

        遍历 /usr/share/applications 和 ~/.local/share/applications，
        解析 .desktop 文件中的 Name 和 Version。

        Returns:
            List[SoftwareAsset]: 已安装软件列表
        """
        try:
            import configparser
        except ImportError:
            print("⚠️  警告: configparser 模块不可用")
            return []

        software_list = []
        seen_names = set()  # 用于去重

        # 定义要扫描的 .desktop 文件目录
        desktop_directories = [
            Path("/usr/share/applications"),
            Path.home() / ".local" / "share" / "applications"
        ]

        for desktop_dir in desktop_directories:
            if not desktop_dir.exists():
                continue

            try:
                # 遍历所有 .desktop 文件
                for desktop_file in desktop_dir.glob("*.desktop"):
                    try:
                        # 使用 configparser 解析 .desktop 文件
                        config = configparser.ConfigParser(interpolation=None)
                        config.read(desktop_file, encoding='utf-8')

                        # 读取 [Desktop Entry] 部分
                        if not config.has_section("Desktop Entry"):
                            continue

                        name = config.get("Desktop Entry", "Name", fallback=None)
                        if not name or name in seen_names:
                            continue

                        seen_names.add(name)

                        # 读取版本号（.desktop 文件通常不包含版本号）
                        version = config.get("Desktop Entry", "Version", fallback="Unknown")

                        # 读取发行商（通常不存在，使用 Comment 或 GenericName）
                        publisher = config.get("Desktop Entry", "Comment", fallback="Unknown")
                        if publisher == "Unknown":
                            publisher = config.get("Desktop Entry", "GenericName", fallback="Unknown")

                        # 读取可执行文件路径（作为安装位置的参考）
                        exec_path = config.get("Desktop Entry", "Exec", fallback=None)
                        install_location = None
                        if exec_path:
                            # 提取可执行文件路径（去除参数）
                            exec_parts = exec_path.split()
                            if exec_parts:
                                try:
                                    install_location = Path(exec_parts[0])
                                except Exception:
                                    pass

                        # 推断关联路径
                        related_paths = self._infer_related_paths(
                            name=name,
                            publisher=publisher if publisher != "Unknown" else None,
                            bundle_id=None
                        )

                        # 创建 SoftwareAsset 对象
                        software = SoftwareAsset(
                            name=name,
                            version=version,
                            install_location=install_location,
                            publisher=publisher,
                            source="Desktop File",
                            bundle_id=None,
                            related_paths=related_paths
                        )
                        software_list.append(software)

                    except Exception as e:
                        # 解析单个 .desktop 文件失败，继续下一个
                        continue

            except Exception as e:
                print(f"  ⚠️  扫描 {desktop_dir} 时出错: {e}")
                continue

        return software_list

    def scan_installed_software(self) -> List[SoftwareAsset]:
        """
        扫描系统已安装软件（跨平台）。

        根据当前操作系统自动选择合适的扫描方法：
        - Windows: 扫描注册表
        - macOS: 扫描 /Applications 和 Info.plist
        - Linux: 扫描 .desktop 文件

        Returns:
            List[SoftwareAsset]: 已安装软件列表
        """
        print("\n" + "=" * 70)
        print("开始已安装软件扫描")
        print("=" * 70)
        print(f"操作系统: {self.os_type}")
        print()

        software_list = []

        try:
            if self.os_type == "Windows":
                print("扫描 Windows 注册表...")
                software_list = self._scan_software_windows()
            elif self.os_type == "macOS":
                print("扫描 macOS 应用程序...")
                software_list = self._scan_software_macos()
            elif self.os_type == "Linux":
                print("扫描 Linux .desktop 文件...")
                software_list = self._scan_software_linux()
            else:
                print(f"⚠️  不支持的操作系统: {self.os_type}")
                return []

            print(f"\n✓ 软件扫描完成: 发现 {len(software_list)} 个已安装软件")
            print("=" * 70)

        except Exception as e:
            print(f"\n❌ 软件扫描失败: {e}")
            import traceback
            traceback.print_exc()

        return software_list

    def export_software_json(self, software_list: List[SoftwareAsset], output_file: str = None) -> str:
        """
        导出已安装软件列表为 JSON 文件。

        Args:
            software_list: 软件列表
            output_file: 输出文件路径（可选，默认自动生成）

        Returns:
            str: 输出文件的路径
        """
        import json
        import datetime

        if not software_list:
            print("⚠️  警告: 软件列表为空，无法导出")
            return None

        # 构建软件报告字典
        software_report = {
            'scan_time': datetime.datetime.now().isoformat(),
            'os': self.os_type,
            'count': len(software_list),
            'software_list': [software.to_dict() for software in software_list]
        }

        # 如果没有指定输出文件，自动生成文件名
        if output_file is None:
            timestamp = datetime.datetime.now().strftime('%Y%m%d_%H%M%S')
            output_file = f"software_report_{timestamp}.json"

        # 写入文件
        with open(output_file, 'w', encoding='utf-8') as f:
            json.dump(software_report, f, ensure_ascii=False, indent=2)

        return output_file

