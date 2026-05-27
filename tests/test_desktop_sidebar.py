from xsafeclaw.desktop_sidebar import (
    MOCK_RISK_APPROVAL_CARDS,
    apply_risk_approval_action,
    get_pending_risk_count_from_cards,
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

