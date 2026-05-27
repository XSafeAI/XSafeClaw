from xsafeclaw.desktop_sidebar import (
    MOCK_RISK_APPROVAL_CARDS,
    apply_risk_approval_action,
    get_collapsed_panel_for_design_y,
    get_pending_risk_count_from_cards,
    get_risk_footer_layout,
    get_risk_sort_selector_layout,
    get_xsafeclaw_logo_path,
    is_scalable_canvas_width_item,
    parse_approval_hitbox_key,
    sort_risk_approval_cards,
)


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
    assert logo_path.parent.name == "assets"


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

