"""
资产保护执法模块

本模块基于软件资产保护规则和系统风险评估，提供运行时文件操作验证功能。

"""

import json
import os
from pathlib import Path
from typing import Dict, Set, List
from .scanner import AssetScanner
from .models import RiskLevel


class SafetyGuard:
    """
    运行时文件操作安全验证器。

    实现4级优先级保护逻辑：
    1. 软件资产保护（install_location、related_paths）→ DENIED（拒绝）
    2. 系统/凭证保护（LEVEL_0/LEVEL_1）→ DENIED（拒绝）
    3. 用户数据保护（LEVEL_2 且为删除/修改操作）→ CONFIRM（需确认）
    4. 安全区域（LEVEL_3）→ ALLOWED（允许）

    使用示例：
        guard = SafetyGuard("software.json")
        result = guard.check_safety("/path/to/file", "delete")
        if result['status'] == 'DENIED':
            print(f"操作被拒绝：{result['reason']}")
    """

    def __init__(self, software_report_path: str = "software.json"):
        """
        使用软件保护规则初始化 SafetyGuard。

        参数：
            software_report_path: software.json 文件路径，包含已安装软件信息
        """
        self.software_report_path = software_report_path
        self.protected_paths: Set[Path] = set()
        self.scanner = AssetScanner()

        # 加载软件保护规则
        self._load_software_rules()

    def _load_software_rules(self):
        """
        从 software.json 加载软件保护规则。

        从每个软件条目中提取 install_location 和 related_paths，
        并将它们添加到 protected_paths 集合中。
        """
        if not os.path.exists(self.software_report_path):
            print(f"警告：未找到软件报告文件：{self.software_report_path}")
            return

        try:
            with open(self.software_report_path, 'r', encoding='utf-8') as f:
                data = json.load(f)

            software_list = data.get('software_list', [])

            for software in software_list:
                # 添加 install_location（如果存在）
                install_loc = software.get('install_location')
                if install_loc and install_loc != "null":
                    try:
                        path = Path(install_loc).resolve()
                        if path.exists():
                            self.protected_paths.add(path)
                    except (ValueError, OSError):
                        pass  # 跳过无效路径

                # 添加 related_paths（如果存在）
                related = software.get('related_paths', [])
                if isinstance(related, list):
                    for rel_path in related:
                        if rel_path and rel_path != "null":
                            try:
                                path = Path(rel_path).resolve()
                                if path.exists():
                                    self.protected_paths.add(path)
                            except (ValueError, OSError):
                                pass  # 跳过无效路径

            print(f"已加载 {len(self.protected_paths)} 个受保护的软件路径")

        except json.JSONDecodeError as e:
            print(f"解析软件报告时出错：{e}")
        except Exception as e:
            print(f"加载软件规则时出错：{e}")

    def check_safety(self, target_path: str, operation: str) -> Dict:
        """
        检查文件操作是否安全。

        实现4步优先级逻辑：
        1. 软件资产保护 → DENIED（拒绝）
        2. 系统/凭证保护（LEVEL_0/LEVEL_1）→ DENIED（拒绝）
        3. 用户数据保护（LEVEL_2 且为删除/修改操作）→ CONFIRM（需确认）
        4. 安全区域（LEVEL_3）→ ALLOWED（允许）

        参数：
            target_path: 要操作的文件/目录路径
            operation: 操作类型（'read'、'write'、'delete'、'modify'、'create'）

        返回：
            包含以下键的字典：
                - status: 'ALLOWED'（允许）、'DENIED'（拒绝）或 'CONFIRM'（需确认）
                - risk_level: 整数风险等级（0-3）
                - reason: 人类可读的解释说明
        """
        try:
            # 处理 create 操作的不存在路径
            path = Path(target_path)
            if operation == 'create' and not path.exists():
                # 对于 create 操作，检查父目录
                path = path.parent.resolve()
            else:
                path = path.resolve()

        except (ValueError, OSError) as e:
            return {
                'status': 'DENIED',
                'risk_level': -1,
                'reason': f'无效路径：{e}'
            }

        # 步骤1：检查软件资产保护
        for protected_path in self.protected_paths:
            if self._is_subpath(protected_path, path):
                return {
                    'status': 'DENIED',
                    'risk_level': 0,
                    'reason': f'路径位于受保护的软件目录内：{protected_path}'
                }

        # 步骤2：使用 AssetScanner 评估风险等级
        risk_level = self.scanner.assess_risk_level(path)

        # LEVEL_0（关键系统）或 LEVEL_1（敏感凭证）→ DENIED（拒绝）
        if risk_level in (RiskLevel.LEVEL_0, RiskLevel.LEVEL_1):
            risk_names = {
                RiskLevel.LEVEL_0: '关键系统文件',
                RiskLevel.LEVEL_1: '敏感凭证'
            }
            return {
                'status': 'DENIED',
                'risk_level': int(risk_level),
                'reason': f'路径包含{risk_names[risk_level]}（LEVEL_{int(risk_level)}）'
            }

        # 步骤3：LEVEL_2（用户数据）且为破坏性操作 → CONFIRM（需确认）
        if risk_level == RiskLevel.LEVEL_2:
            if operation in ('delete', 'modify'):
                return {
                    'status': 'CONFIRM',
                    'risk_level': int(risk_level),
                    'reason': f'用户数据需要确认 {operation} 操作（LEVEL_2）'
                }
            else:
                # 对用户数据的读取/写入/创建操作是允许的
                return {
                    'status': 'ALLOWED',
                    'risk_level': int(risk_level),
                    'reason': f'对用户数据的非破坏性 {operation} 操作（LEVEL_2）'
                }

        # 步骤4：LEVEL_3（安全/临时）→ ALLOWED（允许）
        if risk_level == RiskLevel.LEVEL_3:
            return {
                'status': 'ALLOWED',
                'risk_level': int(risk_level),
                'reason': '路径位于安全区域（LEVEL_3）'
            }

        # 兜底处理（不应到达这里）
        return {
            'status': 'CONFIRM',
            'risk_level': int(risk_level),
            'reason': f'未知风险等级：{risk_level}'
        }

    def _is_subpath(self, parent: Path, child: Path) -> bool:
        """
        检查子路径是否在父路径内。

        针对不同操作系统正确处理大小写敏感性：
        - Windows/macOS：大小写不敏感比较
        - Linux：大小写敏感比较

        参数：
            parent: 父目录路径
            child: 要检查的子路径

        返回：
            如果 child 在 parent 内则返回 True，否则返回 False
        """
        try:
            # 将两个路径解析为绝对路径
            parent = parent.resolve()
            child = child.resolve()

            # 检查 child 是否与 parent 相同或是其子目录
            # 使用 relative_to()，如果不是子路径会抛出 ValueError
            try:
                child.relative_to(parent)
                return True
            except ValueError:
                return False

        except (ValueError, OSError):
            return False

