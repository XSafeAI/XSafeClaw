from xsafeclaw.desktop_sidebar import (
    MOCK_RISK_APPROVAL_CARDS,
    apply_risk_approval_action,
    get_collapsed_logo_crop_box,
    get_collapsed_logo_subsample_factor,
    get_collapsed_panel_for_design_y,
    get_pending_risk_count_from_cards,
    get_risk_footer_layout,
    get_risk_sort_selector_layout,
    get_xsafeclaw_logo_path,
    is_scalable_canvas_width_item,
    normalize_api_base,
    parse_sse_data_line,
    parse_approval_hitbox_key,
    setup_states_from_install_status,
    sort_risk_approval_cards,
)
from xsafeclaw.api.routes.sidebar import _start_sidebar_process
from xsafeclaw.api.routes.system import _hermes_windows_install_args


def test_mock_risk_cards_default_count_is_three() -> None:
    assert len(MOCK_RISK_APPROVAL_CARDS) == 3


def test_sort_risk_cards_orders_by_risk_level_desc() -> None:
    shuffled = [
        MOCK_RISK_APPROVAL_CARDS[2],
        MOCK_RISK_APPROVAL_CARDS[0],
        MOCK_RISK_APPROVAL_CARDS[1],
    ]
    sorted_cards = sort_risk_approval_cards(shuffled)
    assert [card.risk_level for card in sorted_cards] == ["high", "medium", "low"]


def test_sort_risk_cards_orders_by_time_ascending() -> None:
    shuffled = [
        MOCK_RISK_APPROVAL_CARDS[2],
        MOCK_RISK_APPROVAL_CARDS[0],
        MOCK_RISK_APPROVAL_CARDS[1],
    ]
    sorted_cards = sort_risk_approval_cards(shuffled, mode="time")
    assert [card.occurred_text for card in sorted_cards] == ["2 分钟前", "5 分钟前", "12 分钟前"]


def test_risk_sort_selector_layout_centers_label_and_keeps_arrow_inside() -> None:
    layout = get_risk_sort_selector_layout(panel_x=0, is_open=False)
    assert layout["label_anchor"] == "center"
    assert layout["label_center_x"] == (layout["label_left"] + layout["label_right"]) // 2
    assert layout["arrow_left"] >= layout["right"] - 28
    assert layout["arrow_right"] <= layout["right"] - 10


def test_risk_footer_layout_uses_alert_icon_and_shifts_history_left() -> None:
    layout = get_risk_footer_layout(panel_x=0)
    assert layout["icon_style"] == "alert_circle"
    assert layout["history_text_x"] == 566
    assert layout["history_arrow_x"] == 694
    assert layout["history_hitbox_left"] == 566
    assert layout["history_hitbox_right"] == 704


def test_collapsed_top_logo_region_is_static_and_not_a_panel_button() -> None:
    assert get_collapsed_panel_for_design_y(70) is None
    assert get_collapsed_panel_for_design_y(139) is None
    assert get_collapsed_panel_for_design_y(140) == "agents"


def test_xsafeclaw_logo_path_uses_project_logo_asset() -> None:
    logo_path = get_xsafeclaw_logo_path()
    assert logo_path is not None
    assert logo_path.name == "logo.png"
    assert logo_path.parent.name == "public"
    assert logo_path.parent.parent.name == "frontend"


def test_collapsed_logo_crop_uses_left_square_icon_region() -> None:
    assert get_collapsed_logo_crop_box(1920, 600) == (100, 0, 700, 600)
    assert get_collapsed_logo_crop_box(821, 1032) == (0, 0, 821, 1032)
    assert get_collapsed_logo_subsample_factor(1032, target_size=52) == 20


def test_canvas_image_items_do_not_participate_in_width_scaling() -> None:
    assert is_scalable_canvas_width_item("rectangle")
    assert is_scalable_canvas_width_item("line")
    assert not is_scalable_canvas_width_item("image")
    assert not is_scalable_canvas_width_item("text")


def test_pending_count_from_cards_matches_length() -> None:
    assert get_pending_risk_count_from_cards(MOCK_RISK_APPROVAL_CARDS) == 3
    next_cards = apply_risk_approval_action(
        list(MOCK_RISK_APPROVAL_CARDS),
        card_id=MOCK_RISK_APPROVAL_CARDS[0].id,
        action="allow_once",
    )
    assert get_pending_risk_count_from_cards(next_cards) == 2


def test_parse_approval_hitbox_key_returns_card_and_action() -> None:
    parsed = parse_approval_hitbox_key("approval:risk_hermes_upload_env:allow_once")
    assert parsed == ("risk_hermes_upload_env", "allow_once")
    assert parse_approval_hitbox_key("approval:risk_hermes_upload_env:unknown") is None
    assert parse_approval_hitbox_key("risk_hermes_upload_env:allow_once") is None


def test_apply_risk_approval_action_with_unknown_id_keeps_cards() -> None:
    cards = list(MOCK_RISK_APPROVAL_CARDS)
    next_cards = apply_risk_approval_action(
        cards,
        card_id="missing-card-id",
        action="block",
    )
    assert len(next_cards) == len(MOCK_RISK_APPROVAL_CARDS)


def test_setup_api_base_normalization_defaults_and_strips_slash() -> None:
    assert normalize_api_base(None) == "http://127.0.0.1:6874/api"
    assert normalize_api_base(" http://localhost:6874/api/ ") == "http://localhost:6874/api"


def test_setup_sse_parser_accepts_json_data_line() -> None:
    assert parse_sse_data_line('data: {"type": "output", "text": "ok"}') == {
        "type": "output",
        "text": "ok",
    }
    assert parse_sse_data_line("event: ping") is None
    assert parse_sse_data_line("data: not-json") is None


def test_setup_states_from_install_status_maps_all_platforms() -> None:
    states = setup_states_from_install_status(
        {
            "openclaw_installed": True,
            "openclaw_version": "1.2.3",
            "hermes_installed": False,
            "nanobot_installed": True,
            "nanobot_version": "0.4.0",
            "requires_nanobot_configure": True,
        }
    )
    assert states["openclaw"].state == "installed"
    assert states["openclaw"].version == "1.2.3"
    assert states["hermes"].state == "missing"
    assert states["nanobot"].detail == "已安装，待配置模型"


def test_sidebar_process_gets_api_base_argument(monkeypatch) -> None:
    recorded: dict[str, object] = {}

    class FakeProcess:
        def poll(self):
            return None

    def fake_popen(args, **kwargs):
        recorded["args"] = args
        recorded["kwargs"] = kwargs
        return FakeProcess()

    monkeypatch.setattr("xsafeclaw.api.routes.sidebar.subprocess.Popen", fake_popen)
    process = _start_sidebar_process("http://127.0.0.1:9999/api")
    assert process.poll() is None
    args = recorded["args"]
    assert "--api-base" in args
    assert args[args.index("--api-base") + 1] == "http://127.0.0.1:9999/api"


def test_hermes_windows_installer_uses_official_powershell_script() -> None:
    args = _hermes_windows_install_args("powershell")
    assert args[:4] == ["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass"]
    assert "install.ps1" in args[-1]
    assert "irm https://raw.githubusercontent.com/NousResearch/hermes-agent/main/scripts/install.ps1" in args[-1]

