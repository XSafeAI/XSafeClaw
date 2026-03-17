"""
Data models for the Asset Scanner system.
"""
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional, List, Dict
from enum import IntEnum


class RiskLevel(IntEnum):
    """
    风险等级分类（数字越小风险越高）。

    Risk level classification for assets (lower number = higher risk).
    """
    LEVEL_0 = 0  # 系统关键 - 红色 (Critical system files - Red)
    LEVEL_1 = 1  # 敏感凭证 - 橙色 (Sensitive credentials - Orange)
    LEVEL_2 = 2  # 用户数据 - 黄色 (User data - Yellow)
    LEVEL_3 = 3  # 安全/临时 - 绿色 (Safe/Temporary - Green)


@dataclass
class AssetItem:
    """
    Represents a scanned asset with its metadata and risk assessment.

    Attributes:
        path: Path to the asset (file or directory)
        file_type: Type of the file (e.g., 'directory', 'file', 'symlink')
        owner: Owner of the asset (username or UID)
        risk_level: Estimated risk level (0-3)
        size: Optional file size in bytes (for files and leaf directories)
        permissions: Optional file permissions string
        real_path: Optional real path if this is a symlink (symlink defense)
        resolved_risk: Optional risk level based on real path (symlink defense)
        metadata: Optional metadata dict for platform-specific attributes
        direct_size: Optional direct file size in bytes (files only in this directory, not subdirectories)
    """
    path: Path
    file_type: str
    owner: str
    risk_level: RiskLevel
    size: Optional[int] = None
    permissions: Optional[str] = None
    real_path: Optional[Path] = None
    resolved_risk: Optional[RiskLevel] = None
    metadata: Optional[dict] = None
    direct_size: Optional[int] = None

    def __str__(self) -> str:
        return (f"AssetItem(path={self.path}, type={self.file_type}, "
                f"owner={self.owner}, risk={self.risk_level.name})")

    def to_dict(self) -> dict:
        """Convert AssetItem to dictionary representation."""
        result = {
            'path': str(self.path),
            'file_type': self.file_type,
            'owner': self.owner,
            'risk_level': int(self.risk_level),
            'size': self.size,
            'permissions': self.permissions,
            'direct_size': self.direct_size
        }

        # Add symlink defense fields if present
        if self.real_path is not None:
            result['real_path'] = str(self.real_path)
        if self.resolved_risk is not None:
            result['resolved_risk'] = int(self.resolved_risk)

        # Add metadata if present
        if self.metadata:
            result['metadata'] = self.metadata

        return result


@dataclass
class HardwareAsset:
    """
    Represents hardware information collected from the system.

    Attributes:
        cpu_info: CPU information (model, cores, frequency, usage)
        memory_info: Memory information (total, used, free, usage percentage)
        disk_info: Disk information for all partitions
        system_info: System/motherboard information (OS, architecture, hostname, boot time)
        network_info: Network interface information
        gpu_info: GPU information (if available)
    """
    cpu_info: Dict
    memory_info: Dict
    disk_info: List[Dict]
    system_info: Dict
    network_info: List[Dict]
    gpu_info: Optional[Dict] = None

    def to_dict(self) -> dict:
        """Convert HardwareAsset to dictionary representation."""
        return {
            'cpu_info': self.cpu_info,
            'memory_info': self.memory_info,
            'disk_info': self.disk_info,
            'system_info': self.system_info,
            'network_info': self.network_info,
            'gpu_info': self.gpu_info
        }


@dataclass
class SoftwareAsset:
    """
    Represents an installed software application on the system.

    Attributes:
        name: Software name (e.g., "Google Chrome")
        version: Version number (e.g., "120.0.6099", or "Unknown" if unavailable)
        install_location: Installation path (core field, can retrieve D: drive paths on Windows)
        publisher: Publisher/vendor name
        source: Source of information (e.g., "Registry", "App Bundle", "Desktop File")
        bundle_id: Unique identifier for the software (mainly for macOS Bundle ID, e.g., com.tencent.xinWeChat)
        related_paths: List of associated data/config paths (inferred AppData, Library, etc.)
    """
    name: str
    version: str
    install_location: Optional[Path]
    publisher: str
    source: str
    bundle_id: Optional[str] = None
    related_paths: List[Path] = field(default_factory=list)

    def to_dict(self) -> dict:
        """Convert SoftwareAsset to dictionary representation."""
        return {
            'name': self.name,
            'version': self.version,
            'install_location': str(self.install_location) if self.install_location else None,
            'publisher': self.publisher,
            'source': self.source,
            'bundle_id': self.bundle_id,
            'related_paths': [str(path) for path in self.related_paths] if self.related_paths else []
        }
