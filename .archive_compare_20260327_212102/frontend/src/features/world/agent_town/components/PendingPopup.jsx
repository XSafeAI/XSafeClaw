/**
 * Permission request popup for Pending NPC.
 * Pixel-art styled with Approve / Deny buttons.
 */
export default function PendingPopup({ onClose }) {
  return (
    <div className="popup-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="popup-inner">
        <div className="popup-head">
          Permission Request
          <span className="popup-close" onClick={onClose}>×</span>
        </div>
        <div className="popup-body">
          <div className="kv">
            <div>Agent</div><span>Agent-Edward</span>
            <div>Action</div><span>execute_shell_command</span>
            <div>Target</div><span>/usr/bin/sudo apt install python3-dev</span>
            <div>Risk Level</div><span className="badge-error">HIGH</span>
            <div>Reason</div><span>Package installation requires root</span>
            <div>Requested</div><span>2 min ago</span>
          </div>
          <div className="popup-btns">
            <button className="btn primary" onClick={onClose}>Approve</button>
            <button className="btn deny" onClick={onClose}>Deny</button>
          </div>
        </div>
      </div>
    </div>
  );
}
