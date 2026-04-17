const SWITCH_GOLD_OFF_URL = '/UI/png/switch/switch_gold_off.png';
const SWITCH_GOLD_ON_URL = '/UI/png/switch/switch_gold_on.png';

export default function ImageSwitch({
  checked = false,
  onClick,
  label = '',
  onText = 'ON',
  offText = 'OFF',
  className = '',
}) {
  const stateText = checked ? onText : offText;
  const classes = ['tc-image-switch', checked ? 'tc-image-switch-on' : '', className].filter(Boolean).join(' ');

  return (
    <button
      type="button"
      className={classes}
      onClick={onClick}
      aria-pressed={checked}
      aria-label={label ? `${label}: ${stateText}` : stateText}
    >
      <img
        className="tc-image-switch-track"
        src={checked ? SWITCH_GOLD_ON_URL : SWITCH_GOLD_OFF_URL}
        alt=""
        draggable={false}
      />
      <span className="tc-image-switch-copy">
        {label ? <span className="tc-image-switch-label">{label}</span> : null}
        <span className="tc-image-switch-state">{stateText}</span>
      </span>
    </button>
  );
}
